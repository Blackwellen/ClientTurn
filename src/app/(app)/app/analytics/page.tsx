import * as React from "react";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/auth/session";
import { ANALYTICS_VIEWS, type AnalyticsView as ViewKey } from "@/lib/analytics/v4-metrics";
import { getV4Analytics, rangeBounds, type AnalyticsRange } from "@/lib/analytics/v4-queries";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "Analytics · ClientTurn" };
export const dynamic = "force-dynamic";

const RANGES: AnalyticsRange[] = ["7d", "30d", "90d", "12m"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

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

  const data = await getV4Analytics(workspace.businessId, view, rangeBounds(range));

  return <AnalyticsView data={data} range={range} />;
}
