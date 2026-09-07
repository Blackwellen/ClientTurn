import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  programmeConversionRate,
  resolveRange,
  type CustomRange,
  type RangeKey,
} from "./programme";
import { EMPTY_METRICS, type AffiliateMetrics } from "./metrics";

/**
 * The affiliate analytics service (V4 §34).
 *
 * Every number the portal shows comes from here. The dashboard, the referrals
 * page and the performance page each render a different subset of the same
 * eight metrics, and in every previous draft of a product like this they ended
 * up computing them three different ways — usually because one page counted
 * raw clicks and another counted unique visitors. So there is exactly one
 * entry point per shape, and none of them is exported in a form a component
 * could recompute from.
 *
 * **Authorisation.** Every function takes an `affiliateId` that the caller has
 * already resolved from the session via `getAffiliate()`. Nothing here accepts
 * an id from a request. The underlying SQL functions are SECURITY DEFINER with
 * no grant to `authenticated`, so they are reachable only through the service
 * role — which is exactly why the id must never be caller-supplied.
 *
 * **Why the service role at all.** `affiliate_clicks` carries visitor hashes
 * and has no browser grant; aggregating it is the only way to show a click
 * count without exposing the rows. The aggregate functions return counts and
 * sums only, never a click row.
 */

/* ------------------------------------------------------------- shapes --- */

// The metric shapes and the count-vs-rate delta arithmetic are pure and live
// in `metrics.ts`, so they are testable without a database. Re-exported here
// so a caller reaches one module for "the numbers".
export {
  buildFunnel,
  buildLifecycle,
  comparisonLabel,
  countDelta,
  rateDelta,
  type AffiliateMetrics,
  type FunnelStep,
  type MetricDelta,
} from "./metrics";

export type DailyPoint = {
  day: string;
  clicks: number;
  signups: number;
  paidCustomers: number;
  pendingMinor: number;
  approvedMinor: number;
  paidMinor: number;
};

export type LinkMetrics = {
  linkId: string;
  label: string;
  slug: string;
  destinationPath: string;
  utmCampaign: string | null;
  promoCode: string | null;
  campaignName: string | null;
  clicks: number;
  signups: number;
  trials: number;
  paidCustomers: number;
  conversionRate: number | null;
  commissionMinor: number;
  revenueMinor: number;
  updatedAt: string;
};

export type CampaignMetrics = {
  campaign: string;
  clicks: number;
  signups: number;
  paidCustomers: number;
  conversionRate: number | null;
  revenueMinor: number;
  commissionMinor: number;
};

export type AffiliateOverview = {
  range: RangeKey;
  from: string;
  to: string;
  /** Length of the window, so a custom range can caption its own comparison. */
  days: number;
  current: AffiliateMetrics;
  /** Null when the comparison window predates the account, so no fake trend. */
  previous: AffiliateMetrics | null;
};

/* ------------------------------------------------------------ overview --- */


