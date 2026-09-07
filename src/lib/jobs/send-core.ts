/**
 * The single guarded outbound path, shared by `message.send` and
 * `campaign.send`.
 *
 * Pure by design: it holds no Supabase import and no `server-only` marker, so
 * the guard, the idempotency rule and the retry classification are directly
 * unit-testable and there is exactly one copy of them.
 */

import {
  evaluateStopConditions,
  isWithinQuietHours,
  nextPermittedSendTime,
  type ChannelState,
  type LeadState,
  type QuietHours,
  type StopReason,
} from "../automation/scheduler.ts";
import type {
  Channel,
  MessagingProvider,
  SendResult,
} from "../messaging/types.ts";
import type { PolicyReasonCode } from "../policy/types.ts";

// "agent" behaves like "system" in the guard: a lead having replied does
// not block the reply owed back to them, while opt-out, suppression and a
// human takeover still bind absolutely.
export type SendOrigin =
  | "automation"
  | "manual"
  | "campaign"
  | "system"
  | "agent";

export type SendGuardSnapshot = {
  lead: LeadState;
  channel: ChannelState;
  quietHours: QuietHours;
  origin: SendOrigin;
};

export type SendDecision =
  | { action: "send" }
  | { action: "abort"; reason: StopReason }
  | { action: "reschedule"; at: Date };

/**
 * The contactability verdict, taken immediately before dispatch.
 *
 * The guard above answers "has this conversation stopped?"; this answers "may
 * this workspace lawfully contact this person, on this channel, right now?" —
 * jurisdiction pack, subscriber type, recorded relationship and consent. They
 * are separate questions with separate failure modes, so they stay separate
 * decisions rather than one merged verdict nobody can reason about.
 *
 * `defer` is the quiet-hours case and reschedules; `block` is terminal.
 */
export type PolicyGate =
  | { action: "allow" }
  | { action: "block"; reasonCode: PolicyReasonCode; message: string }
  | { action: "defer"; at: Date; reasonCode: PolicyReasonCode };

/**
 * A reply stops an automation sequence, but it must not stop the reply we owe
 * the lead in return; and a human who has taken the conversation over is
 * allowed to send by hand. Opt-out and suppression bind every origin.
 */
function guardedLead(snapshot: SendGuardSnapshot): LeadState {
  const { lead, origin } = snapshot;

  if (origin === "manual") {
    return {
      ...lead,
      status: "CONTACTED",
      hasReplied: false,
      humanTakeover: false,
      automationActive: true,
    };
  }

  if (origin === "automation") return lead;

  return { ...lead, hasReplied: false };
}

export function evaluateSend(
  snapshot: SendGuardSnapshot,
  at: Date = new Date(),
): SendDecision {
  const stop = evaluateStopConditions(guardedLead(snapshot), snapshot.channel);
  if (stop) return { action: "abort", reason: stop };

  if (isWithinQuietHours(at, snapshot.quietHours)) {
    return {
      action: "reschedule",
      at: nextPermittedSendTime(at, snapshot.quietHours),
    };
  }

  return { action: "send" };
}

export type OutboundMessageRecord = {
  id: string;
  businessId: string;
  leadId: string;
  channel: Channel;
  body: string;
  status: string;
  sendKey: string;
  to: string;
  origin: SendOrigin;
  /** Email only; null on every other channel. */
  subject?: string | null;
  unsubscribeUrl?: string | null;
};

export type SendFailure = Extract<SendResult, { ok: false }>;

export interface SendStore {
  load(messageId: string): Promise<OutboundMessageRecord | null>;
  snapshot(message: OutboundMessageRecord): Promise<SendGuardSnapshot | null>;
  /**
   * The contactability decision for this exact message, taken now. Implementors
   * must record it, so "why was this person contacted" has an answer later.
   *
   * A throw is a refusal, not a retry: the caller cannot distinguish "policy
   * says no" from "policy is unreachable", and sending on an unknown verdict is
   * the one outcome worse than not sending.
   */
  policy(
    message: OutboundMessageRecord,
    snapshot: SendGuardSnapshot,
    at: Date,
  ): Promise<PolicyGate>;
  /** Closes a message out as refused by policy, with the reason on the record. */
  blockedByPolicy(
    message: OutboundMessageRecord,
    gate: Extract<PolicyGate, { action: "block" }>,
  ): Promise<void>;
  markSent(
    message: OutboundMessageRecord,
    result: Extract<SendResult, { ok: true }>,
  ): Promise<void>;
  markFailed(
    message: OutboundMessageRecord,
    result: SendFailure,
    terminal: boolean,
  ): Promise<void>;
  abort(message: OutboundMessageRecord, reason: StopReason): Promise<void>;
  reschedule(message: OutboundMessageRecord, at: Date): Promise<void>;
  meter(message: OutboundMessageRecord): Promise<void>;
}

