import "server-only";

/**
 * Reads for the assistant surfaces.
 *
 * Every query is scoped by `business_id` from the caller's verified session,
 * on top of the RLS already enforced on `conversation_agent_runs` and
 * `agent_handoffs`. The belt-and-braces is deliberate: these reads run through
 * the service-role client in places, and a query that forgets the tenant
 * predicate would silently work.
 *
 * Nothing here returns a prompt, a tool argument, a confidence number or a
 * provider detail -- the view types in ./views.ts have no field for them.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { HANDOVER_REASON_LABEL, AGENT_OUTCOME_LABEL } from "./types";
import type {
  AgentOutcome,
  AgentRunStatus,
  HandoverPriority,
  HandoverReason,
  LeadIntent,
} from "./types";
import type {
  AgentDraftRow,
  AgentRunRow,
  ConversationAgentState,
  HandoffRow,
  HandoffStatus,
  HandoffSummaryView,
} from "./views";

type RawHandoff = {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  reason: string;
  priority: string;
  status: string;
  summary_json: unknown;
  assigned_user_id: string | null;
  resolution_note: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  leads?: { first_name: string | null; last_name: string | null } | null;
};

function readSummary(value: unknown): HandoffSummaryView {
  const raw = (value ?? {}) as Record<string, unknown>;
  const answers = Array.isArray(raw.keyAnswers) ? raw.keyAnswers : [];

  return {
    intent: typeof raw.intent === "string" ? raw.intent : null,
    service: typeof raw.service === "string" ? raw.service : null,
    qualificationStatus:
      typeof raw.qualificationStatus === "string" ? raw.qualificationStatus : null,
    keyAnswers: answers
      .filter(
        (entry): entry is { question: string; value: string } =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { question?: unknown }).question === "string" &&
          typeof (entry as { value?: unknown }).value === "string",
      )
      .slice(0, 10),
    bookingIntent: raw.bookingIntent === true,
    unresolvedIssue: typeof raw.unresolvedIssue === "string" ? raw.unresolvedIssue : null,
    sentiment: typeof raw.sentiment === "string" ? raw.sentiment : null,
    summary: typeof raw.summary === "string" ? raw.summary : null,
  };
}

function toHandoffRow(row: RawHandoff, assigneeName: string | null): HandoffRow {
  const reason = row.reason as HandoverReason;
  return {
    id: row.id,
    leadId: row.lead_id,
    leadName:
      [row.leads?.first_name, row.leads?.last_name].filter(Boolean).join(" ") || "This lead",
    conversationId: row.conversation_id,
    reason,
    reasonLabel: HANDOVER_REASON_LABEL[reason] ?? "Needs a person",
    priority: row.priority as HandoverPriority,
    status: row.status as HandoffStatus,
    summary: readSummary(row.summary_json),
    assignedUserId: row.assigned_user_id,
    assigneeName,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
  };
}

const HANDOFF_COLUMNS =
  "id, lead_id, conversation_id, reason, priority, status, summary_json, " +
  "assigned_user_id, resolution_note, created_at, acknowledged_at, resolved_at, " +
  "leads ( first_name, last_name )";

/** Resolves assignee display names in one round trip rather than per row. */
async function assigneeNames(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, first_name, last_name, email")
    .in("id", ids);

  return new Map(
    (data ?? []).map((row) => [
      row.id,
      [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.email ||
        "A team member",
    ]),
  );
}

export type HandoffFilter = {
  status?: HandoffStatus[];
  leadId?: string;
  limit?: number;
};

export async function listHandoffs(
  businessId: string,
  filter: HandoffFilter = {},
): Promise<HandoffRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("agent_handoffs")
    .select(HANDOFF_COLUMNS)
    .eq("business_id", businessId)
    // Urgent first, then oldest — a queue, not a feed.
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 50);

  if (filter.status?.length) query = query.in("status", filter.status);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as RawHandoff[];
  const names = await assigneeNames(rows.map((row) => row.assigned_user_id));

  return rows.map((row) =>
    toHandoffRow(row, row.assigned_user_id ? (names.get(row.assigned_user_id) ?? null) : null),
  );
}

