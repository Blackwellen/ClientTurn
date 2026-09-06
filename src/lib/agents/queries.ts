import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LeadListRow } from "@/lib/leads/types";
import {
  SOURCE_DEFINITIONS,
  type AgentActivityRow,
  type AgentListRow,
  type AgentQueueRow,
  type AgentSourceRow,
  type AgentStatus,
  type AgentType,
  type Autonomy,
  type Cadence,
  type QueueItemType,
  type QueueStatus,
  type SourceKey,
  type SourceStatus,
} from "./types";

export * from "./types";

/**
 * Agent reads.
 *
 * Through the RLS-scoped client, so a query that forgets its `business_id`
 * filter still returns nothing across tenants; the explicit predicate is an
 * additional filter, never the only guard.
 *
 * `max_cost_per_run_minor` is never selected here — it is provider spend, the
 * column is not granted to the browser role (0043), and no customer surface
 * has a reason to render it.
 */

const AGENT_SELECT = `
  id, name, description, agent_type, status, status_reason, autonomy, cadence,
  minimum_grade, enrich_email, enrich_phone, verify_email, auto_promote_to_leads,
  icp_profile_id, conversion_goal_id, campaign_id, service_id,
  daily_prospect_cap, monthly_prospect_cap,
  next_run_at, last_run_at, last_run_status,
  total_prospects, total_leads, total_conversions, pending_review_count,
  created_at, updated_at
`;

type RawAgent = {
  id: string;
  name: string;
  description: string | null;
  agent_type: string;
  status: string;
  status_reason: string | null;
  autonomy: string;
  cadence: string;
  minimum_grade: string;
  enrich_email: boolean;
  enrich_phone: boolean;
  verify_email: boolean;
  auto_promote_to_leads: boolean;
  icp_profile_id: string | null;
  conversion_goal_id: string | null;
  campaign_id: string | null;
  service_id: string | null;
  daily_prospect_cap: number;
  monthly_prospect_cap: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  total_prospects: number;
  total_leads: number;
  total_conversions: number;
  pending_review_count: number;
  created_at: string;
  updated_at: string;
};

type Summary = {
  queued: number;
  blocked: number;
  failed: number;
  prospects7d: number;
  leads7d: number;
};

const EMPTY_SUMMARY: Summary = {
  queued: 0,
  blocked: 0,
  failed: 0,
  prospects7d: 0,
  leads7d: 0,
};

function toListRow(
  raw: RawAgent,
  summary: Summary,
  enabledSources: SourceKey[],
): AgentListRow {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    agentType: raw.agent_type as AgentType,
    status: raw.status as AgentStatus,
    statusReason: raw.status_reason,
    autonomy: raw.autonomy as Autonomy,
    cadence: raw.cadence as Cadence,
    minimumGrade: raw.minimum_grade,
    enrichEmail: raw.enrich_email,
    enrichPhone: raw.enrich_phone,
    nextRunAt: raw.next_run_at,
    lastRunAt: raw.last_run_at,
    totalProspects: raw.total_prospects,
    totalLeads: raw.total_leads,
    totalConversions: raw.total_conversions,
    pendingReviewCount: raw.pending_review_count,
    ...summary,
    enabledSources,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * The card grid. Summaries and enabled sources are resolved in two extra
 * queries rather than per card, so the page cost is flat in the number of
 * agents rather than multiplied by it.
 */
export async function listAgents(businessId: string): Promise<AgentListRow[]> {
  const supabase = await createClient();

  const [{ data: agents, error: agentError }, { data: summaries, error: summaryError }, { data: sources, error: sourceError }] = await Promise.all([
    supabase
      .from("agents")
      .select(AGENT_SELECT)
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false }),
    supabase.rpc("agent_summaries", { p_business_id: businessId }),
    supabase
      .from("agent_sources")
      .select("agent_id, source_key, enabled")
      .eq("business_id", businessId)
      .eq("enabled", true),
  ]);

  const summaryByAgent = new Map<string, Summary>();
  if (agentError || summaryError || sourceError) throw new Error("Agents could not be loaded. Please retry.");
  for (const row of summaries ?? []) {
    summaryByAgent.set(row.agent_id, {
      queued: row.queued,
      blocked: row.blocked,
      failed: row.failed,
      prospects7d: row.prospects_7d,
      leads7d: row.leads_7d,
    });
  }

  const sourcesByAgent = new Map<string, SourceKey[]>();
  for (const row of sources ?? []) {
    const list = sourcesByAgent.get(row.agent_id) ?? [];
    list.push(row.source_key as SourceKey);
    sourcesByAgent.set(row.agent_id, list);
  }

  return ((agents ?? []) as unknown as RawAgent[]).map((raw) =>
    toListRow(raw, summaryByAgent.get(raw.id) ?? EMPTY_SUMMARY, sourcesByAgent.get(raw.id) ?? []),
  );
}

