/**
 * Invoices from an accepted quote's calculation: one invoice per payment
 * schedule row (deposit, balance, instalments, or one FULL invoice), and one
 * per recurring period. No money is recomputed here: the amounts are the
 * schedule rows calculateQuote produced, so the invoices of a quote always
 * sum exactly to its one-off gross and its VAT per rate.
 *
 * A FULL invoice carries the quote's real one-off lines. A deposit, balance
 * or instalment invoice carries one line per VAT rate ("Deposit for quote
 * Q-0042, 20% items"), an apportionment of that rate's net and VAT.
 */

import { VAT_RATE_LABEL, intervalKey } from "../catalogue/types.ts";
import { invoiceKey } from "../quotes/idempotency.ts";
import type { CalculatedLine, QuoteCalculation, ScheduleItem } from "../quotes/types.ts";
import type { InvoiceDraft, InvoiceLine } from "./types.ts";

export type FromQuoteInput = {
  businessId: string;
  quoteRevisionId: string;
  quoteNumber: string;
  calculation: QuoteCalculation;
};

function quoteLine(line: CalculatedLine): InvoiceLine {
  const discountMinor = line.bundleDiscountMinor + line.lineDiscountMinor + line.quoteDiscountMinor;
  return {
    description: line.description,
    quantityMilli: line.quantityMilli,
    unitNetMinor: line.unitPriceMinor,
    discountMinor,
    discountBps: discountMinor > 0 && line.bundleDiscountMinor === 0 && line.quoteDiscountMinor === 0 ? line.lineDiscountBps : null,
    netMinor: line.netMinor,
    vatRate: line.vatRate,
    vatBps: line.vatBps,
    vatMinor: line.vatMinor,
    grossMinor: line.grossMinor,
    apportioned: false,
  };
}

const KIND_WORD = { DEPOSIT: "Deposit", BALANCE: "Balance", INSTALMENT: "Instalment", FULL: "Payment" } as const;

function apportionedLines(row: ScheduleItem, quoteNumber: string, calc: QuoteCalculation, instalmentNo: number): InvoiceLine[] {
  const base = row.kind === "INSTALMENT" ? `Instalment ${instalmentNo} for quote ${quoteNumber}` : `${KIND_WORD[row.kind]} for quote ${quoteNumber}`;
  if (!calc.vatRegistered || row.vatByRate.length === 0) {
    return [
      {
        description: base,
        quantityMilli: 1000,
        unitNetMinor: row.grossMinor,
        discountMinor: 0,
        discountBps: null,
        netMinor: row.grossMinor,
        vatRate: "OUTSIDE_SCOPE",
        vatBps: 0,
        vatMinor: 0,
        grossMinor: row.grossMinor,
        apportioned: true,
      },
    ];
  }
  const several = row.vatByRate.length > 1;
  return row.vatByRate
    .filter((bucket) => bucket.grossMinor > 0)
    .map((bucket) => ({
      description: several ? `${base}, ${VAT_RATE_LABEL[bucket.vatRate]} items` : base,
      quantityMilli: 1000,
      unitNetMinor: bucket.netMinor,
      discountMinor: 0,
      discountBps: null,
      netMinor: bucket.netMinor,
      vatRate: bucket.vatRate,
      vatBps: bucket.vatBps,
      vatMinor: bucket.vatMinor,
      grossMinor: bucket.grossMinor,
      apportioned: true,
    }));
}

export function invoicesFromQuote(input: FromQuoteInput): InvoiceDraft[] {
  const calc = input.calculation;
  const oneOffLines = calc.lines.filter((line) => line.chargeType === "ONE_OFF");
  let instalmentNo = 0;
  return calc.schedule.map((row) => {
    if (row.kind === "INSTALMENT") instalmentNo += 1;
    const lines = row.kind === "FULL" ? oneOffLines.map(quoteLine) : apportionedLines(row, input.quoteNumber, calc, instalmentNo);
    return {
      kind: row.kind,
      status: "DRAFT",
      currency: calc.currency,
      vatRegistered: calc.vatRegistered,
      quoteRevisionId: input.quoteRevisionId,
      scheduleSeq: row.seq,
      due: row.due,
      periodStart: null,
      lines,
      vatByRate: row.vatByRate,
      netMinor: row.netMinor,
      vatMinor: row.vatMinor,
      totalMinor: row.grossMinor,
      idempotencyKey: invoiceKey({
        businessId: input.businessId,
        quoteRevisionId: input.quoteRevisionId,
        kind: row.kind,
        slot: row.seq,
      }),
    };
  });
}

/** The invoice for one period of one recurring interval group. */
export function recurringInvoice(input: FromQuoteInput & { intervalKey: string; periodStart: string }): InvoiceDraft {
  const calc = input.calculation;
  const group = calc.recurring.find((candidate) => candidate.intervalKey === input.intervalKey);
  if (!group) throw new Error(`No recurring charges for interval ${input.intervalKey}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart)) throw new Error("periodStart must be YYYY-MM-DD.");
  const lines = calc.lines
    .filter((line) => line.chargeType === "RECURRING" && line.interval && intervalKey(line.interval) === input.intervalKey)
    .map(quoteLine);
  return {
    kind: "RECURRING",
    status: "DRAFT",
    currency: calc.currency,
    vatRegistered: calc.vatRegistered,
    quoteRevisionId: input.quoteRevisionId,
    scheduleSeq: null,
    due: { type: "ON_ACCEPTANCE" },
    periodStart: input.periodStart,
    lines,
    vatByRate: group.vatByRate,
    netMinor: group.netMinor,
    vatMinor: group.vatMinor,
    totalMinor: group.grossMinor,
    idempotencyKey: invoiceKey({
      businessId: input.businessId,
      quoteRevisionId: input.quoteRevisionId,
      kind: "RECURRING",
      slot: `${input.intervalKey}@${input.periodStart}`,
    }),
  };
}
