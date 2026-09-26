/**
 * Metered limits: consumption order, daily caps, the overage spend cap and the
 * thresholds upsells fire at (Phase 8.9, 8.11, 8.13).
 *
 * Pure -- no `server-only`, no Supabase -- so the send-time gate, the meter,
 * the Usage & limits view and the unit tests all compute the same answer.
 *
 * ## Consumption order (every metered channel)
 *
 *   1. the plan's monthly allowance
 *   2. purchased top-up credit (never expires; it was paid for)
 *   3. overage -- only if the workspace switched it on, only on a plan that
 *      prices it, and only while the month's overage spend stays within the
 *      cap the workspace set
 *   4. otherwise the send is refused, with the reason on the message
 *
 * A message is never split across "allowed" and "refused": either all of its
 * units are covered by 1-3 or it does not go.
 */

import {
  MESSAGE_CREDIT_BUNDLES,
  PLANS,
  nextPlanFor,
  type MessageCreditBundle,
  type MessageCreditChannel,
  type PlanDefinition,
} from "./plans.ts";

export type OverageSettings = {
  enabled: boolean;
  /** Monthly cap the workspace set, in pence. */
  capMinor: number;
  /** Overage already incurred this period, in pence. */
  spentMinor: number;
  /** This plan's price per unit past the allowance, in pence; null = none. */
  unitPricePence: number | null;
};

export type ConsumptionSplit = {
  quantity: number;
  fromAllowance: number;
  fromCredits: number;
  fromOverage: number;
  /** Pence the overage portion costs (rounded up). */
  overageMinor: number;
  allowed: boolean;
  /** Why it was refused, when it was. */
  refusal: "LIMIT_REACHED" | "OVERAGE_CAP_REACHED" | null;
};

export function overageCostMinor(units: number, unitPricePence: number): number {
  if (units <= 0) return 0;
  // Rounded up per message: the customer is never charged a fraction of a
  // penny less than it costs, and never more than one penny more.
  return Math.ceil(units * unitPricePence);
}

export function splitConsumption(input: {
  quantity: number;
  allowance: number;
  usedThisPeriod: number;
  creditBalance: number;
  overage: OverageSettings;
}): ConsumptionSplit {
  const quantity = Math.max(0, Math.ceil(input.quantity));
  const allowanceLeft = Math.max(0, input.allowance - Math.max(0, input.usedThisPeriod));
  const fromAllowance = Math.min(quantity, allowanceLeft);
  let rest = quantity - fromAllowance;

  const fromCredits = Math.min(rest, Math.max(0, Math.floor(input.creditBalance)));
  rest -= fromCredits;

  if (rest === 0) {
    return {
      quantity,
      fromAllowance,
      fromCredits,
      fromOverage: 0,
      overageMinor: 0,
      allowed: true,
      refusal: null,
    };
  }

  const { overage } = input;
  const overageAvailable =
    overage.enabled && overage.capMinor > 0 && overage.unitPricePence !== null;

  if (!overageAvailable) {
    return {
      quantity,
      fromAllowance,
      fromCredits,
      fromOverage: 0,
      overageMinor: 0,
      allowed: false,
      refusal: "LIMIT_REACHED",
    };
  }

  const cost = overageCostMinor(rest, overage.unitPricePence!);
  if (overage.spentMinor + cost > overage.capMinor) {
    return {
      quantity,
      fromAllowance,
      fromCredits,
      fromOverage: 0,
      overageMinor: 0,
      allowed: false,
      refusal: "OVERAGE_CAP_REACHED",
    };
  }

  return {
    quantity,
    fromAllowance,
    fromCredits,
    fromOverage: rest,
    overageMinor: cost,
    allowed: true,
    refusal: null,
  };
}

/* -------------------------------------------------------------- daily caps */

/**
 * A daily cap counts messages, not segments: it is a pacing control ("no more
 * than 200 texts today"), where the monthly allowance is a billing control.
 * A cap of 0 means the channel is paused for the day.
 */
export function dailyCapAllows(input: { sentToday: number; cap: number }): boolean {
  return input.sentToday + 1 <= input.cap;
}

/** The start of the next UTC day: when a daily cap resets. */
export function nextDailyReset(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1, 0, 5));
}

/* ------------------------------------------------------------- thresholds */

export const LIMIT_WARN_PERCENT = 80;

export type LimitLevel = "ok" | "warning" | "reached";

export function limitLevel(used: number, limit: number): LimitLevel {
  if (limit <= 0) return used > 0 ? "reached" : "ok";
  const percent = (used / limit) * 100;
  if (percent >= 100) return "reached";
  if (percent >= LIMIT_WARN_PERCENT) return "warning";
  return "ok";
}

export function limitPercent(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/* ---------------------------------------------------------------- upsells */

export type LimitMetric = "leads" | "sms" | "whatsapp" | "users" | "ai_tokens";

const PLAN_LIMIT: Record<LimitMetric, (plan: PlanDefinition) => number> = {
  leads: (plan) => plan.leadLimit,
  sms: (plan) => plan.smsSegmentAllowance,
  whatsapp: (plan) => plan.whatsappMessageAllowance,
  users: (plan) => plan.userLimit,
  ai_tokens: (plan) => plan.aiTokenAllowance,
};

export type UpsellOffer = {
  level: Exclude<LimitLevel, "ok">;
  /** The next tier, only when it genuinely raises this limit. */
  upgrade: { plan: PlanDefinition; newLimit: number } | null;
  /** Top-up bundles that cover this metric, if any. */
  topUps: MessageCreditBundle[];
};

/**
 * What to offer at 80% / 100% of a limit. Honest by construction: an upgrade
 * is offered only if the next tier actually has a higher limit for this
 * metric, prices come from the catalogue, and nothing is offered below 80%.
 */
export function upsellFor(input: {
  metric: LimitMetric;
  plan: string;
  used: number;
  limit: number;
}): UpsellOffer | null {
  const level = limitLevel(input.used, input.limit);
  if (level === "ok") return null;

  const nextKey = nextPlanFor(input.plan);
  const next = nextKey ? PLANS[nextKey] : null;
  const newLimit = next ? PLAN_LIMIT[input.metric](next) : 0;

  const channel: MessageCreditChannel | null =
    input.metric === "sms" ? "sms" : input.metric === "whatsapp" ? "whatsapp" : null;

  return {
    level,
    upgrade: next && newLimit > input.limit ? { plan: next, newLimit } : null,
    topUps: channel ? MESSAGE_CREDIT_BUNDLES.filter((bundle) => bundle.channel === channel) : [],
  };
}
