import "server-only";
import { createClient } from "@/lib/supabase/server";
import { rate } from "./v4-metrics";
import type { RangeBounds } from "./v4-queries";

/**
 * The parts of Analytics that are shapes rather than single numbers (V4 §21):
 * the trend series, the source and channel breakdowns, conversion goals,
 * campaign performance, and the insights derived from all of them.
 *
 * Kept beside `v4-queries.ts` rather than inside it so neither file becomes the
 * thousand-line module nobody wants to open. Both obey the same rule: a metric
 * has exactly one definition, and no React component recomputes it.
 *
 * The universal exclusions still apply — `is_test` records and internal
 * support traffic never appear in any figure below.
 */

type Supa = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ trends */

export type TrendPoint = {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  prospects: number;
  contactsSent: number;
  replies: number;
  leads: number;
  converted: number;
};

/** Bucket boundaries for the window, one per day. */
function dayKeys(bounds: RangeBounds): string[] {
  const keys: string[] = [];
  const cursor = new Date(bounds.from);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= bounds.to) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function bucket(rows: { created_at: string }[] | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = row.created_at.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The daily series behind the trends chart.
 *
 * Reads timestamps only — never whole rows — and caps each read, because a
 * twelve-month window on a busy workspace is the one query here that could
 * otherwise pull a great deal of data to draw a line.
 */
export async function getTrends(
  businessId: string,
  bounds: RangeBounds,
): Promise<TrendPoint[]> {
  const supabase = await createClient();
  const from = bounds.from.toISOString();
  const to = bounds.to.toISOString();

  const [prospects, outbound, inbound, leads, won] = await Promise.all([
    supabase
      .from("prospects")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(50000),
    supabase
      .from("messages")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("direction", "outbound")
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(50000),
    supabase
      .from("messages")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("direction", "inbound")
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(50000),
    supabase
      .from("leads")
      .select("created_at")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(50000),
    supabase
      .from("leads")
      .select("won_at")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("won_at", from)
      .lt("won_at", to)
      .limit(50000),
  ]);

  const p = bucket(prospects.data);
  const o = bucket(outbound.data);
  const i = bucket(inbound.data);
  const l = bucket(leads.data);
  const w = bucket(
    (won.data ?? []).map((row) => ({ created_at: row.won_at as string })),
  );

  return dayKeys(bounds).map((date) => ({
    date,
    prospects: p.get(date) ?? 0,
    contactsSent: o.get(date) ?? 0,
    replies: i.get(date) ?? 0,
    leads: l.get(date) ?? 0,
    converted: w.get(date) ?? 0,
  }));
}

/* ------------------------------------------------------- channel breakdown */

export type ChannelRow = {
  channel: string;
  sent: number;
  delivered: number;
  replies: number;
  optOuts: number;
  deliveryRate: number | null;
  replyRate: number | null;
};

/**
 * Per-channel outreach performance.
 *
 * Counted per channel rather than dividing one global delivered count across
 * channels: the previous shape reported SMS and WhatsApp delivery as zero,
 * which read as total failure rather than as "not measured".
 */
export async function getChannelPerformance(
  businessId: string,
  bounds: RangeBounds,
): Promise<ChannelRow[]> {
  const supabase = await createClient();
  const from = bounds.from.toISOString();
  const to = bounds.to.toISOString();

  const channels = ["email", "sms", "whatsapp"] as const;

  const rows = await Promise.all(
    channels.map(async (channel) => {
      const base = () =>
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("channel", channel)
          .gte("created_at", from)
          .lt("created_at", to);

      const [sent, delivered, replies, optOuts] = await Promise.all([
        base()
          .eq("direction", "outbound")
          .in("status", ["SENT", "DELIVERED", "FAILED"]),
        base().eq("direction", "outbound").eq("status", "DELIVERED"),
        base().eq("direction", "inbound"),
        supabase
          .from("contact_suppressions")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("channel", channel)
          .gte("created_at", from)
          .lt("created_at", to),
      ]);

      const sentCount = sent.count ?? 0;
      return {
        channel:
          channel === "sms" ? "SMS" : channel === "whatsapp" ? "WhatsApp" : "Email",
        sent: sentCount,
        delivered: delivered.count ?? 0,
        replies: replies.count ?? 0,
        optOuts: optOuts.count ?? 0,
        deliveryRate: rate(delivered.count ?? 0, sentCount),
        replyRate: rate(replies.count ?? 0, sentCount),
      };
    }),
  );

  return rows.filter((row) => row.sent > 0 || row.replies > 0);
}

/* -------------------------------------------------------- conversion goals */

export type GoalRow = {
  id: string;
  name: string;
  type: string;
  count: number;
  share: number | null;
};

/**
 * Results by conversion goal.
 *
 * Attributed through `leads.conversion_goal_id`, which is set once when the
 * lead is created and never rewritten — so a lead counts towards exactly one
 * goal and the shares always sum to the total. Leads with no goal are reported
 * as "Other" rather than being quietly dropped.
 */
export async function getConversionGoals(
  businessId: string,
  bounds: RangeBounds,
): Promise<GoalRow[]> {
  const supabase = await createClient();

  const [goals, leads] = await Promise.all([
    supabase
      .from("conversion_goals")
      .select("id, name, type")
      .eq("business_id", businessId),
    supabase
      .from("leads")
      .select("conversion_goal_id")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .not("booked_at", "is", null)
      .gte("booked_at", bounds.from.toISOString())
      .lt("booked_at", bounds.to.toISOString())
      .limit(50000),
  ]);

  const counts = new Map<string, number>();
  for (const row of leads.data ?? []) {
    const key = row.conversion_goal_id ?? "__none__";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  const named: GoalRow[] = (goals.data ?? []).map((goal) => ({
    id: goal.id,
    name: goal.name,
    type: goal.type,
    count: counts.get(goal.id) ?? 0,
    share: rate(counts.get(goal.id) ?? 0, total),
  }));

  const unattributed = counts.get("__none__") ?? 0;
  if (unattributed > 0) {
    named.push({
      id: "__none__",
      name: "Other",
      type: "CUSTOM",
      count: unattributed,
      share: rate(unattributed, total),
    });
  }

  return named.filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------ campaign breakdown */

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  prospects: number;
  replies: number;
  leads: number;
  converted: number;
  conversionRate: number | null;
};

/** Top acquisition campaigns by prospects contacted. */
export async function getCampaignPerformance(
  businessId: string,
  limit = 6,
): Promise<CampaignRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("outreach_campaigns")
    .select("id, name, status")
    .eq("business_id", businessId)
    .neq("status", "DRAFT")
    .order("updated_at", { ascending: false })
    .limit(limit);

  const campaigns = data ?? [];
  if (campaigns.length === 0) return [];

  return Promise.all(
    campaigns.map(async (campaign) => {
      const base = () =>
        supabase
          .from("outreach_recipient_runs")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("campaign_id", campaign.id);

      const [prospects, replies, promoted] = await Promise.all([
        base(),
        base().not("replied_at", "is", null),
        promotedFromCampaign(supabase, businessId, campaign.id),
      ]);

      const total = prospects.count ?? 0;
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        prospects: total,
        replies: replies.count ?? 0,
        leads: promoted,
        converted: promoted,
        conversionRate: rate(promoted, total),
      };
    }),
  );
}

