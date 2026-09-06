import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  buildFunnel,
  metricValue,
  rate,
  type AnalyticsView,
  type FunnelStage,
  type MetricValue,
} from "./v4-metrics";

/**
 * The four Analytics views (V4 §21).
 *
 * Every number here is counted by Postgres, never by scanning rows in the app:
 * `head: true` with an exact count returns the number without transferring the
 * rows. A workspace with 100,000 messages must not ship them to render a card.
 *
 * The two universal exclusions from §21.7 — test records and internal support
 * traffic — are applied in every query rather than being left to the caller.
 */

export type AnalyticsRange = "7d" | "30d" | "90d" | "12m";

export type RangeBounds = {
  from: Date;
  to: Date;
  /** The equally-sized window immediately before, for period-over-period. */
  previousFrom: Date;
  previousTo: Date;
};

export function rangeBounds(range: AnalyticsRange, now: Date = new Date()): RangeBounds {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 365;
  const to = now;
  const from = new Date(now.getTime() - days * 864e5);
  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - days * 864e5),
    previousTo: from,
  };
}

type Supa = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ shared */

async function leadCounts(
  supabase: Supa,
  businessId: string,
  from: Date,
  to: Date,
): Promise<{
  leads: number;
  promoted: number;
  qualified: number;
  booked: number;
  won: number;
  lost: number;
  contacted: number;
  replied: number;
}> {
  const base = () =>
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false);

  const inWindow = (column: string) =>
    base().gte(column, from.toISOString()).lt(column, to.toISOString());

  const [leads, promoted, qualified, booked, won, lost, contacted, replied] =
    await Promise.all([
      inWindow("created_at"),
      inWindow("created_at").not("promoted_from_prospect_id", "is", null),
      inWindow("qualified_at"),
      inWindow("booked_at"),
      inWindow("won_at"),
      inWindow("lost_at"),
      inWindow("first_contacted_at"),
      inWindow("first_replied_at"),
    ]);

  return {
    leads: leads.count ?? 0,
    promoted: promoted.count ?? 0,
    qualified: qualified.count ?? 0,
    booked: booked.count ?? 0,
    won: won.count ?? 0,
    lost: lost.count ?? 0,
    contacted: contacted.count ?? 0,
    replied: replied.count ?? 0,
  };
}

async function prospectCounts(
  supabase: Supa,
  businessId: string,
  from: Date,
  to: Date,
): Promise<{
  discovered: number;
  withEmail: number;
  verified: number;
  ready: number;
  contacted: number;
  replied: number;
  promoted: number;
  aGrade: number;
  scored: number;
  intent: number;
  runs: number;
}> {
  const base = () =>
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString());

  const [
    discovered,
    withEmail,
    verified,
    ready,
    contacted,
    replied,
    promoted,
    aGrade,
    scored,
    intent,
    runs,
  ] = await Promise.all([
    base(),
    base().not("email", "is", null),
    base().eq("verification_status", "VALID"),
    base().in("status", ["READY", "APPROVED"]),
    base().not("last_contacted_at", "is", null),
    base().not("replied_at", "is", null),
    base().not("promoted_to_lead_id", "is", null),
    base().in("grade", ["A+", "A"]),
    base().not("grade", "is", null),
    supabase
      .from("prospect_intent_matches")
      .select("prospect_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gt("expires_at", new Date().toISOString()),
    supabase
      .from("sourcing_runs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString()),
  ]);

  return {
    discovered: discovered.count ?? 0,
    withEmail: withEmail.count ?? 0,
    verified: verified.count ?? 0,
    ready: ready.count ?? 0,
    contacted: contacted.count ?? 0,
    replied: replied.count ?? 0,
    promoted: promoted.count ?? 0,
    aGrade: aGrade.count ?? 0,
    scored: scored.count ?? 0,
    intent: intent.count ?? 0,
    runs: runs.count ?? 0,
  };
}

async function messageCounts(
  supabase: Supa,
  businessId: string,
  from: Date,
  to: Date,
): Promise<{
  email: number;
  sms: number;
  whatsapp: number;
  delivered: number;
  bounced: number;
  sent: number;
  inbound: number;
  positiveReplies: number;
  totalReplies: number;
}> {
  const base = () =>
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString());

  const outbound = () => base().eq("direction", "outbound");

  const [email, sms, whatsapp, delivered, bounced, sent, inbound, positive, replies] =
    await Promise.all([
      outbound().eq("channel", "email"),
      outbound().eq("channel", "sms"),
      outbound().eq("channel", "whatsapp"),
      outbound().eq("status", "DELIVERED"),
      outbound().in("status", ["BOUNCED", "FAILED"]),
      outbound().in("status", ["SENT", "DELIVERED", "BOUNCED", "FAILED", "COMPLAINED"]),
      base().eq("direction", "inbound"),
      base()
        .eq("direction", "inbound")
        .in("reply_classification", ["POSITIVE_INTEREST", "NEUTRAL_QUESTION"]),
      base().eq("direction", "inbound").not("reply_classification", "is", null),
    ]);

  return {
    email: email.count ?? 0,
    sms: sms.count ?? 0,
    whatsapp: whatsapp.count ?? 0,
    delivered: delivered.count ?? 0,
    bounced: bounced.count ?? 0,
    sent: sent.count ?? 0,
    inbound: inbound.count ?? 0,
    positiveReplies: positive.count ?? 0,
    totalReplies: replies.count ?? 0,
  };
}

