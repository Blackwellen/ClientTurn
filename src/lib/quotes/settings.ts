/**
 * Settings -> Quotes & invoices: the workspace's `quote_settings` row (0152,
 * plus the two 0156 columns) and its document-number prefixes
 * (`document_counters`, server-only), as one validated shape.
 *
 * Pure: zod and relative imports only. The server action, the service
 * operation `quote_settings.update` and the settings form all use this one
 * schema, so a value the quote engine would refuse can never be saved.
 *
 * RBAC: pricing and legal settings (VAT, legal identity, terms, deposit,
 * approval thresholds, numbering) are owner/admin only. That is enforced by
 * the operation's `minimumRole` (re-checked per call by the service runtime)
 * and mirrored here by `canEditQuoteSettings` for the read-only UI.
 */

import { z } from "zod";
import { CURRENCY_PATTERN } from "../catalogue/types.ts";
import { DEFAULT_REMINDER_OFFSETS } from "../invoicing/reminders.ts";
import { PREFIX_PATTERN, DEFAULT_CREDIT_NOTE_PREFIX, DEFAULT_INVOICE_PREFIX } from "../invoicing/numbering.ts";
import { isValidUkVatNumber, normaliseVatNumber } from "../invoicing/vat-invoice.ts";
import { DEFAULT_DISCOUNT_POLICY, discountPolicySchema, type DiscountPolicy } from "./discount-policy.ts";

export const DEFAULT_QUOTE_PREFIX = "Q-";

export type QuoteSettings = {
  currency: string;
  vatRegistered: boolean;
  vatNumber: string | null;
  legalName: string | null;
  companyNumber: string | null;
  addressLines: string[];
  validityDays: number;
  paymentTermsDays: number;
  /** Default deposit on a new quote, basis points of the one-off total; null = none. */
  defaultDepositBps: number | null;
  termsText: string;
  /** Invoice reminder offsets in days relative to the due date. */
  reminderOffsets: number[];
  discountPolicy: DiscountPolicy;
  /** 0156: ask the customer for a drawn signature as well as the typed name. */
  requireDrawnSignature: boolean;
  /** 0156: remind a customer who has not opened / accepted a sent quote. */
  quoteNudgesEnabled: boolean;
  prefixes: { quote: string; invoice: string; creditNote: string };
};

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  currency: "GBP",
  vatRegistered: false,
  vatNumber: null,
  legalName: null,
  companyNumber: null,
  addressLines: [],
  validityDays: 30,
  paymentTermsDays: 14,
  defaultDepositBps: null,
  termsText: "",
  reminderOffsets: [...DEFAULT_REMINDER_OFFSETS],
  discountPolicy: DEFAULT_DISCOUNT_POLICY,
  requireDrawnSignature: false,
  quoteNudgesEnabled: true,
  prefixes: { quote: DEFAULT_QUOTE_PREFIX, invoice: DEFAULT_INVOICE_PREFIX, creditNote: DEFAULT_CREDIT_NOTE_PREFIX },
};

const prefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PREFIX_PATTERN, "Up to 16 capital letters, numbers, / or -, starting with a letter or number");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));

export const quoteSettingsInputSchema = z
  .object({
    currency: z.string().trim().toUpperCase().regex(CURRENCY_PATTERN, "Three-letter currency code, e.g. GBP").default("GBP"),
    vatRegistered: z.boolean(),
    vatNumber: optionalText(20),
    legalName: optionalText(200),
    companyNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{8}$/, "A Companies House number is 8 characters, e.g. 01234567")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    addressLines: z.array(z.string().trim().max(120)).max(6).default([]),
    validityDays: z.number().int().min(1).max(365),
    paymentTermsDays: z.number().int().min(0).max(120),
    defaultDepositBps: z.number().int().min(1).max(10_000).nullable(),
    termsText: z.string().max(20_000).default(""),
    reminderOffsets: z.array(z.number().int().min(-30).max(90)).max(10).default([...DEFAULT_REMINDER_OFFSETS]),
    discountPolicy: discountPolicySchema.default(DEFAULT_DISCOUNT_POLICY),
    requireDrawnSignature: z.boolean().default(false),
    quoteNudgesEnabled: z.boolean().default(true),
    prefixes: z
      .object({ quote: prefixSchema, invoice: prefixSchema, creditNote: prefixSchema })
      .default({ ...DEFAULT_QUOTE_SETTINGS.prefixes }),
  })
  .transform((value) => ({
    ...value,
    vatNumber: value.vatNumber ? normaliseVatNumber(value.vatNumber) : null,
    companyNumber: value.companyNumber ?? null,
    addressLines: value.addressLines.filter((line) => line.length > 0),
    reminderOffsets: [...new Set(value.reminderOffsets)].sort((a, b) => a - b),
  }))
  .superRefine((value, ctx) => {
    if (value.vatRegistered && !value.vatNumber) {
      ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "A VAT-registered business must give its VAT number." });
    }
    if (value.vatNumber && !isValidUkVatNumber(value.vatNumber)) {
      ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "That is not a UK VAT number (GB followed by 9 or 12 digits)." });
    }
    if (!value.vatRegistered && value.vatNumber) {
      ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "Only a VAT-registered business shows a VAT number." });
    }
    const prefixes = [value.prefixes.quote, value.prefixes.invoice, value.prefixes.creditNote];
    if (new Set(prefixes).size !== prefixes.length) {
      ctx.addIssue({ code: "custom", path: ["prefixes"], message: "Quotes, invoices and credit notes need different prefixes." });
    }
  });
