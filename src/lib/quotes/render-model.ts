/**
 * The customer-facing view model of one quote revision: ONE source for the
 * public page /q/[token] and the PDF, so the two can never disagree. It is
 * built field by field from a whitelist; internal cost, margin, internal
 * notes and AI reasoning have no field here, so they cannot leak even if a
 * caller passes them in. Money is pre-formatted deterministically
 * (money.ts formatMinor, no Intl) so page and PDF render identical text.
 *
 * The e-signature seals sha256(canonicalJson(renderModel)) (esign/seal.ts):
 * the signer signs exactly what they saw.
 */

import { VAT_RATE_LABEL } from "../catalogue/types.ts";
import { hashCanonical } from "./canonical.ts";
import { formatBps, formatMilli, formatMinor } from "./money.ts";
import type {
  CalculatedLine,
  DueRule,
  QuoteCalculation,
  QuoteRenderLine,
  QuoteRenderModel,
  QuoteRenderTotals,
  RecurringSubtotal,
  Subtotal,
} from "./types.ts";
import type { BillingInterval } from "../catalogue/types.ts";

export type RenderModelInput = {
  quote: { number: string; revision: number; title: string; issuedOn: string; validUntil: string };
  seller: {
    name: string;
    legalName?: string | null;
    address?: string[];
    companyNumber?: string | null;
    /** Shown only when the workspace is VAT-registered. */
    vatNumber?: string | null;
    email?: string | null;
    logoUrl?: string | null;
  };
  buyer: { name: string; company?: string | null; email?: string | null; address?: string[] };
  calculation: QuoteCalculation;
  terms: string;
  /** A note written FOR the customer. Internal notes are not accepted here. */
  customerNote?: string | null;
  /** "Powered by ClientTurn" (OD-1); false only with white_label_public_pages. */
  poweredBy: boolean;
};

const INTERVAL_WORD: Record<BillingInterval["unit"], [string, string]> = {
  WEEK: ["week", "weeks"],
  MONTH: ["month", "months"],
  QUARTER: ["quarter", "quarters"],
  YEAR: ["year", "years"],
};

export function intervalLabel(interval: BillingInterval): string {
  const [one, many] = INTERVAL_WORD[interval.unit];
  return interval.count === 1 ? `per ${one}` : `every ${interval.count} ${many}`;
}

export function dueLabel(due: DueRule): string {
  switch (due.type) {
    case "ON_ACCEPTANCE":
      return "On acceptance";
    case "ON_COMPLETION":
      return "On completion";
    case "DAYS_AFTER_ACCEPTANCE":
      return `${due.days} day${due.days === 1 ? "" : "s"} after acceptance`;
  }
}

function billingLabel(line: CalculatedLine): string {
  if (line.chargeType === "ONE_OFF") return "One-off";
  if (line.chargeType === "USAGE") return "Usage, billed in arrears (estimate)";
  return line.interval ? `Recurring, ${intervalLabel(line.interval)}` : "Recurring";
}

function renderLine(line: CalculatedLine, currency: string, showVat: boolean): QuoteRenderLine {
  const discountMinor = line.lineDiscountMinor + line.quoteDiscountMinor + line.bundleDiscountMinor;
  let discount: string | null = null;
  if (discountMinor > 0) {
    discount =
      line.lineDiscountBps !== null && line.quoteDiscountMinor === 0 && line.bundleDiscountMinor === 0
        ? `${formatBps(line.lineDiscountBps)} (${formatMinor(discountMinor, currency)})`
        : formatMinor(discountMinor, currency);
  }
  return {
    lineId: line.lineId,
    description: line.description,
    groupLabel: line.bundleName,
    isAddOn: line.parentLineId !== null,
    quantity: formatMilli(line.quantityMilli),
    unit: line.unit,
    unitPrice: line.unitPriceMinor === null ? null : formatMinor(line.unitPriceMinor, currency),
    listAmount: formatMinor(line.listMinor, currency),
    discount,
    netAmount: formatMinor(line.netMinor, currency),
    vatRate: showVat ? VAT_RATE_LABEL[line.vatRate] : null,
    vatAmount: showVat ? formatMinor(line.vatMinor, currency) : null,
    grossAmount: showVat ? formatMinor(line.grossMinor, currency) : null,
    billing: billingLabel(line),
  };
}