export type SendOutcome =
  | { outcome: "sent"; providerMessageId: string }
  | {
      outcome: "failed";
      permanent: boolean;
      errorCode: string;
      errorMessage: string;
    }
  | { outcome: "aborted"; reason: StopReason }
  | { outcome: "blocked"; reasonCode: PolicyReasonCode; message: string }
  | { outcome: "rescheduled"; at: Date }
  | { outcome: "already_processed"; status: string }
  | { outcome: "missing" };

/**
 * Idempotency rule: only a message row still in QUEUED is ever dispatched. A
 * retry after a partial failure finds SENT and stops, so the same `send_key`
 * can never reach the carrier twice.
 */
export async function performSend(input: {
  store: SendStore;
  provider: MessagingProvider;
  messageId: string;
  now?: Date;
  /** True on the job's last permitted attempt, so a retryable failure settles. */
  finalAttempt?: boolean;
}): Promise<SendOutcome> {
  const { store, provider, messageId } = input;
  const now = input.now ?? new Date();

  const message = await store.load(messageId);
  if (!message) return { outcome: "missing" };
  if (message.status !== "QUEUED") {
    return { outcome: "already_processed", status: message.status };
  }

  const snapshot = await store.snapshot(message);
  if (!snapshot) return { outcome: "missing" };

  const decision = evaluateSend(snapshot, now);

  if (decision.action === "abort") {
    await store.abort(message, decision.reason);
    return { outcome: "aborted", reason: decision.reason };
  }

  if (decision.action === "reschedule") {
    await store.reschedule(message, decision.at);
    return { outcome: "rescheduled", at: decision.at };
  }

  /*
   * The contactability gate, last thing before the carrier.
   *
   * It runs after the stop-condition guard rather than before it because the
   * guard answers from state already in hand, while this reads permissions,
   * suppression and the jurisdiction pack — so a conversation that has already
   * stopped never pays for the lookup. It runs *here*, and not when the message
   * was queued, because permission is a fact about this moment: a lead can
   * withdraw consent, or a pack can change, between scheduling and sending.
   */
  const gate = await store.policy(message, snapshot, now);

  if (gate.action === "block") {
    await store.blockedByPolicy(message, gate);
    return { outcome: "blocked", reasonCode: gate.reasonCode, message: gate.message };
  }

  if (gate.action === "defer") {
    await store.reschedule(message, gate.at);
    return { outcome: "rescheduled", at: gate.at };
  }

  const result = await provider.send({
    businessId: message.businessId,
    to: message.to,
    body: message.body,
    sendKey: message.sendKey,
    channel: message.channel,
    subject: message.subject ?? null,
    unsubscribeUrl: message.unsubscribeUrl ?? null,
  });

  if (result.ok) {
    await store.markSent(message, result);
    await store.meter(message);
    return { outcome: "sent", providerMessageId: result.providerMessageId };
  }

  await store.markFailed(
    message,
    result,
    result.permanent || Boolean(input.finalAttempt),
  );
  return {
    outcome: "failed",
    permanent: result.permanent,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

/** Transient failures go back on the queue; everything else is terminal. */
export function shouldRetrySend(outcome: SendOutcome): boolean {
  return outcome.outcome === "failed" && !outcome.permanent;
}

export function isPermanentOutcome(outcome: SendOutcome): boolean {
  if (outcome.outcome === "missing") return true;
  // A policy refusal is settled, not transient. Retrying it would re-ask a
  // question already answered and re-record the same denial.
  if (outcome.outcome === "blocked") return true;
  if (outcome.outcome === "failed") return outcome.permanent;
  return false;
}
