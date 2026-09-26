import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/audit";
import { countSmsSegments } from "@/lib/messaging/sms-segments";
import type { Channel } from "@/lib/messaging/types";
import type { PolicyGate } from "@/lib/jobs/send-core";
import { getEntitlements, getPeriodUsage, type Entitlements } from "./entitlements";
import { getV4Entitlements } from "./v4-entitlements";
import { getTokenStatus } from "./token-service";
import { consumeMessageCredits, getCreditBalances, type CreditBalances } from "./message-credits";
import { allowancesFor, type MessageCreditChannel } from "./plans";
import {
  dailyCapAllows,
  limitLevel,
  limitPercent,
  nextDailyReset,
  splitConsumption,
  upsellFor,
  type LimitLevel,
  type LimitMetric,
  type OverageSettings,
  type UpsellOffer,
} from "./limits";
import { enforcedDailyCap, type AllocationChannel } from "./usage-allocation";
import { daysBetween, GRACE_FULL_ACCESS_DAYS, MAX_DUNNING_ATTEMPTS } from "./lifecycle";
import { getOpenDunning } from "./dunning";

/**
 * Server side of metered limits (8.13): what the send gate enforces, what the
 * meter records, and what the Usage & limits view and the app banner show.
 * Everything is derived from the same allowances (plans.ts via
 * `allowancesFor`) and the same ledger (`usage_events`), so the view cannot
 * show a number the gate does not enforce.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const METERED_CHANNELS = new Set<Channel>(["sms", "whatsapp"]);
const CAPPED_CHANNELS = new Set<Channel>(["sms", "whatsapp", "email"]);

const USAGE_METRIC: Record<MessageCreditChannel, "sms_outbound_segment" | "whatsapp_message"> = {
  sms: "sms_outbound_segment",
  whatsapp: "whatsapp_message",
};

function calendarPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function periodStartOf(entitlements: Entitlements, now = new Date()): string {
  return entitlements.periodStart ?? `${calendarPeriod(now)}T00:00:00.000Z`;
}

async function sumUsage(businessId: string, metric: string, since: string): Promise<number> {
  const { data, error } = await createAdminClient().rpc("sum_usage_events", {
    p_business_id: businessId,
    p_metric: metric,
    p_since: since,
  });
  // A failed read must not read as zero: zero is the state that unlocks sends.
  if (error) throw new Error(`Could not read ${metric} usage: ${error.message}`);
  return Number(data ?? 0);
}

/** Units a message consumes: SMS segments, or one WhatsApp message. */
export function unitsFor(channel: MessageCreditChannel, body: string): number {
  return channel === "sms" ? Math.max(1, countSmsSegments(body).segments) : 1;
}

type AllocationRow = {
  overage_enabled: boolean | null;
  overage_cap_minor: number | null;
  daily_caps_json: Partial<Record<AllocationChannel, number>> | null;
};

async function allocationRow(businessId: string, now = new Date()): Promise<AllocationRow | null> {
  const { data, error } = await db()
    .from("customer_usage_allocations")
    .select("overage_enabled, overage_cap_minor, daily_caps_json")
    .eq("business_id", businessId)
    .eq("billing_period", calendarPeriod(now))
    .maybeSingle();
  if (error) throw new Error(`Could not read usage settings: ${error.message}`);
  return (data as AllocationRow | null) ?? null;
}

/** Messaging overage already incurred this calendar month, in pence. */
export async function overageSpentMinor(businessId: string, now = new Date()): Promise<number> {
  const { data, error } = await db()
    .from("usage_overage_events")
    .select("amount_minor")
    .eq("business_id", businessId)
    .eq("billing_period", calendarPeriod(now));
  if (error) throw new Error(`Could not read overage spend: ${error.message}`);
  return ((data ?? []) as { amount_minor: number }[]).reduce((sum, row) => sum + Number(row.amount_minor), 0);
}

/**
 * The overage budget: switched on, with a cap, and with room left under it.
 * This is what makes the spend cap a limit rather than a boolean.
 */
