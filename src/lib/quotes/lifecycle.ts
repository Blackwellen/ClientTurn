/**
 * The quote state machine (one state per quote REVISION; the quote row
 * mirrors its current revision). Pure: the migration's security-definer
 * RPC applies the same table with the row locked (`FOR UPDATE`) and an
 * `expected_status` check (docs/revenue-engine/12 §73), and the tests
 * assert every legal and illegal transition here.
 *
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT -> VIEWED -> ACCEPTED
 *         -> SIGNED -> DEPOSIT_PAID -> PAID -> WON
 *   side exits: DECLINED, EXPIRED, REVISED (superseded by a new revision),
 *   WITHDRAWN.
 *
 * Guards:
 *   - Content (lines, prices, terms) is editable only in DRAFT. After SENT
 *     the only way to change anything is REVISE, which supersedes this
 *     revision (-> REVISED) and starts a new DRAFT revision; the public
 *     tokens of the old one are revoked (tokens.ts).
 *   - Nothing about the priced content changes after SIGNED: only payment
 *     and WON may follow, and REVISE / WITHDRAW / DECLINE are refused.
 *   - A quote past `validUntil` can no longer be accepted or signed; the
 *     expiry job moves it to EXPIRED.
 *   - SEND needs APPROVED when approval is required; otherwise DRAFT may be
 *     sent directly.
 */

export const QUOTE_STATES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "SIGNED",
  "DEPOSIT_PAID",
  "PAID",
  "WON",
  "DECLINED",
  "EXPIRED",
  "REVISED",
  "WITHDRAWN",
] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];

export const TERMINAL_STATES: readonly QuoteState[] = ["WON", "DECLINED", "EXPIRED", "REVISED", "WITHDRAWN"];

export const QUOTE_ACTIONS = [
  "SUBMIT_FOR_APPROVAL",
  "APPROVE",
  "REJECT_APPROVAL",
  "SEND",
  "MARK_VIEWED",
  "ACCEPT",
  "SIGN",
  "DECLINE",
  "EXPIRE",
  "REVISE",
  "WITHDRAW",
  "RECORD_DEPOSIT_PAID",
  "RECORD_PAID",
  "MARK_WON",
] as const;
export type QuoteAction = (typeof QUOTE_ACTIONS)[number];

/**
 * Automation / webhook event types. The first ten are the §45 set the
 * automation catalog must add (automation/event-types.ts + its CHECK); the
 * rest are emitted for the quote timeline and analytics.
 */
export const QUOTE_EVENT_TYPES = [
  "quote.requested",
  "quote.created",
  "quote.approval_requested",
  "quote.approved",
  "quote.sent",
  "quote.viewed",
  "quote.accepted",
  "quote.declined",
  "quote.expired",
  "quote.signed",
  "quote.approval_rejected",
  "quote.revised",
  "quote.withdrawn",
  "quote.deposit_paid",
  "quote.paid",
  "quote.won",
] as const;
export type QuoteEventType = (typeof QUOTE_EVENT_TYPES)[number];

/** The action table: from-state -> action -> to-state. Anything absent is illegal. */
export const TRANSITIONS: Readonly<Record<QuoteState, Partial<Record<QuoteAction, QuoteState>>>> = {
  DRAFT: { SUBMIT_FOR_APPROVAL: "PENDING_APPROVAL", SEND: "SENT", REVISE: "REVISED", WITHDRAW: "WITHDRAWN" },
  PENDING_APPROVAL: { APPROVE: "APPROVED", REJECT_APPROVAL: "DRAFT", EXPIRE: "EXPIRED", REVISE: "REVISED", WITHDRAW: "WITHDRAWN" },
  APPROVED: { SEND: "SENT", EXPIRE: "EXPIRED", REVISE: "REVISED", WITHDRAW: "WITHDRAWN" },
  SENT: { MARK_VIEWED: "VIEWED", ACCEPT: "ACCEPTED", DECLINE: "DECLINED", EXPIRE: "EXPIRED", REVISE: "REVISED", WITHDRAW: "WITHDRAWN" },
  VIEWED: { MARK_VIEWED: "VIEWED", ACCEPT: "ACCEPTED", DECLINE: "DECLINED", EXPIRE: "EXPIRED", REVISE: "REVISED", WITHDRAW: "WITHDRAWN" },
  ACCEPTED: { SIGN: "SIGNED", DECLINE: "DECLINED" },
  SIGNED: { RECORD_DEPOSIT_PAID: "DEPOSIT_PAID", RECORD_PAID: "PAID", MARK_WON: "WON" },
  DEPOSIT_PAID: { RECORD_PAID: "PAID", MARK_WON: "WON" },
  PAID: { MARK_WON: "WON" },
  WON: {},
  DECLINED: {},
  EXPIRED: {},
  REVISED: {},
  WITHDRAWN: {},
};

