import { programmeConversionRate, stepRate } from "./programme.ts";

/**
 * Metric shapes and derivations for the affiliate portal (V4 §34).
 *
 * Pure — no `server-only`, no Supabase — so the arithmetic that decides what a
 * partner is told about their performance is directly testable.
 * `analytics.ts` re-exports these and adds the SQL around them.
 *
 * The rule this module exists to enforce: **counts and rates report change
 * differently.** A count that went 100 → 128 is "+28%". A rate that went 2.2%
 * → 3.0% is "+0.8pp", not "+36%". Getting that wrong is the single most common
 * way a dashboard lies to the person reading it.
 */

export type AffiliateMetrics = {
  clicks: number;
  uniqueClicks: number;
  signups: number;
  trials: number;
  paidCustomers: number;
  renewals: number;
  /** paid customers / unique clicks. Null when nothing has been clicked. */
  conversionRate: number | null;
  pendingMinor: number;
  approvedMinor: number;
  paidMinor: number;
  reversedMinor: number;
  revenueAttributedMinor: number;
};

export type MetricDelta = {
  /** Formatted for display, e.g. "+28%" or "+0.6pp". */
  value: string;
  direction: "up" | "down" | "flat";
  comparison: string;
};

export type FunnelStep = {
  key: "clicks" | "signups" | "trials" | "paid";
  label: string;
  count: number;
  /** Share of the top of the funnel, for the bar width. */
  shareOfTop: number | null;
  /** Share of the immediately preceding step. */
  shareOfPrevious: number | null;
};

export const EMPTY_METRICS: AffiliateMetrics = {
  clicks: 0,
  uniqueClicks: 0,
  signups: 0,
  trials: 0,
  paidCustomers: 0,
  renewals: 0,
  conversionRate: null,
  pendingMinor: 0,
  approvedMinor: 0,
  paidMinor: 0,
  reversedMinor: 0,
  revenueAttributedMinor: 0,
};

/* --------------------------------------------------------------- deltas --- */

/**
 * A count-to-count delta as a percentage change.
 *
 * Returns undefined rather than "+100%" when the baseline is zero: growth from
 * nothing is not a percentage, and printing one makes an empty prior month
 * look like a triumph.
 */
export function countDelta(
  current: number,
  previous: number | undefined,
  comparison: string,
): MetricDelta | undefined {
  if (previous === undefined || previous === 0) return undefined;

  const change = (current - previous) / previous;
  return {
    value: `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}%`,
    direction: change > 0.0005 ? "up" : change < -0.0005 ? "down" : "flat",
    comparison,
  };
}

/**
 * A rate-to-rate delta in percentage points.
 *
 * Rates never use `countDelta`: 2.2% to 3.0% is +0.8pp, and calling it +36%
 * is the single most common dashboard misrepresentation there is.
 */
export function rateDelta(
  current: number | null,
  previous: number | null | undefined,
  comparison: string,
): MetricDelta | undefined {
  if (current === null || previous === null || previous === undefined) return undefined;

  const points = (current - previous) * 100;
  return {
    value: `${points >= 0 ? "+" : ""}${points.toFixed(1)}pp`,
    direction: points > 0.005 ? "up" : points < -0.005 ? "down" : "flat",
    comparison,
  };
}

/** The wording every KPI card uses for its baseline. */
export function comparisonLabel(range: string): string {
  if (range === "7d") return "vs. previous 7 days";
  if (range === "90d") return "vs. previous 90 days";
  return "vs. previous 30 days";
}

/* --------------------------------------------------------------- funnel --- */

/** Clicks → signups → trials → paid, with both share denominators. */
export function buildFunnel(metrics: AffiliateMetrics): FunnelStep[] {
  const top = metrics.clicks;

  const steps: { key: FunnelStep["key"]; label: string; count: number }[] = [
    { key: "clicks", label: "Clicks", count: metrics.clicks },
    { key: "signups", label: "Signups", count: metrics.signups },
    { key: "trials", label: "Trials", count: metrics.trials },
    { key: "paid", label: "Paid customers", count: metrics.paidCustomers },
  ];

  return steps.map((step, index) => ({
    ...step,
    shareOfTop: stepRate(step.count, top),
    shareOfPrevious:
      index === 0 ? null : stepRate(step.count, steps[index - 1].count),
  }));
}

/** The seven-stage lifecycle strip on the referrals page. */
export function buildLifecycle(
  metrics: AffiliateMetrics,
  commissionMinor: number,
  paidOutMinor: number,
) {
  return [
    { key: "click", label: "Click", value: metrics.clicks, caption: "Total clicks" },
    {
      key: "signup",
      label: "Signup",
      value: metrics.signups,
      caption: rateCaption(metrics.signups, metrics.clicks, "of clicks"),
    },
    {
      key: "trial",
      label: "Trial",
      value: metrics.trials,
      caption: rateCaption(metrics.trials, metrics.signups, "of signups"),
    },
    {
      key: "paid",
      label: "Paid",
      value: metrics.paidCustomers,
      caption: rateCaption(metrics.paidCustomers, metrics.trials, "of trials"),
    },
    {
      key: "renewal",
      label: "Renewal",
      value: metrics.renewals,
      caption: rateCaption(metrics.renewals, metrics.paidCustomers, "of paid"),
    },
    {
      key: "commission",
      label: "Commission",
      value: commissionMinor,
      caption: "Total earned",
      money: true,
    },
    {
      key: "payout",
      label: "Payout",
      value: paidOutMinor,
      caption: rateCaption(paidOutMinor, commissionMinor, "paid out"),
      money: true,
    },
  ] as const;
}

function rateCaption(current: number, previous: number, suffix: string): string {
  const rate = stepRate(current, previous);
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}% ${suffix}`;
}

/** Re-exported so callers reach one module for the conversion definition. */
export { programmeConversionRate };