export async function getOverageBudget(businessId: string, now = new Date()) {
  const [row, spentMinor] = await Promise.all([
    allocationRow(businessId, now),
    overageSpentMinor(businessId, now),
  ]);
  const capMinor = Number(row?.overage_cap_minor ?? 0);
  const enabled = Boolean(row?.overage_enabled) && capMinor > 0;
  return { enabled, capMinor, spentMinor, remainingMinor: Math.max(0, capMinor - spentMinor) };
}

async function sentToday(businessId: string, channel: Channel, now: Date): Promise<number> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { count, error } = await createAdminClient()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("channel", channel)
    .eq("direction", "outbound")
    .in("status", ["SENDING", "SENT", "DELIVERED"])
    .gte("created_at", startOfDay.toISOString());
  if (error) throw new Error(`Could not count today's ${channel} sends: ${error.message}`);
  return count ?? 0;
}

/* ------------------------------------------------------------- send gate */

const LIMIT_MESSAGES: Record<"LIMIT_REACHED" | "OVERAGE_CAP_REACHED", (channel: string) => string> = {
  LIMIT_REACHED: (channel) =>
    `This month's ${channel} allowance is used up and there is no top-up credit left. Buy credits or turn on overage in Settings → Billing & Usage.`,
  OVERAGE_CAP_REACHED: (channel) =>
    `This ${channel} message would take overage past the monthly spend cap you set. Raise the cap or buy credits in Settings → Billing & Usage.`,
};

/**
 * The billing half of the send-time gate, run immediately before a message
 * goes to the carrier. Null means "billing has no objection".
 *
 *   * dunning pause (payment failed 3+ days ago)  -> defer 24h, not dropped
 *   * daily cap for the channel reached            -> defer to tomorrow
 *   * SMS/WhatsApp: allowance, then credit, then overage within its cap,
 *     otherwise                                    -> block, with the reason
 */
export async function billingSendGate(input: {
  businessId: string;
  channel: Channel;
  body: string;
  origin: string;
  at: Date;
}): Promise<PolicyGate | null> {
  const entitlements = await getEntitlements(input.businessId);

  if (entitlements.access === "restricted") {
    return {
      action: "defer",
      at: new Date(input.at.getTime() + 24 * 60 * 60 * 1000),
      reasonCode: "BLOCKED_BUSINESS_STATE",
    };
  }
  if (!entitlements.sendingAllowed) {
    return {
      action: "block",
      reasonCode: "BLOCKED_BUSINESS_STATE",
      message: "This workspace does not have an active subscription.",
    };
  }

  const needsCaps = CAPPED_CHANNELS.has(input.channel) && input.origin !== "manual";
  const needsMetering = METERED_CHANNELS.has(input.channel);
  if (!needsCaps && !needsMetering) return null;

  const allocation = await allocationRow(input.businessId, input.at);

  // A daily cap paces automated and campaign traffic; a person typing a reply
  // is not held back by it.
  if (needsCaps) {
    const cap = enforcedDailyCap(input.channel as AllocationChannel, allocation?.daily_caps_json);
    const today = await sentToday(input.businessId, input.channel, input.at);
    if (!dailyCapAllows({ sentToday: today, cap })) {
      return { action: "defer", at: nextDailyReset(input.at), reasonCode: "BLOCKED_DAILY_LIMIT" };
    }
  }

  if (!needsMetering) return null;

  const channel = input.channel as MessageCreditChannel;
  const split = await consumptionFor({
    businessId: input.businessId,
    entitlements,
    channel,
    units: unitsFor(channel, input.body),
    allocation,
    at: input.at,
  });

  if (!split.allowed) {
    const label = channel === "sms" ? "SMS" : "WhatsApp";
    return {
      action: "block",
      reasonCode: split.refusal === "OVERAGE_CAP_REACHED" ? "BLOCKED_COST_BUDGET" : "BLOCKED_MONTHLY_LIMIT",
      message: LIMIT_MESSAGES[split.refusal ?? "LIMIT_REACHED"](label),
    };
  }
  return null;
}

