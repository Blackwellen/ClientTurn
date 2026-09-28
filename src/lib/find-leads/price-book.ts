/**
 * `provider_price_book` rows -> Find Leads unit costs, in pence per call.
 *
 * Pure, so `tests/entitlement-holes.test.ts` checks it with a USD row and no
 * database. `server/budget.ts` `loadUnitCosts()` reads the rows and calls this.
 *
 * Two defects this replaces (docs/economics.md §6.5 item 4, gap audit 15 §9):
 *
 *   1. The rows were matched on `product` ("company_lookup", "contact_profile",
 *      ...) against capability names ("COMPANY_SEARCH", ...), so nothing ever
 *      matched and every run was estimated from the hard-coded fallbacks. The
 *      capability lives in its own `capability` column (migration 0038).
 *   2. `unit_cost` is in the row's `currency` (almost always USD) and was
 *      multiplied by 100 and read as pence, so $0.08 became 8p rather than
 *      about 6p. It is now converted at the model rate (`USD_TO_GBP_MODEL`,
 *      unit-costs.ts, the rate every other cost figure uses).
 *
 * A row in a currency with no known rate is skipped (the fallback applies)
 * rather than guessed.
 */

import { CAPABILITIES, type Capability, type UnitCosts } from "./cost-model.ts";

export type PriceBookRow = {
  capability: string | null;
  currency: string | null;
  unit_cost: number | string | null;
  effective_from: string | null;
  effective_to: string | null;
};

/** Pence per unit of each currency, at the model rate. */
export function penceRateFor(currency: string | null | undefined, usdToGbp: number): number | null {
  switch ((currency ?? "USD").toUpperCase()) {
    case "GBP":
      return 100;
    case "USD":
      return usdToGbp * 100;
    default:
      return null;
  }
}

/** Rounded UP to 4 decimal places: an estimate must never under-state cost. */
function ceil4(value: number): number {
  return Math.ceil(value * 10_000 - 1e-9) / 10_000;
}

/**
 * The live unit cost per capability. Rows may arrive in any order: the one
 * with the latest `effective_from` that has started and not ended wins.
 */
export function unitCostsFromPriceBook(rows: readonly PriceBookRow[], opts: { now: Date; usdToGbp: number }): UnitCosts {
  const best = new Map<Capability, { from: number; pence: number }>();
  const now = opts.now.getTime();
  for (const row of rows) {
    const capability = row.capability as Capability | null;
    if (!capability || !CAPABILITIES.includes(capability)) continue;
    const from = row.effective_from ? new Date(row.effective_from).getTime() : 0;
    if (Number.isNaN(from) || from > now) continue;
    if (row.effective_to && new Date(row.effective_to).getTime() <= now) continue;
    const rate = penceRateFor(row.currency, opts.usdToGbp);
    const cost = Number(row.unit_cost);
    if (rate === null || !Number.isFinite(cost) || cost < 0) continue;
    const current = best.get(capability);
    if (current && current.from >= from) continue;
    best.set(capability, { from, pence: ceil4(cost * rate) });
  }
  const out: UnitCosts = {};
  for (const [capability, value] of best) out[capability] = value.pence;
  return out;
}
