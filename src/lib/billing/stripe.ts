import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { PLANS, TRIAL_ENTITLEMENTS, type PlanId } from "./plans";

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

/** The entitlement snapshot written alongside the mirrored Stripe state. */
export function entitlementsForPlan(plan: PlanId) {
  if (plan === "trial") {
    return {
      lead_limit: TRIAL_ENTITLEMENTS.leadLimit,
      user_limit: TRIAL_ENTITLEMENTS.userLimit,
      whatsapp_enabled: TRIAL_ENTITLEMENTS.whatsappEnabled,
      campaigns_enabled: TRIAL_ENTITLEMENTS.campaignsEnabled,
      ai_assist_allowed: TRIAL_ENTITLEMENTS.aiAssistAllowed,
    };
  }

  const definition = PLANS[plan];
  return {
    lead_limit: definition.leadLimit,
    user_limit: definition.userLimit,
    whatsapp_enabled: definition.whatsappEnabled,
    campaigns_enabled: definition.campaignsEnabled,
    ai_assist_allowed: definition.aiAssistAllowed,
  };
}