async function consumptionFor(input: {
  businessId: string;
  entitlements: Entitlements;
  channel: MessageCreditChannel;
  units: number;
  allocation: AllocationRow | null;
  at: Date;
}) {
  const allowances = allowancesFor(input.entitlements.plan);
  const allowance =
    input.channel === "sms" ? allowances.smsSegmentAllowance : allowances.whatsappMessageAllowance;
  const unitPricePence =
    input.channel === "sms" ? allowances.smsOveragePence : allowances.whatsappOveragePence;

  const [used, credits, spentMinor] = await Promise.all([
    sumUsage(input.businessId, USAGE_METRIC[input.channel], periodStartOf(input.entitlements, input.at)),
    getCreditBalances(input.businessId),
    overageSpentMinor(input.businessId, input.at),
  ]);

  const capMinor = Number(input.allocation?.overage_cap_minor ?? 0);
  const overage: OverageSettings = {
    enabled: Boolean(input.allocation?.overage_enabled) && capMinor > 0,
    capMinor,
    spentMinor,
    unitPricePence,
  };

  return {
    ...splitConsumption({
      quantity: input.units,
      allowance,
      usedThisPeriod: used,
      creditBalance: credits[input.channel],
      overage,
    }),
    unitPricePence,
  };
}

/* ------------------------------------------------------------------ meter */

/**
 * After a send: records the units against the ledger (SMS by segment), then
 * spends any credit and records any overage the send needed -- in that order,
 * matching the gate. Never throws: the message has already gone, and a failure
 * here must not fail (and so retry) a send that succeeded. Idempotent on the
 * message: a second run finds the ledger row and stops.
 */
