import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import type { PlanId } from "./plans";
import { entitlementSnapshot } from "./lifecycle";

export const stripe = new Stripe(serverEnv.stripe.secretKey);

export function priceIdFor(plan: PlanId, interval: "month" | "year") {
  if (plan === "trial" || plan === "enterprise") return null;
  return serverEnv.stripe.prices[plan]?.[interval] ?? null;
}

export function planForPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "trial";
  for (const plan of ["starter", "growth", "pro"] as const) {
    const prices = serverEnv.stripe.prices[plan];
    if (prices.month === priceId || prices.year === priceId) return plan;
  }
  return "trial";
}

const STATUS_MAP: Record<string, string> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELLED",
  unpaid: "UNPAID",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELLED",
  paused: "CANCELLED",
};

export function mapSubscriptionStatus(status: string): string {
  return STATUS_MAP[status] ?? "INCOMPLETE";
}

/**
 * The entitlement snapshot written alongside the mirrored Stripe state. While
 * the subscription is trialling it is the trial's (see `TRIAL` in plans.ts),
 * whatever tier was chosen at checkout.
 */
export function entitlementsForPlan(plan: PlanId, trialing = false) {
  return entitlementSnapshot(plan, trialing);
}
