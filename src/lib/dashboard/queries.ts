import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ResolvedRange } from "@/lib/dates";
import { leadDisplayName, sourceLabel } from "@/lib/leads/types";
import type { LeadListRow, LeadSourceRef } from "@/lib/leads/types";
import { getBookingDestination } from "@/lib/bookings/queries";
import {
  attentionLabel,
  type AttentionItem,
  type DashboardData,
  type DashboardSeries,
  type FollowUpMetric,
  type HealthStripItem,
  type HealthStripStatus,
  type PeriodCounts,
  type SourceSnapshotRow,
} from "./types";

export * from "./types";

/**
 * Keeps a 90-day sparkline as cheap to render as a 7-day one — and wide
 * buckets matter visually too: daily counts in single figures draw noise
 * rather than a trend.
 */
const MAX_SERIES_POINTS = 14;
const LEAD_LIMIT = 5000;
const MESSAGE_LIMIT = 20000;
const ATTENTION_LIMIT = 20;
const TOP_SOURCES = 5;

type CohortRow = {
  id: string;
  created_at: string;
  first_contacted_at: string | null;
  first_replied_at: string | null;
  qualified_at: string | null;
  booked_at: string | null;
  won_at: string | null;
  opted_out: boolean;
  source_id: string | null;
  lead_sources: LeadSourceRef | null;
};

type MessageRow = {
  lead_id: string;
  direction: string;
  status: string;
  created_at: string;
};

function summarise(rows: CohortRow[]): PeriodCounts {
  const leads = rows.length;
  const booked = rows.filter((row) => row.booked_at).length;
  return {
    leads,
    contacted: rows.filter((row) => row.first_contacted_at).length,
    replied: rows.filter((row) => row.first_replied_at).length,
    qualified: rows.filter((row) => row.qualified_at).length,
    booked,
    won: rows.filter((row) => row.won_at).length,
    bookingRate: leads === 0 ? 0 : (booked / leads) * 100,
  };
}

/* ------------------------------------------------------------ sparklines */

/**
 * Buckets each stage by the timestamp that defines it, across the selected
 * window. Every point is a real count — a workspace with no history gets a
 * flat line rather than an invented shape.
 */
function buildSeries(rows: CohortRow[], range: ResolvedRange): DashboardSeries {
  const points = Math.max(2, Math.min(range.days, MAX_SERIES_POINTS));
  const start = range.from.getTime();
  const span = Math.max(1, range.to.getTime() - start);
  const bucketMs = span / points;

  const empty = () => new Array<number>(points).fill(0);
  const series: DashboardSeries = {
    leads: empty(),
    contacted: empty(),
    replied: empty(),
    qualified: empty(),
    booked: empty(),
    bookingRate: empty(),
  };

  const indexFor = (value: string | null) => {
    if (!value) return null;
    const time = new Date(value).getTime();
    if (Number.isNaN(time) || time < start || time >= range.to.getTime()) {
      return null;
    }
    return Math.min(points - 1, Math.floor((time - start) / bucketMs));
  };

  const bump = (key: keyof DashboardSeries, value: string | null) => {
    const index = indexFor(value);
    if (index !== null) series[key][index] += 1;
  };

  for (const row of rows) {
    bump("leads", row.created_at);
    bump("contacted", row.first_contacted_at);
    bump("replied", row.first_replied_at);
    bump("qualified", row.qualified_at);
    bump("booked", row.booked_at);
  }

  for (let index = 0; index < points; index += 1) {
    const leads = series.leads[index];
    series.bookingRate[index] =
      leads === 0 ? 0 : (series.booked[index] / leads) * 100;
  }

  return series;
}

/* ------------------------------------------------------------- follow-up */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

type AttemptTotals = {
  firstSent: number;
  firstReplies: number;
  laterSent: number;
  laterReplies: number;
};

