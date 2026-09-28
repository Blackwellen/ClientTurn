/**
 * Monthly recurring revenue per subscription, for Admin (gap audit 15 §6:
 * "Admin MRR uses list prices"). Pure.
 *
 * The real figure is `subscriptions.mrr_minor`, written from each paid
 * full-period Stripe invoice (invoice-ledger.ts): after coupons, discounts
 * and grandfathered prices, before VAT, annual / 12, and including any
 * add-on items on the subscription (the Pro voice item, the number). Only
 * where no paid invoice has been recorded yet (a subscription from before
 * 0165, or one still on its first period) does it fall back to the plan's
 * list price, and it says which it used.
 */

import { PLANS, type PlanId } from "./plans.ts";

export type MrrSource = "stripe_invoice" | "list_price" | "none";

export function listMonthlyPrice(plan: string, interval: string | null): number {
  if (plan === "trial") return 0;
  const definition = PLANS[plan as Exclude<PlanId, "trial">];
  if (!definition || definition.monthlyPrice === null) return 0;
  if (interval === "year") return definition.yearlyPrice ? definition.yearlyPrice / 12 : 0;
  return definition.monthlyPrice;
}

/** Pounds a month, and where the number came from. */
export function monthlyRevenue(input: { mrrMinor: number | string | null | undefined; plan: string; interval: string | null }): {
  gbp: number;
  source: MrrSource;
} {
  if (input.mrrMinor !== null && input.mrrMinor !== undefined && Number.isFinite(Number(input.mrrMinor))) {
    return { gbp: Number(input.mrrMinor) / 100, source: "stripe_invoice" };
  }
  const list = listMonthlyPrice(input.plan, input.interval);
  return list > 0 ? { gbp: list, source: "list_price" } : { gbp: 0, source: "none" };
}
