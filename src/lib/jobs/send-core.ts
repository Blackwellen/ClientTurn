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
import { normaliseForSms } from "../messaging/sms-segments.ts";
import type { OutboundTemplate } from "../messaging/whatsapp-templates.ts";
import type { EmailMessageClass } from "../email/sender-health.ts";
import type { ReengagementTrigger } from "../reengagement/triggers.ts";

// "agent" behaves like "system" in the guard: a lead having replied does
// not block the reply owed back to them, while opt-out, suppression and a
// human takeover still bind absolutely.
//
// "agent_handover" is the one agent message that is *about* the takeover: the
// short acknowledgement ("someone from the team will pick this up") sent in
// the same turn that hands the conversation to a person. The takeover is set
// first, so if this origin were bound by it the lead would never be told. It
// is exempt from the takeover and the paused flag only; opt-out, suppression,
// a closed lead status, channel health and quiet hours all still bind.
export type SendOrigin =
  | "automation"
  | "manual"
  | "campaign"
  | "system"
  | "agent"
  | "agent_handover";

export type SendGuardSnapshot = {
  lead: LeadState;
  channel: ChannelState;
  quietHours: QuietHours;
  origin: SendOrigin;
  /**
   * Platform maintenance (docs/MAINTENANCE.md): while the app or the site is
   * offline, outbound sends wait until this time unless the operator kept
   * automated follow-up running. A hold, never a stop: the message is
   * rescheduled exactly like quiet hours, and every other check still runs
   * again when it comes due.
   */
  maintenancePauseUntil?: Date | null;
  /**
   * A `booking_reminder` automation step (Phase 3.1): exempt from the BOOKED
   * and replied stop conditions only. Honoured for `automation` origin alone.
   */
  bookingReminder?: boolean;
  /**
   * An intent-driven re-engagement message (reengagement/triggers.ts), marked
   * by its `reengage:` send key. Honoured for `automation` origin alone. Each
   * trigger is exempt only from the stop condition its own existence answers:
   *
   *   NOT_NOW_RESUME / DEADLINE_PASSED  the lead replied ("try me in March")
   *                                     -- that reply is why it is sent;
   *   NO_SHOW_REBOOK / NO_SHOW_NUDGE    replied, and BOOKED (the booking they
   *                                     missed); a NEW booking cancels the
   *                                     trigger before it queues anything;
   *   WIN_BACK                          replied, LOST and paused (closing a
   *                                     deal switches follow-up off; the
   *                                     win-back is its own opted-in loop).
   *
   * Opt-out, suppression, human takeover, WON, subscription and channel health
   * bind every trigger, and quiet hours, the policy gate and the frequency
   * guard all still run.
   */
  reengagement?: ReengagementTrigger | null;
  /**
   * The thank-you after a confirmed payment (payments/send-keys.ts), marked by
   * its `payment-thanks:` send key. Honoured for `system` origin alone, and
   * exempt only from WON (the payment made the lead WON), BOOKED, a reply and
   * the paused flag (closing the deal switched follow-up off). Opt-out,
   * suppression, human takeover, channel health and quiet hours all bind.
   */
  paymentConfirmation?: boolean;
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
  /**
   * `template`: WhatsApp outside the 24-hour window, sent as this approved
   * template instead of the free-text body. Never free text outside the window.
   */
  | { action: "allow"; template?: OutboundTemplate }
  | { action: "block"; reasonCode: PolicyReasonCode; message: string }
  | { action: "defer"; at: Date; reasonCode: PolicyReasonCode };

/**
 * The opted-out input to the guard (design 03 §5).
 *
 * Opt-out is per channel now: a carrier STOP suppresses SMS (or WhatsApp) and
 * nothing else, and `leads.opted_out` is derived from the list -- true only for
 * an all-channel opt-out (0123). So for a lead with an email or phone the
 * binding check is the channel's own suppression lookup (`channelState`,
 * which also sees ALL-channel rows), and the lead-wide flag is not consulted:
 * consulting it is what kept START from re-permitting SMS.
 *
 * The flag still binds wherever the channel lookup cannot see the opt-out: a
 * social DM goes to a platform address that an email or phone opt-out row
 * does not name, and a lead with no address on this channel has nothing for
 * the lookup to match. There an all-channel opt-out must still stop the send.
 */
export function guardOptedOut(
  lead: {
    opted_out: boolean;
    email?: string | null;
    phone?: string | null;
    phone_normalized?: string | null;
  },
  channel: Channel,
): boolean {
  const covered =
    channel === "email"
      ? Boolean(lead.email?.trim())
      : channel === "sms" || channel === "whatsapp"
        ? Boolean(lead.phone_normalized?.trim() || lead.phone?.trim())
        : false;
  return covered ? false : lead.opted_out;
}

/**
 * A reply stops an automation sequence, but it must not stop the reply we owe
 * the lead in return; and a human who has taken the conversation over is
 * allowed to send by hand. Opt-out and suppression bind every origin.
 */
function guardedLead(snapshot: SendGuardSnapshot): LeadState {
  const { lead, origin } = snapshot;

  if (origin === "system" && snapshot.paymentConfirmation === true) {
    return {
      ...lead,
      status: lead.status === "WON" || lead.status === "BOOKED" ? "CONTACTED" : lead.status,
      hasReplied: false,
      automationActive: true,
    };
  }

  if (origin === "manual") {
    return {
      ...lead,
      status: "CONTACTED",
      hasReplied: false,
      humanTakeover: false,
      automationActive: true,
    };
  }

  if (origin === "automation") {
    switch (snapshot.reengagement ?? null) {
      case "NOT_NOW_RESUME":
      case "DEADLINE_PASSED":
        return { ...lead, hasReplied: false };
      case "NO_SHOW_REBOOK":
      case "NO_SHOW_NUDGE":
        return {
          ...lead,
          hasReplied: false,
          status: lead.status === "BOOKED" ? "CONTACTED" : lead.status,
        };
      case "WIN_BACK":
        return {
          ...lead,
          hasReplied: false,
          automationActive: true,
          status: lead.status === "LOST" ? "CONTACTED" : lead.status,
        };
      default:
        return lead;
    }
  }

  // A reactivation campaign is its own explicit decision to message, made by
  // the person who launched it. `automation_active` governs the *follow-up
  // sequence*, and imported leads are created with it off precisely so an
  // import alone never starts messaging -- so it must not silently abort every
  // campaign send to an imported list as "paused". Opt-out, suppression,
  // takeover, won/lost and channel health all still bind.
  if (origin === "campaign") {
    return { ...lead, hasReplied: false, automationActive: true };
  }

  if (origin === "agent_handover") {
    return {
      ...lead,
      hasReplied: false,
      humanTakeover: false,
      automationActive: true,
    };
  }

  // The conversation agent's reply to a message the lead sent (story I3).
  // `automation_active` governs *outbound follow-up*; a lead created via the
  // API or an import starts with it off, and answering them when they write in
  // is not follow-up. Likewise BOOKED stops a follow-up sequence, but the agent
  // still helps a booked lead with their booking (POST_BOOKING). The agent is
  // only ever enqueued by an inbound message (agent/events.ts); a non-reply
  // trigger keeps the paused meaning in the orchestrator (`isReplyTrigger`).
  // Opt-out, suppression, human takeover, won/lost, channel health and quiet
  // hours all still bind.
  if (origin === "agent") {
    return {
      ...lead,
      status: lead.status === "BOOKED" ? "CONTACTED" : lead.status,
      hasReplied: false,
      automationActive: true,
    };
  }

  return { ...lead, hasReplied: false };
}

export function evaluateSend(
  snapshot: SendGuardSnapshot,
  at: Date = new Date(),
): SendDecision {
  const stop = evaluateStopConditions(guardedLead(snapshot), snapshot.channel, {
    bookingReminder: snapshot.origin === "automation" && snapshot.bookingReminder === true,
  });
  if (stop) return { action: "abort", reason: stop };

  if (snapshot.maintenancePauseUntil && snapshot.maintenancePauseUntil.getTime() > at.getTime()) {
    return { action: "reschedule", at: snapshot.maintenancePauseUntil };
  }

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
  /** Email only: TRANSACTIONAL or MARKETING (§43). */
  messageClass?: EmailMessageClass | null;
  /** Email only: the sender identity the From address is taken from (§43). */
  senderIdentity?: {
    id: string;
    displayName: string | null;
    email: string | null;
    replyTo?: string | null;
  } | null;
  /**
   * WhatsApp only: set by the policy gate when the window has closed and an
   * approved template was chosen (§45). Never set on the way in.
   */
  template?: OutboundTemplate | null;
  /** The template the step named and its variables, as queued. */
  queuedTemplate?: { templateId: string; variables: Record<string, string> | null } | null;
};

export type SendFailure = Extract<SendResult, { ok: false }>;

/**
 * The in-flight status. A row moves QUEUED -> SENDING in one conditional
 * update immediately before the carrier is called, and only the caller whose
 * update matched may call it. A row found in SENDING later is a send whose
 * outcome we do not know, and it is never dispatched again automatically.
 */
export const SENDING_STATUS = "SENDING";

export interface SendStore {
  load(messageId: string): Promise<OutboundMessageRecord | null>;
  /**
   * Atomically claims the row for dispatch: `update ... set status='SENDING'
   * where id = ? and status = 'QUEUED'`. True only for the caller whose update
   * matched a row; false means someone else already claimed or settled it.
   * Without it two workers can both reach the carrier.
   */
  claim(message: OutboundMessageRecord): Promise<boolean>;
  /**
   * A row found in SENDING: a previous attempt claimed it and never recorded
   * an outcome, so the carrier may or may not have accepted it. Implementors
   * must not resend. They record it and route it to a person to confirm.
   */
  reconcileInFlight(message: OutboundMessageRecord): Promise<void>;
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
  /** Found in SENDING: possibly sent. Never retried; a person confirms it. */
  | { outcome: "unconfirmed" }
  | { outcome: "missing" };

/**
 * Idempotency rule: only a message row still in QUEUED is ever dispatched, and
 * only by the one caller that atomically moves it to SENDING. A retry after a
 * partial failure finds SENT and stops; a retry after a crash between the
 * carrier accepting the message and `markSent` finds SENDING and reconciles
 * rather than sending again. So the same `send_key` can never reach the
 * carrier twice from this path.
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
  if (message.status === SENDING_STATUS) {
    await store.reconcileInFlight?.(message);
    return { outcome: "unconfirmed" };
  }
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

  // The template the gate chose, if any, travels with the message from here:
  // the carrier sends it, and markSent records its category for cost (§45).
  // Only WhatsApp may carry one; anything else would be a gate bug, refused.
  //
  // An SMS goes out as plain GSM-7 punctuation. One em dash or curly quote
  // switches the whole message to UCS-2 (70 characters a segment instead of
  // 160), which made the default sequence cost 7 segments a lead instead of 5
  // (economics.md). The sequence templates, campaigns and the agent all pass
  // through here, so this is the one place it is done for every SMS.
  const gated: OutboundMessageRecord =
    gate.template && message.channel === "whatsapp" ? { ...message, template: gate.template } : message;
  const outbound: OutboundMessageRecord =
    gated.channel === "sms" ? { ...gated, body: normaliseForSms(gated.body) } : gated;

  // The claim is the last step before the carrier, after every read that can
  // still refuse, so a refused message never passes through SENDING. Losing
  // the claim means a concurrent job (a stale-lock release, a reschedule's
  // second job, a double-approved draft) got there first.
  if (store.claim) {
    const claimed = await store.claim(outbound);
    if (!claimed) {
      return { outcome: "already_processed", status: SENDING_STATUS };
    }
  }

  const result = await provider.send({
    businessId: outbound.businessId,
    to: outbound.to,
    body: outbound.body,
    sendKey: outbound.sendKey,
    channel: outbound.channel,
    subject: outbound.subject ?? null,
    unsubscribeUrl: outbound.unsubscribeUrl ?? null,
    template: outbound.template ?? null,
    senderIdentity: outbound.senderIdentity ?? null,
    messageClass: outbound.messageClass ?? null,
  });

  if (result.ok) {
    await store.markSent(outbound, result);
    await store.meter(outbound);
    return { outcome: "sent", providerMessageId: result.providerMessageId };
  }

  await store.markFailed(
    outbound,
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
  // Possibly delivered. Retrying is exactly the duplicate this state prevents.
  if (outcome.outcome === "unconfirmed") return true;
  // A policy refusal is settled, not transient. Retrying it would re-ask a
  // question already answered and re-record the same denial.
  if (outcome.outcome === "blocked") return true;
  if (outcome.outcome === "failed") return outcome.permanent;
  return false;
}

/* ------------------------------------------------------ manual send key --- */

/** FNV-1a, 32-bit. Not a security hash: a stable fingerprint for dedupe only. */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const MANUAL_SEND_BUCKET_MS = 60_000;

/**
 * The send keys a manual send may collide with, newest first.
 *
 * A person pressing Send twice must produce one message. With a client nonce
 * (one per composed draft) the key is exact. Without one, the key is the
 * content -- lead, channel, subject, body -- in a one-minute bucket, and the
 * previous bucket's key is returned too so a double-click that straddles the
 * minute boundary is still caught. The cost is that sending the identical
 * text to the same lead twice within about a minute is treated as one send,
 * which is the intended reading of that action.
 */
export function manualSendKeys(input: {
  leadId: string;
  channel: string;
  body: string;
  subject?: string | null;
  nonce?: string | null;
  at?: Date;
}): { key: string; candidates: string[] } {
  const nonce = input.nonce?.trim();
  if (nonce) {
    const key = `manual:${input.leadId}:n:${nonce}`;
    return { key, candidates: [key] };
  }

  const content = `${input.channel}\u0000${input.subject?.trim() ?? ""}\u0000${input.body.trim()}`;
  const fingerprint = `${fnv1a(content, 0x811c9dc5)}${fnv1a(content, 0x9747b28c)}`;
  const bucket = Math.floor((input.at ?? new Date()).getTime() / MANUAL_SEND_BUCKET_MS);
  const keyFor = (b: number) => `manual:${input.leadId}:${fingerprint}:${b}`;

  return { key: keyFor(bucket), candidates: [keyFor(bucket), keyFor(bucket - 1)] };
}