async function metricsFor(
  affiliateId: string,
  from: Date,
  to: Date,
): Promise<AffiliateMetrics> {
  const { data, error } = await createAdminClient().rpc("affiliate_metrics", {
    p_affiliate_id: affiliateId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return EMPTY_METRICS;

  return {
    clicks: Number(row.clicks ?? 0),
    uniqueClicks: Number(row.unique_clicks ?? 0),
    signups: Number(row.signups ?? 0),
    trials: Number(row.trials ?? 0),
    paidCustomers: Number(row.paid_customers ?? 0),
    renewals: Number(row.renewals ?? 0),
    conversionRate:
      row.conversion_rate === null || row.conversion_rate === undefined
        ? null
        : Number(row.conversion_rate),
    pendingMinor: Number(row.pending_minor ?? 0),
    approvedMinor: Number(row.approved_minor ?? 0),
    paidMinor: Number(row.paid_minor ?? 0),
    reversedMinor: Number(row.reversed_minor ?? 0),
    revenueAttributedMinor: Number(row.revenue_attributed_minor ?? 0),
  };
}

/**
 * The eight headline metrics for a window, plus the comparable previous window.
 *
 * `previous` is null when the affiliate did not exist for the whole of the
 * comparison window. That matters: a trend against a period the account was
 * not open for reads as explosive growth when it is really just a start date,
 * and the KPI cards omit the delta entirely rather than print a lie.
 */
export const getOverview = cache(async function getOverview(
  affiliateId: string,
  range: RangeKey,
  joinedAt: string,
  custom?: CustomRange | null,
): Promise<AffiliateOverview> {
  const { from, to, days, previousFrom } = resolveRange(range, new Date(), custom);

  const accountOpened = new Date(joinedAt).getTime();
  const comparable = Number.isFinite(accountOpened)
    ? accountOpened <= previousFrom.getTime()
    : false;

  const [current, previous] = await Promise.all([
    metricsFor(affiliateId, from, to),
    comparable ? metricsFor(affiliateId, previousFrom, from) : Promise.resolve(null),
  ]);

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    current,
    previous,
  };
});

/* ---------------------------------------------------------- daily series -- */

export const getDailySeries = cache(async function getDailySeries(
  affiliateId: string,
  range: RangeKey,
  custom?: CustomRange | null,
): Promise<DailyPoint[]> {
  const { from, to } = resolveRange(range, new Date(), custom);

  const { data, error } = await createAdminClient().rpc("affiliate_daily_series", {
    p_affiliate_id: affiliateId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error || !Array.isArray(data)) return [];

  return data.map((row) => ({
    day: String(row.day),
    clicks: Number(row.clicks ?? 0),
    signups: Number(row.signups ?? 0),
    paidCustomers: Number(row.paid_customers ?? 0),
    pendingMinor: Number(row.pending_minor ?? 0),
    approvedMinor: Number(row.approved_minor ?? 0),
    paidMinor: Number(row.paid_minor ?? 0),
  }));
});

/* ----------------------------------------------------------------- links -- */

export const getLinkMetrics = cache(async function getLinkMetrics(
  affiliateId: string,
  range: RangeKey,
  custom?: CustomRange | null,
): Promise<LinkMetrics[]> {
  const { from, to } = resolveRange(range, new Date(), custom);

  const { data, error } = await createAdminClient().rpc("affiliate_link_metrics", {
    p_affiliate_id: affiliateId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error || !Array.isArray(data)) return [];

  return data.map((row) => {
    const clicks = Number(row.clicks ?? 0);
    const paid = Number(row.paid_customers ?? 0);
    return {
      linkId: String(row.link_id),
      label: String(row.label),
      slug: String(row.slug),
      destinationPath: String(row.destination_path ?? "/"),
      utmCampaign: row.utm_campaign ?? null,
      promoCode: row.promo_code ?? null,
      campaignName: row.campaign_name ?? null,
      clicks,
      signups: Number(row.signups ?? 0),
      trials: Number(row.trials ?? 0),
      paidCustomers: paid,
      // Same definition as everywhere else. Per-link uniques are not tracked
      // separately, so this uses the link's own click count as its denominator
      // and is labelled the same way because it answers the same question.
      conversionRate: programmeConversionRate(paid, clicks),
      commissionMinor: Number(row.commission_minor ?? 0),
      revenueMinor: Number(row.revenue_minor ?? 0),
      updatedAt: String(row.updated_at),
    };
  });
});

/* ------------------------------------------------------------- campaigns -- */

/**
 * Campaign rollups, derived from the link metrics rather than from their own
 * query.
 *
 * A campaign is just a grouping of links, so deriving it guarantees the two
 * tables on the performance page can never disagree — which they would if each
 * had its own SQL.
 */
export const getCampaignMetrics = cache(async function getCampaignMetrics(
  affiliateId: string,
  range: RangeKey,
  custom?: CustomRange | null,
): Promise<CampaignMetrics[]> {
  const links = await getLinkMetrics(affiliateId, range, custom);
  const byCampaign = new Map<string, CampaignMetrics>();

  for (const link of links) {
    const name = link.campaignName ?? link.utmCampaign ?? "Ungrouped";
    const entry = byCampaign.get(name) ?? {
      campaign: name,
      clicks: 0,
      signups: 0,
      paidCustomers: 0,
      conversionRate: null,
      revenueMinor: 0,
      commissionMinor: 0,
    };

    entry.clicks += link.clicks;
    entry.signups += link.signups;
    entry.paidCustomers += link.paidCustomers;
    entry.revenueMinor += link.revenueMinor;
    entry.commissionMinor += link.commissionMinor;
    byCampaign.set(name, entry);
  }

  return [...byCampaign.values()]
    .map((entry) => ({
      ...entry,
      conversionRate: programmeConversionRate(entry.paidCustomers, entry.clicks),
    }))
    .sort((a, b) => b.clicks - a.clicks);
});
