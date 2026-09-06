import "server-only";
import { createClient } from "@/lib/supabase/server";
import { leadDisplayName } from "@/lib/leads/types";
import type { CampaignStatus } from "./types";
import {
  campaignIconKey,
  type ReactivationActivityEntry,
  type ReactivationAudienceRow,
  type ReactivationCampaignDetail,
  type ReactivationCampaignRow,
  type ReactivationEligibilityRule,
  type ReactivationMessage,
  type ReactivationSummary,
  type ReactivationTrend,
} from "./reactivation-types";

const CAMPAIGN_LIMIT = 200;
/** Only the audience *preview* reads individual contacts. */
const AUDIENCE_SAMPLE = 25;

/**
 * How old a lead must be to count as reactivation-eligible. There is no
 * per-workspace threshold column yet, so this is the one place the number
 * lives — when a workspace setting is added, this constant is what it
 * replaces, not a literal scattered through the UI.
 */
export const DEFAULT_ELIGIBILITY_DAYS = 90;

type CampaignRecord = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  channel: string;
  audience_label: string | null;
  tags: string[] | null;
  message_template: string | null;
  followup_template: string | null;
  followup_delay_seconds: number | null;
  estimated_audience_size: number;
  send_window_start: string;
  send_window_end: string;
  timezone: string | null;
  filter_config: unknown;
  scheduled_at: string | null;
  launched_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const CAMPAIGN_COLUMNS =
  "id, name, description, status, channel, audience_label, tags, " +
  "message_template, followup_template, followup_delay_seconds, " +
  "estimated_audience_size, send_window_start, send_window_end, timezone, " +
  "filter_config, scheduled_at, launched_at, started_at, paused_at, " +
  "completed_at, cancelled_at, created_by, updated_by, created_at, updated_at";

type ResultRow = {
  campaign_id: string;
  audience_count: number;
  sent_count: number;
  delivered_count: number;
  reply_count: number;
  qualified_count: number;
  booked_count: number;
  failed_count: number;
  stopped_count: number;
  pending_count: number;
  processed_count: number;
  revenue_amount: number;
  recent_reply_count: number;
  previous_reply_count: number;
  recent_qualified_count: number;
  previous_qualified_count: number;
  recent_booked_count: number;
  previous_booked_count: number;
};

function emptyResult(campaignId: string): ResultRow {
  return {
    campaign_id: campaignId,
    audience_count: 0,
    sent_count: 0,
    delivered_count: 0,
    reply_count: 0,
    qualified_count: 0,
    booked_count: 0,
    failed_count: 0,
    stopped_count: 0,
    pending_count: 0,
    processed_count: 0,
    revenue_amount: 0,
    recent_reply_count: 0,
    previous_reply_count: 0,
    recent_qualified_count: 0,
    previous_qualified_count: 0,
    recent_booked_count: 0,
    previous_booked_count: 0,
  };
}

/**
 * Campaign results are aggregated in Postgres. A single campaign can hold
 * thousands of contacts, so counting them in Node would mean either a very
 * large transfer or a silently truncated total.
 */
async function fetchResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  campaignId?: string,
): Promise<Map<string, ResultRow>> {
  // The generated RPC signature takes an optional argument rather than a
  // nullable one, so "all campaigns" omits it instead of passing null.
  const { data } = await supabase.rpc("reactivation_campaign_results", {
    p_business_id: businessId,
    ...(campaignId ? { p_campaign_id: campaignId } : {}),
  });

  return new Map(
    ((data ?? []) as ResultRow[]).map((row) => [row.campaign_id, row]),
  );
}

/** Falls back to a readable label when a campaign predates `audience_label`. */
function audienceLabelFor(campaign: {
  audience_label: string | null;
  filter_config: unknown;
}): string {
  if (campaign.audience_label) return campaign.audience_label;

  const config = campaign.filter_config as
    | { lastContactedBeforeDays?: number }
    | null;
  const days = config?.lastContactedBeforeDays;
  if (typeof days === "number" && days > 0) {
    return "Not contacted in " + days + "+ days";
  }
  return "All dormant leads";
}

