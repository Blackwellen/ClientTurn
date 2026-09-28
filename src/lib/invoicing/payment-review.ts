/**
 * The invoice-payment review queue (Settings -> Quotes & invoices): which
 * payments wait for a person, what that person may do with each, and what
 * "apply to an invoice" is allowed to record.
 *
 * Pure: relative imports only, so the operations, the settings card and the
 * tests read one table of rules.
 *
 * A payment is in the queue while it is not resolved (0175
 * review_resolved_at) and either
 *   - carries a review_reason (0173): the invoice settlement or a later
 *     refund / dispute flagged it; or
 *   - is REVIEW / UNMATCHED with no invoice: no pay token, or an email-only
 *     match. It may be a payment for one of the workspace's invoices.
 *
 * Two ways out, both a person's decision:
 *   APPLY    record the payment on an open invoice. Only a payment nothing has
 *            been recorded from yet (applied_at is null), with an amount, that
 *            was not refunded or disputed. The same settlement rules as the
 *            automatic path (settlement.ts) decide what is recorded: currency
 *            must match, the invoice must be open, and anything above the
 *            amount due stays flagged OVERPAID for the person to refund or
 *            keep as credit.
 *   DISMISS  say what was done outside ClientTurn (refunded in Stripe, kept as
 *            credit, credit note issued, dispute won, recorded by hand, not
 *            ours). Nothing is recorded and no money moves: the customer's own
 *            Stripe is the merchant of record (CLAUDE.md, Resolved conflict 8).
 */

import { decideInvoiceSettlement, type SettlementInvoice, type SettlementReviewReason } from "./settlement.ts";

export const PAYMENT_REVIEW_RESOLUTIONS = [
  "APPLIED",
  "REFUNDED",
  "KEPT_AS_CREDIT",
  "CREDIT_NOTE",
  "RECORDED_BY_HAND",
  "DISPUTE_WON",
  "NOT_OURS",
] as const;
export type PaymentReviewResolution = (typeof PAYMENT_REVIEW_RESOLUTIONS)[number];

/** The resolutions a person can choose when dismissing (APPLIED is the apply path's own). */
export type DismissResolution = Exclude<PaymentReviewResolution, "APPLIED">;
export const DISMISS_RESOLUTIONS = PAYMENT_REVIEW_RESOLUTIONS.filter(
  (value): value is DismissResolution => value !== "APPLIED",
);

export const RESOLUTION_LABEL: Record<PaymentReviewResolution, string> = {
  APPLIED: "Recorded on an invoice",
  REFUNDED: "Refunded in my payment provider",
  KEPT_AS_CREDIT: "Kept as credit for the customer",
  CREDIT_NOTE: "Credit note issued",
  RECORDED_BY_HAND: "Recorded by hand on the invoice",
  DISPUTE_WON: "Dispute closed in our favour",
  NOT_OURS: "Not a payment for our invoices",
};

export type ReviewKind = SettlementReviewReason | "UNMATCHED" | "EMAIL_ONLY";

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  CURRENCY_MISMATCH: "Different currency",
  ZERO_AMOUNT: "No amount",
  INVOICE_ALREADY_PAID: "Invoice already paid",
  INVOICE_NOT_PAYABLE: "Invoice not open",
  OVERPAID: "Overpaid",
  REFUNDED: "Refunded",
  DISPUTED: "Disputed",
  UNMATCHED: "No invoice or lead matched",
  EMAIL_ONLY: "Matched by email only",
};

/** What the person is told to do, per kind. Plain words; no money is moved by ClientTurn. */
export const REVIEW_KIND_GUIDANCE: Record<ReviewKind, string> = {
  CURRENCY_MISMATCH: "Nothing was recorded. Record it by hand in the invoice's currency, or refund it.",
  ZERO_AMOUNT: "Nothing was recorded. Check it in your payment provider.",
  INVOICE_ALREADY_PAID: "Nothing was recorded. Refund it, keep it as credit, or apply it to another open invoice.",
  INVOICE_NOT_PAYABLE: "Nothing was recorded. Apply it to an open invoice, or record it by hand.",
  OVERPAID: "The amount due was recorded. Refund the rest in your payment provider, or keep it as credit.",
  REFUNDED: "The invoice was not changed. Issue a credit note for the refunded amount.",
  DISPUTED: "The invoice was not changed. Answer the dispute in your payment provider; issue a credit note if you lose it.",
  UNMATCHED: "It carried no invoice reference. Apply it to the invoice it pays, or dismiss it.",
  EMAIL_ONLY: "It matched a lead by email only. Apply it to the invoice it pays, or dismiss it.",
};

/** The dismiss options that make sense for each kind, most likely first. */
export const RESOLUTIONS_FOR_KIND: Record<ReviewKind, readonly DismissResolution[]> = {
  CURRENCY_MISMATCH: ["RECORDED_BY_HAND", "REFUNDED", "NOT_OURS"],
  ZERO_AMOUNT: ["NOT_OURS"],
  INVOICE_ALREADY_PAID: ["REFUNDED", "KEPT_AS_CREDIT"],
  INVOICE_NOT_PAYABLE: ["RECORDED_BY_HAND", "REFUNDED", "NOT_OURS"],
  OVERPAID: ["REFUNDED", "KEPT_AS_CREDIT"],
  REFUNDED: ["CREDIT_NOTE", "RECORDED_BY_HAND"],
  DISPUTED: ["DISPUTE_WON", "CREDIT_NOTE"],
  UNMATCHED: ["NOT_OURS", "RECORDED_BY_HAND", "REFUNDED"],
  EMAIL_ONLY: ["NOT_OURS", "RECORDED_BY_HAND", "REFUNDED"],
};

