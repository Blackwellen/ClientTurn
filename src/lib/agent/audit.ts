import "server-only";

/**
 * The decision log.
 *
 * Everything the runtime decides is recorded here as structured, non-sensitive
 * facts: which tools ran, which were refused and why, which extracted fields
 * were accepted, what the turn ended up doing. Nothing in this module ever
 * writes model reasoning, prompt text, tool arguments verbatim, or provider
 * detail -- the model is never asked for chain-of-thought in the first place,
 * so there is none to leak.
 *
 * Logging must never break a turn: a failed audit write is swallowed after the
 * run row itself exists, because losing an audit line is strictly better than
 * losing an inbound enquiry.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AgentActionStatus,
  AgentChannel,
  AgentEvent,
  AgentMode,
  AgentOperatingMode,
  AgentOutcome,
  AgentRunStatus,
  LeadIntent,
  LifecycleState,
  ReplyClassification,
  RiskLevel,
} from "./types";

/**
 * Supabase query builders are thenables, not Promises, so they have no
 * `.catch`. Awaiting inside a try/catch is the only correct way to make an
 * audit write best-effort.
 */
async function swallow(operation: PromiseLike<unknown>): Promise<void> {
  try {
    await operation;
  } catch {
    // An audit line is worth strictly less than the turn it describes.
  }
}

export type AgentRunHandle = {
  id: string;
  businessId: string;
  startedAt: number;
  /** Incremented by recordAction so step indices are stable and ordered. */
  step: number;
};

/**
 * Opens (or re-attaches to) the run for this event. The unique index on
 * (business_id, idempotency_key) is what makes a retried job idempotent: the
 * second attempt finds the existing row rather than starting a second turn.
 *
 * Returns null when a COMPLETED run already exists for the key, which is the
 * signal to the caller that this delivery is a duplicate and must do nothing.
 */
export async function openRun(input: {
  event: AgentEvent;
  mode: AgentMode;
  agentMode: AgentOperatingMode;
  lifecycle: LifecycleState;
  qualificationState: string;
}): Promise<AgentRunHandle | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("conversation_agent_runs")
    .insert({
      business_id: input.event.businessId,
      lead_id: input.event.leadId,
      conversation_id: input.event.conversationId,
      trigger_event_type: input.event.eventType,
      trigger_event_id: input.event.eventId,
      idempotency_key: input.event.idempotencyKey,
      mode: input.mode,
      agent_mode: input.agentMode,
      channel: input.event.channel,
      status: "RUNNING",
      lifecycle_before: input.lifecycle,
      qualification_before: input.qualificationState,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    const { data: existing } = await admin
      .from("conversation_agent_runs")
      .select("id, status")
      .eq("business_id", input.event.businessId)
      .eq("idempotency_key", input.event.idempotencyKey)
      .maybeSingle();

    // A run left RUNNING by a crashed worker is safe to resume: every
    // side-effecting tool downstream carries its own idempotency key.
    if (!existing || existing.status !== "RUNNING") return null;
    return {
      id: existing.id,
      businessId: input.event.businessId,
      startedAt: Date.now(),
      step: 0,
    };
  }

  if (error || !data) throw error ?? new Error("Could not open an agent run.");

  return {
    id: data.id,
    businessId: input.event.businessId,
    startedAt: Date.now(),
    step: 0,
  };
}

export type CloseRunInput = {
  status: AgentRunStatus;
  outcome: AgentOutcome;
  intent?: LeadIntent | null;
  intentConfidence?: number | null;
  replyClassification?: ReplyClassification | null;
  lifecycleAfter?: LifecycleState | null;
  qualificationAfter?: string | null;
  errorCode?: string | null;
  /**
   * Structured decision record. Keys are fixed and shallow so a query can
   * aggregate over them; free-form model text never lands here.
   */
  decision?: Record<string, unknown>;
};