function renderTotals(label: string, subtotal: Subtotal, currency: string, showVat: boolean): QuoteRenderTotals {
  return {
    label,
    net: formatMinor(subtotal.netMinor, currency),
    vat: showVat ? formatMinor(subtotal.vatMinor, currency) : null,
    gross: formatMinor(showVat ? subtotal.grossMinor : subtotal.netMinor, currency),
    vatByRate: showVat
      ? subtotal.vatByRate.map((bucket) => ({
          rate: VAT_RATE_LABEL[bucket.vatRate],
          net: formatMinor(bucket.netMinor, currency),
          vat: formatMinor(bucket.vatMinor, currency),
        }))
      : null,
  };
}

const SCHEDULE_LABEL = { DEPOSIT: "Deposit", BALANCE: "Balance", INSTALMENT: "Instalment", FULL: "Payment" } as const;

export function buildQuoteRenderModel(input: RenderModelInput): QuoteRenderModel {
  const calc = input.calculation;
  const currency = calc.currency;
  const showVat = calc.vatRegistered;
  const usageLines = calc.lines.filter((line) => line.chargeType === "USAGE");
  const priced = calc.lines.filter((line) => line.chargeType !== "USAGE");
  let instalment = 0;

  return {
    schema: "clientturn.quote.render/1",
    quote: {
      number: input.quote.number,
      revision: input.quote.revision,
      title: input.quote.title,
      issuedOn: input.quote.issuedOn,
      validUntil: input.quote.validUntil,
      currency,
    },
    seller: {
      name: input.seller.name,
      legalName: input.seller.legalName ?? null,
      address: [...(input.seller.address ?? [])],
      companyNumber: input.seller.companyNumber ?? null,
      vatNumber: showVat ? (input.seller.vatNumber ?? null) : null,
      email: input.seller.email ?? null,
      logoUrl: input.seller.logoUrl ?? null,
    },
    buyer: {
      name: input.buyer.name,
      company: input.buyer.company ?? null,
      email: input.buyer.email ?? null,
      address: [...(input.buyer.address ?? [])],
    },
    showVat,
    lines: priced.map((line) => renderLine(line, currency, showVat)),
    oneOff: calc.oneOff.listMinor > 0 || priced.some((l) => l.chargeType === "ONE_OFF") ? renderTotals("One-off", calc.oneOff, currency, showVat) : null,
    recurring: calc.recurring.map((group: RecurringSubtotal) =>
      renderTotals(`Recurring, ${intervalLabel(group.interval)}`, group, currency, showVat),
    ),
    usage:
      usageLines.length > 0
        ? {
            explanation: "Usage is billed in arrears at the rates below. Quantities are estimates and are not included in the totals.",
            lines: usageLines.map(
              (line) => `${line.description}: estimated ${formatMilli(line.quantityMilli)} ${line.unit} = ${formatMinor(line.netMinor, currency)}${showVat ? " + VAT" : ""}`,
            ),
          }
        : null,
    totalDiscount: calc.totals.discountMinor > 0 ? formatMinor(calc.totals.discountMinor, currency) : null,
    deposit: calc.depositMinor > 0 ? formatMinor(calc.depositMinor, currency) : null,
    firstPayment: formatMinor(calc.firstPaymentMinor, currency),
    schedule: calc.schedule.map((row) => {
      if (row.kind === "INSTALMENT") instalment += 1;
      return {
        label: row.kind === "INSTALMENT" ? `Instalment ${instalment}` : SCHEDULE_LABEL[row.kind],
        due: dueLabel(row.due),
        amount: formatMinor(row.grossMinor, currency),
      };
    }),
    terms: input.terms,
    customerNote: input.customerNote ?? null,
    vatNotice: showVat ? null : "The seller is not registered for VAT. No VAT is charged.",
    poweredBy: input.poweredBy,
    calculationHash: calc.calculationHash,
  };
}

/** The hash an e-signature seals and the PDF footer prints. */
export function renderModelHash(model: QuoteRenderModel): string {
  return hashCanonical(model);
}
