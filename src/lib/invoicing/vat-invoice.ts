/**
 * HMRC full VAT invoice checks (VAT Notice 700/21 "Full VAT invoices"):
 *
 *   - a unique, sequential invoice number
 *   - the seller's name and address, and VAT registration number
 *   - the invoice date, and the time of supply (tax point) if different
 *   - the customer's name (or trading name) and address
 *   - a description of each supply, with quantity and unit price excl. VAT
 *   - the VAT rate of each line, and the rate of any discount per line
 *   - the total excluding VAT, the VAT per rate, and the total VAT
 *   - for an invoice in another currency: the VAT total in sterling
 *
 * A workspace that is NOT VAT-registered must not charge or show VAT, a
 * VAT number or a VAT breakdown; the invoice says no VAT is charged.
 * Simplified invoices (<= £250) are not issued by this product.
 */

import { VAT_RATE_BPS } from "../catalogue/types.ts";
import { percentOf } from "../quotes/money.ts";
import type { VatBucket } from "../quotes/types.ts";
import type { InvoiceLine, SellerProfile } from "./types.ts";

export const UK_VAT_NUMBER = /^GB(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/;

export function normaliseVatNumber(value: string): string {
  return value.replace(/[\s.-]/g, "").toUpperCase();
}

export function isValidUkVatNumber(value: string): boolean {
  return UK_VAT_NUMBER.test(normaliseVatNumber(value));
}

export type VatInvoiceDocument = {
  number: string | null;
  issueDate: string | null;
  /** Tax point, when it differs from the issue date. */
  supplyDate: string | null;
  currency: string;
  seller: SellerProfile;
  buyer: { name: string; address: string[] };
  lines: InvoiceLine[];
  vatByRate: VatBucket[];
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  /** Required when currency is not GBP and VAT is charged. */
  vatTotalGbpMinor?: number | null;
};

export type VatInvoiceIssue =
  | "NUMBER_MISSING"
  | "ISSUE_DATE_MISSING"
  | "SELLER_NAME_MISSING"
  | "SELLER_ADDRESS_MISSING"
  | "SELLER_VAT_NUMBER_MISSING"
  | "SELLER_VAT_NUMBER_INVALID"
  | "BUYER_NAME_MISSING"
  | "BUYER_ADDRESS_MISSING"
  | "NO_LINES"
  | "LINE_DESCRIPTION_MISSING"
  | "LINE_QUANTITY_MISSING"
  | "LINE_UNIT_PRICE_MISSING"
  | "LINE_VAT_RATE_MISMATCH"
  | "LINE_VAT_MISCALCULATED"
  | "LINE_ARITHMETIC"
  | "VAT_BY_RATE_MISMATCH"
  | "TOTALS_MISMATCH"
  | "GBP_VAT_TOTAL_MISSING"
  | "VAT_CHARGED_WHEN_NOT_REGISTERED"
  | "VAT_NUMBER_WHEN_NOT_REGISTERED";

export function checkVatInvoice(doc: VatInvoiceDocument): { compliant: boolean; issues: VatInvoiceIssue[] } {
  const issues = new Set<VatInvoiceIssue>();
  const registered = doc.seller.vatRegistered;

  if (!doc.number?.trim()) issues.add("NUMBER_MISSING");
  if (!doc.issueDate) issues.add("ISSUE_DATE_MISSING");
  if (!doc.seller.name.trim()) issues.add("SELLER_NAME_MISSING");
  if (doc.seller.address.filter((line) => line.trim()).length === 0) issues.add("SELLER_ADDRESS_MISSING");
  if (!doc.buyer.name.trim()) issues.add("BUYER_NAME_MISSING");
  if (registered && doc.buyer.address.filter((line) => line.trim()).length === 0) issues.add("BUYER_ADDRESS_MISSING");
  if (doc.lines.length === 0) issues.add("NO_LINES");

  for (const line of doc.lines) {
    if (!line.description.trim()) issues.add("LINE_DESCRIPTION_MISSING");
    if (!(line.quantityMilli > 0)) issues.add("LINE_QUANTITY_MISSING");
    if (registered && line.unitNetMinor === null && line.quantityMilli !== 1000) issues.add("LINE_UNIT_PRICE_MISSING");
    if (line.netMinor + line.vatMinor !== line.grossMinor) issues.add("LINE_ARITHMETIC");
    if (registered) {
      if (line.vatBps !== VAT_RATE_BPS[line.vatRate]) issues.add("LINE_VAT_RATE_MISMATCH");
      // Line-level VAT (calculate.ts): each ordinary line's VAT is its net at
      // the rate, rounded half up. Apportioned deposit/balance lines carry a
      // share of the quote's VAT instead and are checked through the totals.
      if (!line.apportioned && line.vatMinor !== percentOf(line.netMinor, line.vatBps)) issues.add("LINE_VAT_MISCALCULATED");
    }
  }

  const lineNet = doc.lines.reduce((t, l) => t + l.netMinor, 0);
  const lineVat = doc.lines.reduce((t, l) => t + l.vatMinor, 0);
  if (lineNet !== doc.netMinor || lineVat !== doc.vatMinor || doc.netMinor + doc.vatMinor !== doc.totalMinor) {
    issues.add("TOTALS_MISMATCH");
  }

  if (registered) {
    if (!doc.seller.vatNumber) issues.add("SELLER_VAT_NUMBER_MISSING");
    else if (!isValidUkVatNumber(doc.seller.vatNumber)) issues.add("SELLER_VAT_NUMBER_INVALID");
    for (const bucket of doc.vatByRate) {
      const inRate = doc.lines.filter((line) => line.vatRate === bucket.vatRate);
      const net = inRate.reduce((t, l) => t + l.netMinor, 0);
      const vat = inRate.reduce((t, l) => t + l.vatMinor, 0);
      if (net !== bucket.netMinor || vat !== bucket.vatMinor) issues.add("VAT_BY_RATE_MISMATCH");
    }
    const rates = new Set(doc.lines.map((line) => line.vatRate));
    if (rates.size !== doc.vatByRate.length || doc.vatByRate.some((bucket) => !rates.has(bucket.vatRate))) {
      issues.add("VAT_BY_RATE_MISMATCH");
    }
    if (doc.currency !== "GBP" && doc.vatMinor > 0 && (doc.vatTotalGbpMinor === null || doc.vatTotalGbpMinor === undefined)) {
      issues.add("GBP_VAT_TOTAL_MISSING");
    }
  } else {
    if (doc.vatMinor !== 0 || doc.lines.some((line) => line.vatMinor !== 0) || doc.vatByRate.length > 0) {
      issues.add("VAT_CHARGED_WHEN_NOT_REGISTERED");
    }
    if (doc.seller.vatNumber) issues.add("VAT_NUMBER_WHEN_NOT_REGISTERED");
  }

  return { compliant: issues.size === 0, issues: [...issues] };
}
