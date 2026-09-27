/**
 * Catalogue rows (0152) <-> the catalogue model calculate.ts prices from.
 * Pure. The row `key` is the model's `id` (the stable id quotes and AI tools
 * refer to); the row uuid never leaves the server.
 *
 * `costPriceMinor` and option cost deltas are INTERNAL. `toPublicItem`
 * strips them for anyone who is not an owner or admin (the browser roles
 * cannot even select those columns; the service role can, so the operation
 * strips them by role).
 */

import type { CatalogueBundle, CatalogueItem, ItemOption, PriceTier } from "./types.ts";

export type CatalogueItemRow = {
  id: string;
  key: string;
  service_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  currency: string;
  charge_type: string;
  interval_unit: string | null;
  interval_count: number | null;
  unit: string;
  unit_price_minor: number | string;
  cost_price_minor?: number | string | null;
  vat_rate: string;
  tier_mode: string | null;
  min_quantity: number | string | null;
  max_quantity: number | string | null;
  options?: unknown;
  add_on_item_keys: string[] | null;
  add_on_only: boolean;
  checkout_link_id: string | null;
  active: boolean;
  archived_at: string | null;
};

export type PriceTierRow = {
  item_id: string;
  position: number;
  up_to: number | string | null;
  unit_price_minor: number | string;
  flat_fee_minor: number | string;
};

export type BundleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  currency: string;
  pricing_type: string;
  fixed_price_minor: number | string | null;
  percent_off_bps: number | null;
  active: boolean;
};

export type BundleItemRow = { bundle_id: string; item_id: string; position: number; quantity: number | string };

const num = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

function optionsOf(raw: unknown): ItemOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id ?? ""),
      name: String(entry.name ?? ""),
      unitPriceDeltaMinor: Number(entry.unitPriceDeltaMinor ?? 0),
      ...(entry.unitCostDeltaMinor === undefined || entry.unitCostDeltaMinor === null
        ? {}
        : { unitCostDeltaMinor: Number(entry.unitCostDeltaMinor) }),
    }));
}

export function itemFromRow(row: CatalogueItemRow, tiers: readonly PriceTierRow[] = []): CatalogueItem {
  const own = tiers.filter((tier) => tier.item_id === row.id).sort((a, b) => a.position - b.position);
  const priceTiers: PriceTier[] = own.map((tier) => ({
    upTo: num(tier.up_to),
    unitPriceMinor: Number(tier.unit_price_minor),
    flatFeeMinor: Number(tier.flat_fee_minor ?? 0),
  }));
  const min = num(row.min_quantity);
  const max = num(row.max_quantity);
  return {
    id: row.key,
    ...(row.sku ? { sku: row.sku } : {}),
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    serviceId: row.service_id,
    currency: row.currency,
    chargeType: row.charge_type as CatalogueItem["chargeType"],
    ...(row.charge_type === "RECURRING" && row.interval_unit
      ? { interval: { unit: row.interval_unit as "WEEK" | "MONTH" | "QUARTER" | "YEAR", count: row.interval_count ?? 1 } }
      : {}),
    unit: row.unit,
    unitPriceMinor: Number(row.unit_price_minor),
    costPriceMinor: num(row.cost_price_minor ?? null),
    vatRate: row.vat_rate as CatalogueItem["vatRate"],
    ...(row.tier_mode && priceTiers.length > 0 ? { tierMode: row.tier_mode as "VOLUME" | "GRADUATED" } : {}),
    tiers: row.tier_mode ? priceTiers : [],
    ...(min !== null ? { minQuantity: min } : {}),
    ...(max !== null ? { maxQuantity: max } : {}),
    options: optionsOf(row.options),
    addOnItemIds: row.add_on_item_keys ?? [],
    addOnOnly: row.add_on_only,
    active: row.active && !row.archived_at,
  };
}

export function bundleFromRows(
  row: BundleRow,
  components: readonly BundleItemRow[],
  itemKeyById: ReadonlyMap<string, string>,
): CatalogueBundle | null {
  const parts = components
    .filter((component) => component.bundle_id === row.id)
    .sort((a, b) => a.position - b.position)
    .map((component) => ({ itemId: itemKeyById.get(component.item_id) ?? "", quantity: Number(component.quantity) }));
  if (parts.length === 0 || parts.some((part) => !part.itemId)) return null;
  return {
    id: row.key,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    currency: row.currency,
    components: parts,
    pricing:
      row.pricing_type === "FIXED"
        ? { type: "FIXED", priceMinor: Number(row.fixed_price_minor ?? 0) }
        : { type: "PERCENT_OFF", bps: Number(row.percent_off_bps ?? 0) },
    active: row.active,
  };
}

/** The 0152 row for an item (tiers go to catalogue_price_tiers). */
export function rowFromItem(item: CatalogueItem, businessId: string, checkoutLinkId: string | null = null) {
  return {
    business_id: businessId,
    service_id: item.serviceId,
    key: item.id,
    sku: item.sku ?? null,
    name: item.name,
    description: item.description ?? null,
    currency: item.currency,
    charge_type: item.chargeType,
    interval_unit: item.interval?.unit ?? null,
    interval_count: item.interval?.count ?? null,
    unit: item.unit,
    unit_price_minor: item.unitPriceMinor,
    cost_price_minor: item.costPriceMinor,
    vat_rate: item.vatRate,
    tier_mode: item.tierMode ?? null,
    min_quantity: item.minQuantity ?? null,
    max_quantity: item.maxQuantity ?? null,
    options: item.options,
    add_on_item_keys: item.addOnItemIds,
    add_on_only: item.addOnOnly,
    checkout_link_id: checkoutLinkId,
    active: item.active,
    archived_at: item.active ? null : undefined,
  };
}

/** Strip the internal cost figures for a caller who may not see margin. */
export function toPublicItem(item: CatalogueItem): CatalogueItem {
  return {
    ...item,
    costPriceMinor: null,
    options: item.options.map((option) => ({ id: option.id, name: option.name, unitPriceDeltaMinor: option.unitPriceDeltaMinor })),
  };
}
