import * as React from "react";
import type { Metadata } from "next";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { ANALYTICS_VIEWS, type AnalyticsView as ViewKey } from "@/lib/analytics/v4-metrics";
import { getV4Analytics, rangeBounds, type AnalyticsRange } from "@/lib/analytics/v4-queries";
import {
  deriveInsights,
  getCampaignPerformance,
  getChannelPerformance,
  getConversionGoals,
  getProviderWaterfall,
  getSenderHealthTrend,
  getTrends,
} from "@/lib/analytics/v4-extras";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "Analytics · ClientTurn" };
export const dynamic = "force-dynamic";

const RANGES: AnalyticsRange[] = ["7d", "30d", "90d", "12m"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/app/analytics` (V4 §21).
 *
 * Deliberately does not duplicate the Dashboard: Dashboard answers "what needs
 * me today", this answers "what is working".
 *
 * Only the active view's data is loaded — computing all four every request
 * would quadruple the cost so that three-quarters of it could be thrown away.
 * Everything is counted by Postgres through the analytics service; no metric is
 * recomputed in the browser.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, workspace] = await Promise.all([searchParams, requireWorkspace()]);

  const rawView = first(params.view);
  const view: ViewKey = ANALYTICS_VIEWS.includes(rawView as ViewKey)
    ? (rawView as ViewKey)
    : "overview";

  const rawRange = first(params.range);
  const range: AnalyticsRange = RANGES.includes(rawRange as AnalyticsRange)
    ? (rawRange as AnalyticsRange)
    : "30d";

  const bounds = rangeBounds(range);
  const businessId = workspace.businessId;

  const [data, channels] = await Promise.all([
    getV4Analytics(businessId, view, bounds),
    // Channel figures feed both the Outreach view and the Overview insights,
    // so they are loaded once rather than twice.
    view === "overview" || view === "outreach"
      ? getChannelPerformance(businessId, bounds)
      : Promise.resolve([]),
  ]);

  const [trends, goals, campaigns, providers, senderHealth] = await Promise.all([
    view === "overview" ? getTrends(businessId, bounds) : Promise.resolve([]),
    view === "overview" || view === "conversion"
      ? getConversionGoals(businessId, bounds)
      : Promise.resolve([]),
    view === "overview" || view === "conversion"
      ? getCampaignPerformance(businessId)
      : Promise.resolve([]),
    view === "acquisition"
      ? getProviderWaterfall(businessId, bounds)
      : Promise.resolve([]),
    view === "outreach"
      ? getSenderHealthTrend(businessId, bounds)
      : Promise.resolve([]),
  ]);

  const replyRate = data.outreach?.metrics.find((m) => m.key === "reply_rate");

  return (
    <AnalyticsView
      data={data}
      range={range}
      trends={trends}
      channels={channels}
      goals={goals}
      campaigns={campaigns}
      providers={providers}
      senderHealth={senderHealth}
      insights={deriveInsights({
        channels,
        trends,
        campaigns,
        replyRateNow: replyRate?.value ?? null,
        replyRatePrevious: replyRate?.previous ?? null,
      })}
      // Export reads the same service the page does, but it leaves the
      // workspace, so it is gated on a role rather than merely hidden.
      canExport={hasRole(workspace.role, "member")}
    />
  );
}