export type AgentDetail = {
  agent: AgentListRow & {
    verifyEmail: boolean;
    autoPromoteToLeads: boolean;
    icpProfileId: string | null;
    conversionGoalId: string | null;
    campaignId: string | null;
    serviceId: string | null;
    dailyProspectCap: number;
    monthlyProspectCap: number;
    lastRunStatus: string | null;
  };
  sources: AgentSourceRow[];
};

export async function getAgent(
  businessId: string,
  agentId: string,
): Promise<AgentDetail | null> {
  const supabase = await createClient();

  const [{ data: raw }, { data: sourceRows }, { data: summaries }] = await Promise.all([
    supabase
      .from("agents")
      .select(AGENT_SELECT)
      .eq("business_id", businessId)
      .eq("id", agentId)
      .maybeSingle(),
    supabase
      .from("agent_sources")
      .select("id, source_key, enabled, status, status_detail, last_run_at, prospects_found, error_message")
      .eq("business_id", businessId)
      .eq("agent_id", agentId),
    supabase.rpc("agent_summaries", { p_business_id: businessId }),
  ]);

  if (!raw) return null;
  const agent = raw as unknown as RawAgent;

  const summaryRow = (summaries ?? []).find((s) => s.agent_id === agentId);
  const summary: Summary = summaryRow
    ? {
        queued: summaryRow.queued,
        blocked: summaryRow.blocked,
        failed: summaryRow.failed,
        prospects7d: summaryRow.prospects_7d,
        leads7d: summaryRow.leads_7d,
      }
    : EMPTY_SUMMARY;

  const sources: AgentSourceRow[] = (sourceRows ?? []).map((row) => ({
    id: row.id,
    sourceKey: row.source_key as SourceKey,
    enabled: row.enabled,
    status: row.status as SourceStatus,
    statusDetail: row.status_detail,
    lastRunAt: row.last_run_at,
    prospectsFound: row.prospects_found,
    errorMessage: row.error_message,
  }));

  const enabled = sources.filter((s) => s.enabled).map((s) => s.sourceKey);

  return {
    agent: {
      ...toListRow(agent, summary, enabled),
      verifyEmail: agent.verify_email,
      autoPromoteToLeads: agent.auto_promote_to_leads,
      icpProfileId: agent.icp_profile_id,
      conversionGoalId: agent.conversion_goal_id,
      campaignId: agent.campaign_id,
      serviceId: agent.service_id,
      dailyProspectCap: agent.daily_prospect_cap,
      monthlyProspectCap: agent.monthly_prospect_cap,
      lastRunStatus: agent.last_run_status,
    },
    sources,
  };
}

/* ------------------------------------------------------------------ queue */

export async function getAgentQueue(
  businessId: string,
  agentId: string,
  status?: QueueStatus,
): Promise<AgentQueueRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("agent_queue_items")
    .select(
      "id, item_type, status, subject_type, subject_id, subject_label, priority, attempts, blocked_reason, error_message, scheduled_for, completed_at, created_at",
    )
    .eq("business_id", businessId)
    .eq("agent_id", agentId);

  if (status) query = query.eq("status", status);

  // Blocked first: those are the items asking for a person, and burying them
  // under completed work is how an agent silently stalls.
  const { data } = await query
    .order("status", { ascending: true })
    .order("priority", { ascending: true })
    .order("scheduled_for", { ascending: true })
    .limit(200);

  return (data ?? []).map((row) => ({
    id: row.id,
    itemType: row.item_type as QueueItemType,
    status: row.status as QueueStatus,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectLabel: row.subject_label,
    priority: row.priority,
    attempts: row.attempts,
    blockedReason: row.blocked_reason,
    errorMessage: row.error_message,
    scheduledFor: row.scheduled_for,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }));
}

/* --------------------------------------------------------------- activity */

export async function getAgentActivity(
  businessId: string,
  agentId: string,
  limit = 100,
): Promise<AgentActivityRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_activity_events")
    .select("id, event_type, severity, title, detail, subject_type, subject_id, created_at")
    .eq("business_id", businessId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    severity: row.severity as AgentActivityRow["severity"],
    title: row.title,
    detail: row.detail,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    createdAt: row.created_at,
  }));
}