export async function closeRun(
  handle: AgentRunHandle,
  input: CloseRunInput,
): Promise<void> {
  const admin = createAdminClient();
  await swallow(
    admin
      .from("conversation_agent_runs")
      .update({
        status: input.status,
        outcome: input.outcome,
        detected_intent: input.intent ?? null,
        intent_confidence: input.intentConfidence ?? null,
        reply_classification: input.replyClassification ?? null,
        lifecycle_after: input.lifecycleAfter ?? null,
        qualification_after: input.qualificationAfter ?? null,
        step_count: handle.step,
        error_code: input.errorCode ?? null,
        decision_json: (input.decision ?? {}) as never,
        duration_ms: Date.now() - handle.startedAt,
        completed_at: new Date().toISOString(),
      })
      .eq("id", handle.id),
  );
}

export type RecordActionInput = {
  toolName: string;
  riskLevel: RiskLevel;
  status: AgentActionStatus;
  denialReason?: string | null;
  /** Summarised, not raw: ids and counts, never credentials or full payloads. */
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  latencyMs?: number | null;
};

export async function recordAction(
  handle: AgentRunHandle,
  input: RecordActionInput,
): Promise<void> {
  handle.step += 1;
  const admin = createAdminClient();
  await swallow(
    admin
      .from("conversation_agent_actions")
      .insert({
        business_id: handle.businessId,
        agent_run_id: handle.id,
        step_index: handle.step,
        tool_name: input.toolName,
        risk_level: input.riskLevel,
        status: input.status,
        denial_reason: input.denialReason ?? null,
        input_summary: (input.input ?? {}) as never,
        result_summary: (input.result ?? {}) as never,
        latency_ms: input.latencyMs ?? null,
      }),
  );
}

export type ExtractionRecord = {
  leadId: string;
  field: string;
  value: unknown;
  confidence: number;
  sourceMessageId?: string | null;
  accepted: boolean;
  rejectedReason?: string | null;
};

/**
 * Records every candidate field the model proposed, accepted or not. The
 * rejected rows are the ones that earn their keep: they answer "why did it not
 * fill this in" without re-running anything.
 */
export async function recordExtractions(
  handle: AgentRunHandle,
  records: ExtractionRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const admin = createAdminClient();
  await swallow(
    admin
      .from("conversation_agent_extractions")
      .insert(
        records.map((record) => ({
          business_id: handle.businessId,
          agent_run_id: handle.id,
          lead_id: record.leadId,
          field: record.field,
          value_json: (record.value ?? null) as never,
          confidence: record.confidence,
          source_message_id: record.sourceMessageId ?? null,
          accepted: record.accepted,
          rejected_reason: record.rejectedReason ?? null,
        })),
      ),
  );
}

/** Records model usage onto the run so cost is attributable per conversation. */
export async function recordUsage(
  handle: AgentRunHandle,
  usage: {
    modelProvider: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  },
): Promise<void> {
  const admin = createAdminClient();
  await swallow(
    admin
      .from("conversation_agent_runs")
      .update({
        model_provider: usage.modelProvider,
        model_name: usage.modelName,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        estimated_cost_usd: usage.estimatedCostUsd,
      })
      .eq("id", handle.id),
  );
}

/**
 * A run that was never opened -- the gate refused before any work happened.
 * Recorded so "why did the agent not reply to this" is answerable, and cheap
 * enough that an off workspace costs one insert per inbound message.
 */
export async function recordSkippedRun(input: {
  event: AgentEvent;
  agentMode: AgentOperatingMode;
  channel: AgentChannel | null;
  code: string;
  detail: string;
}): Promise<void> {
  const admin = createAdminClient();
  await swallow(
    admin
      .from("conversation_agent_runs")
      .insert({
        business_id: input.event.businessId,
        lead_id: input.event.leadId,
        conversation_id: input.event.conversationId,
        trigger_event_type: input.event.eventType,
        trigger_event_id: input.event.eventId,
        idempotency_key: input.event.idempotencyKey,
        agent_mode: input.agentMode,
        channel: input.channel,
        status: "SKIPPED",
        outcome: "NO_ACTION",
        error_code: input.code,
        decision_json: { skipped: input.detail } as never,
        completed_at: new Date().toISOString(),
        duration_ms: 0,
      }),
  );
}
