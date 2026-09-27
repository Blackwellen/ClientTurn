/**
 * Quote types: the calculator's input (zod), its breakdown, and the
 * customer-facing render model shared by the public page /q/[token] and the
 * PDF. Pure: zod and relative imports only.
 */

import { z } from "zod";
import {
  bpsSchema,
  catalogueSchema,
  currencySchema,
  idSchema,
  minorSchema,
  quantitySchema,
  type ChargeType,
  type BillingInterval,
  type VatRateCode,
} from "../catalogue/types.ts";

/* ---------------------------------------------------------------- inputs */

export const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERCENT"), bps: bpsSchema }),
  /** A fixed amount off (per period for recurring lines). */
  z.object({ type: z.literal("AMOUNT"), minor: minorSchema }),
]);
export type Discount = z.infer<typeof discountSchema>;

export const DISCOUNT_SCOPES = ["ONE_OFF", "RECURRING", "ALL"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

const scopeSchema = z.enum(DISCOUNT_SCOPES).default("ALL");
export const quoteDiscountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERCENT"), bps: bpsSchema, scope: scopeSchema }),
  z.object({ type: z.literal("AMOUNT"), minor: minorSchema, scope: scopeSchema }),
]);
export type QuoteDiscount = z.infer<typeof quoteDiscountSchema>;

export const itemLineSchema = z.object({
  lineId: idSchema,
  kind: z.literal("ITEM"),
  itemId: idSchema,
  quantity: quantitySchema,
  optionIds: z.array(idSchema).max(30).default([]),
  /** Set for an add-on: the line of the parent item it attaches to. */
  parentLineId: idSchema.optional(),
  discount: discountSchema.optional(),
  /** Customer-facing wording override; the catalogue name otherwise. */
  description: z.string().trim().min(1).max(500).optional(),
});

export const bundleLineSchema = z.object({
  lineId: idSchema,
  kind: z.literal("BUNDLE"),
  bundleId: idSchema,
  /** Number of bundles; each component's quantity is multiplied by this. */
  quantity: z.number().int().min(1).max(10_000),
  discount: discountSchema.optional(),
});

export const quoteLineInputSchema = z.discriminatedUnion("kind", [itemLineSchema, bundleLineSchema]);
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const dueRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ON_ACCEPTANCE") }),
  z.object({ type: z.literal("ON_COMPLETION") }),
  z.object({ type: z.literal("DAYS_AFTER_ACCEPTANCE"), days: z.number().int().min(1).max(365) }),
]);
export type DueRule = z.infer<typeof dueRuleSchema>;

export const depositSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERCENT"), bps: z.number().int().min(1).max(10_000) }),
  z.object({ type: z.literal("FIXED"), minor: z.number().int().min(1).max(1_000_000_000_000) }),
]);
export type DepositRule = z.infer<typeof depositSchema>;

export const remainderSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SINGLE"), due: dueRuleSchema.default({ type: "ON_ACCEPTANCE" }) }),
  z.object({
    type: z.literal("INSTALMENTS"),
    count: z.number().int().min(2).max(36),
    firstDueDays: z.number().int().min(0).max(365),
    intervalDays: z.number().int().min(1).max(365),
  }),
]);
export type RemainderRule = z.infer<typeof remainderSchema>;

export const paymentTermsSchema = z.object({
  deposit: depositSchema.optional(),
  remainder: remainderSchema.default({ type: "SINGLE", due: { type: "ON_ACCEPTANCE" } }),
  /** The first period of every recurring line is due with the first payment. */
  recurringBilledUpfront: z.boolean().default(true),
});
export type PaymentTerms = z.infer<typeof paymentTermsSchema>;

export const calculateQuoteInputSchema = z.object({
  /** The quote currency: must equal the workspace catalogue currency. */
  currency: currencySchema,
  /** quote_settings.vat_registered. When false no VAT is charged or shown. */
  vatRegistered: z.boolean(),
  catalogue: catalogueSchema,
  lines: z.array(quoteLineInputSchema).min(1).max(200),
  quoteDiscount: quoteDiscountSchema.optional(),
  payment: paymentTermsSchema.default({
    remainder: { type: "SINGLE", due: { type: "ON_ACCEPTANCE" } },
    recurringBilledUpfront: true,
  }),
});
export type CalculateQuoteInput = z.input<typeof calculateQuoteInputSchema>;
export type ParsedQuoteInput = z.infer<typeof calculateQuoteInputSchema>;

/* --------------------------------------------------------------- outputs */

