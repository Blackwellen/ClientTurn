/**
 * Customer invoicing types (the workspace's invoices to ITS customers, not
 * ClientTurn's own Stripe billing in lib/billing). Integer minor units.
 * Pure: no I/O.
 */

import type { VatRateCode } from "../catalogue/types.ts";
import type { DueRule, VatBucket } from "../quotes/types.ts";

export const INVOICE_STATUSES = ["DRAFT", "OPEN", "PARTIALLY_PAID", "PAID", "VOID", "UNCOLLECTIBLE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_KINDS = ["DEPOSIT", "BALANCE", "INSTALMENT", "FULL", "RECURRING"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export type InvoiceLine = {
  description: string;
  quantityMilli: number;
  /** Unit price excluding VAT; null when graduated tiers mixed prices. */
  unitNetMinor: number | null;
  discountMinor: number;
  /** Discount rate for the line when it was a percentage (HMRC: show the rate of any discount). */
  discountBps: number | null;
  netMinor: number;
  vatRate: VatRateCode;
  vatBps: number;
  vatMinor: number;
  grossMinor: number;
  /**
   * True for a deposit / balance / instalment line: an apportionment of the
   * quote's VAT for that rate, so the invoices of one quote sum exactly to
   * its VAT (calculate.ts splitAcrossBuckets).
   */
  apportioned: boolean;
};

export type InvoiceDraft = {
  kind: InvoiceKind;
  status: "DRAFT";
  currency: string;
  vatRegistered: boolean;
  quoteRevisionId: string;
  scheduleSeq: number | null;
  due: DueRule | null;
  /** For RECURRING: the period start (YYYY-MM-DD). */
  periodStart: string | null;
  lines: InvoiceLine[];
  vatByRate: VatBucket[];
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  idempotencyKey: string;
};

export type InvoicePayment = { id: string; amountMinor: number; receivedAt: string };

export type CreditNote = {
  id: string;
  number: string;
  invoiceId: string;
  amountMinor: number;
  netMinor: number;
  vatMinor: number;
  vatByRate: VatBucket[];
  reason: string;
  issuedAt: string;
};

/** The state the payment / credit / status functions work on. */
export type InvoiceState = {
  id: string;
  status: InvoiceStatus;
  number: string | null;
  currency: string;
  totalMinor: number;
  vatByRate: VatBucket[];
  payments: InvoicePayment[];
  creditNotes: CreditNote[];
  issueDate: string | null;
  dueDate: string | null;
};

export type SellerProfile = {
  name: string;
  address: string[];
  vatRegistered: boolean;
  vatNumber: string | null;
};
