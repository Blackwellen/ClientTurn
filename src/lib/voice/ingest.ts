/**
 * Applying one normalised provider event (`VoiceEvent`) to a call. Pure: the
 * `voice.webhook_ingest` job reads the call, asks this module what changes,
 * writes the patch under a compare-and-swap on the call's state, appends the
 * `voice_call_events` row and queues the follow-ups.
 *
 * Providers deliver out of order and more than once. `applyObservedState`
 * (state-machine.ts) ignores a stale or repeated observation rather than
 * regressing the call, and an unreachable one is recorded as not applied
 * (never thrown out of the job: a replay must not wedge the queue).
 */

import { applyObservedState, IllegalCallTransition, isTerminal, type CallState } from "./state-machine.ts";
import type { CallOutcome, VoiceEvent } from "./providers/types.ts";

export type IngestCall = {
  id: string;
  business_id: string;
  state: CallState;
  answered_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  outcome: string | null;
};

export type FollowUp = "POST_CALL" | "RECORDING_FETCH";

export type IngestResult = {
  observed: CallState | null;
  applied: boolean;
  reason: "APPLIED" | "STALE" | "TERMINAL" | "ILLEGAL" | "NO_STATE";
  /** The state after the event (unchanged when not applied). */
  state: CallState;
  /** Column updates for voice_calls (empty when nothing changes). */
  patch: Record<string, string | number | null>;
  followUps: FollowUp[];
  /** Safe payload for voice_call_events: ids and states, never words or numbers. */
  eventPayload: Record<string, string | number | boolean | null>;
};

/** The call state a provider event reports, if any. */
export function observedStateFor(event: VoiceEvent, current: CallState): CallState | null {
  switch (event.type) {
    case "CALL_QUEUED":
      return "QUEUED";
    case "CALL_DIALLING":
      return "DIALLING";
    case "CALL_RINGING":
      return "RINGING";
    case "CALL_ANSWERED":
      return event.answeredBy === "MACHINE" ? "VOICEMAIL" : "ANSWERED";
    case "CALL_STARTED":
      return "IN_CONVERSATION";
    case "TRANSFER_STARTED":
      return "TRANSFERRED";
    case "CALL_ENDED":
      return endedState(event.outcome, current);
    default:
      return null;
  }
}

function endedState(outcome: CallOutcome, current: CallState): CallState {
  switch (outcome) {
    case "NO_ANSWER":
      return "NO_ANSWER";
    case "BUSY":
      return "BUSY";
    case "VOICEMAIL":
      return current === "VOICEMAIL" ? "ENDED" : "VOICEMAIL";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      // Before anyone answered it is a cancellation; after, the call ended.
      return ["QUEUED", "DIALLING", "RINGING"].includes(current) ? "CANCELLED" : "ENDED";
    default:
      return "ENDED";
  }
}

const ENDED_STATES: readonly CallState[] = ["ENDED", "NO_ANSWER", "BUSY", "FAILED", "VOICEMAIL", "CANCELLED"];

export function reduceVoiceEvent(call: IngestCall, event: VoiceEvent, now: Date): IngestResult {
  const at = event.occurredAt ?? now.toISOString();
  const patch: IngestResult["patch"] = {};
  const followUps: FollowUp[] = [];
  const eventPayload: IngestResult["eventPayload"] = { type: event.type, from_state: call.state };

  // Facts that are not a state change still land on the call.
  if (event.type === "CALL_ENDED") {
    if (!call.ended_at) patch.ended_at = at;
    if (event.durationSec != null && call.duration_sec == null) patch.duration_sec = event.durationSec;
    if (!call.outcome) patch.outcome = event.outcome;
    if (event.disconnectionReason) patch.disconnection_reason = event.disconnectionReason.slice(0, 120);
    eventPayload.outcome = event.outcome;
    eventPayload.duration_sec = event.durationSec;
  }
  if (event.type === "CALL_ANALYZED") {
    eventPayload.successful = event.successful;
    // The provider's analysis feeds the post-call job (idempotent per call).
    followUps.push("POST_CALL");
  }

  const observed = observedStateFor(event, call.state);
  if (!observed) {
    return { observed: null, applied: false, reason: "NO_STATE", state: call.state, patch, followUps, eventPayload };
  }
  eventPayload.observed_state = observed;

  if (isTerminal(call.state)) {
    return { observed, applied: false, reason: "TERMINAL", state: call.state, patch, followUps, eventPayload };
  }

  let result;
  try {
    result = applyObservedState(call.state, observed);
  } catch (error) {
    if (error instanceof IllegalCallTransition) {
      return { observed, applied: false, reason: "ILLEGAL", state: call.state, patch, followUps, eventPayload };
    }
    throw error;
  }
  if (!result.applied) {
    return { observed, applied: false, reason: result.reason === "TERMINAL" ? "TERMINAL" : "STALE", state: call.state, patch, followUps, eventPayload };
  }

  patch.state = result.state;
  if (result.path.includes("ANSWERED") && !call.answered_at) patch.answered_at = at;
  if (ENDED_STATES.includes(result.state)) {
    if (!call.ended_at && !patch.ended_at) patch.ended_at = at;
    if (!followUps.includes("POST_CALL")) followUps.push("POST_CALL");
    if (result.state === "ENDED" || result.state === "VOICEMAIL") followUps.push("RECORDING_FETCH");
  }
  eventPayload.to_state = result.state;
  return { observed, applied: true, reason: "APPLIED", state: result.state, patch, followUps, eventPayload };
}

/** The call a provider event belongs to: our call id or key carried in metadata. */
export function callRefOf(event: VoiceEvent): { providerCallId: string | null; callId: string | null; callKey: string | null } {
  if (!("providerCallId" in event)) return { providerCallId: null, callId: null, callKey: null };
  const meta = ("metadata" in event ? event.metadata : undefined) ?? {};
  return {
    providerCallId: event.providerCallId,
    callId: meta.voice_call_id ?? null,
    callKey: meta.call_key ?? null,
  };
}
