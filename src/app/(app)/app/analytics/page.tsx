import * as React from "react";
import type { Metadata } from "next";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import {
  ANALYTICS_VIEWS,
  type AnalyticsView as ViewKey,
} from "@/lib/analytics/v4-metrics";
import {
  getV4Analytics,
  rangeBounds,
  type AnalyticsRange,
} from "@/lib/analytics/v4-queries";
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
import { getSlice } from "@/lib/analytics/slices";
import {
  ATTRIBUTION_MODELS,
  SLICE_DIMENSIONS,
  type AttributionModel,
  type SliceDimension,
} from "@/lib/analytics/revenue-surfaces";
import { SlicesPanel } from "@/components/analytics/slices-panel";
import { getSourceFunnels } from "@/lib/analytics/source-funnels-query";
import { SourceFunnelsPanel } from "@/components/analytics/source-funnels-panel";

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
  const [params, workspace] = await Promise.all([
    searchParams,
    requireWorkspace(),
  ]);

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

  // Source funnels (coverage tracker 8.16) is its own tab with its own read;
  // none of the V4 view queries below are needed for it.
  if (rawView === "sources") {
    const funnels = await getSourceFunnels(businessId, bounds);
    return (
      <div className="space-y-5">
        <AnalyticsView
          data={{ view: "overview", overview: null, acquisition: null, outreach: null, conversion: null }}
          range={range}
          trends={[]}
          channels={[]}
          goals={[]}
          campaigns={[]}
          providers={[]}
          senderHealth={[]}
          insights={[]}
          canExport={false}
          sources={<SourceFunnelsPanel result={funnels} />}
        />
      </div>
    );
  }

  const rawSlice = first(params.slice);
  const slice: SliceDimension = SLICE_DIMENSIONS.includes(
    rawSlice as SliceDimension,
  )
    ? (rawSlice as SliceDimension)
    : "source";
  const rawModel = first(params.model);
  const model: AttributionModel = ATTRIBUTION_MODELS.includes(
    rawModel as AttributionModel,
  )
    ? (rawModel as AttributionModel)
    : "first";

  const [data, channels, sliceResult] = await Promise.all([
    getV4Analytics(businessId, view, bounds),
    // Channel figures feed both the Outreach view and the Overview insights,
    // so they are loaded once rather than twice.
    view === "overview" || view === "outreach"
      ? getChannelPerformance(businessId, bounds)
      : Promise.resolve([]),
    // Never rejects: an unreadable breakdown reports itself as unavailable.
    getSlice(businessId, bounds, slice, model),
  ]);

  const [trends, goals, campaigns, providers, senderHealth] = await Promise.all(
    [
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
    ],
  );

  const replyRate = data.outreach?.metrics.find((m) => m.key === "reply_rate");

  return (
    <div className="space-y-5">
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
      <SlicesPanel
        result={sliceResult}
        dimension={slice}
        model={model}
        baseParams={{ view, range }}
      />
    </div>
  );
}