export async function getHandoff(
  businessId: string,
  handoffId: string,
): Promise<HandoffRow | null> {
  const { data } = await createAdminClient()
    .from("agent_handoffs")
    .select(HANDOFF_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", handoffId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as RawHandoff;
  const names = await assigneeNames([row.assigned_user_id]);
  return toHandoffRow(
    row,
    row.assigned_user_id ? (names.get(row.assigned_user_id) ?? null) : null,
  );
}

/** Suggest-only replies still waiting for a person. */
export async function listDrafts(
  businessId: string,
  filter: { conversationId?: string; leadId?: string; limit?: number } = {},
): Promise<AgentDraftRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("messages")
    .select("id, conversation_id, lead_id, channel, body, created_at, agent_run_id")
    .eq("business_id", businessId)
    .eq("status", "DRAFT")
    .eq("origin", "agent")
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 20);

  if (filter.conversationId) query = query.eq("conversation_id", filter.conversationId);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);

  const { data } = await query;

  return (data ?? [])
    .filter((row) => row.lead_id)
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      leadId: row.lead_id as string,
      channel: row.channel,
      body: row.body,
      createdAt: row.created_at,
      agentRunId: row.agent_run_id,
    }));
}

export async function listAgentRuns(
  businessId: string,
  filter: { conversationId?: string; leadId?: string; limit?: number } = {},
): Promise<AgentRunRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("conversation_agent_runs")
    .select(
      "id, trigger_event_type, mode, status, outcome, detected_intent, error_code, duration_ms, created_at",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 20);

  if (filter.conversationId) query = query.eq("conversation_id", filter.conversationId);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);

  const { data } = await query;

  return (data ?? []).map((row) => {
    const outcome = (row.outcome ?? null) as AgentOutcome | null;
    return {
      id: row.id,
      triggerEventType: row.trigger_event_type,
      mode: row.mode,
      status: row.status as AgentRunStatus,
      outcome,
      intent: (row.detected_intent ?? null) as LeadIntent | null,
      outcomeLabel: outcome ? AGENT_OUTCOME_LABEL[outcome] : "No action",
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    };
  });
}

/**
 * Everything the assistant panel shows for one conversation, in one place so
 * the surface never renders a half-loaded state.
 */
export async function getConversationAgentState(
  businessId: string,
  conversationId: string,
): Promise<ConversationAgentState | null> {
  const admin = createAdminClient();

  const { data: conversation } = await admin
    .from("conversations")
    .select("id, lead_id, owner, channel")
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!conversation) return null;

  const [settings, handoffs, drafts, runs] = await Promise.all([
    admin
      .from("business_ai_settings")
      .select("agent_mode, agent_channels")
      .eq("business_id", businessId)
      .maybeSingle(),
    listHandoffs(businessId, { status: ["OPEN", "ACKNOWLEDGED"], limit: 1 }).then((rows) =>
      rows.filter((row) => row.conversationId === conversationId),
    ),
    listDrafts(businessId, { conversationId }),
    listAgentRuns(businessId, { conversationId, limit: 10 }),
  ]);

  const agentMode = (settings.data?.agent_mode ?? "OFF") as ConversationAgentState["agentMode"];
  const channels = settings.data?.agent_channels ?? [];

  return {
    conversationId: conversation.id,
    leadId: conversation.lead_id,
    owner: (conversation.owner ?? "AI_ACTIVE") as ConversationAgentState["owner"],
    agentEnabledHere: agentMode !== "OFF" && channels.includes(conversation.channel),
    agentMode,
    openHandoff: handoffs[0] ?? null,
    pendingDrafts: drafts,
    recentRuns: runs,
  };
}

/** Counts for the queue badge. Cheap enough to call on every page render. */
export async function countOpenHandoffs(businessId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("agent_handoffs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .in("status", ["OPEN", "ACKNOWLEDGED"]);

  return count ?? 0;
}
