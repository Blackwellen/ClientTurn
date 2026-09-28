import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { aiMay } from "@/lib/commercial/ai-permissions";
import { assertVoiceAllowed } from "@/lib/voice/entitlement";
import { ENTITLEMENT_MESSAGES } from "@/lib/voice/dial-decision";
import { buildEntitlementSnapshot } from "@/lib/voice/snapshot";
import { loadEntitlementFacts } from "@/lib/voice/server-deps";
import { voiceIntegrationStatus } from "@/lib/voice/providers/registry";
import { clampDailyCap, type AgentCallFacts, type AgentVoiceAvailability } from "./voice-calls";

/**
 * Server reads for agent-initiated AI calls (0176). No service-layer import,
 * so `services/operations/voice.ts` can use it without a cycle.
 *
 * Every read tolerates a database without 0176: the option then reads as off
 * and cannot be switched on, and no agent asks for a call.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const LOCKED_REASONS = ["TRIAL_ACCOUNT", "DEMO_ACCOUNT", "FREE_ACCOUNT", "SUBSCRIPTION_INACTIVE", "CAPABILITY_MISSING", "NO_VOICE_PACKAGE"];

/** Is voice usable for the workspace at all (entitlement plus connection), and why not. */
export async function workspaceVoiceStatus(businessId: string): Promise<{ usable: boolean; reason: string | null; locked: boolean }> {
  const integration = voiceIntegrationStatus();
  let decision: ReturnType<typeof assertVoiceAllowed>;
  try {
    decision = assertVoiceAllowed(buildEntitlementSnapshot(await loadEntitlementFacts(businessId)));
  } catch {
    return { usable: false, reason: "Voice settings could not be read right now.", locked: false };
  }
  if (!decision.allowed) {
    return {
      usable: false,
      reason: ENTITLEMENT_MESSAGES[decision.reason] ?? "Voice isn't available on this workspace right now.",
      locked: LOCKED_REASONS.includes(decision.reason),
    };
  }
  if (!integration.ready) return { usable: false, reason: "Calling isn't connected on this environment yet.", locked: false };
  return { usable: true, reason: null, locked: false };
}

/** The workspace's "What the AI may do -> Phone leads", read fresh. */
export async function workspaceAiMayCall(businessId: string): Promise<boolean> {
  const authority = await loadCommercialAuthoritySettings(businessId);
  return aiMay(aiAuthorityOf(authority), "call");
}

/** Calls an agent asked for since `since` (the daily cap). Schema lag reads as 0 calls and no agent calling. */
export async function agentCallsSince(businessId: string, agentId: string, since: Date): Promise<number> {
  const { count, error } = await db()
    .from("voice_calls")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("requested_by_agent_id", agentId)
    .gte("created_at", since.toISOString());
  if (error) throw new Error("The agent's calls could not be counted.");
  return count ?? 0;
}

export type AgentVoiceColumns = { enabled: boolean; dailyCap: number };

/** The 0176 columns for some agents. `schemaReady: false` before 0176. */
export async function readAgentVoiceColumns(
  businessId: string,
  agentIds?: readonly string[],
): Promise<{ schemaReady: boolean; byAgent: Map<string, AgentVoiceColumns> }> {
  const byAgent = new Map<string, AgentVoiceColumns>();
  let q = db().from("agents").select("id, voice_calls_enabled, voice_daily_call_cap").eq("business_id", businessId);
  if (agentIds) {
    if (agentIds.length === 0) return { schemaReady: true, byAgent };
    q = q.in("id", [...agentIds]);
  }
  const { data, error } = await q;
  if (error) {
    if (isSchemaLag(error)) return { schemaReady: false, byAgent };
    throw new Error("Agent call settings could not be read.");
  }
  for (const row of (data ?? []) as { id: string; voice_calls_enabled: boolean; voice_daily_call_cap: number }[]) {
    byAgent.set(row.id, { enabled: row.voice_calls_enabled === true, dailyCap: clampDailyCap(row.voice_daily_call_cap) });
  }
  return { schemaReady: true, byAgent };
}

/** Calls per agent in a window, for the list and detail pages. Empty before 0176. */
export async function agentCallCounts(businessId: string, since: Date): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await db()
    .from("voice_calls")
    .select("requested_by_agent_id")
    .eq("business_id", businessId)
    .not("requested_by_agent_id", "is", null)
    .gte("created_at", since.toISOString())
    .limit(5000);
  if (error) return counts;
  for (const row of (data ?? []) as { requested_by_agent_id: string | null }[]) {
    if (row.requested_by_agent_id) counts.set(row.requested_by_agent_id, (counts.get(row.requested_by_agent_id) ?? 0) + 1);
  }
  return counts;
}

/** The facts `agentCallRefusal` decides on, read fresh for one request. */
export async function loadAgentCallFacts(
  businessId: string,
  agentId: string,
  route: string,
  now: Date,
): Promise<AgentCallFacts & { agentName: string | null }> {
  const { data, error } = await db()
    .from("agents")
    .select("id, name, status, agent_type, voice_calls_enabled, voice_daily_call_cap")
    .eq("business_id", businessId)
    .eq("id", agentId)
    .maybeSingle();
  if (error && !isSchemaLag(error)) throw new Error("The agent could not be read.");
  const row = (error ? null : data) as
    | { id: string; name: string; status: string; agent_type: string; voice_calls_enabled: boolean; voice_daily_call_cap: number }
    | null;
  if (!row) return { agent: null, aiMayCall: false, callsToday: 0, route, agentName: null };

  const since = new Date(now.getTime());
  since.setUTCHours(0, 0, 0, 0);
  const [aiMayCall, callsToday] = await Promise.all([workspaceAiMayCall(businessId), agentCallsSince(businessId, agentId, since)]);
  return {
    agent: {
      status: row.status,
      agentType: row.agent_type,
      voiceCallsEnabled: row.voice_calls_enabled === true,
      dailyCallCap: clampDailyCap(row.voice_daily_call_cap),
    },
    aiMayCall,
    callsToday,
    route,
    agentName: row.name,
  };
}

/** What the wizard and the agent's settings show for the option. */
export async function loadAgentVoiceAvailability(businessId: string, canManage: boolean): Promise<AgentVoiceAvailability> {
  const [voice, aiMayCall, probe] = await Promise.all([
    workspaceVoiceStatus(businessId),
    workspaceAiMayCall(businessId).catch(() => false),
    db().from("agents").select("voice_calls_enabled").eq("business_id", businessId).limit(1),
  ]);
  const schemaReady = !probe.error || !isSchemaLag(probe.error);
  return {
    schemaReady,
    voiceUsable: voice.usable,
    voiceReason: voice.reason,
    voiceLocked: voice.locked,
    aiMayCall,
    canManage,
  };
}
