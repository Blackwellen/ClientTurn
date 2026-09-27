/**
 * The priced catalogue (docs/revenue-engine/12 §4): `services` stays the
 * OFFER; catalogue items are the priced lines under it (FK `service_id`,
 * nullable for standalone add-ons); bundles group items. Prices live in
 * relational rows (docs/revenue-engine/13-quote-schema-draft.sql), never in
 * `services.offer_profile` jsonb.
 *
 * Money is integer minor units of the WORKSPACE currency (one currency per
 * workspace catalogue; a quote never mixes currencies). Percentages are
 * integer basis points. Pure: zod only.
 */

import { z } from "zod";
import { MAX_MINOR, MAX_QUANTITY } from "../quotes/money.ts";

/* ------------------------------------------------------------------- VAT */

/**
 * UK VAT treatment per item. ZERO, EXEMPT and OUTSIDE_SCOPE all carry 0 VAT
 * but are distinct on a VAT invoice and in the VAT return, so they are kept
 * apart (HMRC VAT Notice 700). Rates are data here so a future rate change
 * is one edit plus a new calculation version.
 */
export const VAT_RATE_CODES = ["STANDARD", "REDUCED", "ZERO", "EXEMPT", "OUTSIDE_SCOPE"] as const;
export type VatRateCode = (typeof VAT_RATE_CODES)[number];

export const VAT_RATE_BPS: Readonly<Record<VatRateCode, number>> = {
  STANDARD: 2000,
  REDUCED: 500,
  ZERO: 0,
  EXEMPT: 0,
  OUTSIDE_SCOPE: 0,
};

export const VAT_RATE_LABEL: Readonly<Record<VatRateCode, string>> = {
  STANDARD: "20%",
  REDUCED: "5%",
  ZERO: "0% (zero-rated)",
  EXEMPT: "Exempt",
  OUTSIDE_SCOPE: "Outside the scope of VAT",
};

/* ---------------------------------------------------------------- shared */

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const currencySchema = z.string().regex(CURRENCY_PATTERN, "Three-letter currency code, e.g. GBP");

export const minorSchema = z.number().int().min(0).max(MAX_MINOR);
export const bpsSchema = z.number().int().min(0).max(10_000);
/** A quantity: positive, at most three decimal places (7.5 hours). */
export const quantitySchema = z
  .number()
  .positive()
  .max(MAX_QUANTITY)
  .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "At most three decimal places");

export const idSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/, "Letters, numbers and _ . : - only");

export const CHARGE_TYPES = ["ONE_OFF", "RECURRING", "USAGE"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const INTERVAL_UNITS = ["WEEK", "MONTH", "QUARTER", "YEAR"] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

export const intervalSchema = z.object({
  unit: z.enum(INTERVAL_UNITS),
  count: z.number().int().min(1).max(12).default(1),
});
export type BillingInterval = z.infer<typeof intervalSchema>;

export function intervalKey(interval: BillingInterval): string {
  return `${interval.unit}:${interval.count}`;
}

/* ----------------------------------------------------------------- tiers */

/**
 * VOLUME: the whole quantity is priced at the tier it falls into.
 * GRADUATED: each band of the quantity is priced at its own tier.
 * `upTo` is inclusive and in whole-or-fractional units; the last tier has
 * `upTo: null` (no ceiling). `flatFeeMinor` is added once when the tier
 * applies (volume) or once per band reached (graduated), as Stripe does.
 */
export const TIER_MODES = ["VOLUME", "GRADUATED"] as const;
export type TierMode = (typeof TIER_MODES)[number];

export const priceTierSchema = z.object({
  upTo: quantitySchema.nullable(),
  unitPriceMinor: minorSchema,
  flatFeeMinor: minorSchema.default(0),
});
export type PriceTier = z.infer<typeof priceTierSchema>;

/* ----------------------------------------------------------------- items */

export const itemOptionSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  /** Added to the unit price for every unit (options never reduce a price). */
  unitPriceDeltaMinor: minorSchema.default(0),
  /** Added to the unit cost; absent while the item has a cost = cost unknown. */
  unitCostDeltaMinor: minorSchema.optional(),
});
export type ItemOption = z.infer<typeof itemOptionSchema>;

