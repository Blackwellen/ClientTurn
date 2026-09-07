import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { loadSenderHealth } from "@/lib/outreach/campaigns/sender";
import {
  ALLOCATION_CHANNELS,
  DEFAULT_ALLOCATION,
  effectiveDailyCap,
  estimateSends,
  type Allocation,
  type AllocationChannel,
  type DailyCaps,
  type SendEstimate,
} from "./usage-allocation";

/**
 * UsageService — the server-authoritative view of what a workspace has used and
 * what it is allowed to use (V4 §27).
 *
 * Everything a customer can change here is a *narrowing*: they may allocate
 * their own allowance across channels, and they may lower a daily cap. They
 * cannot raise a limit, cannot grant themselves allowance, and cannot enable
 * spend beyond the account ceiling — all of which are re-derived here from plan
 * entitlements, never read from the browser.
 *
 * No provider cost appears in anything this module returns. Spend is the
 * customer's own billed spend; the wholesale price book stays server-side.
 */

export type ChannelUsage = {
  channel: AllocationChannel;
  sent: number;
  delivered: number;
  replies: number;
  deliveryRate: number | null;
  replyRate: number | null;
};

export type UsageMonth = {
  /** `YYYY-MM`. */
  period: string;
  label: string;
  prospectsSourced: number;
  messagesSent: number;
  intentMonitors: number;
  searchRuns: number;
  totalSpend: number;
  current: boolean;
};

export type UsageLimit = { used: number; limit: number };

export type UsageOverview = {
  /** `YYYY-MM-01`, the billing period these figures belong to. */
  period: string;
  allocation: Allocation;
  estimates: SendEstimate[];
  /** What the customer asked for. */
  dailyCaps: DailyCaps;
  /** What actually applies after plan, platform and sender-health ceilings. */
  effectiveCaps: DailyCaps;
  overageEnabled: boolean;
  overageCapMinor: number;
  accountMaxOverageMinor: number;
  monthlyAllowance: number;
  limits: {
    sourcing: UsageLimit;
    communication: UsageLimit;
    intentMonitors: UsageLimit;
    searchRuns: UsageLimit;
  };
  channels: ChannelUsage[];
  history: UsageMonth[];
};

