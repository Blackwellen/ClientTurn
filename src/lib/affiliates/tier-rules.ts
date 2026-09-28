import type { CommissionPlan } from "./types.ts";

/**
 * Partner tiers and sales-tier tracking (affiliate audit 17, §3; owner
 * decisions of 2026-09-28).
 *
 * Pure: no `server-only`, no Supabase. The daily ledger job, the partner
 * dashboard, the admin tier editor and the public pages all read these.
 *
 * Commission is **one-off**: a single payment per referred customer, on that
 * customer's first paid subscription invoice (see `ledger-rules.ts`). A tier
 * therefore changes one thing only: the one-off RATE.
 *
 * - **Partner tier**: Partner (6%), Pro Partner (8%), Elite Partner (10%).
 *   Earned by **paid referred customers in the last 12 months**: referred
 *   workspaces whose first payment landed in the trailing 365 days.
 *   There is no MRR threshold. With a one-off commission a partner earns
 *   nothing from a customer's later revenue, so qualifying on referred MRR
 *   would reward exactly what the programme no longer pays for, and would let
 *   one large customer outrank several paying ones. The
 *   `min_referred_mrr_minor` column stays (0169 sets it to null) but is not
 *   read.
 *   A tier never pays below the partner's published plan (`effectivePlan`).
 * - **Sales tier**: which ClientTurn plan each active referred customer is on,
 *   with its MRR. Anonymised counts only; information, not a threshold.
 *
 * Tiers are recalculated daily. Promotion is immediate; demotion happens only
 * at the monthly review (the 1st), so a partner is not demoted mid-month and
 * promoted again a week later. An admin lock holds a tier in place.
 */

