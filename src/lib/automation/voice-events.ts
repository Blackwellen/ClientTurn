/**
 * Voice automation triggers (gap map §45), read off the voice runtime's own
 * writes rather than threaded through it.
 *
 * `withVoiceAutomationEvents(repo, emit)` wraps the voice repo: when the
 * runtime moves a call to DIALLING, ANSWERED, NO_ANSWER/BUSY or VOICEMAIL,
 * records a queued call, saves an outcome or saves objections, the matching
 * automation event is emitted after the write succeeded. The runtime itself is
 * untouched, so a repo without the wrapper (the tests' in-memory repo) behaves
 * exactly as before, and an emit that fails never fails the call.
 *
 * Pure: types only from the voice modules, no `server-only`, so the mapping is
 * asserted in tests/automation-rules.test.ts with a fake repo.
 */

import type { AutomationEventType } from "./event-types.ts";

/** The slice of the voice repo this wraps. Structural, so the real VoiceRepo fits. */
type CallLike = { id: string; business_id: string; lead_id: string; route?: string | null };
type RepoSlice = {
  transitionCall(callId: string, from: readonly never[], patch: { state?: string }): Promise<CallLike | null>;
  audit(entry: { businessId: string; action: string; entityId: string | null; metadata: Record<string, unknown> }): Promise<void>;
  saveOutcome(input: { businessId: string; callId: string; leadId: string; analysis: { disposition: string; facts: Record<string, string>; voiceOptOut: boolean } }): Promise<void>;
  saveObjections(input: { businessId: string; leadId: string; callId: string; objections: readonly { key: string }[] }): Promise<void>;
};

export type VoiceEmit = (input: {
  businessId: string;
  leadId: string | null;
  eventType: AutomationEventType;
  payload: Record<string, unknown>;
}) => Promise<void>;

/** Call state -> trigger. States not listed emit nothing. */
export const CALL_STATE_EVENT: Readonly<Record<string, AutomationEventType>> = {
  DIALLING: "call.started",
  ANSWERED: "call.answered",
  NO_ANSWER: "call.missed",
  BUSY: "call.missed",
  VOICEMAIL: "call.voicemail",
};

/** Dispositions that move a lead forward: the call "qualified" it. */
const FORWARD_DISPOSITIONS = new Set(["MEETING_BOOKED", "CHECKOUT_LINK_SENT", "QUOTE_REQUESTED"]);

/**
 * The events one call outcome produces. `call.qualified` when the call moved
 * the lead forward (a booking, a checkout link, a quote request, or a
 * conversation that captured at least one fact) and the lead did not opt out.
 */
export function outcomeEvents(analysis: { disposition: string; facts: Record<string, string>; voiceOptOut: boolean }): AutomationEventType[] {
  const out: AutomationEventType[] = [];
  const factCount = Object.keys(analysis.facts ?? {}).length;
  const forward =
    FORWARD_DISPOSITIONS.has(analysis.disposition) || (analysis.disposition === "CONVERSATION" && factCount > 0);
  if (forward && !analysis.voiceOptOut) out.push("call.qualified");
  if (analysis.disposition === "QUOTE_REQUESTED") out.push("quote.requested");
  if (analysis.disposition === "TRANSFERRED_TO_HUMAN") out.push("human.requested");
  return out;
}

async function safely(emit: VoiceEmit, input: Parameters<VoiceEmit>[0]): Promise<void> {
  try {
    await emit(input);
  } catch (error) {
    console.error("[automation] voice event not emitted", {
      eventType: input.eventType,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function withVoiceAutomationEvents<R extends RepoSlice>(repo: R, emit: VoiceEmit): R {
  const wrapped: R = Object.create(repo);
  // Bound so methods that call `this` or `repo.x` on the original keep working.
  for (const key of Object.keys(repo) as (keyof R)[]) {
    const value = repo[key];
    if (typeof value === "function") (wrapped as Record<keyof R, unknown>)[key] = (value as (...a: unknown[]) => unknown).bind(repo);
  }

  wrapped.transitionCall = (async (callId: string, from: readonly never[], patch: { state?: string }) => {
    const row = await repo.transitionCall(callId, from, patch);
    const eventType = row && patch.state ? CALL_STATE_EVENT[patch.state] : undefined;
    if (row && eventType) {
      await safely(emit, {
        businessId: row.business_id,
        leadId: row.lead_id,
        eventType,
        payload: { callId: row.id, leadId: row.lead_id, route: row.route ?? null, state: patch.state },
      });
    }
    return row;
  }) as R["transitionCall"];

  wrapped.audit = (async (entry: Parameters<RepoSlice["audit"]>[0]) => {
    await repo.audit(entry);
    if (entry.action === "voice.call_queued") {
      const leadId = typeof entry.metadata.lead_id === "string" ? entry.metadata.lead_id : null;
      await safely(emit, {
        businessId: entry.businessId,
        leadId,
        eventType: "call.requested",
        payload: { callId: entry.entityId, leadId, route: entry.metadata.route ?? null, entryPoint: entry.metadata.entry_point ?? null },
      });
    }
  }) as R["audit"];

  wrapped.saveOutcome = (async (input: Parameters<RepoSlice["saveOutcome"]>[0]) => {
    await repo.saveOutcome(input);
    for (const eventType of outcomeEvents(input.analysis)) {
      await safely(emit, {
        businessId: input.businessId,
        leadId: input.leadId,
        eventType,
        payload: { callId: input.callId, leadId: input.leadId, disposition: input.analysis.disposition, source: "call" },
      });
    }
  }) as R["saveOutcome"];

  wrapped.saveObjections = (async (input: Parameters<RepoSlice["saveObjections"]>[0]) => {
    await repo.saveObjections(input);
    if (input.objections.length > 0) {
      await safely(emit, {
        businessId: input.businessId,
        leadId: input.leadId,
        eventType: "objection.detected",
        payload: { callId: input.callId, leadId: input.leadId, objections: input.objections.map((o) => o.key).slice(0, 10), source: "call" },
      });
    }
  }) as R["saveObjections"];

  return wrapped;
}