export type ReviewPaymentRow = {
  status: string;
  review_reason: string | null;
  review_resolved_at: string | null;
  applied_at: string | null;
  invoice_id: string | null;
  match_kind: string | null;
  amount_minor: number;
};

const REASONS = new Set<string>([
  "CURRENCY_MISMATCH",
  "ZERO_AMOUNT",
  "INVOICE_ALREADY_PAID",
  "INVOICE_NOT_PAYABLE",
  "OVERPAID",
  "REFUNDED",
  "DISPUTED",
]);

/** Whether the payment waits for a person in this queue. */
export function isOpenReview(row: ReviewPaymentRow): boolean {
  if (row.review_resolved_at) return false;
  if (row.review_reason && REASONS.has(row.review_reason)) return true;
  // A payment already applied to a lead or an invoice is not waiting.
  if (row.applied_at) return false;
  return row.status === "REVIEW" || row.status === "UNMATCHED";
}

export function reviewKind(row: ReviewPaymentRow): ReviewKind {
  if (row.review_reason && REASONS.has(row.review_reason)) return row.review_reason as SettlementReviewReason;
  return row.match_kind === "EMAIL" ? "EMAIL_ONLY" : "UNMATCHED";
}

/** Whether "apply to an invoice" is offered. */
export function canApplyToInvoice(row: ReviewPaymentRow): boolean {
  if (!isOpenReview(row) || row.applied_at) return false;
  if (row.status !== "REVIEW" && row.status !== "UNMATCHED") return false;
  if (!Number.isInteger(row.amount_minor) || row.amount_minor <= 0) return false;
  const kind = reviewKind(row);
  return kind !== "REFUNDED" && kind !== "DISPUTED" && kind !== "ZERO_AMOUNT";
}

export function canDismiss(row: ReviewPaymentRow, resolution: DismissResolution): boolean {
  return isOpenReview(row) && RESOLUTIONS_FOR_KIND[reviewKind(row)].includes(resolution);
}

export type ApplyDecision =
  | { kind: "RECORD"; amountMinor: number; excessMinor: number }
  | { kind: "ALREADY_RECORDED"; amountMinor: number; excessMinor: number }
  | { kind: "REFUSE"; message: string };

const REFUSAL: Record<string, string> = {
  CURRENCY_MISMATCH: "That invoice is in a different currency from the payment. Record it by hand instead.",
  ZERO_AMOUNT: "The payment has no amount to record.",
  INVOICE_ALREADY_PAID: "That invoice is already paid. Choose an open invoice.",
  INVOICE_NOT_PAYABLE: "That invoice is not open for payment (draft, void or written off). Choose an open invoice.",
  NOT_THIS_WORKSPACE: "That invoice could not be found.",
};

/**
 * What applying `payment` to `invoice` records. The automatic settlement's
 * rules, so a person can never record what a pay token could not: currency
 * must match, the invoice must be open, and at most the amount due is
 * recorded. `alreadyRecordedMinor` is the invoice_payments row for this
 * provider payment, if one exists (a retry, a double click): nothing is
 * recorded twice.
 */
export function decideApply(input: {
  businessId: string;
  row: ReviewPaymentRow & { currency: string };
  invoice: SettlementInvoice;
  alreadyRecordedMinor: number | null;
}): ApplyDecision {
  if (input.alreadyRecordedMinor !== null) {
    return {
      kind: "ALREADY_RECORDED",
      amountMinor: input.alreadyRecordedMinor,
      excessMinor: Math.max(0, input.row.amount_minor - input.alreadyRecordedMinor),
    };
  }
  if (!canApplyToInvoice(input.row)) {
    return { kind: "REFUSE", message: "This payment can no longer be applied to an invoice." };
  }
  const decision = decideInvoiceSettlement({
    businessId: input.businessId,
    invoice: input.invoice,
    payment: { amountMinor: input.row.amount_minor, currency: input.row.currency },
    alreadyRecorded: false,
  });
  if (decision.kind === "SETTLE") return { kind: "RECORD", amountMinor: decision.amountMinor, excessMinor: decision.excessMinor };
  if (decision.kind === "REVIEW") return { kind: "REFUSE", message: REFUSAL[decision.reason] ?? "That invoice cannot take this payment." };
  if (decision.kind === "NOT_THIS_WORKSPACE") return { kind: "REFUSE", message: REFUSAL.NOT_THIS_WORKSPACE };
  return { kind: "REFUSE", message: "That payment is already on the invoice." };
}

/**
 * The checkout_payments patch after a successful apply. With nothing over,
 * the review is resolved APPLIED. With an excess, the payment stays in the
 * queue as OVERPAID so the person refunds the rest or keeps it as credit.
 */
export function applyPatch(input: {
  invoiceId: string;
  leadId: string | null;
  excessMinor: number;
  userId: string | null;
  now: string;
}): Record<string, unknown> {
  const resolved = input.excessMinor <= 0;
  return {
    status: "MATCHED",
    match_kind: "INVOICE",
    invoice_id: input.invoiceId,
    lead_id: input.leadId,
    applied_at: input.now,
    review_reason: resolved ? null : "OVERPAID",
    review_resolved_at: resolved ? input.now : null,
    review_resolved_by: resolved ? input.userId : null,
    review_resolution: resolved ? "APPLIED" : null,
  };
}

/** Counts of open reviews by kind, for the settings card and the admin support view. */
export function countByKind(rows: readonly ReviewPaymentRow[]): { total: number; byKind: Partial<Record<ReviewKind, number>> } {
  const byKind: Partial<Record<ReviewKind, number>> = {};
  let total = 0;
  for (const row of rows) {
    if (!isOpenReview(row)) continue;
    const kind = reviewKind(row);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    total += 1;
  }
  return { total, byKind };
}
