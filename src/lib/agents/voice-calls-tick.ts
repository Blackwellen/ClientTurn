import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation } from "@/lib/services";
import { voiceMaintenancePauseUntil } from "@/lib/voice/server-p3";
import { findStalledLeads, type AgentRow } from "./ticks";
import {
  CALL_APPROVAL_ITEM,
  CALL_APPROVAL_OPEN_STATUSES,
  agentCallIdempotencyKey,
  closingRouteForGoal,
  runAgentVoiceCalls,
  type AgentVoiceAgent,
  type AgentVoiceDeps,
  type AgentVoiceRoute,
  type AgentVoiceTickResult,
  type VoiceCandidate,
} from "./voice-calls";
import { agentCallsSince, readAgentVoiceColumns, workspaceAiMayCall, workspaceVoiceStatus } from "./voice-calls-guard";

/**
 * "Phone leads with AI" on the agent's scheduled tick (0176): the server
 * dependencies for `runAgentVoiceCalls`. The call itself is always
 * `voice.request_call` run as caller AGENT, the same operation and the same
 * `requestCall -> decideDial` path the "Call with AI" button uses.
 */

type Db = ReturnType<typeof createAdminClient>;

const OPEN_STATES = ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED", "DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];

const ROUTE_WORDS: Record<AgentVoiceRoute, string> = {
  QUALIFICATION: "to qualify them",
  BOOKING_CLOSE: "to book the meeting",
  DIRECT_CLOSE: "to close the sale",
};

/** New leads the agent may qualify by phone: arrived in the last 7 days, not yet qualified. */
const NEW_LEAD_WINDOW_MS = 7 * 864e5;

function label(lead: { first_name: string | null; last_name: string | null; email: string | null }): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || lead.email || "a lead";
}

async function callHistory(
  db: Db,
  businessId: string,
  agentId: string,
  leadIds: string[],
): Promise<{ open: Set<string>; routes: Map<string, Set<string>>; awaitingApproval: Set<string> }> {
  const open = new Set<string>();
  const routes = new Map<string, Set<string>>();
  const awaitingApproval = new Set<string>();
  if (!leadIds.length) return { open, routes, awaitingApproval };
  const approvals = await db
    .from("agent_queue_items")
    .select("subject_id")
    .eq("business_id", businessId)
    .eq("agent_id", agentId)
    .eq("item_type", CALL_APPROVAL_ITEM.itemType)
    .eq("subject_type", CALL_APPROVAL_ITEM.subjectType)
    .in("status", [...CALL_APPROVAL_OPEN_STATUSES])
    .in("subject_id", leadIds);
  if (approvals.error) throw new Error("Calls waiting for approval could not be read.");
  for (const a of approvals.data ?? []) if (a.subject_id) awaitingApproval.add(a.subject_id);
  const { data, error } = await db
    .from("voice_calls")
    .select("lead_id, route, state")
    .eq("business_id", businessId)
    .in("lead_id", leadIds);
  if (error) throw new Error("Earlier calls could not be read.");
  for (const c of (data ?? []) as { lead_id: string; route: string; state: string }[]) {
    if (OPEN_STATES.includes(c.state)) open.add(c.lead_id);
    routes.set(c.lead_id, (routes.get(c.lead_id) ?? new Set()).add(c.route));
  }
  return { open, routes, awaitingApproval };
}