function displayNameFrom(
  profile:
    | { first_name: string | null; last_name: string | null; email: string | null }
    | undefined,
): string | null {
  if (!profile) return null;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return name || profile.email || null;
}

async function profileNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email")
    .in("id", unique);

  return new Map(
    (data ?? []).flatMap((row) => {
      const name = displayNameFrom(row);
      return name ? ([[row.id, name]] as [string, string][]) : [];
    }),
  );
}

/**
 * A finished campaign always reads 100% and an unstarted one always 0%,
 * regardless of how far contact expansion got — the bar reports the campaign,
 * not the queue.
 */
function progressFor(
  status: CampaignStatus,
  processed: number,
  denominator: number,
): number {
  if (status === "DRAFT" || status === "SCHEDULED") return 0;
  if (status === "COMPLETED" || status === "CANCELLED") return 100;
  if (denominator <= 0) return 0;
  return Math.min(100, Math.round((processed / denominator) * 100));
}

/* ------------------------------------------------------------- rows --- */

/**
 * Every reactivation campaign in the workspace with its live results.
 * RLS scopes `campaigns` and the rollup function to the caller's business;
 * the explicit `business_id` filter is belt-and-braces, never the only guard.
 */
export async function listReactivationCampaigns(
  businessId: string,
): Promise<ReactivationCampaignRow[]> {
  const supabase = await createClient();

  const [{ data: campaigns }, results] = await Promise.all([
    supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS)
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(CAMPAIGN_LIMIT),
    fetchResults(supabase, businessId),
  ]);

  const records = (campaigns ?? []) as unknown as CampaignRecord[];
  const names = await profileNames(
    supabase,
    records.map((record) => record.created_by),
  );

  return records.map((record) => {
    const result = results.get(record.id) ?? emptyResult(record.id);
    const audienceLabel = audienceLabelFor(record);
    const denominator = Math.max(
      result.audience_count,
      record.estimated_audience_size,
    );

    return {
      id: record.id,
      name: record.name,
      description: record.description,
      status: record.status as CampaignStatus,
      channel: record.channel,
      audienceLabel,
      icon: campaignIconKey({
        status: record.status,
        channel: record.channel,
        audienceLabel,
        name: record.name,
      }),
      audience: result.audience_count,
      sent: result.sent_count,
      replies: result.reply_count,
      qualified: result.qualified_count,
      booked: result.booked_count,
      progress: progressFor(
        record.status as CampaignStatus,
        result.processed_count,
        denominator,
      ),
      tags: record.tags ?? [],
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      scheduledAt: record.scheduled_at,
      createdByName: record.created_by
        ? (names.get(record.created_by) ?? null)
        : null,
    };
  });
}

/* ---------------------------------------------------------- summary --- */

function trend(current: number, previous: number): ReactivationTrend | null {
  if (previous <= 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change) || Math.round(change) === 0) return null;
  const rounded = Math.round(change);
  return {
    value: (rounded > 0 ? "+" : "") + rounded + "%",
    direction: rounded > 0 ? "up" : "down",
  };
}

/**
 * The six KPI cards above the campaign grid. Every figure is computed from
 * live workspace data — nothing here is a placeholder.
 */