const EVENT_FOR: Partial<Record<QuoteAction, QuoteEventType>> = {
  SUBMIT_FOR_APPROVAL: "quote.approval_requested",
  APPROVE: "quote.approved",
  REJECT_APPROVAL: "quote.approval_rejected",
  SEND: "quote.sent",
  MARK_VIEWED: "quote.viewed",
  ACCEPT: "quote.accepted",
  SIGN: "quote.signed",
  DECLINE: "quote.declined",
  EXPIRE: "quote.expired",
  REVISE: "quote.revised",
  WITHDRAW: "quote.withdrawn",
  RECORD_DEPOSIT_PAID: "quote.deposit_paid",
  RECORD_PAID: "quote.paid",
  MARK_WON: "quote.won",
};

export type QuoteSnapshot = {
  state: QuoteState;
  /** ISO timestamp; null = no expiry. */
  validUntil: string | null;
  /** Set when a discount / value / margin rule requires approval (discount-policy.ts). */
  approvalRequired: boolean;
  /** Set once the revision has been viewed (MARK_VIEWED is idempotent after that). */
  viewedAt?: string | null;
};

export type TransitionContext = {
  now: string;
  /** Who acts: the approver on APPROVE must not be the AI. */
  actorKind: "AI" | "HUMAN" | "CUSTOMER" | "SYSTEM";
};

export type TransitionResult =
  | { ok: true; from: QuoteState; to: QuoteState; events: QuoteEventType[]; changed: boolean }
  | { ok: false; from: QuoteState; reason: TransitionRefusal; detail: string };

export type TransitionRefusal =
  | "ILLEGAL_TRANSITION"
  | "APPROVAL_REQUIRED"
  | "EXPIRED"
  | "NOT_EXPIRED"
  | "LOCKED_AFTER_SIGNING"
  | "ACTOR_NOT_PERMITTED";

export function isExpired(validUntil: string | null, now: string): boolean {
  return validUntil !== null && Date.parse(now) > Date.parse(validUntil);
}

const CUSTOMER_ACTIONS: readonly QuoteAction[] = ["MARK_VIEWED", "ACCEPT", "SIGN", "DECLINE"];
const HUMAN_ONLY_ACTIONS: readonly QuoteAction[] = ["APPROVE", "REJECT_APPROVAL"];
const EXPIRY_BLOCKED: readonly QuoteAction[] = ["ACCEPT", "SIGN", "SEND", "APPROVE"];
const POST_SIGNATURE: readonly QuoteState[] = ["SIGNED", "DEPOSIT_PAID", "PAID", "WON"];