export async function meterSendBilling(input: {
  businessId: string;
  messageId: string;
  channel: Channel;
  body: string;
}): Promise<void> {
  if (!METERED_CHANNELS.has(input.channel)) return;
  const channel = input.channel as MessageCreditChannel;
  const operationId = `send-units:${input.messageId}`;

  try {
    const existing = await createAdminClient()
      .from("usage_events")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("operation_id", operationId)
      .limit(1);
    if (existing.error) throw existing.error;
    if (existing.data?.length) return;

    const now = new Date();
    const entitlements = await getEntitlements(input.businessId);
    const units = unitsFor(channel, input.body);
    const allocation = await allocationRow(input.businessId, now);
    // Split against usage *before* this message is recorded.
    const split = await consumptionFor({
      businessId: input.businessId,
      entitlements,
      channel,
      units,
      allocation,
      at: now,
    });

    await recordUsage({
      businessId: input.businessId,
      metric: USAGE_METRIC[channel],
      quantity: units,
      provider: "twilio",
      entity: { type: "message", id: input.messageId },
      operationId,
      metadata: {
        from_allowance: split.fromAllowance,
        from_credits: split.fromCredits,
        from_overage: split.fromOverage,
      },
    });

    if (split.fromCredits > 0) {
      await consumeMessageCredits({
        businessId: input.businessId,
        channel,
        quantity: split.fromCredits,
        messageId: input.messageId,
      });
    }

    // Past allowance and credit with no overage room means the gate's view
    // was overtaken by a concurrent send. The message went, so it is recorded
    // as overage at the plan's price if the plan has one, even past the cap;
    // the next send is refused. A plan without an overage price records none.
    const overageUnits = split.allowed ? split.fromOverage : units - split.fromAllowance - split.fromCredits;
    if (overageUnits > 0 && split.unitPricePence !== null) {
      const { error } = await db()
        .from("usage_overage_events")
        .insert({
          business_id: input.businessId,
          channel,
          billing_period: calendarPeriod(now),
          units: overageUnits,
          unit_price_pence: split.unitPricePence,
          amount_minor: Math.ceil(overageUnits * split.unitPricePence),
          message_id: input.messageId,
        });
      if (error && error.code !== "23505") throw error;
    }
  } catch (error) {
    console.error("[billing meter] could not meter a sent message", {
      businessId: input.businessId,
      messageId: input.messageId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ------------------------------------------------------- limits overview */

export type LimitRow = {
  key: string;
  metric: LimitMetric | "email" | "prospects" | "search_runs";
  label: string;
  unit: string;
  monthly: { used: number; limit: number; percent: number; level: LimitLevel };
  daily: { used: number; cap: number } | null;
  credits: number | null;
  /** What happens at the limit, in words. */
  atLimit: string;
  upsell: UpsellOffer | null;
};

export type LimitsOverview = {
  plan: string;
  selectedPlan: string;
  state: Entitlements["state"];
  periodStart: string;
  rows: LimitRow[];
  credits: CreditBalances;
  overage: Awaited<ReturnType<typeof getOverageBudget>>;
  /** Whether the plan includes WhatsApp: decides which credit bundles are offered. */
  whatsappEnabled: boolean;
};

function row(input: Omit<LimitRow, "monthly" | "upsell"> & {
  used: number;
  limit: number;
  plan: string;
  upsellMetric?: LimitMetric;
}): LimitRow {
  const { used, limit, plan, upsellMetric, ...rest } = input;
  return {
    ...rest,
    monthly: { used, limit, percent: limitPercent(used, limit), level: limitLevel(used, limit) },
    upsell: upsellMetric ? upsellFor({ metric: upsellMetric, plan, used, limit }) : null,
  };
}

function atLimitText(input: {
  credits: number;
  overagePrice: number | null;
  overageEnabled: boolean;
}): string {
  const parts = ["Sends stop at the monthly allowance"];
  if (input.credits > 0) parts.push(`then your ${input.credits.toLocaleString("en-GB")} top-up credits are used`);
  if (input.overagePrice !== null && input.overageEnabled) {
    parts.push(`then overage at ${input.overagePrice}p each, up to your spend cap`);
  } else if (input.overagePrice !== null) {
    parts.push("overage is off, so sending stops there");
  }
  return `${parts.join(", ")}.`;
}

export async function getLimitsOverview(businessId: string): Promise<LimitsOverview> {
  const now = new Date();
  const entitlements = await getEntitlements(businessId);
  const since = periodStartOf(entitlements, now);
  const allowances = allowancesFor(entitlements.plan);
  // Upsells start from the tier being paid for (or chosen, in a trial).
  const upsellPlan = entitlements.state === "TRIALING" ? entitlements.selectedPlan : entitlements.plan;

  const [allocation, credits, overage, smsUsed, whatsappUsed, periodUsage, v4, tokens, smsToday, waToday, emailToday, seats] =
    await Promise.all([
      allocationRow(businessId, now),
      getCreditBalances(businessId),
      getOverageBudget(businessId, now),
      sumUsage(businessId, "sms_outbound_segment", since),
      sumUsage(businessId, "whatsapp_message", since),
      getPeriodUsage(businessId, entitlements.periodStart),
      getV4Entitlements(businessId),
      getTokenStatus(businessId).catch(() => null),
      sentToday(businessId, "sms", now),
      sentToday(businessId, "whatsapp", now),
      sentToday(businessId, "email", now),
      createAdminClient()
        .from("business_members")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .in("status", ["active", "invited"]),
    ]);

  const [emailUsed, prospectsUsed, runsUsed] = await Promise.all([
    sumUsage(businessId, "email_sent", since),
    sumUsage(businessId, "verified_prospect", since),
    sumUsage(businessId, "search_run", since),
  ]);

  const caps = allocation?.daily_caps_json ?? null;
  const rows: LimitRow[] = [
    row({
      key: "leads",
      metric: "leads",
      label: "New leads",
      unit: "leads",
      used: periodUsage.leads,
      limit: entitlements.leadLimit,
      plan: upsellPlan,
      upsellMetric: "leads",
      daily: null,
      credits: null,
      // Honest about current behaviour: no lead is ever dropped for a limit.
      atLimit: "Leads keep being captured and followed up; a lead is never dropped for a limit. Regularly going over means the next plan fits better.",
    }),
    row({
      key: "sms",
      metric: "sms",
      label: "SMS",
      unit: "segments",
      used: smsUsed,
      limit: allowances.smsSegmentAllowance,
      plan: upsellPlan,
      upsellMetric: "sms",
      daily: { used: smsToday, cap: enforcedDailyCap("sms", caps) },
      credits: credits.sms,
      atLimit: atLimitText({
        credits: credits.sms,
        overagePrice: allowances.smsOveragePence,
        overageEnabled: overage.enabled,
      }),
    }),
    row({
      key: "whatsapp",
      metric: "whatsapp",
      label: "WhatsApp",
      unit: "messages",
      used: whatsappUsed,
      limit: allowances.whatsappMessageAllowance,
      plan: upsellPlan,
      upsellMetric: "whatsapp",
      daily: { used: waToday, cap: enforcedDailyCap("whatsapp", caps) },
      credits: credits.whatsapp,
      atLimit: entitlements.whatsappEnabled
        ? atLimitText({
            credits: credits.whatsapp,
            overagePrice: allowances.whatsappOveragePence,
            overageEnabled: overage.enabled,
          })
        : "WhatsApp is not included in this plan.",
    }),
    row({
      key: "email",
      metric: "email",
      label: "Email",
      unit: "emails",
      used: emailUsed,
      limit: v4.allowances.email_sent.hardLimit,
      plan: upsellPlan,
      daily: { used: emailToday, cap: enforcedDailyCap("email", caps) },
      credits: null,
      atLimit: v4.allowances.email_sent.overageAllowed
        ? "Outreach email stops at the allowance unless overage is on, then continues up to your spend cap."
        : "Outreach email stops at the allowance.",
    }),
    row({
      key: "ai_tokens",
      metric: "ai_tokens",
      label: "AI tokens",
      unit: "tokens",
      used: tokens?.used ?? 0,
      limit: tokens?.granted ?? allowances.aiTokenAllowance,
      plan: upsellPlan,
      upsellMetric: "ai_tokens",
      daily: null,
      credits: tokens?.purchasedTokens ?? null,
      atLimit: "The AI assistant pauses; follow-up and qualification rules keep running. Top up tokens to resume.",
    }),
    row({
      key: "users",
      metric: "users",
      label: "Team members",
      unit: "seats",
      used: seats.count ?? 0,
      limit: entitlements.userLimit,
      plan: upsellPlan,
      upsellMetric: "users",
      daily: null,
      credits: null,
      atLimit: "New invitations are refused until a seat is freed or the plan is upgraded.",
    }),
    row({
      key: "prospects",
      metric: "prospects",
      label: "Verified prospects",
      unit: "prospects",
      used: prospectsUsed,
      limit: v4.allowances.verified_prospect.hardLimit,
      plan: upsellPlan,
      daily: null,
      credits: null,
      atLimit: "Sourcing stops at the allowance unless overage is on.",
    }),
    row({
      key: "search_runs",
      metric: "search_runs",
      label: "Sourcing runs",
      unit: "runs",
      used: runsUsed,
      limit: v4.allowances.search_run.hardLimit,
      plan: upsellPlan,
      daily: null,
      credits: null,
      atLimit: "New runs are refused until the next period.",
    }),
  ];

  return {
    plan: entitlements.plan,
    selectedPlan: entitlements.selectedPlan,
    state: entitlements.state,
    periodStart: since,
    rows,
    credits,
    overage,
    whatsappEnabled: entitlements.whatsappEnabled,
  };
}

/* --------------------------------------------------------------- banner */

export type BillingNotice = {
  tone: "info" | "warning" | "danger";
  title: string;
  body: string;
  action: { label: string; href: string } | null;
};

/**
 * The one banner the app shell shows, most urgent first: a failed payment,
 * an ended subscription, a trial about to convert, then a metered limit at
 * 80% or 100%. Honest: every figure is read, nothing is invented to hurry
 * anyone.
 */
export async function getBillingNotice(
  businessId: string,
  entitlements: Entitlements,
): Promise<BillingNotice | null> {
  const now = new Date();

  if (entitlements.state === "PAST_DUE_GRACE" || entitlements.state === "PAST_DUE_RESTRICTED") {
    const dunning = await getOpenDunning(businessId);
    const day = dunning ? daysBetween(new Date(dunning.firstFailedAt), now) : 0;
    return entitlements.state === "PAST_DUE_RESTRICTED"
      ? {
          tone: "danger",
          title: "Sending and AI are paused: your last payment failed",
          body: `Leads are still being captured and nothing has been deleted. We retry the charge daily (${dunning?.attempts ?? 0} of ${MAX_DUNNING_ATTEMPTS} retries so far). Update your card to resume straight away.`,
          action: { label: "Update card", href: "/api/billing/portal" },
        }
      : {
          tone: "warning",
          title: "Your last payment didn't go through",
          body: `Everything is still running. We will retry daily; if it is still unpaid ${Math.max(0, GRACE_FULL_ACCESS_DAYS - day)} day(s) from now, sending and AI pause until it is.`,
          action: { label: "Update card", href: "/api/billing/portal" },
        };
  }

  if (entitlements.state === "CANCELLED") {
    return {
      tone: "danger",
      title: "This workspace is read-only",
      body: "The subscription has ended. Your data is intact and can be exported; resubscribe to carry on.",
      action: { label: "Resubscribe", href: "/start-trial" },
    };
  }

  if (entitlements.state === "TRIALING" && entitlements.trialEndsAt) {
    const daysLeft = Math.ceil((new Date(entitlements.trialEndsAt).getTime() - now.getTime()) / 86_400_000);
    if (daysLeft <= 3 && daysLeft >= 0) {
      return {
        tone: "info",
        title: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body: "Your card is charged then and the plan's full limits switch on. Change plan or cancel from Billing.",
        action: { label: "Review plan", href: "/app/settings?section=billing" },
      };
    }
  }

  // Metered limits at 80% / 100%: the ones that stop work.
  const since = periodStartOf(entitlements, now);
  const allowances = allowancesFor(entitlements.plan);
  const [smsUsed, whatsappUsed, credits] = await Promise.all([
    sumUsage(businessId, "sms_outbound_segment", since),
    sumUsage(businessId, "whatsapp_message", since),
    getCreditBalances(businessId),
  ]);

  const candidates: { label: string; used: number; limit: number; credits: number }[] = [
    { label: "SMS allowance", used: smsUsed, limit: allowances.smsSegmentAllowance, credits: credits.sms },
    ...(entitlements.whatsappEnabled
      ? [{ label: "WhatsApp allowance", used: whatsappUsed, limit: allowances.whatsappMessageAllowance, credits: credits.whatsapp }]
      : []),
  ];

  for (const candidate of candidates) {
    if (candidate.limit <= 0) continue;
    const level = limitLevel(candidate.used, candidate.limit);
    if (level === "ok") continue;
    if (level === "reached" && candidate.credits > 0) continue; // credit is covering it
    return {
      tone: level === "reached" ? "danger" : "warning",
      title:
        level === "reached"
          ? `You've used this month's ${candidate.label}`
          : `You've used ${limitPercent(candidate.used, candidate.limit)}% of this month's ${candidate.label}`,
      body:
        level === "reached"
          ? "New sends on this channel are refused until the period resets. Buy top-up credits or upgrade to keep sending."
          : "Top up or upgrade before it runs out, or let it pause at the limit; nothing is charged unless you choose to.",
      action: { label: "See usage & limits", href: "/app/settings?section=billing#usage-limits" },
    };
  }

  return null;
}