function serverDeps(row: AgentRow): AgentVoiceDeps {
  const db = createAdminClient();
  return {
    now: () => new Date(),
    maintenancePausedUntil: voiceMaintenancePauseUntil,
    voiceStatus: workspaceVoiceStatus,
    aiMayCall: workspaceAiMayCall,
    callsSince: agentCallsSince,

    async approvalsSince(businessId, agentId, since) {
      const { count, error } = await db
        .from("agent_queue_items")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("agent_id", agentId)
        .eq("item_type", CALL_APPROVAL_ITEM.itemType)
        .eq("subject_type", CALL_APPROVAL_ITEM.subjectType)
        .in("status", [...CALL_APPROVAL_OPEN_STATUSES])
        .gte("created_at", since.toISOString());
      if (error) throw new Error("Calls waiting for approval could not be counted.");
      return count ?? 0;
    },

    async requestApproval(agent, c) {
      // One open approval per agent and lead: a second run finds it.
      const open = await db
        .from("agent_queue_items")
        .select("id")
        .eq("business_id", agent.businessId)
        .eq("agent_id", agent.id)
        .eq("item_type", CALL_APPROVAL_ITEM.itemType)
        .eq("subject_type", CALL_APPROVAL_ITEM.subjectType)
        .eq("subject_id", c.leadId)
        .in("status", [...CALL_APPROVAL_OPEN_STATUSES])
        .limit(1)
        .maybeSingle();
      if (open.error) return { ok: false, message: "The approval could not be checked." };
      if (open.data) return { ok: true, existing: true };
      const { error } = await db.from("agent_queue_items").insert({
        business_id: agent.businessId,
        agent_id: agent.id,
        item_type: CALL_APPROVAL_ITEM.itemType,
        status: "BLOCKED",
        subject_type: CALL_APPROVAL_ITEM.subjectType,
        subject_id: c.leadId,
        subject_label: `Call ${c.label} with AI`,
        blocked_reason: `Approve to let the AI phone this lead (${ROUTE_WORDS[c.route]}). This agent's approval setting asks a person before each call.`,
      });
      if (error) return { ok: false, message: "The call could not be put up for approval." };
      return { ok: true, existing: false };
    },

    async candidates(agent, work, limit): Promise<VoiceCandidate[]> {
      if (work === "CLOSING") {
        const stalled = await findStalledLeads(row);
        const leads = stalled.leads.slice(0, limit);
        const history = await callHistory(db, agent.businessId, agent.id, leads.map((l) => l.id));
        return leads.map((lead) => {
          const route = closingRouteForGoal(lead.goal);
          return {
            leadId: lead.id,
            label: label(lead),
            route,
            phone: lead.phone,
            optedOut: lead.opted_out,
            humanTakeover: lead.human_takeover,
            openCall: history.open.has(lead.id),
            calledOnRoute: history.routes.get(lead.id)?.has(route) ?? false,
            approvalPending: history.awaitingApproval.has(lead.id),
          };
        });
      }
      const since = new Date(Date.now() - NEW_LEAD_WINDOW_MS).toISOString();
      const { data, error } = await db
        .from("leads")
        .select("id, first_name, last_name, email, phone, opted_out, human_takeover")
        .eq("business_id", agent.businessId)
        .eq("is_test", false)
        .in("qualification_state", ["PENDING", "REVIEW"])
        .is("won_at", null)
        .is("lost_at", null)
        .is("archived_at", null)
        .eq("opted_out", false)
        .eq("human_takeover", false)
        .not("phone", "is", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error("New leads could not be read.");
      const leads = (data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; opted_out: boolean; human_takeover: boolean }[];
      const history = await callHistory(db, agent.businessId, agent.id, leads.map((l) => l.id));
      const route: AgentVoiceRoute = "QUALIFICATION";
      return leads.map((lead) => ({
        leadId: lead.id,
        label: label(lead),
        route,
        phone: lead.phone,
        optedOut: lead.opted_out,
        humanTakeover: lead.human_takeover,
        openCall: history.open.has(lead.id),
        calledOnRoute: history.routes.get(lead.id)?.has(route) ?? false,
        approvalPending: history.awaitingApproval.has(lead.id),
      }));
    },

    async requestCall(agent, leadId, route) {
      const result = await runOperation<{ callId: string; existing: boolean; deferredReason: string | null }>(
        "voice.request_call",
        { leadId, route, agentId: agent.id },
        {
          businessId: agent.businessId,
          userId: null,
          role: "member",
          caller: "AGENT",
          // The admin's switch ("Phone leads with AI" plus the workspace's
          // "Phone leads" permission) is the standing confirmation; the
          // handler re-checks both, and the audit row says so.
          confirmed: true,
          confirmationSource: "standing_permission",
          correlationId: `agent-voice:${agent.id}:${randomUUID()}`,
          idempotencyKey: agentCallIdempotencyKey(agent.id, leadId, route),
        },
      );
      if (!result.success) return { ok: false, code: result.code, message: result.message };
      return { ok: true, callId: result.data.callId, existing: result.data.existing, deferredReason: result.data.deferredReason };
    },

    async record(agent, event) {
      await db.from("agent_activity_events").insert({
        business_id: agent.businessId,
        agent_id: agent.id,
        event_type: event.eventType,
        severity: event.severity,
        title: event.title,
        detail: event.detail,
        subject_type: event.callId ? "voice_call" : event.leadId ? "lead" : null,
        subject_id: event.callId ?? event.leadId ?? null,
        metadata: { lead_id: event.leadId ?? null, call_id: event.callId ?? null } as never,
      });
    },
  };
}

/**
 * The agent's voice step for one tick. A no-op (and no timeline row) when the
 * option is off, the type does not phone, or 0176 is not applied.
 */
export async function runAgentVoiceTick(row: AgentRow & { name?: string; agent_type: string; status?: string }): Promise<AgentVoiceTickResult> {
  const columns = await readAgentVoiceColumns(row.business_id, [row.id]);
  const settings = columns.byAgent.get(row.id);
  const agent: AgentVoiceAgent = {
    id: row.id,
    businessId: row.business_id,
    name: row.name ?? "Agent",
    agentType: row.agent_type,
    status: row.status ?? "ACTIVE",
    autonomy: row.autonomy,
    voiceCallsEnabled: columns.schemaReady && settings?.enabled === true,
    dailyCallCap: settings?.dailyCap ?? 20,
  };
  return runAgentVoiceCalls(serverDeps(row), agent);
}