export const TIER_KEYS = ["STANDARD", "PARTNER", "PREMIUM"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

/** The highest one-off rate any tier may pay (owner decision 2026-09-28). */
export const MAX_TIER_PERCENT = 10;
/** The lowest rate a tier may be set to. */
export const MIN_TIER_PERCENT = 1;
/** The trailing window paid referred customers are counted over. */
export const TIER_WINDOW_DAYS = 365;

export type TierDefinition = {
  key: TierKey;
  name: string;
  rank: number;
  /** Paid referred customers (first payment in the last 12 months) needed. */
  minActiveCustomers: number;
  /** The one-off commission rate. Null: the partner's plan rate applies. */
  commissionPercent: number | null;
  description: string | null;
};

/**
 * The owner's tier table (2026-09-28), seeded by migration 0169 and used when
 * the table cannot be read. The database row wins everywhere once it exists.
 * Keys are the stored values (0034's CHECK); the names are what people see.
 */
export const DEFAULT_TIERS: readonly TierDefinition[] = [
  { key: "STANDARD", name: "Partner", rank: 0, minActiveCustomers: 0, commissionPercent: 6, description: "Every approved partner: 6% one-off commission." },
  { key: "PARTNER", name: "Pro Partner", rank: 1, minActiveCustomers: 5, commissionPercent: 8, description: "5 paid referred customers in the last 12 months: 8% one-off commission." },
  { key: "PREMIUM", name: "Elite Partner", rank: 2, minActiveCustomers: 15, commissionPercent: 10, description: "15 paid referred customers in the last 12 months: 10% one-off commission." },
];

export type TierMetrics = {
  /**
   * Paid referred customers in the trailing 12 months: referrals whose first
   * payment is within `TIER_WINDOW_DAYS`. (Named for its stored column.)
   */
  activeCustomers: number;
  /** Referred MRR, for display and history only. Never a threshold. */
  referredMrrMinor: number;
};

export function isTierKey(value: unknown): value is TierKey {
  return typeof value === "string" && (TIER_KEYS as readonly string[]).includes(value);
}

function ordered(tiers: readonly TierDefinition[]): TierDefinition[] {
  return [...tiers].sort((a, b) => a.rank - b.rank);
}

/** Paid referred customers in the window. A zero threshold means "everyone". */
export function qualifies(tier: TierDefinition, metrics: TierMetrics): boolean {
  if (tier.minActiveCustomers <= 0) return true;
  return metrics.activeCustomers >= tier.minActiveCustomers;
}

/** Whether a referral's first payment counts toward the tier window. */
export function countsTowardTier(firstPaidAt: string | null | undefined, now: Date): boolean {
  if (!firstPaidAt) return false;
  const paid = new Date(firstPaidAt).getTime();
  if (!Number.isFinite(paid) || paid > now.getTime()) return false;
  return now.getTime() - paid <= TIER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** The highest tier the metrics earn. */
export function earnedTier(tiers: readonly TierDefinition[], metrics: TierMetrics): TierKey {
  let best: TierKey = "STANDARD";
  for (const tier of ordered(tiers)) if (qualifies(tier, metrics)) best = tier.key;
  return best;
}

export type TierEvaluation = {
  tier: TierKey;
  changed: boolean;
  direction: "up" | "down" | null;
  /** Why the tier did not move when the metrics say it should. */
  heldBecause: "locked" | "not_review_day" | null;
};

/**
 * The tier a partner should hold after a recalculation.
 *
 * `locked` is an admin override: the partner stays where an operator put them.
 * `allowDowngrade` is true only on the monthly review.
 */
export function evaluateTier(input: {
  tiers: readonly TierDefinition[];
  metrics: TierMetrics;
  current: TierKey;
  locked: boolean;
  allowDowngrade: boolean;
}): TierEvaluation {
  const target = earnedTier(input.tiers, input.metrics);
  if (target === input.current) return { tier: input.current, changed: false, direction: null, heldBecause: null };
  if (input.locked) return { tier: input.current, changed: false, direction: null, heldBecause: "locked" };
  const rank = (key: TierKey) => input.tiers.find((tier) => tier.key === key)?.rank ?? 0;
  const up = rank(target) > rank(input.current);
  if (!up && !input.allowDowngrade) {
    return { tier: input.current, changed: false, direction: null, heldBecause: "not_review_day" };
  }
  return { tier: target, changed: true, direction: up ? "up" : "down", heldBecause: null };
}

/** The monthly review: demotions are applied on the first day of the month (UTC). */
export function isTierReviewDay(now: Date): boolean {
  return now.getUTCDate() === 1;
}

export type TierProgress = {
  current: TierDefinition;
  next: TierDefinition | null;
  /** 0-100 toward the next tier. */
  percent: number;
  customersToGo: number | null;
};

export function tierProgress(tiers: readonly TierDefinition[], metrics: TierMetrics, current: TierKey): TierProgress {
  const list = ordered(tiers.length > 0 ? tiers : DEFAULT_TIERS);
  const currentDef = list.find((tier) => tier.key === current) ?? list[0];
  const next = list.find((tier) => tier.rank > currentDef.rank) ?? null;
  if (!next) return { current: currentDef, next: null, percent: 100, customersToGo: null };

  const customerPct = next.minActiveCustomers > 0 ? metrics.activeCustomers / next.minActiveCustomers : 0;
  return {
    current: currentDef,
    next,
    percent: Math.max(0, Math.min(100, Math.round(customerPct * 100))),
    customersToGo: next.minActiveCustomers > 0 ? Math.max(0, next.minActiveCustomers - metrics.activeCustomers) : null,
  };
}

/**
 * The plan a commission is calculated on, with the tier's rate applied.
 *
 * Never worse than the plan: a tier's percent only replaces the plan's where
 * it is better for the partner, and never above `MAX_TIER_PERCENT`. Only
 * percentage plans take a tier rate.
 */
export function effectivePlan<P extends Pick<CommissionPlan, "commissionType" | "percent">>(
  plan: P,
  tier: TierDefinition | null,
): P {
  if (!tier) return plan;
  const out = { ...plan };
  if (tier.commissionPercent !== null && plan.commissionType !== "FLAT_AMOUNT") {
    out.percent = Math.max(plan.percent ?? 0, Math.min(tier.commissionPercent, MAX_TIER_PERCENT));
  }
  return out;
}

/** Validates an admin's tier edit. Returns problems, empty when valid. */
export function validateTierEdit(tiers: readonly TierDefinition[]): string[] {
  const problems: string[] = [];
  const list = ordered(tiers);
  for (const tier of list) {
    if (tier.minActiveCustomers < 0) problems.push(`${tier.name}: the customer threshold cannot be negative.`);
    if (
      tier.commissionPercent !== null &&
      (tier.commissionPercent < MIN_TIER_PERCENT || tier.commissionPercent > MAX_TIER_PERCENT)
    ) {
      problems.push(`${tier.name}: a one-off rate must be between ${MIN_TIER_PERCENT}% and ${MAX_TIER_PERCENT}%.`);
    }
  }
  for (let index = 1; index < list.length; index += 1) {
    const lower = list[index - 1];
    const higher = list[index];
    if (higher.minActiveCustomers < lower.minActiveCustomers) {
      problems.push(`${higher.name} must need at least as many customers as ${lower.name}.`);
    }
    if ((higher.commissionPercent ?? 0) < (lower.commissionPercent ?? 0)) {
      problems.push(`${higher.name} cannot pay a lower rate than ${lower.name}.`);
    }
  }
  return problems;
}

/** "6%", "8%", "10%": a tier's headline rate for any page. */
export function tierRateLabel(tier: Pick<TierDefinition, "commissionPercent">, planPercent: number | null = null): string {
  const rate = tier.commissionPercent ?? planPercent ?? 0;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

/* --------------------------------------------------------- sales tiers -- */

export const SALES_TIER_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
  trial: "Trial",
};

export type SalesTierRow = { planKey: string; label: string; customers: number; mrrMinor: number };

/** Active referred customers grouped by the ClientTurn plan they are on. */
export function salesTierBreakdown(rows: readonly { planKey: string | null; mrrMinor: number | null }[]): SalesTierRow[] {
  const byPlan = new Map<string, SalesTierRow>();
  for (const row of rows) {
    const key = (row.planKey ?? "unknown").toLowerCase();
    const existing = byPlan.get(key) ?? { planKey: key, label: SALES_TIER_LABEL[key] ?? "Other", customers: 0, mrrMinor: 0 };
    existing.customers += 1;
    existing.mrrMinor += Math.max(0, Number(row.mrrMinor ?? 0));
    byPlan.set(key, existing);
  }
  const order = ["enterprise", "pro", "growth", "starter", "trial"];
  return [...byPlan.values()].sort((a, b) => {
    const ai = order.indexOf(a.planKey);
    const bi = order.indexOf(b.planKey);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

/** "6% to 10%" (or "6%" when every tier pays the same): for public copy. */
export function tierRateRangeLabel(tiers: readonly TierDefinition[], planPercent: number | null): string {
  const list = tiers.length > 0 ? tiers : DEFAULT_TIERS;
  const rates = list.map((tier) => Math.min(Math.max(tier.commissionPercent ?? planPercent ?? 0, planPercent ?? 0), MAX_TIER_PERCENT));
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
  return min === max ? fmt(min) : `${fmt(min)} to ${fmt(max)}`;
}

/** "Partner 6%; Pro Partner 8% from 5 paid referred customers in the last 12 months; …" */
export function tierSummary(tiers: readonly TierDefinition[], planPercent: number | null): string {
  return [...(tiers.length > 0 ? tiers : DEFAULT_TIERS)]
    .sort((a, b) => a.rank - b.rank)
    .map((tier) =>
      tier.minActiveCustomers > 0
        ? `${tier.name} ${tierRateLabel(tier, planPercent)} from ${tier.minActiveCustomers} paid referred customers in the last 12 months`
        : `${tier.name} ${tierRateLabel(tier, planPercent)}`,
    )
    .join("; ");
}
