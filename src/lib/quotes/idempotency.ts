/**
 * Idempotency keys for commercial actions (docs/revenue-engine/12 §73).
 * Each key is stored in a UNIQUE column, so a retried job, a double click,
 * a replayed webhook or two agents acting at once produce ONE row:
 *
 *   quotes.request_key            one quote per originating request
 *   quote_events.action_key       one accept / sign / pay per revision
 *   invoices.idempotency_key      one invoice per revision + schedule row
 *   payment_links.idempotency_key one payment link per invoice + amount
 *
 * Keys are `<kind>:v1:<sha256 of the canonical parts>` so they are bounded
 * (≤ 96 chars), carry no personal data, and the same parts in any key order
 * give the same key.
 */

import { hashCanonical } from "./canonical.ts";

export const IDEMPOTENCY_VERSION = "v1";

function key(kind: string, parts: Record<string, string | number | null>): string {
  for (const [name, value] of Object.entries(parts)) {
    if (value === undefined) throw new Error(`idempotency: ${name} is required`);
    if (typeof value === "string" && value.trim() === "") throw new Error(`idempotency: ${name} is empty`);
  }
  return `${kind}:${IDEMPOTENCY_VERSION}:${hashCanonical({ kind, ...parts })}`;
}

/**
 * A quote from the same request: the inbound message / tool call / API
 * request that asked for it, for this opportunity. A second tool call for
 * the same request returns the existing quote instead of a new one.
 */
export function quoteRequestKey(input: {
  businessId: string;
  opportunityId: string | null;
  leadId: string | null;
  /** The message id, agent tool-call id or API Idempotency-Key header. */
  requestId: string;
}): string {
  return key("quote-request", {
    businessId: input.businessId,
    opportunityId: input.opportunityId,
    leadId: input.leadId,
    requestId: input.requestId,
  });
}

export const QUOTE_ACTION_KINDS = ["SEND", "ACCEPT", "SIGN", "DECLINE", "APPROVE", "RECORD_DEPOSIT_PAID", "RECORD_PAID", "MARK_WON"] as const;
export type QuoteActionKind = (typeof QUOTE_ACTION_KINDS)[number];

/** Accept / sign / pay are idempotent on (quote_revision_id, action). */
export function quoteActionKey(input: { revisionId: string; action: QuoteActionKind }): string {
  return key("quote-action", { revisionId: input.revisionId, action: input.action });
}

/** One invoice per revision and schedule row (deposit, balance, instalment n), or per recurring period. */
export function invoiceKey(input: {
  businessId: string;
  quoteRevisionId: string;
  kind: "DEPOSIT" | "BALANCE" | "INSTALMENT" | "FULL" | "RECURRING";
  /** Schedule seq, or the recurring period start (ISO date). */
  slot: string | number;
}): string {
  return key("invoice", {
    businessId: input.businessId,
    quoteRevisionId: input.quoteRevisionId,
    kind: input.kind,
    slot: input.slot,
  });
}

/**
 * One payment link for the same action: the same invoice, amount and
 * purpose always maps to the same key (and so the same Checkout Session
 * idempotency key on the customer's Stripe).
 */
export function paymentLinkKey(input: {
  businessId: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  purpose: "INVOICE_FULL" | "INVOICE_BALANCE" | "INSTALMENT";
}): string {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("idempotency: amountMinor must be a positive integer");
  }
  return key("payment-link", {
    businessId: input.businessId,
    invoiceId: input.invoiceId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    purpose: input.purpose,
  });
}

/** One credit note per invoice and request. */
export function creditNoteKey(input: { businessId: string; invoiceId: string; requestId: string }): string {
  return key("credit-note", { businessId: input.businessId, invoiceId: input.invoiceId, requestId: input.requestId });
}
