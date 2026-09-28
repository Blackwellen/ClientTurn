"use client";

import * as React from "react";
import { CalendarPlus, Eye, History, Megaphone, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { maintenancePageHtml } from "@/lib/maintenance/response";
import { formatLondon } from "@/lib/maintenance/schedule";
import type { MaintenanceStatus } from "@/lib/maintenance/types";
import type { SiteAdminData } from "@/lib/maintenance/admin-types";
import { MaintenanceStateCard } from "./maintenance-state-card";
import { MaintenanceForm } from "./maintenance-form";
import { MaintenanceWindows } from "./maintenance-windows";
import { BannerManager } from "./banner-manager";

/** /admin/site: maintenance state, scheduling, banners and the change history. */
export function SiteView({ data }: { data: Extract<SiteAdminData, { status: "ok" }> }) {
  const [preview, setPreview] = React.useState(false);

  const previewStatus: MaintenanceStatus =
    data.maintenance.phase === "ACTIVE"
      ? data.maintenance
      : {
          phase: "ACTIVE",
          level: data.maintenance.upcoming?.level ?? "APP_OFFLINE",
          active: data.maintenance.upcoming ?? {
            id: "preview",
            level: "APP_OFFLINE",
            startsAt: data.nowIso,
            endsAt: new Date(Date.parse(data.nowIso) + 2 * 3_600_000).toISOString(),
            expectedBackAt: null,
            message: "We're upgrading our database. Leads, payments and opt-outs keep arriving and nothing is lost.",
            keepQuotePagesOnline: true,
            keepAutomationRunning: false,
            announceBanner: true,
          },
          upcoming: null,
        };

  return (
    <div className="space-y-5">
      <MaintenanceStateCard status={data.maintenance} nowIso={data.nowIso} envOverride={data.envOverride} />

      <div className="grid gap-5 min-[1400px]:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <Panel
          icon={CalendarPlus}
          tone="warning"
          title="Schedule maintenance"
          description="Start now or at a set time. Ends automatically at the end time."
          action={
            <Button size="sm" variant="secondary" onClick={() => setPreview(true)}>
              <Eye className="size-3.5" aria-hidden />
              Preview page
            </Button>
          }
          contentClassName="px-4 pb-5 sm:px-5"
        >
          <MaintenanceForm />
        </Panel>

        <Panel icon={TriangleAlert} tone="neutral" title="Maintenance windows" description="Scheduled, active and past.">
          <MaintenanceWindows windows={data.windows} />
        </Panel>
      </div>

      <Panel
        icon={Megaphone}
        tone="info"
        title="Banners and announcements"
        description="App top bar, website top bar and dashboard card."
      >
        <BannerManager banners={data.banners} />
      </Panel>

      <Panel icon={History} tone="neutral" title="History" description="Every change to maintenance and banners, from the audit log.">
        {data.history.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-content-muted">No changes recorded yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {data.history.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 sm:px-5">
                <span className="min-w-0 text-[13px] text-content">{row.summary}</span>
                <span className="shrink-0 text-[12px] text-content-muted">
                  {row.actorEmail ?? "Unknown operator"} · <time dateTime={row.at}>{formatLondon(row.at)}</time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Maintenance page preview"
        description="What customers see (HTTP 503, not indexed) while the app or site is offline."
        size="lg"
      >
        <iframe
          title="Maintenance page preview"
          sandbox=""
          srcDoc={maintenancePageHtml({ status: previewStatus, kind: "offline" })}
          className="h-[420px] w-full rounded-lg border border-line"
        />
      </Modal>
    </div>
  );
}
