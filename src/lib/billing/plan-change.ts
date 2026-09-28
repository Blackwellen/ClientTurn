/**
 * Moving a live subscription between self-serve tiers: the pure decisions.
 *
 * Terms §6.3 and the pricing FAQ promise:
 *
 *   * an upgrade takes effect immediately and the difference is charged pro
 *     rata for the rest of the current term;
 *   * a downgrade takes effect from the next renewal date, with no refund for
 *     the current term -- the customer keeps what they paid for.
 *
 * The Stripe I/O lives in `checkout.ts` (server-only). Everything that decides
 * *what* to ask Stripe for lives here, so it can be tested without Stripe.
 *
 * Mechanism for a downgrade: a Subscription Schedule attached to the live
 * subscription, with the current phase left untouched until
 * `current_period_end` and a second phase on the lower price after it. When
 * the second phase starts Stripe changes the subscription's price itself and
 * sends `customer.subscription.updated`, which the webhook already mirrors
 * onto `subscriptions` (plan + entitlement snapshot). `end_behavior:
 * "release"` hands the subscription back as an ordinary one afterwards.
 */

import type { PlanId } from "./plans";

export type BillingInterval = "month" | "year";
export type SelfServePlan = "starter" | "growth" | "pro";

/** Position on the ladder. Unknown plans rank -1 so they never count as an upgrade target. */
const RANK: Record<PlanId, number> = {
  trial: 0,
  starter: 1,
  growth: 2,
  pro: 3,
  enterprise: 4,
};

export function planRank(plan: string): number {
  return plan in RANK ? RANK[plan as PlanId] : -1;
}

/** The self-serve tier directly below, for the in-app downgrade. */
export function previousSelfServePlan(plan: string): SelfServePlan | null {
  if (plan === "pro") return "growth";
  if (plan === "growth") return "starter";
  return null;
}

export type PlanChangeDirection = "same" | "upgrade" | "downgrade";

export function planChangeDirection(current: string, target: string): PlanChangeDirection {
  const from = planRank(current);
  const to = planRank(target);
  if (from === to) return "same";
  return to > from ? "upgrade" : "downgrade";
}

/**
 * The interval a plan change is priced on. A live subscription keeps the
 * interval it already has -- an in-app upgrade used to hard-code "month" and
 * moved annual customers onto monthly billing. With no live subscription the
 * caller's choice is used, then the last known interval, then monthly.
 */
export function resolvePlanInterval(input: {
  liveInterval?: string | null;
  requested?: string | null;
  storedInterval?: string | null;
}): BillingInterval {
  for (const candidate of [input.liveInterval, input.requested, input.storedInterval]) {
    if (candidate === "month" || candidate === "year") return candidate;
  }
  return "month";
}

export type PlanChangeDecision =
  | { kind: "noop" }
  /** Swap the price on the subscription now. */
  | {
      kind: "immediate";
      reason: "upgrade" | "trial";
      prorationBehavior: "create_prorations" | "none";
    }
  /** Keep the current price until `effectiveAt` (unix seconds), then switch. */
  | { kind: "scheduled"; effectiveAt: number };

/**
 * What to do with a requested plan change.
 *
 *   * same tier                       -> nothing
 *   * during a trial, either way      -> immediate, no prorations: nothing
 *                                        has been charged yet, and the trial's
 *                                        own limits apply until it converts,
 *                                        so the first invoice is simply at the
 *                                        new tier
 *   * upgrade                         -> immediate, prorated
 *   * downgrade                       -> scheduled for the period end
 *
 * A downgrade with no known period end cannot be scheduled honestly, so it is
 * refused (`null`) rather than silently applied now.
 */
export function decidePlanChange(input: {
  currentPlan: string;
  targetPlan: string;
  trialing: boolean;
  currentPeriodEnd: number | null;
}): PlanChangeDecision | null {
  const direction = planChangeDirection(input.currentPlan, input.targetPlan);
  if (direction === "same") return { kind: "noop" };
  if (input.trialing) return { kind: "immediate", reason: "trial", prorationBehavior: "none" };
  if (direction === "upgrade") {
    return { kind: "immediate", reason: "upgrade", prorationBehavior: "create_prorations" };
  }
  if (!input.currentPeriodEnd) return null;
  return { kind: "scheduled", effectiveAt: input.currentPeriodEnd };
}