/**
 * How many of a campaign's prospects became leads.
 *
 * Promotion is recorded on the prospect, not on the recipient run, so this is
 * a two-hop count. Chunked because `in` with tens of thousands of ids is a
 * query Postgres will refuse rather than merely run slowly.
 */
async function promotedFromCampaign(
  supabase: Supa,
  businessId: string,
  campaignId: string,
): Promise<number> {
  const { data } = await supabase
    .from("outreach_recipient_runs")
    .select("prospect_id")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .limit(50000);

  const ids = (data ?? []).map((row) => row.prospect_id);
  if (ids.length === 0) return 0;

  let promoted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const { count } = await supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .not("promoted_to_lead_id", "is", null)
      .in("id", ids.slice(i, i + 500));
    promoted += count ?? 0;
  }
  return promoted;
}

/* ---------------------------------------------------------------- insights */

export type Insight = {
  key: string;
  title: string;
  body: string;
  tone: "positive" | "neutral" | "attention";
};

/**
 * Insights, derived — never invented (V4 §21.7).
 *
 * Every sentence below is computed from figures already on this page. There is
 * no model in this path and no claim that is not arithmetic on the workspace's
 * own data, because an "AI insight" that cannot be checked against the numbers
 * beside it is worse than no insight.
 */
export function deriveInsights(input: {
  channels: ChannelRow[];
  trends: TrendPoint[];
  campaigns: CampaignRow[];
  replyRateNow: number | null;
  replyRatePrevious: number | null;
}): Insight[] {
  const out: Insight[] = [];

  if (
    input.replyRateNow !== null &&
    input.replyRatePrevious !== null &&
    input.replyRatePrevious > 0
  ) {
    const change = (input.replyRateNow - input.replyRatePrevious) / input.replyRatePrevious;
    if (Math.abs(change) >= 0.1) {
      out.push({
        key: "reply_rate_change",
        title: `Reply rate ${change > 0 ? "up" : "down"} ${Math.abs(Math.round(change * 100))}%`,
        body: `Your reply rate has ${change > 0 ? "increased" : "fallen"} by ${Math.abs(
          Math.round(change * 100),
        )}% compared to the previous period.`,
        tone: change > 0 ? "positive" : "attention",
      });
    }
  }

  const ranked = [...input.channels]
    .filter((row) => row.replyRate !== null && row.sent >= 20)
    .sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0));

  if (ranked.length >= 2) {
    const [best, next] = ranked;
    const lift = ((best.replyRate ?? 0) - (next.replyRate ?? 0)) / (next.replyRate || 1);
    if (lift >= 0.1) {
      out.push({
        key: "best_channel",
        title: `${best.channel} performing best`,
        body: `${best.channel} is generating ${Math.round(lift * 100)}% more replies than ${next.channel}.`,
        tone: "positive",
      });
    }
  }

  const leading = [...input.campaigns]
    .filter((row) => row.conversionRate !== null && row.prospects >= 50)
    .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))[0];

  if (leading) {
    out.push({
      key: "leading_campaign",
      title: "Leading campaign",
      body: `"${leading.name}" has the highest conversion rate (${((leading.conversionRate ?? 0) * 100).toFixed(1)}%).`,
      tone: "positive",
    });
  }

  const deliverability = input.channels.find(
    (row) => row.deliveryRate !== null && row.deliveryRate < 0.9 && row.sent >= 50,
  );
  if (deliverability) {
    out.push({
      key: "deliverability",
      title: `${deliverability.channel} delivery needs attention`,
      body: `Only ${((deliverability.deliveryRate ?? 0) * 100).toFixed(1)}% of ${deliverability.channel} messages were delivered. Check sender and domain health in Connections.`,
      tone: "attention",
    });
  }

  return out;
}