export function transition(snapshot: QuoteSnapshot, action: QuoteAction, context: TransitionContext): TransitionResult {
  const from = snapshot.state;

  if (HUMAN_ONLY_ACTIONS.includes(action) && context.actorKind !== "HUMAN") {
    return { ok: false, from, reason: "ACTOR_NOT_PERMITTED", detail: "Only a person may approve or reject a quote." };
  }
  if (CUSTOMER_ACTIONS.includes(action) && action !== "MARK_VIEWED" && context.actorKind !== "CUSTOMER") {
    return { ok: false, from, reason: "ACTOR_NOT_PERMITTED", detail: "Only the customer accepts, signs or declines a quote." };
  }
  if (POST_SIGNATURE.includes(from) && (action === "REVISE" || action === "WITHDRAW" || action === "DECLINE" || action === "EXPIRE")) {
    return { ok: false, from, reason: "LOCKED_AFTER_SIGNING", detail: "A signed quote cannot be changed, withdrawn or expired." };
  }

  const to = TRANSITIONS[from][action];
  if (!to) {
    return { ok: false, from, reason: "ILLEGAL_TRANSITION", detail: `${action} is not allowed from ${from}.` };
  }
  if (action === "SEND" && from === "DRAFT" && snapshot.approvalRequired) {
    return { ok: false, from, reason: "APPROVAL_REQUIRED", detail: "This quote needs approval before it is sent." };
  }
  // SUBMIT_FOR_APPROVAL is allowed even when approval is not required: a
  // person may ask for a second pair of eyes.
  if (EXPIRY_BLOCKED.includes(action) && isExpired(snapshot.validUntil, context.now)) {
    return { ok: false, from, reason: "EXPIRED", detail: "The quote has passed its valid-until date." };
  }
  if (action === "EXPIRE" && !isExpired(snapshot.validUntil, context.now)) {
    return { ok: false, from, reason: "NOT_EXPIRED", detail: "The quote is still within its validity." };
  }

  // Re-viewing is idempotent: no state change, no second event.
  if (action === "MARK_VIEWED" && from === "VIEWED") {
    return { ok: true, from, to, events: [], changed: false };
  }
  const event = EVENT_FOR[action];
  return { ok: true, from, to, events: event ? [event] : [], changed: true };
}

/** Events for a new quote. A quote asked for by the lead also emits quote.requested. */
export function creationEvents(origin: "LEAD_REQUEST" | "AGENT" | "USER" | "API"): QuoteEventType[] {
  return origin === "LEAD_REQUEST" ? ["quote.requested", "quote.created"] : ["quote.created"];
}

/** Content (lines, prices, discount, terms) may be edited only in DRAFT. */
export function canEditContent(state: QuoteState): boolean {
  return state === "DRAFT";
}

/** Has the revision been frozen (sent to the customer at least once)? */
export function isFrozen(state: QuoteState): boolean {
  return !["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(state);
}

export function isSigned(state: QuoteState): boolean {
  return POST_SIGNATURE.includes(state);
}

export function isTerminal(state: QuoteState): boolean {
  return TERMINAL_STATES.includes(state);
}

export type EditCheck = { ok: true } | { ok: false; reason: "LOCKED_AFTER_SIGNING" | "NEEDS_NEW_REVISION" | "NOT_EDITABLE"; detail: string };

/** The guard every content write calls first (mirrored by the DB trigger). */
export function assertEditable(state: QuoteState): EditCheck {
  if (canEditContent(state)) return { ok: true };
  if (isSigned(state)) return { ok: false, reason: "LOCKED_AFTER_SIGNING", detail: "Nothing changes after a quote is signed." };
  if (state === "SENT" || state === "VIEWED") {
    return { ok: false, reason: "NEEDS_NEW_REVISION", detail: "A sent quote is changed only by issuing a new revision." };
  }
  if (state === "PENDING_APPROVAL" || state === "APPROVED") {
    return { ok: false, reason: "NOT_EDITABLE", detail: "Return the quote to draft (reject the approval) or revise it first." };
  }
  return { ok: false, reason: "NOT_EDITABLE", detail: `A ${state.toLowerCase()} quote cannot be edited.` };
}

/** The effective state at `now`: a live quote past its validity reads as EXPIRED. */
export function effectiveState(snapshot: QuoteSnapshot, now: string): QuoteState {
  if (TRANSITIONS[snapshot.state].EXPIRE && isExpired(snapshot.validUntil, now)) return "EXPIRED";
  return snapshot.state;
}

/** Valid-until from an issue time and the workspace's validity days (end of that UTC day). */
export function validUntilFrom(issuedAt: string, validityDays: number): string {
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
    throw new Error("validityDays must be an integer from 1 to 365.");
  }
  const date = new Date(Date.parse(issuedAt));
  date.setUTCDate(date.getUTCDate() + validityDays);
  date.setUTCHours(23, 59, 59, 999);
  return date.toISOString();
}
