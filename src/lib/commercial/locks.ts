/**
 * No duplicate commercial actions (brief §73). Pure.
 *
 * Two mechanisms, both deterministic:
 *
 *   1. **Idempotency keys** on every commercial row, each in a UNIQUE column,
 *      so a retried job, a double click, a replayed webhook or two actors at
 *      once produce ONE row:
 *        one quote per request          quotes.request_key          quoteRequestKey
 *        one invoice per schedule row   invoices.idempotency_key    invoiceKey
 *        one payment link per action    payment_links.idempotency_key paymentLinkKey
 *        one booking per slot and lead  commercial_action_claims    bookingActionKey
 *        one quote send per revision    quote_events.action_key     quoteActionKey
 *        one voice call per attempt     voice_calls                 voiceCallKey
 *      (the first four live in quotes/idempotency.ts and voice/eligibility.ts;
 *      this module adds the conversation-scoped ones the agent uses).
 *
 *   2. **One actor at a time on a lead.** A commercial action takes the lead's
 *      advisory lock and a short lease naming who holds it (the AI, a person,
 *      a voice agent). While one kind of actor holds the lease, another kind's
 *      commercial action on the same lead is refused: the AI never drafts a
 *      quote while a person is sending one, and two voice agents never work
 *      the same lead. The lock key IS the voice runtime's `voiceLeadLockKey`,
 *      so a dial and a commercial action serialise on the same Postgres
 *      advisory lock (migration 0158 `claim_commercial_action`; the voice dial
 *      in 0157 takes the same lock id).
 *
 * `leaseDecision` is the rule the SQL applies, mirrored here so it is tested
 * without a database.
 */

import { advisoryLockId, voiceLeadLockKey } from "../voice/eligibility.ts";
import { hashCanonical } from "../quotes/canonical.ts";

/** The lead's commercial lock: the same key (and so the same advisory lock id) as a voice dial. */
export function leadCommercialLockKey(businessId: string, leadId: string): string {
  return voiceLeadLockKey(businessId, leadId);
}

export function leadCommercialLockId(businessId: string, leadId: string): number {
  return advisoryLockId(leadCommercialLockKey(businessId, leadId));
}

export const LEASE_HOLDERS = ["AI", "HUMAN", "VOICE"] as const;
export type LeaseHolder = (typeof LEASE_HOLDERS)[number];

/** How long a claim holds the lead. Short: long enough to finish the action, not to block a person for long. */
export const LEASE_SECONDS: Record<LeaseHolder, number> = { AI: 120, HUMAN: 600, VOICE: 1_800 };

export const COMMERCIAL_ACTION_KINDS = [
  "QUOTE_CREATE",
  "QUOTE_SEND",
  "QUOTE_APPROVAL_REQUEST",
  "QUOTE_DISCOUNT",
  "INVOICE_CREATE",
  "PAYMENT_LINK",
  "BOOKING",
  "VOICE_CALL",
] as const;
export type CommercialActionKind = (typeof COMMERCIAL_ACTION_KINDS)[number];

export type Lease = { holder: LeaseHolder; holderRef: string | null; expiresAt: string };

export type LeaseRequest = { holder: LeaseHolder; holderRef: string | null; now: Date };

export type LeaseDecision =
  | { ok: true; renew: boolean }
  | { ok: false; reason: "HELD"; heldBy: LeaseHolder; until: string };

/**
 * May this actor act on the lead now?
 *   - no lease, or an expired one: yes (a new lease is taken);
 *   - the same kind of actor: yes (renewed). Two AI turns on one conversation
 *     are already serialised by `claim_agent_turn`, and two people may work
 *     one lead;
 *   - a voice agent holding it: only the same call (holder_ref) may act;
 *   - otherwise: refused until the lease expires.
 */
export function leaseDecision(existing: Lease | null, request: LeaseRequest): LeaseDecision {
  if (!existing) return { ok: true, renew: false };
  if (Date.parse(existing.expiresAt) <= request.now.getTime()) return { ok: true, renew: false };
  if (existing.holder !== request.holder) return { ok: false, reason: "HELD", heldBy: existing.holder, until: existing.expiresAt };
  if (existing.holder === "VOICE" && existing.holderRef !== request.holderRef) {
    return { ok: false, reason: "HELD", heldBy: existing.holder, until: existing.expiresAt };
  }
  return { ok: true, renew: true };
}

function key(kind: string, parts: Record<string, string | number>): string {
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value === "string" && value.trim() === "") throw new Error(`commercial key: ${name} is empty`);
  }
  return `${kind}:v1:${hashCanonical({ kind, ...parts })}`;
}

/**
 * The request id an agent quote carries into `quote.create`: the
 * conversation plus the inbound message that asked. A retried turn, or the
 * same request re-planned on a later turn, maps to the same quote.
 */
export function agentQuoteRequestId(conversationId: string | null, requestMessageId: string): string {
  return `agent:${conversationId ?? "none"}:${requestMessageId}`;
}

/** One agent action of a kind per quote revision (send, approval request, discount). */
export function agentQuoteActionKey(kind: Extract<CommercialActionKind, "QUOTE_SEND" | "QUOTE_APPROVAL_REQUEST" | "QUOTE_DISCOUNT">, quoteId: string, revisionOrRequest: string): string {
  return key("agent-quote-action", { kind, quoteId, ref: revisionOrRequest });
}

/** One booking per lead and slot start, whoever makes it. */
export function bookingActionKey(businessId: string, leadId: string, startsAtIso: string): string {
  const start = new Date(startsAtIso);
  if (!Number.isFinite(start.getTime())) throw new Error("commercial key: startsAt is not a date");
  return key("booking", { businessId, leadId, startsAt: start.toISOString() });
}