/* ------------------------------------------------- provider waterfall (§21.5) */

export type ProviderRow = {
  provider: string;
  /** Distinct prospects this provider contributed at least one field to. */
  candidates: number;
  verified: number;
  /** Individual fields this provider supplied that were later verified. */
  enrichedFields: number;
  /** Verified prospects as a share of candidates supplied. */
  yield: number | null;
};

/**
 * How each sourcing provider actually performed.
 *
 * Names the provider and its yield, and nothing else: no credentials, no
 * endpoint, and no unit cost — the price book is platform-confidential
 * (§21.5).
 */
export async function getProviderWaterfall(
  businessId: string,
  bounds: RangeBounds,
): Promise<ProviderRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("prospect_data_sources")
    // `obtained_at` is when the provider actually supplied the field, which is
    // the moment the cost was incurred. There is no `created_at` on this table.
    .select("provider, prospect_id, verified_at")
    .eq("business_id", businessId)
    .not("prospect_id", "is", null)
    .gte("obtained_at", bounds.from.toISOString())
    .lt("obtained_at", bounds.to.toISOString())
    .limit(50000);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const prospectIds = [
    ...new Set(rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id))),
  ];
  const verifiedIds = new Set<string>();

  // Chunked so a large window cannot build an `in` list Postgres refuses.
  for (let i = 0; i < prospectIds.length; i += 500) {
    const { data: verified } = await supabase
      .from("prospects")
      .select("id")
      .eq("business_id", businessId)
      .eq("verification_status", "VALID")
      .in("id", prospectIds.slice(i, i + 500));
    for (const row of verified ?? []) verifiedIds.add(row.id);
  }

  const byProvider = new Map<
    string,
    { seen: Set<string>; verified: Set<string>; enriched: number }
  >();

  for (const row of rows) {
    if (!row.prospect_id) continue;
    const entry = byProvider.get(row.provider) ?? {
      seen: new Set<string>(),
      verified: new Set<string>(),
      enriched: 0,
    };
    // A provider that supplied six fields for one prospect supplied one
    // candidate, not six.
    entry.seen.add(row.prospect_id);
    if (verifiedIds.has(row.prospect_id)) entry.verified.add(row.prospect_id);
    if (row.verified_at) entry.enriched += 1;
    byProvider.set(row.provider, entry);
  }

  return [...byProvider.entries()]
    .map(([provider, entry]) => ({
      provider,
      candidates: entry.seen.size,
      verified: entry.verified.size,
      enrichedFields: entry.enriched,
      yield: rate(entry.verified.size, entry.seen.size),
    }))
    .sort((a, b) => b.candidates - a.candidates);
}

/* ------------------------------------------------ sender/domain health (§21.6) */

export type SenderHealthPoint = {
  date: string;
  domain: string;
  bounceRate: number;
  complaintRate: number;
  state: string;
};

/**
 * Domain health over the window, straight from the daily snapshots.
 *
 * There is no computed "reputation score" here. The snapshots record what the
 * provider and DNS actually reported; inventing a composite number on top of
 * them would be a claim the data does not support (§21.6).
 */
export async function getSenderHealthTrend(
  businessId: string,
  bounds: RangeBounds,
): Promise<SenderHealthPoint[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("domain_health_snapshots")
    .select("snapshot_date, domain, bounce_rate, complaint_rate, health_state")
    .eq("business_id", businessId)
    .gte("snapshot_date", bounds.from.toISOString().slice(0, 10))
    .lte("snapshot_date", bounds.to.toISOString().slice(0, 10))
    .order("snapshot_date", { ascending: true })
    .limit(400);

  return (data ?? []).map((row) => ({
    date: row.snapshot_date,
    domain: row.domain,
    bounceRate: Number(row.bounce_rate),
    complaintRate: Number(row.complaint_rate),
    state: row.health_state,
  }));
}
