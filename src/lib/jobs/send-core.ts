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
  if (outcome.outcome === "failed") return outcome.permanent;
  return false;
}