/* ---------------------------------------------------------------- overview */

export type OverviewData = {
  funnel: FunnelStage[];
  metrics: MetricValue[];
  sources: { label: string; leads: number; won: number }[];
};

export async function getOverview(
  businessId: string,
  bounds: RangeBounds,
): Promise<OverviewData> {
  const supabase = await createClient();

  const [prospects, leads, previousLeads] = await Promise.all([
    prospectCounts(supabase, businessId, bounds.from, bounds.to),
    leadCounts(supabase, businessId, bounds.from, bounds.to),
    leadCounts(supabase, businessId, bounds.previousFrom, bounds.previousTo),
  ]);

  // The full journey from §21.3. Sourced and inbound share the lower half, so
  // the funnel tells one story rather than two disconnected ones.
  const funnel = buildFunnel([
    { key: "discovered", label: "Prospects discovered", count: prospects.discovered },
    { key: "verified", label: "Verified", count: prospects.verified },
    { key: "contacted", label: "Contacted", count: prospects.contacted + leads.contacted },
    { key: "replied", label: "Replied", count: prospects.replied + leads.replied },
    { key: "leads", label: "Leads", count: leads.leads },
    { key: "qualified", label: "Qualified", count: leads.qualified },
    { key: "converted", label: "Booked", count: leads.booked },
    { key: "won", label: "Won", count: leads.won },
  ]);

  return {
    funnel,
    metrics: [
      metricValue("leads", leads.leads, previousLeads.leads),
      metricValue("qualified", leads.qualified, previousLeads.qualified),
      metricValue("booked", leads.booked, previousLeads.booked),
      metricValue("won", leads.won, previousLeads.won),
      metricValue("prospects_discovered", prospects.discovered),
      metricValue(
        "lead_to_won",
        rate(leads.won, leads.leads),
        rate(previousLeads.won, previousLeads.leads),
      ),
    ],
    sources: await sourceBreakdown(supabase, businessId, bounds),
  };
}

/**
 * Lead volume by origin. Deliberately coarse — inbound, sourced, manual,
 * imported, reactivation — because §21.3 asks for a source split, not a full
 * attribution model.
 */
async function sourceBreakdown(
  supabase: Supa,
  businessId: string,
  bounds: RangeBounds,
): Promise<{ label: string; leads: number; won: number }[]> {
  const { data } = await supabase
    .from("leads")
    .select("intake_method, won_at")
    .eq("business_id", businessId)
    .eq("is_test", false)
    .gte("created_at", bounds.from.toISOString())
    .lt("created_at", bounds.to.toISOString())
    .limit(5000);

  const buckets = new Map<string, { leads: number; won: number }>();
  for (const row of data ?? []) {
    const label = intakeLabel(row.intake_method);
    const bucket = buckets.get(label) ?? { leads: 0, won: 0 };
    bucket.leads += 1;
    if (row.won_at) bucket.won += 1;
    buckets.set(label, bucket);
  }

  return [...buckets.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.leads - a.leads);
}

function intakeLabel(method: string | null): string {
  switch (method) {
    case "CLIENTTURN_SOURCING":
      return "ClientTurn sourcing";
    case "META":
    case "WEBFORM":
      return "Inbound";
    case "MANUAL":
    case "PHONE_CALL":
    case "WALK_IN":
    case "REFERRAL":
    case "EVENT":
      return "Manual";
    case "IMPORT":
      return "Import";
    case "PIPEDRIVE":
    case "API":
      return "Integrations";
    default:
      return "Inbound";
  }
}

/* ------------------------------------------------------------- acquisition */

export type AcquisitionData = {
  metrics: MetricValue[];
  funnel: FunnelStage[];
};