export async function getReactivationSummary(
  businessId: string,
  eligibilityDays = DEFAULT_ELIGIBILITY_DAYS,
): Promise<ReactivationSummary> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - eligibilityDays * 864e5).toISOString();

  const [{ data: campaigns }, results, { count: eligibleCount }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select("id, status")
        .eq("business_id", businessId)
        .limit(CAMPAIGN_LIMIT),
      fetchResults(supabase, businessId),
      // Reactivation-eligible: contactable, never booked, not opted out, not
      // a test record, and dormant for longer than the eligibility threshold.
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_test", false)
        .eq("opted_out", false)
        .is("booked_at", null)
        .not("phone_normalized", "is", null)
        .or("last_contact_at.is.null,last_contact_at.lt." + cutoff)
        .lt("created_at", cutoff),
    ]);

  const records = (campaigns ?? []) as { id: string; status: string }[];

  const totals = {
    sent: 0,
    replies: 0,
    qualified: 0,
    booked: 0,
    revenue: 0,
  };
  const current = { replies: 0, qualified: 0, booked: 0 };
  const previous = { replies: 0, qualified: 0, booked: 0 };

  for (const result of results.values()) {
    totals.sent += result.sent_count;
    totals.replies += result.reply_count;
    totals.qualified += result.qualified_count;
    totals.booked += result.booked_count;
    totals.revenue += Number(result.revenue_amount ?? 0);

    current.replies += result.recent_reply_count;
    current.qualified += result.recent_qualified_count;
    current.booked += result.recent_booked_count;
    previous.replies += result.previous_reply_count;
    previous.qualified += result.previous_qualified_count;
    previous.booked += result.previous_booked_count;
  }

  return {
    eligibleLeads: eligibleCount ?? 0,
    eligibleThresholdDays: eligibilityDays,
    totalCampaigns: records.length,
    runningCampaigns: records.filter((c) => c.status === "RUNNING").length,
    scheduledCampaigns: records.filter((c) => c.status === "SCHEDULED").length,
    replies: totals.replies,
    repliesTrend: trend(current.replies, previous.replies),
    qualified: totals.qualified,
    qualificationRate:
      totals.replies === 0 ? 0 : (totals.qualified / totals.replies) * 100,
    qualifiedTrend: trend(current.qualified, previous.qualified),
    booked: totals.booked,
    bookingRate:
      totals.replies === 0 ? 0 : (totals.booked / totals.replies) * 100,
    bookedTrend: trend(current.booked, previous.booked),
    revenue: totals.revenue,
  };
}

/** Audience names actually in use, for the Audience filter dropdown. */
export async function getAudienceOptions(
  businessId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("audience_label, filter_config")
    .eq("business_id", businessId)
    .limit(CAMPAIGN_LIMIT);

  const labels = new Set<string>();
  for (const row of data ?? []) {
    labels.add(audienceLabelFor(row));
  }
  return [...labels].sort((a, b) => a.localeCompare(b, "en-GB"));
}

/* ----------------------------------------------------------- detail --- */

const ACTIVITY_LABELS: Record<string, string> = {
  "campaign.created": "Campaign created",
  "campaign.launched": "Campaign started",
  "campaign.scheduled": "Campaign scheduled",
  "campaign.paused": "Campaign paused",
  "campaign.resumed": "Campaign resumed",
  "campaign.cancelled": "Campaign cancelled",
  "campaign.completed": "Campaign completed",
  "campaign.duplicated": "Campaign duplicated",
  "campaign.updated": "Campaign edited",
  "campaign.deleted": "Draft deleted",
};

const ELIGIBILITY_STATE: Record<
  string,
  { state: ReactivationAudienceRow["eligibility"]; label: string }
> = {
  pending: { state: "eligible", label: "Eligible" },
  scheduled: { state: "eligible", label: "Queued" },
  sent: { state: "contacted", label: "Contacted" },
  delivered: { state: "contacted", label: "Delivered" },
  replied: { state: "converted", label: "Replied" },
  failed: { state: "excluded", label: "Delivery failed" },
  suppressed: { state: "excluded", label: "Suppressed" },
  stopped: { state: "excluded", label: "Stopped" },
};

