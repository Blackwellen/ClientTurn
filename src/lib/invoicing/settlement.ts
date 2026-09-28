/**
 * Automatic invoice settlement: what a verified payment that carries an
 * invoice's pay token (invoicing/pay-link.ts) may do to that invoice.
 *
 * Pure: no imports, so payments/confirm.ts, the tests and the docs agree on
 * one table of rules.
 *
 *   token names an invoice in THIS workspace, not yet recorded:
 *     currency differs              -> REVIEW (CURRENCY_MISMATCH), nothing recorded
 *     amount is zero                -> REVIEW (ZERO_AMOUNT)
 *     invoice already PAID          -> REVIEW (INVOICE_ALREADY_PAID): a second payment
 *     invoice DRAFT / VOID /
 *       UNCOLLECTIBLE               -> REVIEW (INVOICE_NOT_PAYABLE)
 *     amount <= amount due          -> SETTLE the amount (PARTIALLY_PAID or PAID)
 *     amount >  amount due          -> SETTLE the amount due, and flag the
 *                                      excess for review (OVERPAID): a person
 *                                      refunds it or credits it
 *   the same provider payment already recorded on the invoice
 *                                   -> ALREADY_RECORDED (a retry or a duplicate
 *                                      webhook: nothing is recorded twice)
 *
 * A payment with no token, or matched by email only, never reaches this
 * function: it is a REVIEW item in payments/confirm.ts, never a settlement.
 * Refunds and disputes never reverse a recorded payment here: they are
 * flagged for a person, who issues a credit note (credit-notes.ts).
 */

export const SETTLEMENT_REVIEW_REASONS = [
  "CURRENCY_MISMATCH",
  "ZERO_AMOUNT",
  "INVOICE_ALREADY_PAID",
  "INVOICE_NOT_PAYABLE",
  "OVERPAID",
  "REFUNDED",
  "DISPUTED",
] as const;
export type SettlementReviewReason = (typeof SETTLEMENT_REVIEW_REASONS)[number];

export type SettlementInvoice = {
  business_id: string;
  status: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
};

export type SettlementDecision =
  | { kind: "SETTLE"; amountMinor: number; excessMinor: number }
  | { kind: "REVIEW"; reason: Exclude<SettlementReviewReason, "OVERPAID" | "REFUNDED" | "DISPUTED"> }
  | { kind: "ALREADY_RECORDED" }
  /** The token's invoice belongs to another workspace: not an invoice payment here. */
  | { kind: "NOT_THIS_WORKSPACE" };

export function decideInvoiceSettlement(input: {
  businessId: string;
  invoice: SettlementInvoice;
  payment: { amountMinor: number; currency: string };
  /** The provider payment is already on the invoice (invoice_payments unique key). */
  alreadyRecorded: boolean;
}): SettlementDecision {
  const { invoice, payment } = input;
  if (invoice.business_id !== input.businessId) return { kind: "NOT_THIS_WORKSPACE" };
  if (input.alreadyRecorded) return { kind: "ALREADY_RECORDED" };
  if (!Number.isInteger(payment.amountMinor) || payment.amountMinor <= 0) return { kind: "REVIEW", reason: "ZERO_AMOUNT" };
  if (payment.currency.trim().toUpperCase() !== invoice.currency.trim().toUpperCase()) {
    return { kind: "REVIEW", reason: "CURRENCY_MISMATCH" };
  }
  if (invoice.status === "PAID") return { kind: "REVIEW", reason: "INVOICE_ALREADY_PAID" };
  if (invoice.status !== "OPEN" && invoice.status !== "PARTIALLY_PAID") return { kind: "REVIEW", reason: "INVOICE_NOT_PAYABLE" };
  const due = Math.max(0, invoice.total_minor - invoice.paid_minor);
  if (due === 0) return { kind: "REVIEW", reason: "INVOICE_ALREADY_PAID" };
  if (payment.amountMinor > due) return { kind: "SETTLE", amountMinor: due, excessMinor: payment.amountMinor - due };
  return { kind: "SETTLE", amountMinor: payment.amountMinor, excessMinor: 0 };
}

/**
 * The invoice_payments row's external id for a provider payment: the order /
 * session id, unique per (workspace, provider) -- the same key 0154 makes
 * unique, so a retried job or a second webhook for the same session can
 * never record the payment twice.
 */
export function invoicePaymentExternalId(payment: { provider_order_id: string }): string {
  return payment.provider_order_id.slice(0, 200);
}

/** invoice_payments.provider for a checkout payment's provider. */
export function invoicePaymentProvider(provider: string): "stripe" | "other" {
  return provider === "stripe" ? "stripe" : "other";
}

/** What the owner is told, in words. */
export function settlementReviewSummary(reason: SettlementReviewReason, detail: { invoiceNumber: string | null; excess?: string | null }): string {
  const invoice = detail.invoiceNumber ? `invoice ${detail.invoiceNumber}` : "an invoice";
  switch (reason) {
    case "CURRENCY_MISMATCH":
      return `A payment for ${invoice} arrived in a different currency. Nothing was recorded; check it and record the payment by hand.`;
    case "ZERO_AMOUNT":
      return `A payment for ${invoice} arrived with no amount. Nothing was recorded.`;
    case "INVOICE_ALREADY_PAID":
      return `A payment arrived for ${invoice}, which is already paid. Nothing was recorded; refund it in your payment provider or keep it as credit.`;
    case "INVOICE_NOT_PAYABLE":
      return `A payment arrived for ${invoice}, which is not open for payment (draft, void or written off). Nothing was recorded; check it by hand.`;
    case "OVERPAID":
      return `The customer paid more than was due on ${invoice}. The amount due was recorded${detail.excess ? `; ${detail.excess} is over` : ""}. Refund the rest in your payment provider or keep it as credit.`;
    case "REFUNDED":
      return `A payment on ${invoice} was refunded in your payment provider. The invoice was not changed: issue a credit note for the refunded amount.`;
    case "DISPUTED":
      return `The customer disputed a payment on ${invoice}. The invoice was not changed: respond to the dispute in your payment provider, and issue a credit note if you lose it.`;
  }
}