export type CalculatedLine = {
  /** The input line id; a bundle component is `${bundleLineId}#${index}`. */
  lineId: string;
  sourceLineId: string;
  bundleId: string | null;
  bundleName: string | null;
  parentLineId: string | null;
  itemId: string;
  description: string;
  unit: string;
  chargeType: ChargeType;
  interval: BillingInterval | null;
  quantityMilli: number;
  optionIds: string[];
  /** Unit list price that applied, or null for mixed graduated bands. */
  unitPriceMinor: number | null;
  listMinor: number;
  bundleDiscountMinor: number;
  lineDiscountMinor: number;
  quoteDiscountMinor: number;
  /** Line discount as shown to the customer, when it was a percentage. */
  lineDiscountBps: number | null;
  netMinor: number;
  vatRate: VatRateCode;
  vatBps: number;
  vatMinor: number;
  grossMinor: number;
  /** INTERNAL: never on a render model. */
  costMinor: number | null;
  marginMinor: number | null;
  marginBps: number | null;
};

export type VatBucket = { vatRate: VatRateCode; vatBps: number; netMinor: number; vatMinor: number; grossMinor: number };

export type Subtotal = {
  listMinor: number;
  discountMinor: number;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  vatByRate: VatBucket[];
};

export type RecurringSubtotal = Subtotal & { interval: BillingInterval; intervalKey: string };

export type ScheduleKind = "DEPOSIT" | "BALANCE" | "INSTALMENT" | "FULL";

export type ScheduleItem = {
  seq: number;
  kind: ScheduleKind;
  due: DueRule;
  grossMinor: number;
  netMinor: number;
  vatMinor: number;
  /** This payment's share of each one-off VAT bucket; sums exactly. */
  vatByRate: VatBucket[];
};

export type MarginSummary = {
  /** Every priced (non-usage) line had a known cost. */
  complete: boolean;
  costMinor: number;
  netMinor: number;
  marginMinor: number;
  marginBps: number | null;
};

export type QuoteCalculation = {
  version: string;
  currency: string;
  vatRegistered: boolean;
  lines: CalculatedLine[];
  oneOff: Subtotal;
  recurring: RecurringSubtotal[];
  /** Usage lines at their estimated quantity; billed in arrears, not in totals. */
  usageEstimate: Subtotal;
  totals: {
    listMinor: number;
    discountMinor: number;
    /** One-off plus the first period of every recurring line. */
    netMinor: number;
    vatMinor: number;
    grossMinor: number;
  };
  depositMinor: number;
  firstPaymentMinor: number;
  schedule: ScheduleItem[];
  /** INTERNAL: over lines whose cost is known (usage excluded). */
  margin: MarginSummary;
  warnings: string[];
  calculationHash: string;
};

export type CalcIssue = { code: string; path: (string | number)[]; message: string };

export type CalculateQuoteResult = { ok: true; quote: QuoteCalculation } | { ok: false; issues: CalcIssue[] };

/* ---------------------------------------------------------- render model */

/**
 * The ONLY data the public page and the PDF render. Built by
 * render-model.ts from a whitelist, so internal cost, margin, notes and AI
 * reasoning cannot reach a customer even if a caller passes them in. The
 * SHA-256 of its canonical JSON is what an e-signature seals.
 */
export type QuoteRenderLine = {
  lineId: string;
  description: string;
  groupLabel: string | null;
  isAddOn: boolean;
  quantity: string;
  unit: string;
  unitPrice: string | null;
  listAmount: string;
  discount: string | null;
  netAmount: string;
  vatRate: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  billing: string;
};

export type QuoteRenderTotals = {
  label: string;
  net: string;
  vat: string | null;
  gross: string;
  vatByRate: { rate: string; net: string; vat: string }[] | null;
};

export type QuoteRenderModel = {
  schema: "clientturn.quote.render/1";
  quote: {
    number: string;
    revision: number;
    title: string;
    issuedOn: string;
    validUntil: string;
    currency: string;
  };
  seller: {
    name: string;
    legalName: string | null;
    address: string[];
    companyNumber: string | null;
    vatNumber: string | null;
    email: string | null;
    logoUrl: string | null;
  };
  buyer: { name: string; company: string | null; email: string | null; address: string[] };
  showVat: boolean;
  lines: QuoteRenderLine[];
  oneOff: QuoteRenderTotals | null;
  recurring: QuoteRenderTotals[];
  usage: { explanation: string; lines: string[] } | null;
  totalDiscount: string | null;
  deposit: string | null;
  firstPayment: string;
  schedule: { label: string; due: string; amount: string }[];
  terms: string;
  customerNote: string | null;
  vatNotice: string | null;
  poweredBy: boolean;
  calculationHash: string;
};