/**
 * Attempt N is the Nth outbound message to a lead; a reply is credited to the
 * attempt it directly followed. Attempt 1 is the opening message, attempts 2+
 * are the automated chases — which is what "replies after follow-up" means.
 */
function attemptTotals(messages: MessageRow[]): AttemptTotals {
  const byLead = new Map<string, MessageRow[]>();
  for (const message of messages) {
    const list = byLead.get(message.lead_id);
    if (list) list.push(message);
    else byLead.set(message.lead_id, [message]);
  }

  const totals: AttemptTotals = {
    firstSent: 0,
    firstReplies: 0,
    laterSent: 0,
    laterReplies: 0,
  };

  for (const list of byLead.values()) {
    const ordered = [...list].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    let attempt = 0;
    let awaitingReply = false;

    for (const message of ordered) {
      if (message.direction === "outbound") {
        if (message.status === "QUEUED") continue;
        attempt += 1;
        if (attempt === 1) totals.firstSent += 1;
        else totals.laterSent += 1;
        awaitingReply = true;
        continue;
      }
      if (!awaitingReply || attempt === 0) continue;
      if (attempt === 1) totals.firstReplies += 1;
      else totals.laterReplies += 1;
      awaitingReply = false;
    }
  }

  return totals;
}

type FollowUpSnapshot = {
  latency: number | null;
  repliesFirst: number | null;
  repliesFollowUp: number | null;
  failureRate: number | null;
  optOutRate: number | null;
};

function followUpSnapshot(
  leads: CohortRow[],
  messages: MessageRow[],
): FollowUpSnapshot {
  const latencies = leads
    .filter((row) => row.first_contacted_at)
    .map((row) =>
      Math.max(
        0,
        (new Date(row.first_contacted_at as string).getTime() -
          new Date(row.created_at).getTime()) /
          1000,
      ),
    );

  const attempts = attemptTotals(messages);

  let outboundAttempted = 0;
  let failed = 0;
  for (const message of messages) {
    if (message.direction !== "outbound" || message.status === "QUEUED") continue;
    outboundAttempted += 1;
    if (message.status === "FAILED") failed += 1;
  }

  const contacted = leads.filter((row) => row.first_contacted_at).length;
  const optOuts = leads.filter((row) => row.opted_out).length;

  return {
    // Median, not mean: one stalled lead should not move the headline figure.
    latency: median(latencies),
    repliesFirst:
      attempts.firstSent === 0
        ? null
        : (attempts.firstReplies / attempts.firstSent) * 100,
    repliesFollowUp:
      attempts.laterSent === 0
        ? null
        : (attempts.laterReplies / attempts.laterSent) * 100,
    failureRate:
      outboundAttempted === 0 ? null : (failed / outboundAttempted) * 100,
    // Canonical denominator: leads that were actually contacted.
    optOutRate: contacted === 0 ? null : (optOuts / contacted) * 100,
  };
}

const FOLLOW_UP_METRICS: {
  key: FollowUpMetric["key"];
  label: string;
  hint: string;
  format: FollowUpMetric["format"];
  invert: boolean;
}[] = [
  {
    key: "latency",
    label: "First response latency",
    hint: "Median time between a lead arriving and the first message going out.",
    format: "duration",
    invert: true,
  },
  {
    key: "repliesFirst",
    label: "Replies after first message",
    hint: "Share of opening messages that earned a reply before any follow-up.",
    format: "percent",
    invert: false,
  },
  {
    key: "repliesFollowUp",
    label: "Replies after follow-up",
    hint: "Share of second-and-later automated messages that earned a reply.",
    format: "percent",
    invert: false,
  },
  {
    key: "failureRate",
    label: "Message failure rate",
    hint: "Messages that failed to send, over all send attempts.",
    format: "percent",
    invert: true,
  },
  {
    key: "optOutRate",
    label: "Opt-out rate",
    hint: "Leads that opted out, over leads that were contacted.",
    format: "percent",
    invert: true,
  },
];

