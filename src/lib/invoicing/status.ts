/**
 * Invoice status and payments.
 *
 *   DRAFT --issue--> OPEN --part payment--> PARTIALLY_PAID --rest--> PAID
 *   DRAFT / OPEN (nothing paid) --void--> VOID
 *   OPEN / PARTIALLY_PAID --write off--> UNCOLLECTIBLE (a later payment still applies)
 *
 * Payments are idempotent on the payment id (a replayed webhook applies
 * once) and may never exceed the amount due: an overpayment is refused so a
 * person decides (refund or credit). A paid invoice is corrected with a
 * credit note (credit-notes.ts), never edited or voided.
 */

import { assertMinor } from "../quotes/money.ts";
import type { InvoicePayment, InvoiceState, InvoiceStatus } from "./types.ts";

export function paidMinor(invoice: Pick<InvoiceState, "payments">): number {
  return invoice.payments.reduce((total, payment) => total + payment.amountMinor, 0);
}

export function creditedMinor(invoice: Pick<InvoiceState, "creditNotes">): number {
  return invoice.creditNotes.reduce((total, note) => total + note.amountMinor, 0);
}

export function amountDueMinor(invoice: Pick<InvoiceState, "payments" | "totalMinor">): number {
  return Math.max(0, invoice.totalMinor - paidMinor(invoice));
}

/** The status payments imply, for an issued invoice. */
export function statusFromPayments(totalMinor: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "OPEN";
  return paid >= totalMinor ? "PAID" : "PARTIALLY_PAID";
}

export type InvoiceChange =
  | { ok: true; invoice: InvoiceState; duplicate?: boolean }
  | { ok: false; reason: string; detail: string };

export function issueInvoice(invoice: InvoiceState, input: { number: string; issueDate: string; dueDate: string }): InvoiceChange {
  if (invoice.status !== "DRAFT") return { ok: false, reason: "NOT_DRAFT", detail: "Only a draft invoice can be issued." };
  if (invoice.totalMinor <= 0) return { ok: false, reason: "ZERO_TOTAL", detail: "An invoice needs an amount to issue." };
  if (input.dueDate < input.issueDate) return { ok: false, reason: "DUE_BEFORE_ISSUE", detail: "The due date is before the issue date." };
  return { ok: true, invoice: { ...invoice, status: "OPEN", number: input.number, issueDate: input.issueDate, dueDate: input.dueDate } };
}

export function applyPayment(invoice: InvoiceState, payment: InvoicePayment): InvoiceChange {
  assertMinor(payment.amountMinor, "payment");
  if (payment.amountMinor <= 0) return { ok: false, reason: "NON_POSITIVE", detail: "A payment must be a positive amount." };
  const existing = invoice.payments.find((candidate) => candidate.id === payment.id);
  if (existing) {
    if (existing.amountMinor !== payment.amountMinor) {
      return { ok: false, reason: "PAYMENT_ID_CONFLICT", detail: "This payment id was already recorded with a different amount." };
    }
    return { ok: true, invoice, duplicate: true };
  }
  if (invoice.status === "DRAFT") return { ok: false, reason: "NOT_ISSUED", detail: "A draft invoice cannot take payments." };
  if (invoice.status === "VOID") return { ok: false, reason: "VOID", detail: "A void invoice cannot take payments." };
  if (invoice.status === "PAID") return { ok: false, reason: "ALREADY_PAID", detail: "The invoice is already paid in full." };
  if (payment.amountMinor > amountDueMinor(invoice)) {
    return { ok: false, reason: "OVERPAYMENT", detail: "The payment is more than the amount due." };
  }
  const payments = [...invoice.payments, payment];
  const paid = paidMinor({ payments });
  return { ok: true, invoice: { ...invoice, payments, status: statusFromPayments(invoice.totalMinor, paid) } };
}

export function voidInvoice(invoice: InvoiceState): InvoiceChange {
  if (invoice.status !== "DRAFT" && invoice.status !== "OPEN") {
    return { ok: false, reason: "CANNOT_VOID", detail: `A ${invoice.status.toLowerCase()} invoice cannot be voided; issue a credit note.` };
  }
  if (paidMinor(invoice) > 0) return { ok: false, reason: "HAS_PAYMENTS", detail: "An invoice with payments is corrected by a credit note." };
  return { ok: true, invoice: { ...invoice, status: "VOID" } };
}

export function markUncollectible(invoice: InvoiceState): InvoiceChange {
  if (invoice.status !== "OPEN" && invoice.status !== "PARTIALLY_PAID") {
    return { ok: false, reason: "CANNOT_WRITE_OFF", detail: "Only an open or part-paid invoice can be written off." };
  }
  return { ok: true, invoice: { ...invoice, status: "UNCOLLECTIBLE" } };
}

/** Overdue: issued, not settled, and past its due date (YYYY-MM-DD comparison). */
export function isOverdue(invoice: Pick<InvoiceState, "status" | "dueDate">, today: string): boolean {
  return (invoice.status === "OPEN" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate !== null && today > invoice.dueDate;
}