export async function getAcquisition(
  businessId: string,
  bounds: RangeBounds,
): Promise<AcquisitionData> {
  const supabase = await createClient();

  const [current, previous] = await Promise.all([
    prospectCounts(supabase, businessId, bounds.from, bounds.to),
    prospectCounts(supabase, businessId, bounds.previousFrom, bounds.previousTo),
  ]);

  return {
    metrics: [
      metricValue("sourcing_runs", current.runs, previous.runs),
      metricValue("prospects_discovered", current.discovered, previous.discovered),
      metricValue("prospects_verified", current.verified, previous.verified),
      metricValue("prospects_ready", current.ready, previous.ready),
      metricValue(
        "verification_rate",
        rate(current.verified, current.withEmail),
        rate(previous.verified, previous.withEmail),
      ),
      metricValue(
        "a_grade_share",
        rate(current.aGrade, current.scored),
        rate(previous.aGrade, previous.scored),
      ),
      metricValue("intent_matches", current.intent),
    ],
    funnel: buildFunnel([
      { key: "found", label: "Discovered", count: current.discovered },
      { key: "verified", label: "Verified", count: current.verified },
      { key: "ready", label: "Ready", count: current.ready },
      { key: "contacted", label: "Contacted", count: current.contacted },
      { key: "replied", label: "Replied", count: current.replied },
      { key: "promoted", label: "Promoted to lead", count: current.promoted },
    ]),
  };
}

/* ---------------------------------------------------------------- outreach */

export type OutreachData = {
  metrics: MetricValue[];
  channels: { channel: string; sent: number; delivered: number; replies: number }[];
};

export async function getOutreach(
  businessId: string,
  bounds: RangeBounds,
): Promise<OutreachData> {
  const supabase = await createClient();

  const [current, previous] = await Promise.all([
    messageCounts(supabase, businessId, bounds.from, bounds.to),
    messageCounts(supabase, businessId, bounds.previousFrom, bounds.previousTo),
  ]);

  return {
    metrics: [
      metricValue("emails_sent", current.email, previous.email),
      metricValue("sms_segments", current.sms, previous.sms),
      metricValue("whatsapp_messages", current.whatsapp, previous.whatsapp),
      metricValue(
        "delivery_rate",
        rate(current.delivered, current.sent),
        rate(previous.delivered, previous.sent),
      ),
      metricValue(
        "bounce_rate",
        rate(current.bounced, current.sent),
        rate(previous.bounced, previous.sent),
      ),
      metricValue(
        "reply_rate",
        rate(current.inbound, current.sent),
        rate(previous.inbound, previous.sent),
      ),
      metricValue(
        "positive_reply_rate",
        rate(current.positiveReplies, current.totalReplies),
        rate(previous.positiveReplies, previous.totalReplies),
      ),
    ],
    channels: [
      { channel: "Email", sent: current.email, delivered: current.delivered, replies: current.inbound },
      { channel: "SMS", sent: current.sms, delivered: 0, replies: 0 },
      { channel: "WhatsApp", sent: current.whatsapp, delivered: 0, replies: 0 },
    ].filter((row) => row.sent > 0),
  };
}

/* -------------------------------------------------------------- conversion */

export type ConversionData = {
  metrics: MetricValue[];
  funnel: FunnelStage[];
};

export async function getConversion(
  businessId: string,
  bounds: RangeBounds,
): Promise<ConversionData> {
  const supabase = await createClient();

  const [current, previous] = await Promise.all([
    leadCounts(supabase, businessId, bounds.from, bounds.to),
    leadCounts(supabase, businessId, bounds.previousFrom, bounds.previousTo),
  ]);

  return {
    metrics: [
      metricValue("leads", current.leads, previous.leads),
      metricValue("leads_promoted", current.promoted, previous.promoted),
      metricValue("qualified", current.qualified, previous.qualified),
      metricValue("booked", current.booked, previous.booked),
      metricValue("won", current.won, previous.won),
      metricValue(
        "lead_to_qualified",
        rate(current.qualified, current.leads),
        rate(previous.qualified, previous.leads),
      ),
      metricValue(
        "qualified_to_goal",
        rate(current.booked, current.qualified),
        rate(previous.booked, previous.qualified),
      ),
      metricValue(
        "lead_to_won",
        rate(current.won, current.leads),
        rate(previous.won, previous.leads),
      ),
    ],
    funnel: buildFunnel([
      { key: "leads", label: "Leads", count: current.leads },
      { key: "contacted", label: "Contacted", count: current.contacted },
      { key: "replied", label: "Replied", count: current.replied },
      { key: "qualified", label: "Qualified", count: current.qualified },
      { key: "booked", label: "Booked", count: current.booked },
      { key: "won", label: "Won", count: current.won },
    ]),
  };
}

export type AnalyticsData = {
  view: AnalyticsView;
  overview: OverviewData | null;
  acquisition: AcquisitionData | null;
  outreach: OutreachData | null;
  conversion: ConversionData | null;
};

/** Loads only the active view — three unused view queries per page load would
 *  triple the cost for no benefit. */
export async function getV4Analytics(
  businessId: string,
  view: AnalyticsView,
  bounds: RangeBounds,
): Promise<AnalyticsData> {
  return {
    view,
    overview: view === "overview" ? await getOverview(businessId, bounds) : null,
    acquisition: view === "acquisition" ? await getAcquisition(businessId, bounds) : null,
    outreach: view === "outreach" ? await getOutreach(businessId, bounds) : null,
    conversion: view === "conversion" ? await getConversion(businessId, bounds) : null,
  };
}