/**
 * The two phases written to the schedule for a downgrade. The current phase
 * is restated exactly (Stripe requires it) and ends at the period end; the
 * second phase is the lower price for one billing interval, after which the
 * schedule releases and the subscription renews on that price as normal.
 * No prorations: nothing is credited or charged for the switch itself.
 * `business_id` is carried on each phase so the subscription's metadata --
 * which the webhook uses to find the workspace -- survives the transition.
 */
/**
 * The subscription's other items across a scheduled downgrade (OD-2). A
 * schedule phase lists EVERY item it keeps, so an item left out is removed
 * at the phase change. The Starter/Growth dedicated-number item (and any
 * other non-plan item) carries into the new plan; only the Pro £100 voice
 * item goes when the target is not Pro (the customer is offered packs plus
 * the £11.99 number instead). Minute packs are prepaid balance, not items,
 * so they are untouched.
 */
export function carriedItems(input: {
  items: readonly { id: string; priceId: string | null; quantity: number | null }[];
  planItemId: string;
  proVoicePriceId: string | null;
  targetPlan: string;
}): { current: { price: string; quantity: number }[]; target: { price: string; quantity: number }[]; droppedProVoice: boolean } {
  const current: { price: string; quantity: number }[] = [];
  const target: { price: string; quantity: number }[] = [];
  let droppedProVoice = false;
  for (const item of input.items) {
    if (item.id === input.planItemId || !item.priceId) continue;
    const entry = { price: item.priceId, quantity: item.quantity ?? 1 };
    current.push(entry);
    const isProVoice = input.proVoicePriceId !== null && item.priceId === input.proVoicePriceId;
    if (isProVoice && input.targetPlan !== "pro") droppedProVoice = true;
    else target.push(entry);
  }
  return { current, target, droppedProVoice };
}

export function downgradeSchedulePhases(input: {
  currentPriceId: string;
  targetPriceId: string;
  quantity: number;
  currentPhaseStart: number;
  currentPeriodEnd: number;
  interval: BillingInterval;
  businessId: string;
  /** Non-plan items (carriedItems): kept now, and in the new plan unless dropped. */
  otherItems?: { current: { price: string; quantity: number }[]; target: { price: string; quantity: number }[] };
}) {
  const metadata = { business_id: input.businessId };
  return {
    end_behavior: "release" as const,
    proration_behavior: "none" as const,
    phases: [
      {
        items: [{ price: input.currentPriceId, quantity: input.quantity }, ...(input.otherItems?.current ?? [])],
        start_date: input.currentPhaseStart,
        end_date: input.currentPeriodEnd,
        proration_behavior: "none" as const,
        metadata,
      },
      {
        items: [{ price: input.targetPriceId, quantity: input.quantity }, ...(input.otherItems?.target ?? [])],
        start_date: input.currentPeriodEnd,
        duration: { interval: input.interval, interval_count: 1 },
        proration_behavior: "none" as const,
        metadata,
      },
    ],
  };
}

/** A scheduled change as the billing page shows it. */
export type PendingPlanChange = { plan: string; effectiveAt: string };

type ScheduleLike = {
  status?: string | null;
  phases?: Array<{
    start_date: number;
    items?: Array<{ price?: string | { id?: string } | null }>;
  }> | null;
};

/**
 * The next phase of a live schedule, if it moves to a different plan.
 * `planForPrice` maps a Stripe price id to a plan key (server-side env).
 */
export function pendingChangeFromSchedule(
  schedule: ScheduleLike | null | undefined,
  currentPlan: string,
  nowUnix: number,
  planForPrice: (priceId: string | null) => string,
): PendingPlanChange | null {
  if (!schedule || (schedule.status !== "active" && schedule.status !== "not_started")) return null;
  const next = (schedule.phases ?? [])
    .filter((phase) => phase.start_date > nowUnix)
    .sort((a, b) => a.start_date - b.start_date)[0];
  if (!next) return null;
  const raw = next.items?.[0]?.price;
  const priceId = typeof raw === "string" ? raw : (raw?.id ?? null);
  const plan = planForPrice(priceId);
  if (plan === currentPlan || plan === "trial") return null;
  return { plan, effectiveAt: new Date(next.start_date * 1000).toISOString() };
}