export const catalogueItemSchema = z
  .object({
    id: idSchema,
    sku: z.string().trim().max(64).optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    /** The offer (services row) this priced line belongs to; null for a standalone add-on. */
    serviceId: z.string().uuid().nullable().default(null),
    currency: currencySchema,
    chargeType: z.enum(CHARGE_TYPES),
    /** Required for RECURRING, forbidden otherwise. */
    interval: intervalSchema.optional(),
    /** Display unit: "hour", "seat", "project", "1,000 emails". */
    unit: z.string().trim().min(1).max(40),
    /** List price per unit (ignored when tiers are set). */
    unitPriceMinor: minorSchema,
    /** Internal cost per unit, for margin. Never customer-facing. */
    costPriceMinor: minorSchema.nullable().default(null),
    vatRate: z.enum(VAT_RATE_CODES),
    tierMode: z.enum(TIER_MODES).optional(),
    tiers: z.array(priceTierSchema).max(20).default([]),
    minQuantity: quantitySchema.optional(),
    maxQuantity: quantitySchema.optional(),
    options: z.array(itemOptionSchema).max(30).default([]),
    /** Catalogue items that may be attached to a line of this item as add-ons. */
    addOnItemIds: z.array(idSchema).max(30).default([]),
    /** Only sellable as an add-on under a parent line. */
    addOnOnly: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .superRefine((item, ctx) => {
    if (item.chargeType === "RECURRING" && !item.interval) {
      ctx.addIssue({ code: "custom", path: ["interval"], message: "A recurring item needs a billing interval." });
    }
    if (item.chargeType !== "RECURRING" && item.interval) {
      ctx.addIssue({ code: "custom", path: ["interval"], message: "Only recurring items have an interval." });
    }
    if (item.tierMode && item.tiers.length === 0) {
      ctx.addIssue({ code: "custom", path: ["tiers"], message: "Tiered pricing needs at least one tier." });
    }
    if (!item.tierMode && item.tiers.length > 0) {
      ctx.addIssue({ code: "custom", path: ["tierMode"], message: "Choose VOLUME or GRADUATED for tiers." });
    }
    item.tiers.forEach((tier, index) => {
      const last = index === item.tiers.length - 1;
      if (last && tier.upTo !== null) {
        ctx.addIssue({ code: "custom", path: ["tiers", index, "upTo"], message: "The last tier has no ceiling (upTo: null)." });
      }
      if (!last && tier.upTo === null) {
        ctx.addIssue({ code: "custom", path: ["tiers", index, "upTo"], message: "Only the last tier may be open-ended." });
      }
      const prev = index > 0 ? item.tiers[index - 1].upTo : 0;
      if (tier.upTo !== null && prev !== null && tier.upTo <= prev) {
        ctx.addIssue({ code: "custom", path: ["tiers", index, "upTo"], message: "Tier ceilings must increase." });
      }
    });
    if (item.minQuantity !== undefined && item.maxQuantity !== undefined && item.minQuantity > item.maxQuantity) {
      ctx.addIssue({ code: "custom", path: ["minQuantity"], message: "Minimum quantity is above the maximum." });
    }
    const optionIds = new Set<string>();
    item.options.forEach((option, index) => {
      if (optionIds.has(option.id)) {
        ctx.addIssue({ code: "custom", path: ["options", index, "id"], message: "Duplicate option id." });
      }
      optionIds.add(option.id);
    });
    if (item.addOnItemIds.includes(item.id)) {
      ctx.addIssue({ code: "custom", path: ["addOnItemIds"], message: "An item cannot be its own add-on." });
    }
  });
export type CatalogueItem = z.infer<typeof catalogueItemSchema>;
export type CatalogueItemInput = z.input<typeof catalogueItemSchema>;

/* --------------------------------------------------------------- bundles */

export const bundlePricingSchema = z.discriminatedUnion("type", [
  /** The bundle sells for exactly this (per bundle), whatever its parts list at. */
  z.object({ type: z.literal("FIXED"), priceMinor: minorSchema }),
  /** The bundle sells for its parts' list total less this percentage. */
  z.object({ type: z.literal("PERCENT_OFF"), bps: z.number().int().min(1).max(10_000) }),
]);
export type BundlePricing = z.infer<typeof bundlePricingSchema>;

export const catalogueBundleSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  currency: currencySchema,
  components: z
    .array(z.object({ itemId: idSchema, quantity: quantitySchema }))
    .min(1)
    .max(30),
  pricing: bundlePricingSchema,
  active: z.boolean().default(true),
});
export type CatalogueBundle = z.infer<typeof catalogueBundleSchema>;
export type CatalogueBundleInput = z.input<typeof catalogueBundleSchema>;

/* ------------------------------------------------------------- catalogue */

export const catalogueSchema = z.object({
  /** The workspace currency (quote_settings.currency). */
  currency: currencySchema,
  items: z.array(catalogueItemSchema).max(2000),
  bundles: z.array(catalogueBundleSchema).max(500).default([]),
});
export type Catalogue = z.infer<typeof catalogueSchema>;
export type CatalogueInput = z.input<typeof catalogueSchema>;

export type CatalogueIssue = { code: string; path: (string | number)[]; message: string };
