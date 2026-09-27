/**
 * List pricing of one catalogue item at a quantity: flat, VOLUME or
 * GRADUATED tiers, plus per-unit option deltas. Integer minor units; each
 * extension (unit price x fractional quantity) is rounded half up to the
 * minor unit, and for GRADUATED tiers each band is extended and rounded on
 * its own (the Stripe convention), so a band total never depends on another.
 *
 * Only `quotes/calculate.ts` (and catalogue validation) call this: it is
 * part of the one place prices are computed.
 */

import { extend, toMilli } from "../quotes/money.ts";
import type { CatalogueItem, ItemOption } from "./types.ts";

export type ListPrice = {
  /** Total list amount for the quantity, before any discount. */
  amountMinor: number;
  /** The unit price that applied, or null when graduated bands mixed prices. */
  unitPriceMinor: number | null;
  /** Index of the tier used (VOLUME) or the highest band reached (GRADUATED). */
  tierIndex: number | null;
};

export function optionDeltaMinor(options: readonly ItemOption[]): number {
  return options.reduce((sum, option) => sum + option.unitPriceDeltaMinor, 0);
}

export function listPrice(item: CatalogueItem, quantityMilli: number, options: readonly ItemOption[] = []): ListPrice {
  const delta = optionDeltaMinor(options);
  if (!item.tierMode || item.tiers.length === 0) {
    const unit = item.unitPriceMinor + delta;
    return { amountMinor: extend(unit, quantityMilli), unitPriceMinor: unit, tierIndex: null };
  }

  if (item.tierMode === "VOLUME") {
    const index = item.tiers.findIndex((tier) => tier.upTo === null || quantityMilli <= toMilli(tier.upTo));
    const tier = item.tiers[index];
    const unit = tier.unitPriceMinor + delta;
    return { amountMinor: extend(unit, quantityMilli) + tier.flatFeeMinor, unitPriceMinor: unit, tierIndex: index };
  }

  // GRADUATED
  let amount = 0;
  let previousCeiling = 0;
  let reached = 0;
  for (let index = 0; index < item.tiers.length; index += 1) {
    const tier = item.tiers[index];
    const ceiling = tier.upTo === null ? Number.POSITIVE_INFINITY : toMilli(tier.upTo);
    const band = Math.min(quantityMilli, ceiling) - previousCeiling;
    if (band <= 0) break;
    amount += extend(tier.unitPriceMinor, band) + tier.flatFeeMinor;
    reached = index;
    previousCeiling = ceiling;
    if (quantityMilli <= ceiling) break;
  }
  amount += extend(delta, quantityMilli);
  const single = reached === 0 ? item.tiers[0].unitPriceMinor + delta : null;
  return { amountMinor: amount, unitPriceMinor: single, tierIndex: reached };
}

/** Internal cost of a quantity, or null when any part of the cost is unknown. */
export function costAmount(item: CatalogueItem, quantityMilli: number, options: readonly ItemOption[] = []): number | null {
  if (item.costPriceMinor === null) return null;
  let unitCost = item.costPriceMinor;
  for (const option of options) {
    if (option.unitCostDeltaMinor === undefined) {
      if (option.unitPriceDeltaMinor > 0) return null;
      continue;
    }
    unitCost += option.unitCostDeltaMinor;
  }
  return extend(unitCost, quantityMilli);
}