export type QuoteSettingsInput = z.input<typeof quoteSettingsInputSchema>;

/** Pricing and legal settings: owner or admin. */
export function canEditQuoteSettings(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** The catalogue (prices, cost, VAT class): owner or admin. */
export function canEditCatalogue(role: string): boolean {
  return canEditQuoteSettings(role);
}

/** Members build, edit and send quotes; viewers only read them. */
export function canWorkQuotes(role: string): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

/* ------------------------------------------------------------ DB mapping */

export type QuoteSettingsRow = {
  currency?: string | null;
  vat_registered?: boolean | null;
  vat_number?: string | null;
  legal_name?: string | null;
  company_number?: string | null;
  address_lines?: string[] | null;
  validity_days?: number | null;
  payment_terms_days?: number | null;
  default_deposit_bps?: number | null;
  terms_text?: string | null;
  reminder_offsets?: number[] | null;
  discount_policy?: unknown;
  require_drawn_signature?: boolean | null;
  quote_nudges_enabled?: boolean | null;
};

export type CounterRow = { kind: string; prefix: string };

/** A stored row read defensively: a missing row or column is the default. */
export function settingsFromRow(row: QuoteSettingsRow | null, counters: readonly CounterRow[] = []): QuoteSettings {
  const d = DEFAULT_QUOTE_SETTINGS;
  const policy = discountPolicySchema.safeParse(row?.discount_policy ?? {});
  const prefix = (kind: string, fallback: string) => counters.find((c) => c.kind === kind)?.prefix ?? fallback;
  return {
    currency: row?.currency ?? d.currency,
    vatRegistered: row?.vat_registered ?? d.vatRegistered,
    vatNumber: row?.vat_number ?? null,
    legalName: row?.legal_name ?? null,
    companyNumber: row?.company_number ?? null,
    addressLines: row?.address_lines ?? [],
    validityDays: row?.validity_days ?? d.validityDays,
    paymentTermsDays: row?.payment_terms_days ?? d.paymentTermsDays,
    defaultDepositBps: row?.default_deposit_bps ?? null,
    termsText: row?.terms_text ?? "",
    reminderOffsets: row?.reminder_offsets ?? [...d.reminderOffsets],
    discountPolicy: policy.success ? policy.data : DEFAULT_DISCOUNT_POLICY,
    requireDrawnSignature: row?.require_drawn_signature ?? d.requireDrawnSignature,
    quoteNudgesEnabled: row?.quote_nudges_enabled ?? d.quoteNudgesEnabled,
    prefixes: {
      quote: prefix("QUOTE", d.prefixes.quote),
      invoice: prefix("INVOICE", d.prefixes.invoice),
      creditNote: prefix("CREDIT_NOTE", d.prefixes.creditNote),
    },
  };
}

/** The 0152 columns (always present). */
export function baseRowFromSettings(settings: QuoteSettings) {
  return {
    currency: settings.currency,
    vat_registered: settings.vatRegistered,
    vat_number: settings.vatRegistered ? settings.vatNumber : null,
    legal_name: settings.legalName,
    company_number: settings.companyNumber,
    address_lines: settings.addressLines,
    validity_days: settings.validityDays,
    payment_terms_days: settings.paymentTermsDays,
    default_deposit_bps: settings.defaultDepositBps,
    terms_text: settings.termsText,
    reminder_offsets: settings.reminderOffsets,
    discount_policy: settings.discountPolicy,
  };
}

/** The 0156 columns: written separately so a database behind the code still saves the rest. */
export function extendedRowFromSettings(settings: QuoteSettings) {
  return {
    require_drawn_signature: settings.requireDrawnSignature,
    quote_nudges_enabled: settings.quoteNudgesEnabled,
  };
}

/** Readiness for issuing a VAT-correct document: what is missing, in words. */
export function settingsGaps(settings: QuoteSettings, businessName: string): string[] {
  const gaps: string[] = [];
  if (!businessName.trim()) gaps.push("Your business name");
  if (settings.addressLines.length === 0) gaps.push("Your business address");
  if (settings.vatRegistered && !settings.vatNumber) gaps.push("Your VAT number");
  if (!settings.termsText.trim()) gaps.push("Your quote terms");
  return gaps;
}
