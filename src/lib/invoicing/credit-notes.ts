/**
 * Credit notes. A credit note refunds or cancels part of what was PAID on
 * an invoice, and the total credited can never exceed the total paid.
 *
 * VAT: the amount is split across the invoice's VAT rates in proportion to
 * what is still uncredited in each, and each rate's VAT is taken on the
 * running credited total, so crediting an invoice in full (in one or many
 * notes) returns exactly its net and VAT per rate.
 */

import { allocate, assertMinor, mulDivRound } from "../quotes/money.ts";
import type { VatBucket } from "../quotes/types.ts";
import { creditedMinor, paidMinor } from "./status.ts";
import type { CreditNote, InvoiceState } from "./types.ts";

export type CreditNoteResult =
  | { ok: true; creditNote: CreditNote }
  | { ok: false; reason: "NOT_ISSUED" | "NOTHING_PAID" | "EXCEEDS_PAID" | "NON_POSITIVE" | "REASON_REQUIRED"; detail: string; maxMinor: number };

export function creditableMinor(invoice: InvoiceState): number {
  return Math.max(0, paidMinor(invoice) - creditedMinor(invoice));
}

function priorByRate(invoice: InvoiceState): { gross: number; vat: number }[] {
  return invoice.vatByRate.map((bucket) => {
    let gross = 0;
    let vat = 0;
    for (const note of invoice.creditNotes) {
      const match = note.vatByRate.find((candidate) => candidate.vatRate === bucket.vatRate);
      if (match) {
        gross += match.grossMinor;
        vat += match.vatMinor;
      }
    }
    return { gross, vat };
  });
}

export function createCreditNote(
  invoice: InvoiceState,
  input: { id: string; number: string; amountMinor: number; reason: string; issuedAt: string },
): CreditNoteResult {
  assertMinor(input.amountMinor, "credit");
  const max = creditableMinor(invoice);
  if (invoice.status === "DRAFT" || invoice.status === "VOID") {
    return { ok: false, reason: "NOT_ISSUED", detail: "Credit notes apply to issued invoices only.", maxMinor: 0 };
  }
  if (input.amountMinor <= 0) return { ok: false, reason: "NON_POSITIVE", detail: "A credit note must be a positive amount.", maxMinor: max };
  if (!input.reason.trim()) return { ok: false, reason: "REASON_REQUIRED", detail: "Give the reason for the credit.", maxMinor: max };
  if (paidMinor(invoice) === 0) return { ok: false, reason: "NOTHING_PAID", detail: "Nothing has been paid on this invoice.", maxMinor: 0 };
  if (input.amountMinor > max) {
    return { ok: false, reason: "EXCEEDS_PAID", detail: "Credits cannot exceed the amount paid.", maxMinor: max };
  }

  let vatByRate: VatBucket[] = [];
  if (invoice.vatByRate.length > 0) {
    const prior = priorByRate(invoice);
    const remaining = invoice.vatByRate.map((bucket, b) => bucket.grossMinor - prior[b].gross);
    const shares = allocate(input.amountMinor, remaining);
    vatByRate = invoice.vatByRate.map((bucket, b) => {
      const cumulative = prior[b].gross + shares[b];
      const vatSoFar = bucket.grossMinor === 0 ? 0 : mulDivRound(bucket.vatMinor, cumulative, bucket.grossMinor);
      const vatMinor = vatSoFar - prior[b].vat;
      return { vatRate: bucket.vatRate, vatBps: bucket.vatBps, netMinor: shares[b] - vatMinor, vatMinor, grossMinor: shares[b] };
    });
  }
  const vatMinor = vatByRate.reduce((t, v) => t + v.vatMinor, 0);
  return {
    ok: true,
    creditNote: {
      id: input.id,
      number: input.number,
      invoiceId: invoice.id,
      amountMinor: input.amountMinor,
      netMinor: input.amountMinor - vatMinor,
      vatMinor,
      vatByRate,
      reason: input.reason.trim(),
      issuedAt: input.issuedAt,
    },
  };
}

export function addCreditNote(invoice: InvoiceState, note: CreditNote): InvoiceState {
  return { ...invoice, creditNotes: [...invoice.creditNotes, note] };
}