function eligibilityRules(
  campaign: CampaignRecord,
  eligibilityDays: number,
): ReactivationEligibilityRule[] {
  const config = campaign.filter_config as
    | { lastContactedBeforeDays?: number }
    | null;
  const cooldown = config?.lastContactedBeforeDays ?? eligibilityDays;

  return [
    {
      label: "Dormant for " + cooldown + "+ days",
      detail: "Leads contacted more recently than this are left alone.",
    },
    {
      label: "Not already booked or won",
      detail: "A lead that converted is never re-contacted by a campaign.",
    },
    {
      label: "Has not opted out",
      detail:
        "Opt-outs and the suppression list are re-checked before every send.",
    },
    {
      label: "Has a reachable " + campaign.channel.toUpperCase() + " contact",
      detail:
        "Leads without a usable number are excluded when the audience is built.",
    },
    {
      label: "Not in a live conversation",
      detail:
        "Leads under human takeover, or mid new-lead follow-up, are held back so the two flows never overlap.",
    },
  ];
}

function messagesFor(
  campaign: CampaignRecord,
  sent: number,
  followupSent: number,
): ReactivationMessage[] {
  const messages: ReactivationMessage[] = [
    {
      position: 1,
      label: "Opening message",
      channel: campaign.channel,
      timing: "When the campaign reaches the lead",
      enabled: true,
      body: campaign.message_template,
      sent,
    },
  ];

  if (campaign.followup_template) {
    const hours = Math.round((campaign.followup_delay_seconds ?? 0) / 3600);
    messages.push({
      position: 2,
      label: "Follow-up",
      channel: campaign.channel,
      timing:
        hours > 0
          ? "+" + hours + " hours, if there is no reply"
          : "If there is no reply",
      enabled: true,
      body: campaign.followup_template,
      sent: followupSent,
    });
  }

  return messages;
}

type ContactRecord = {
  id: string;
  lead_id: string;
  state: string;
  sent_at: string | null;
  replied_at: string | null;
  leads: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    booked_at: string | null;
    last_contact_at: string | null;
    services: { name: string } | null;
  } | null;
};