function followUpMetrics(
  current: FollowUpSnapshot,
  previous: FollowUpSnapshot,
): FollowUpMetric[] {
  return FOLLOW_UP_METRICS.map((metric) => ({
    ...metric,
    current: current[metric.key],
    previous: previous[metric.key],
  }));
}

/* -------------------------------------------------------------- loaders */

const COHORT_SELECT = `id, created_at, first_contacted_at, first_replied_at,
  qualified_at, booked_at, won_at, opted_out, source_id,
  lead_sources ( id, provider, source_name, form_name, campaign_name,
                 campaign_id, ad_name, adset_name, page_name )`;

const RECENT_SELECT = `id, first_name, last_name, phone, email, postcode, status,
  qualification_state, needs_attention, attention_reason, automation_active,
  human_takeover, opted_out, assigned_user_id, created_at, last_contact_at,
  first_contacted_at, first_replied_at, booked_at,
  services ( id, name, average_value ),
  lead_sources ( id, provider, source_name, form_name, campaign_name,
                 campaign_id, ad_name, adset_name, page_name )`;

type AttentionLeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  attention_reason: string | null;
  created_at: string;
  last_contact_at: string | null;
  services: { name: string } | null;
};

export async function getDashboardData(
  businessId: string,
  range: ResolvedRange,
): Promise<DashboardData> {
  const supabase = await createClient();
  const failedSince = new Date(Date.now() - 864e5);

  const [
    cohortResult,
    recentResult,
    pipelineResult,
    attentionResult,
    messageResult,
    failedResult,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select(COHORT_SELECT)
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", range.previousFrom.toISOString())
      .lt("created_at", range.to.toISOString())
      .limit(LEAD_LIMIT),
    supabase
      .from("leads")
      .select(RECENT_SELECT)
      .eq("business_id", businessId)
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("leads")
      .select("id, services ( average_value )")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .eq("qualification_state", "QUALIFIED")
      .not("status", "in", "(WON,LOST)")
      .eq("opted_out", false)
      .limit(LEAD_LIMIT),
    supabase
      .from("leads")
      .select(
        `id, first_name, last_name, phone, email, attention_reason,
         created_at, last_contact_at, services ( name )`,
      )
      .eq("business_id", businessId)
      .eq("is_test", false)
      .eq("needs_attention", true)
      .order("last_contact_at", { ascending: false, nullsFirst: false })
      .limit(ATTENTION_LIMIT),
    supabase
      .from("messages")
      .select("lead_id, direction, status, created_at")
      .eq("business_id", businessId)
      .gte("created_at", range.previousFrom.toISOString())
      .lt("created_at", range.to.toISOString())
      .order("created_at", { ascending: true })
      .limit(MESSAGE_LIMIT),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "FAILED")
      .gte("created_at", failedSince.toISOString()),
  ]);

  const cohort = (cohortResult.data ?? []) as unknown as CohortRow[];
  const currentRows = cohort.filter(
    (row) => new Date(row.created_at) >= range.from,
  );
  const previousRows = cohort.filter(
    (row) => new Date(row.created_at) < range.from,
  );

  const messages = (messageResult.data ?? []) as MessageRow[];
  const currentMessages = messages.filter(
    (row) => new Date(row.created_at) >= range.from,
  );
  const previousMessages = messages.filter(
    (row) => new Date(row.created_at) < range.from,
  );

  const pipelineRows = (pipelineResult.data ?? []) as unknown as {
    id: string;
    services: { average_value: number | null } | null;
  }[];
  const estimatedPipeline = pipelineRows.reduce(
    (total, row) => total + Number(row.services?.average_value ?? 0),
    0,
  );

  const sourceMap = new Map<string, SourceSnapshotRow>();
  for (const row of currentRows) {
    const key = row.source_id ?? "unknown";
    const existing = sourceMap.get(key) ?? {
      key,
      label: sourceLabel(row.lead_sources),
      provider: row.lead_sources?.provider ?? "unknown",
      leads: 0,
      replies: 0,
      qualified: 0,
      booked: 0,
      conversionRate: 0,
    };
    existing.leads += 1;
    if (row.first_replied_at) existing.replies += 1;
    if (row.qualified_at) existing.qualified += 1;
    if (row.booked_at) existing.booked += 1;
    sourceMap.set(key, existing);
  }
  for (const entry of sourceMap.values()) {
    entry.conversionRate =
      entry.leads === 0 ? 0 : (entry.booked / entry.leads) * 100;
  }

  const attentionRows = (attentionResult.data ??
    []) as unknown as AttentionLeadRow[];

  const leadAttention: AttentionItem[] = attentionRows.map((row) => {
    const name = leadDisplayName(row);
    const service = row.services?.name;
    return {
      id: `lead-${row.id}`,
      title: attentionLabel(row.attention_reason),
      detail: service ? `${name} · ${service}` : name,
      at: row.last_contact_at ?? row.created_at,
      // Opens the existing Lead Drawer rather than a dashboard-only surface.
      href: `/app/leads?lead=${row.id}`,
      tone:
        row.attention_reason === "human_requested" ||
        row.attention_reason === "message_failed"
          ? "danger"
          : "warning",
    };
  });

  return {
    current: summarise(currentRows),
    previous: summarise(previousRows),
    series: buildSeries(currentRows, range),
    estimatedPipeline,
    qualifyingLeads: pipelineRows.length,
    recentLeads: (recentResult.data ?? []) as unknown as LeadListRow[],
    sources: [...sourceMap.values()]
      .sort((a, b) => b.leads - a.leads)
      .slice(0, TOP_SOURCES),
    followUp: followUpMetrics(
      followUpSnapshot(currentRows, currentMessages),
      followUpSnapshot(previousRows, previousMessages),
    ),
    leadAttention,
    failedMessages: failedResult.count ?? 0,
  };
}

