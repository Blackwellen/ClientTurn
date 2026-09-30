import * as React from "react";
import { z } from "zod";
import { getAdminOverview } from "@/lib/admin/overview";
import { ADMIN_RANGES } from "@/lib/admin/types";
import { OverviewHeader } from "@/components/admin/overview/overview-header";
import { AdminKpiGrid } from "@/components/admin/overview/kpi-grid";
import { ProviderHealthPanel } from "@/components/admin/overview/provider-health-panel";
import { RecentCustomersPanel } from "@/components/admin/overview/recent-customers-panel";
import { ActionRequiredPanel } from "@/components/admin/overview/action-required-panel";
import { FailedJobsPanel } from "@/components/admin/overview/failed-jobs-panel";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { adminGreeting } from "@/lib/admin/greeting";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  range: z.enum(ADMIN_RANGES).default("24h").catch("24h"),
});

/**
 * The platform runs on UK time, so the greeting and stamp are computed in
 * Europe/London rather than from the server's own clock or the browser's.
 * That makes the first paint correct and stable across renders.
 */
const PLATFORM_TZ = "Europe/London";

function stampFor(now: Date): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: PLATFORM_TZ,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: PLATFORM_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return `${date} · ${time}`;
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const { range } = paramsSchema.parse({ range: first(raw.range) });
  // Cached per request: the layout has already run the same check.
  const operator = await requirePlatformAdmin();
  const overview = await getAdminOverview(range);
  const now = new Date(overview.generatedAt);

  return (
    <div className="space-y-5">
      <OverviewHeader
        greeting={adminGreeting(now, operator.firstName)}
        stamp={stampFor(now)}
        range={range}
      />

      <AdminKpiGrid metrics={overview.metrics} range={range} />

      {/* items-start: a short panel should end where its content ends
          rather than trailing dead space beside a taller neighbour. */}
      <div className="@container/panels">
        <div className="grid items-start gap-4 @[78rem]/panels:grid-cols-2">
          <ProviderHealthPanel providers={overview.providers} />
          <RecentCustomersPanel customers={overview.recentCustomers} />
          <ActionRequiredPanel items={overview.actionRequired} />
          <FailedJobsPanel jobs={overview.failedJobs} />
        </div>
      </div>
    </div>
  );
}
