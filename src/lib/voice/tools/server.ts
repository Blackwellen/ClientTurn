import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation, type ServiceContext } from "@/lib/services";
import { runVoiceTool, toolCallIdOf, type RetellToolBody, type ClaimResult, type PortOutcome, type PriorToolResult, type ToolCallRow, type VoiceToolPorts, type VoiceToolResponse } from "./core";
import { isVoiceToolName, type VoiceToolName } from "./definitions";
import { logEvent } from "@/lib/observability/log";

/**
 * Server wiring for the voice tool core: Supabase for the call, the
 * idempotency row (voice_tool_calls, 0162) and earlier results; the service
 * registry, as caller AGENT, for the work (`voice_agent.<tool>`).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const CALL_COLUMNS = "id, business_id, lead_id, route, state, direction, consent_basis, answered_at, started_at, created_at, provider_call_id";

/** Operation names in the service registry, one per tool (services/registry.ts). */
export const VOICE_AGENT_OPERATION: Readonly<Record<Exclude<VoiceToolName, "get_call_status">, string>> = {
  record_fact: "voice_agent.record_fact",
  check_availability: "voice_agent.check_availability",
  book_meeting: "voice_agent.book_meeting",
  calculate_quote: "voice_agent.calculate_quote",
  send_quote: "voice_agent.send_quote",
  send_checkout_link: "voice_agent.send_checkout_link",
  send_booking_link: "voice_agent.send_booking_link",
  transfer_to_human: "voice_agent.transfer_to_human",
  schedule_callback: "voice_agent.schedule_callback",
  opt_out: "voice_agent.opt_out",
  log_objection: "voice_agent.log_objection",
  end_call_summary: "voice_agent.end_call_summary",
};

/** The context a voice tool runs under: caller AGENT, no user, member role, one correlation id per call. */
export function voiceAgentContext(call: ToolCallRow, idempotencyKey: string, standingConfirmation = false): ServiceContext {
  return {
    businessId: call.business_id,
    userId: null,
    role: "member",
    caller: "AGENT",
    correlationId: `voice:${call.id}`,
    idempotencyKey,
    // The two EXTERNAL tools run on the owner's standing permission (Settings,
    // AI & selling, What the AI may do: send quotes / direct close), which
    // voiceToolGate has just checked, exactly as the text agent's quote send.
    ...(standingConfirmation ? { confirmed: true, confirmationSource: "standing_permission" as const } : {}),
  };
}

/** Tools whose operation is EXTERNAL and runs on the owner's standing permission. */
const STANDING_PERMISSION_TOOLS: ReadonlySet<VoiceToolName> = new Set(["send_quote", "send_checkout_link", "send_booking_link"]);

export const serverToolPorts: VoiceToolPorts = {
  now: () => new Date(),

  async loadCall(ref) {
    if (ref.callId && /^[0-9a-f-]{36}$/i.test(ref.callId)) {
      const { data } = await db().from("voice_calls").select(CALL_COLUMNS).eq("id", ref.callId).maybeSingle();
      const row = data as (ToolCallRow & { provider_call_id: string | null }) | null;
      // The metadata's call id must belong to the provider call that signed this request.
      if (row && ref.providerCallId && row.provider_call_id && row.provider_call_id !== ref.providerCallId) return null;
      if (row) return row;
    }
    if (ref.providerCallId) {
      const { data } = await db().from("voice_calls").select(CALL_COLUMNS).eq("provider_call_id", ref.providerCallId).maybeSingle();
      if (data) return data as ToolCallRow;
    }
    return null;
  },

  async claim({ call, toolCallId, tool, argsHash }): Promise<ClaimResult> {
    const { error } = await db().from("voice_tool_calls").insert({
      business_id: call.business_id,
      voice_call_id: call.id,
      lead_id: call.lead_id,
      tool_call_id: toolCallId.slice(0, 200),
      tool,
      args_hash: argsHash,
      status: "IN_PROGRESS",
    });
    if (!error) return { kind: "NEW" };
    if (error.code !== "23505") return { kind: "UNAVAILABLE" };
    const { data } = await db()
      .from("voice_tool_calls")
      .select("status, args_hash, result")
      .eq("voice_call_id", call.id)
      .eq("tool_call_id", toolCallId.slice(0, 200))
      .maybeSingle();
    const row = data as { status: string; args_hash: string; result: VoiceToolResponse } | null;
    if (!row) return { kind: "UNAVAILABLE" };
    if (row.args_hash !== argsHash) return { kind: "MISMATCH" };
    if (row.status === "IN_PROGRESS") return { kind: "IN_PROGRESS" };
    return { kind: "DONE", response: row.result };
  },

  async complete({ call, toolCallId, status, operation, response, refusalCode, latencyMs }) {
    await db()
      .from("voice_tool_calls")
      .update({ status, operation, result: response, refusal_code: refusalCode, latency_ms: latencyMs, completed_at: new Date().toISOString() })
      .eq("voice_call_id", call.id)
      .eq("tool_call_id", toolCallId.slice(0, 200));
  },

  async priorResults(callId): Promise<PriorToolResult[]> {
    const { data } = await db().from("voice_tool_calls").select("tool, status, result").eq("voice_call_id", callId).order("created_at", { ascending: true }).limit(100);
    return ((data ?? []) as { tool: string; status: string; result: VoiceToolResponse | null }[])
      .filter((r) => isVoiceToolName(r.tool))
      .map((r) => ({ tool: r.tool as VoiceToolName, status: r.status, result: (r.result?.data ?? {}) as Record<string, unknown> }));
  },

  async permissions(call) {
    const { loadVoiceCall, voiceToolPermissions } = await import("./work");
    const lite = await loadVoiceCall(call.business_id, call.id);
    if (!lite) {
      return { aiEnabled: false, book: false, quote: false, sendQuote: false, checkout: false, transferMode: "NEVER", transferNumberSet: false, transferHuman: false, aiCall: false, hasEmail: false, smsLawful: false, bookingLink: false };
    }
    return voiceToolPermissions(lite);
  },

  // One redacted operator event per tool verdict (ids, tool, verdict, code,
  // latency; never arguments or words). The audit row for a write is the
  // service registry's; READ tools and refusals are on voice_tool_calls.
  observe(event) {
    logEvent("voice.tool_used", { ...event }, event.status === "FAILED" ? "warn" : "info");
  },

  async execute(name, call, args, key): Promise<PortOutcome> {
    if (name === "get_call_status") return { ok: true, say: null, data: {}, operation: null };
    const operation = VOICE_AGENT_OPERATION[name as Exclude<VoiceToolName, "get_call_status">];
    const result = await runOperation<PortOutcome>(operation, { callId: call.id, ...(args as Record<string, unknown>) }, voiceAgentContext(call, key, STANDING_PERMISSION_TOOLS.has(name)));
    if (!result.success) return { ok: false, code: result.code, say: "", operation };
    return result.data;
  },
};

/* ------------------------------------------------------------ the request */

export async function handleVoiceToolRequest(tool: string, rawBody: string) {
  let body: RetellToolBody;
  try {
    body = JSON.parse(rawBody) as RetellToolBody;
  } catch {
    return { status: 400, body: { ok: false as const, error: "Invalid JSON." } };
  }
  const meta = body.call?.metadata ?? {};
  return runVoiceTool(serverToolPorts, {
    name: tool,
    toolCallId: toolCallIdOf(body, tool),
    callId: typeof meta.voice_call_id === "string" ? meta.voice_call_id : null,
    providerCallId: typeof body.call?.call_id === "string" ? body.call.call_id : null,
    args: body.args ?? {},
  });
}