/* ---------------------------------------------------------------- health */

const MESSAGING_PROVIDERS = ["twilio_sms", "twilio_whatsapp", "whatsapp_cloud"];

const MESSAGING_CHANNEL_LABEL: Record<string, string> = {
  twilio_sms: "SMS",
  twilio_whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp",
};

const STATUS_LABEL: Record<string, string> = {
  HEALTHY: "Connected",
  TESTING: "Test mode",
  DEGRADED: "Degraded",
  ACTION_REQUIRED: "Action required",
  DISCONNECTED: "Not connected",
};

function toStripStatus(status: string | undefined): HealthStripStatus {
  if (status === "HEALTHY" || status === "TESTING") return "healthy";
  if (status === "DEGRADED") return "warning";
  return "error";
}

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/**
 * The dashboard's health strip only checks the four things that stop a lead
 * from being contacted, qualified and booked. Detailed remediation lives on
 * the top-bar health banner and the Connections page.
 */
async function getFollowUpPublishStatus(businessId: string): Promise<{
  published: boolean;
  enabled: boolean;
  steps: number;
}> {
  const supabase = await createClient();
  const { data: definition } = await supabase
    .from("automation_definitions")
    .select("id, enabled")
    .eq("business_id", businessId)
    .eq("type", "new_lead")
    .maybeSingle();

  if (!definition) return { published: false, enabled: false, steps: 0 };

  const { data: version } = await supabase
    .from("automation_versions")
    .select("id")
    .eq("business_id", businessId)
    .eq("automation_id", definition.id)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!version) {
    return { published: false, enabled: definition.enabled, steps: 0 };
  }

  const { count } = await supabase
    .from("automation_steps")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("version_id", version.id)
    .eq("enabled", true);

  return { published: true, enabled: definition.enabled, steps: count ?? 0 };
}