/** First day of the current billing month, UTC. */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(yearMonth: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00Z`));
}

export async function getUsageOverview(
  businessId: string,
): Promise<UsageOverview> {
  const admin = createAdminClient();
  const period = currentPeriod();
  const periodStart = `${period}T00:00:00.000Z`;

  const [allocationRow, v4, senders] = await Promise.all([
    admin
      .from("customer_usage_allocations")
      .select(
        "email_percent, sms_percent, whatsapp_percent, overage_enabled, overage_cap_minor, daily_caps_json",
      )
      .eq("business_id", businessId)
      .eq("billing_period", period)
      .maybeSingle(),
    getV4Entitlements(businessId),
    loadSenderHealth(businessId),
  ]);

  const allocation: Allocation = allocationRow.data
    ? {
        email: Number(allocationRow.data.email_percent),
        sms: Number(allocationRow.data.sms_percent),
        whatsapp: Number(allocationRow.data.whatsapp_percent),
      }
    : DEFAULT_ALLOCATION;

  const storedCaps = (allocationRow.data?.daily_caps_json ?? {}) as Partial<
    Record<AllocationChannel, number>
  >;

  // Email's ceiling is bounded by what this workspace's own healthy mailboxes
  // can carry. A 2,000/day cap over a mailbox that safely does 300 is a cap
  // that could only be met by damaging the sending domain.
  const senderCapacity = senders
    .filter((sender) => sender.warmState !== "BLOCKED")
    .reduce((sum, sender) => sum + sender.dailySendCap, 0);

  const monthlyAllowance = v4.allowances.email_sent.hardLimit || 0;

  const planCaps: DailyCaps = {
    // A sensible daily fraction of the monthly allowance, floored so a small
    // plan is not effectively unable to send on any single day.
    email: Math.max(50, Math.round(monthlyAllowance / 20)),
    sms: Math.max(20, Math.round(monthlyAllowance / 80)),
    whatsapp: Math.max(20, Math.round(monthlyAllowance / 80)),
  };

  const dailyCaps = {} as DailyCaps;
  const effectiveCaps = {} as DailyCaps;

  for (const channel of ALLOCATION_CHANNELS) {
    const requested = storedCaps[channel] ?? planCaps[channel];
    dailyCaps[channel] = requested;
    effectiveCaps[channel] = effectiveDailyCap({
      channel,
      requested,
      planCap: planCaps[channel],
      senderCapacity: channel === "email" ? senderCapacity : undefined,
    });
  }

  const [channels, counts, history] = await Promise.all([
    getChannelUsage(businessId, periodStart),
    getPeriodCounts(businessId, periodStart),
    getUsageHistory(businessId, period),
  ]);

  const messagesSent = channels.reduce((sum, row) => sum + row.sent, 0);

  return {
    period,
    allocation,
    estimates: estimateSends(allocation, monthlyAllowance),
    dailyCaps,
    effectiveCaps,
    // Off unless the customer explicitly switched it on (§27.13).
    overageEnabled: allocationRow.data?.overage_enabled ?? false,
    overageCapMinor: Number(allocationRow.data?.overage_cap_minor ?? 0),
    accountMaxOverageMinor: v4.allowances.email_sent.overageAllowed ? 500_00 : 0,
    monthlyAllowance,
    limits: {
      sourcing: {
        used: counts.prospects,
        limit: v4.allowances.verified_prospect.hardLimit,
      },
      communication: { used: messagesSent, limit: monthlyAllowance },
      intentMonitors: {
        used: counts.intentMonitors,
        limit: v4.allowances.intent_monitor.hardLimit,
      },
      searchRuns: {
        used: counts.searchRuns,
        limit: v4.allowances.search_run.hardLimit,
      },
    },
    channels,
    history,
  };
}

/* --------------------------------------------------------------- counting */

/** Messages this period, per channel, counted by Postgres rather than scanned. */
async function getChannelUsage(
  businessId: string,
  periodStart: string,
): Promise<ChannelUsage[]> {
  const admin = createAdminClient();

  return Promise.all(
    ALLOCATION_CHANNELS.map(async (channel) => {
      const base = () =>
        admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("channel", channel)
          .gte("created_at", periodStart);

      const [sent, delivered, replies] = await Promise.all([
        base()
          .eq("direction", "outbound")
          .in("status", ["SENT", "DELIVERED", "FAILED"]),
        base().eq("direction", "outbound").eq("status", "DELIVERED"),
        base().eq("direction", "inbound"),
      ]);

      const sentCount = sent.count ?? 0;
      return {
        channel,
        sent: sentCount,
        delivered: delivered.count ?? 0,
        replies: replies.count ?? 0,
        // Null, not zero: "0% delivery" on a channel nothing was sent through
        // reads as failure rather than as absence.
        deliveryRate: sentCount > 0 ? (delivered.count ?? 0) / sentCount : null,
        replyRate: sentCount > 0 ? (replies.count ?? 0) / sentCount : null,
      };
    }),
  );
}

async function getPeriodCounts(businessId: string, periodStart: string) {
  const admin = createAdminClient();

  const [prospects, searchRuns, intentMonitors] = await Promise.all([
    admin
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", periodStart),
    admin
      .from("sourcing_runs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", periodStart),
    // Monitors are a standing capacity, so what counts against the allowance
    // is how many are live now — not how many ran this month.
    admin
      .from("intent_monitors")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "ACTIVE"),
  ]);

  return {
    prospects: prospects.count ?? 0,
    searchRuns: searchRuns.count ?? 0,
    intentMonitors: intentMonitors.count ?? 0,
  };
}

/** The last six months, rolled up rather than recomputed from raw events. */
async function getUsageHistory(
  businessId: string,
  currentPeriodStart: string,
): Promise<UsageMonth[]> {
  const admin = createAdminClient();

  const from = new Date(`${currentPeriodStart}T00:00:00Z`);
  from.setUTCMonth(from.getUTCMonth() - 5);
  const fromIso = from.toISOString();

  const [prospects, runs, messages, costs] = await Promise.all([
    admin
      .from("prospects")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", fromIso)
      .limit(50000),
    admin
      .from("sourcing_runs")
      .select("created_at")
      .eq("business_id", businessId)
      .gte("created_at", fromIso)
      .limit(5000),
    admin
      .from("messages")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("direction", "outbound")
      .gte("created_at", fromIso)
      .limit(50000),
    admin
      .from("business_cost_daily")
      .select("date, total_cost")
      .eq("business_id", businessId)
      .gte("date", fromIso.slice(0, 10))
      .limit(400),
  ]);

  const bucket = (rows: { created_at: string }[] | null) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const key = row.created_at.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const prospectCounts = bucket(prospects.data);
  const runCounts = bucket(runs.data);
  const messageCounts = bucket(messages.data);

  const spend = new Map<string, number>();
  for (const row of costs.data ?? []) {
    const key = row.date.slice(0, 7);
    spend.set(key, (spend.get(key) ?? 0) + Number(row.total_cost ?? 0));
  }

  const currentKey = currentPeriodStart.slice(0, 7);
  const months: UsageMonth[] = [];

  for (let index = 0; index < 6; index += 1) {
    const date = new Date(from);
    date.setUTCMonth(date.getUTCMonth() + index);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

    months.push({
      period: key,
      label: monthLabel(key),
      prospectsSourced: prospectCounts.get(key) ?? 0,
      messagesSent: messageCounts.get(key) ?? 0,
      // Monitors are a standing capacity, not a monthly event, so the current
      // count is reported rather than a per-month total that would be a
      // different measure wearing the same label.
      intentMonitors: 0,
      searchRuns: runCounts.get(key) ?? 0,
      totalSpend: spend.get(key) ?? 0,
      current: key === currentKey,
    });
  }

  return months.reverse();
}