/* ------------------------------------------------------------------ leads */

/** Leads this agent produced. The Leads tab is a filtered view of the real
 *  Leads register, not a second copy of it. */
export async function getAgentLeads(
  businessId: string,
  agentId: string,
  limit = 50,
): Promise<LeadListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select(
      `id, first_name, last_name, phone, email, postcode, status, qualification_state,
       needs_attention, attention_reason, automation_active, human_takeover, opted_out,
       assigned_user_id, created_at, last_contact_at, first_contacted_at, first_replied_at,
       booked_at, won_at, lost_at,
       services ( id, name, average_value ),
       lead_sources ( id, provider, source_name, form_name, campaign_name, campaign_id,
                      ad_name, adset_name, page_name )`,
    )
    .eq("business_id", businessId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as LeadListRow[];
}

/* ------------------------------------------------------ wizard reference data */

export type AgentWizardOptions = {
  icpProfiles: { id: string; name: string }[];
  conversionGoals: { id: string; name: string; type: string }[];
  services: { id: string; name: string }[];
  campaigns: { id: string; name: string; status: string }[];
  /** Which sources this workspace can actually run today, and why not. */
  sourceAvailability: Record<SourceKey, { status: SourceStatus; detail: string | null }>;
};

/**
 * Everything the wizard needs, plus an honest read on which sources will work.
 *
 * A source that needs a connection the workspace has not made is reported as
 * REQUIRES_SETUP with the reason, rather than being offered and then failing
 * silently on the first run.
 */
export const getAgentWizardOptions = cache(
  async (businessId: string): Promise<AgentWizardOptions> => {
    const admin = createAdminClient();

    const [icps, goals, services, campaigns, integrations] = await Promise.all([
      admin.from("icp_profiles").select("id, name").eq("business_id", businessId).eq("active", true).order("name"),
      admin.from("conversion_goals").select("id, name, type").eq("business_id", businessId).eq("active", true).order("name"),
      admin.from("services").select("id, name").eq("business_id", businessId).order("name"),
      admin
        .from("outreach_campaigns")
        .select("id, name, status")
        .eq("business_id", businessId)
        .in("status", ["DRAFT", "READY", "ACTIVE", "PAUSED"])
        .order("updated_at", { ascending: false })
        .limit(50),
      admin
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", businessId),
    ]);

    const connected = new Set(
      (integrations.data ?? [])
        .filter((row) => row.status === "connected" || row.status === "active")
        .map((row) => row.provider_type),
    );

    const availability = {} as AgentWizardOptions["sourceAvailability"];
    for (const definition of Object.values(SOURCE_DEFINITIONS)) {
      let status: SourceStatus = "AVAILABLE";
      let detail: string | null = null;

      if (definition.key === "META_LEAD_ADS" && !connected.has("meta")) {
        status = "REQUIRES_SETUP";
        detail = definition.requires;
      } else if (definition.key === "LINKEDIN_ADS" && !connected.has("linkedin_ads")) {
        status = "REQUIRES_SETUP";
        detail = definition.requires;
      } else if (
        definition.key === "CRM_SYNC" &&
        !["hubspot", "zoho_crm", "salesforce", "pipedrive"].some((p) => connected.has(p))
      ) {
        status = "REQUIRES_SETUP";
        detail = definition.requires;
      }

      availability[definition.key] = { status, detail };
    }

    return {
      icpProfiles: icps.data ?? [],
      conversionGoals: goals.data ?? [],
      services: services.data ?? [],
      campaigns: campaigns.data ?? [],
      sourceAvailability: availability,
    };
  },
);

/** Counts for the list page's header chips. */
export async function getAgentCounts(businessId: string): Promise<{
  all: number;
  active: number;
  needsAttention: number;
  draft: number;
}> {
  const supabase = await createClient();
  const base = () =>
    supabase.from("agents").select("id", { count: "exact", head: true }).eq("business_id", businessId);

  const [all, active, attention, draft] = await Promise.all([
    base(),
    base().eq("status", "ACTIVE"),
    base().in("status", ["NEEDS_ATTENTION", "ERROR"]),
    base().eq("status", "DRAFT"),
  ]);

  return {
    all: all.count ?? 0,
    active: active.count ?? 0,
    needsAttention: attention.count ?? 0,
    draft: draft.count ?? 0,
  };
}