export async function getHealthStripData(
  businessId: string,
): Promise<HealthStripItem[]> {
  const supabase = await createClient();

  const [integrationsResult, objectsResult, followUp, destination] =
    await Promise.all([
      supabase
        .from("integrations")
        .select("id, provider_type, status")
        .eq("business_id", businessId)
        .in("provider_type", ["meta", ...MESSAGING_PROVIDERS]),
      supabase
        .from("integration_objects")
        .select("object_type")
        .eq("business_id", businessId)
        .eq("enabled", true)
        .in("object_type", ["meta_page", "meta_form"]),
      getFollowUpPublishStatus(businessId),
      getBookingDestination(businessId),
    ]);

  const integrations = integrationsResult.data ?? [];
  const meta = integrations.find((row) => row.provider_type === "meta");
  const messagingRows = integrations.filter((row) =>
    MESSAGING_PROVIDERS.includes(row.provider_type),
  );
  const messaging = messagingRows[0];

  const objects = objectsResult.data ?? [];
  const pages = objects.filter((row) => row.object_type === "meta_page").length;
  const forms = objects.filter((row) => row.object_type === "meta_form").length;

  // Every secondary line states what is actually configured, never a guess.
  const channels = [
    ...new Set(
      messagingRows
        .filter((row) => toStripStatus(row.status) !== "error")
        .map((row) => MESSAGING_CHANNEL_LABEL[row.provider_type])
        .filter(Boolean),
    ),
  ];

  return [
    {
      key: "meta",
      label: "Meta connection",
      status: meta ? toStripStatus(meta.status) : "error",
      statusLabel: meta
        ? (STATUS_LABEL[meta.status] ?? meta.status)
        : "Not connected",
      detail: meta
        ? pages + forms === 0
          ? "No pages or forms selected"
          : `${countLabel(pages, "page")} · ${countLabel(forms, "form")}`
        : "Connect Meta to receive lead ads",
      href: "/app/settings/connections",
    },
    {
      key: "messaging",
      label: "Messaging",
      status: messaging ? toStripStatus(messaging.status) : "error",
      statusLabel: messaging
        ? (STATUS_LABEL[messaging.status] ?? messaging.status)
        : "Not connected",
      detail:
        channels.length > 0
          ? channels.join(" · ")
          : "No sending channel configured",
      href: "/app/settings/connections",
    },
    {
      key: "booking",
      label: "Booking destination",
      status: destination.configured ? "healthy" : "error",
      statusLabel: destination.configured ? "Configured" : "Not configured",
      detail: destination.label,
      href: "/app/settings/workspace",
    },
    {
      key: "followup",
      label: "Follow-up",
      status: followUp.published
        ? "healthy"
        : followUp.enabled
          ? "warning"
          : "error",
      statusLabel: followUp.published
        ? "Published"
        : followUp.enabled
          ? "Not published"
          : "Not set up",
      detail: followUp.published
        ? followUp.steps === 0
          ? "No steps enabled"
          : `${countLabel(followUp.steps, "step")} sequence active`
        : "Publish a sequence to start following up",
      href: "/app/follow-up",
    },
  ];
}

export async function getFailedMessageCount(
  businessId: string,
  since: Date,
): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("status", "FAILED")
    .gte("created_at", since.toISOString());
  return count ?? 0;
}

/** A booking-capable workspace needs both a mode and a live calendar link. */
export async function getBookingConfigIssue(
  businessId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const [{ data: settings }, { data: integrations }] = await Promise.all([
    supabase
      .from("business_settings")
      .select("booking_mode")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("integrations")
      .select("provider_type, status")
      .eq("business_id", businessId)
      .in("provider_type", ["calendly", "google_calendar"]),
  ]);

  if (!settings || settings.booking_mode === "handover") return null;

  const provider = (integrations ?? []).find(
    (row) => row.provider_type === settings.booking_mode,
  );
  if (!provider || provider.status === "DISCONNECTED") {
    return "Booking link missing — no calendar is connected for the selected booking mode.";
  }
  return null;
}
