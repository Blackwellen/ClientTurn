import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { OverviewHeader } from "@/components/admin/overview/overview-header";
import { AdminKpiGrid } from "@/components/admin/overview/kpi-grid";
import { ProviderHealthPanel } from "@/components/admin/overview/provider-health-panel";
import { RecentCustomersPanel } from "@/components/admin/overview/recent-customers-panel";
import { ActionRequiredPanel } from "@/components/admin/overview/action-required-panel";
import { FailedJobsPanel } from "@/components/admin/overview/failed-jobs-panel";
import { CustomersView } from "@/components/admin/customers/customers-view";
import {
  SYSTEM_VIEW_DESCRIPTION,
  SystemViewSwitch,
} from "@/components/admin/system/system-view-switch";
import { SystemHealthView } from "@/components/admin/system/system-health-view";
import { SystemEventsView } from "@/components/admin/system/system-events-view";
import { SystemErrorsView } from "@/components/admin/system/system-errors-view";
import { PageHeader } from "@/components/app/page-header";
import {
  fixtureCustomerDetail,
  fixtureCustomers,
  fixtureErrors,
  fixtureEventDetail,
  fixtureEvents,
  fixtureHealth,
  fixtureOverview,
  fixtureSelectedError,
  fixtureTopBar,
} from "@/lib/admin/fixtures";

export const metadata: Metadata = { title: "Admin preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for the Platform Administration area.
 *
 * It renders the real admin views inside the real `AdminShell` with the
 * reference data set, so the six design states can be checked without a
 * platform-admin session or a seeded database:
 *
 *   /dev/admin-preview?state=overview
 *   /dev/admin-preview?state=customers
 *   /dev/admin-preview?state=drawer
 *   /dev/admin-preview?state=health
 *   /dev/admin-preview?state=events
 *   /dev/admin-preview?state=errors
 *
 * It 404s outside development and is never linked from the product. Because it
 * bypasses `requirePlatformAdmin()` it must never render anything but fixtures.
 */
const STATES = [
  "overview",
  "customers",
  "drawer",
  "health",
  "events",
  "event-detail",
  "errors",
] as const;

type PreviewState = (typeof STATES)[number];

export default async function AdminPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const raw = Array.isArray(params.state) ? params.state[0] : params.state;
  const state: PreviewState = (STATES as readonly string[]).includes(raw ?? "")
    ? (raw as PreviewState)
    : "overview";

  const topBar = fixtureTopBar();

  return (
    <ToastProvider>
      <AdminShell
        operator={topBar.operator}
        recentCustomers={topBar.recentCustomers}
        alertCount={topBar.alertCount}
      >
        {state === "overview" && <OverviewState />}
        {(state === "customers" || state === "drawer") && (
          <CustomersState withDrawer={state === "drawer"} />
        )}
        {state === "health" && <SystemState view="health" />}
        {(state === "events" || state === "event-detail") && (
          <SystemState view="events" withDetail={state === "event-detail"} />
        )}
        {state === "errors" && <SystemState view="errors" />}
      </AdminShell>
    </ToastProvider>
  );
}

function OverviewState() {
  const overview = fixtureOverview();
  return (
    <div className="space-y-5">
      <OverviewHeader
        greeting="Good afternoon, Admin"
        stamp="Monday, 14 Apr 2025 · 16:24"
        range="24h"
      />
      <AdminKpiGrid metrics={overview.metrics} range="24h" />
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

function CustomersState({ withDrawer }: { withDrawer: boolean }) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Manage and support all ClientTurn customers."
      />
      <CustomersView
        result={fixtureCustomers()}
        filter="all"
        search=""
        sort="joined"
        direction="desc"
        detail={withDrawer ? fixtureCustomerDetail() : null}
      />
    </div>
  );
}

function SystemState({
  view,
  withDetail = false,
}: {
  view: "health" | "events" | "errors";
  withDetail?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
            System
          </h1>
          <p className="mt-1 text-[14px] text-content-muted">
            {SYSTEM_VIEW_DESCRIPTION[view]}
          </p>
        </div>
        <SystemViewSwitch view={view} />
      </div>

      {view === "health" && <SystemHealthView health={fixtureHealth()} />}
      {view === "events" && (
        <SystemEventsView
          result={fixtureEvents()}
          filters={{
            search: "",
            type: "all",
            provider: "all",
            status: "all",
            range: "7d",
          }}
          detail={withDetail ? fixtureEventDetail() : null}
        />
      )}
      {view === "errors" && (
        <SystemErrorsView
          result={fixtureErrors()}
          filters={{
            search: "",
            severity: "all",
            area: "all",
            status: "all",
            range: "7d",
            sort: "newest",
          }}
          selected={fixtureSelectedError()}
        />
      )}
    </div>
  );
}