export async function getReactivationCampaignDetail(
  businessId: string,
  campaignId: string,
  eligibilityDays = DEFAULT_ELIGIBILITY_DAYS,
): Promise<ReactivationCampaignDetail | null> {
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!row) return null;
  const campaign = row as unknown as CampaignRecord;
  const floor = new Date(
    campaign.started_at ?? campaign.launched_at ?? campaign.created_at,
  ).getTime();

  const [
    results,
    { data: contacts, count: contactCount },
    { count: followupCount },
    { data: auditRows },
    { data: integrations },
  ] = await Promise.all([
    fetchResults(supabase, businessId, campaignId),
    // Only a preview page of contacts is read — the totals above come from
    // the SQL rollup, so this never has to be the whole audience.
    supabase
      .from("campaign_contacts")
      .select(
        "id, lead_id, state, sent_at, replied_at, " +
          "leads ( first_name, last_name, phone, email, booked_at, " +
          "last_contact_at, services ( name ) )",
        { count: "exact" },
      )
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
      .limit(AUDIENCE_SAMPLE),
    supabase
      .from("campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .not("followup_sent_at", "is", null),
    supabase
      .from("audit_log")
      .select("id, action, actor_user_id, actor_type, created_at")
      .eq("business_id", businessId)
      .eq("entity_type", "campaign")
      .eq("entity_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("integrations")
      .select("provider_type, status")
      .eq("business_id", businessId),
  ]);

  const result = results.get(campaignId) ?? emptyResult(campaignId);

  const names = await profileNames(supabase, [
    campaign.created_by,
    campaign.updated_by,
    ...(auditRows ?? []).map((entry) => entry.actor_user_id),
  ]);

  const audienceSample: ReactivationAudienceRow[] = (
    (contacts ?? []) as unknown as ContactRecord[]
  ).map((contact) => {
    const mapped = ELIGIBILITY_STATE[contact.state] ?? {
      state: "eligible" as const,
      label: "Eligible",
    };
    const lead = contact.leads;
    const converted = Boolean(
      lead?.booked_at && new Date(lead.booked_at).getTime() >= floor,
    );
    return {
      id: contact.id,
      leadId: contact.lead_id,
      name: lead ? leadDisplayName(lead) : "Unnamed lead",
      service: lead?.services?.name ?? null,
      lastActivityAt:
        contact.replied_at ?? contact.sent_at ?? lead?.last_contact_at ?? null,
      channel: campaign.channel,
      contact: lead?.phone ?? lead?.email ?? null,
      eligibility: converted ? "converted" : mapped.state,
      eligibilityLabel: converted ? "Booked" : mapped.label,
    };
  });

  const activity: ReactivationActivityEntry[] = (auditRows ?? []).map(
    (entry) => ({
      id: entry.id,
      action: entry.action,
      label: ACTIVITY_LABELS[entry.action] ?? entry.action,
      actor:
        entry.actor_type === "system"
          ? "Client Turn"
          : ((entry.actor_user_id ? names.get(entry.actor_user_id) : null) ??
            "Unknown user"),
      at: entry.created_at,
    }),
  );

  const messagingProviders =
    campaign.channel === "whatsapp"
      ? ["twilio_whatsapp", "whatsapp_cloud"]
      : ["twilio_sms"];
  const providerConnected = (integrations ?? []).some(
    (integration) =>
      messagingProviders.includes(integration.provider_type) &&
      integration.status !== "DISCONNECTED" &&
      integration.status !== "ACTION_REQUIRED",
  );

  const audienceLabel = audienceLabelFor(campaign);
  const denominator = Math.max(
    result.audience_count,
    campaign.estimated_audience_size,
  );
  const timezone = campaign.timezone ?? "workspace time";

  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    status: campaign.status as CampaignStatus,
    channel: campaign.channel,
    icon: campaignIconKey({
      status: campaign.status,
      channel: campaign.channel,
      audienceLabel,
      name: campaign.name,
    }),
    audienceLabel,
    estimatedAudienceSize: denominator,
    tags: campaign.tags ?? [],
    sendWindow:
      formatClock(campaign.send_window_start) +
      " – " +
      formatClock(campaign.send_window_end) +
      " (" +
      timezone +
      ")",
    createdAt: campaign.created_at,
    createdByName: campaign.created_by
      ? (names.get(campaign.created_by) ?? null)
      : null,
    updatedAt: campaign.updated_at,
    updatedByName: campaign.updated_by
      ? (names.get(campaign.updated_by) ?? null)
      : null,
    scheduledAt: campaign.scheduled_at,
    startedAt: campaign.started_at ?? campaign.launched_at,
    pausedAt: campaign.paused_at,
    completedAt: campaign.completed_at,
    cancelledAt: campaign.cancelled_at,
    totals: {
      audience: result.audience_count,
      sent: result.sent_count,
      delivered: result.delivered_count,
      replies: result.reply_count,
      qualified: result.qualified_count,
      booked: result.booked_count,
      failed: result.failed_count,
      stopped: result.stopped_count,
      pending: result.pending_count,
      revenue: Number(result.revenue_amount ?? 0),
    },
    progress: progressFor(
      campaign.status as CampaignStatus,
      result.processed_count,
      denominator,
    ),
    eligibilityRules: eligibilityRules(campaign, eligibilityDays),
    audienceSample,
    audienceSampleTotal: contactCount ?? audienceSample.length,
    messages: messagesFor(campaign, result.sent_count, followupCount ?? 0),
    activity,
    providerConnected,
  };
}

/** "08:00:00" -> "8:00 AM". */
function formatClock(value: string): string {
  const [hourPart, minutePart] = value.split(":");
  const hour = Number(hourPart);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return display + ":" + (minutePart ?? "00") + " " + suffix;
}
