"use client";

import * as React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import type { ViewMode } from "@/components/ui/view-toggle";
import type { FindLeadsView as ViewKey, ProspectFilters } from "@/lib/prospects/filters";
import type { ProspectListRow, ProspectQuickCounts } from "@/lib/prospects/types";
import type { ProspectFilterOptions, ProspectKpi } from "@/lib/prospects/queries";
import type { FindLeadsKpi } from "@/lib/find-leads/types";
import { ProspectsView } from "./prospects-view";
import { FindLeadsViewSwitch } from "./view-switch";
import { FindLeadsKpiStrip } from "./kpi-strip";
import { ProspectKpiStrip } from "./prospects/prospect-kpi-strip";
import { useFindLeadsParams } from "./use-find-leads-params";

/**
 * The Find Leads surface (V4 §8).
 *
 * Four internal views behind one destination, not four sidebar entries — the
 * navigation rule in §1.4 keeps the sidebar at five customer destinations.
 *
 * Only the active view is in the DOM. Discover and Prospects are both heavy —
 * a chat with its composer, and a paginated table — and mounting all four to
 * save a re-render would make every view pay for the other three.
 *
 * The KPI strip changes with the view rather than staying fixed: Discover is
 * about search capacity, Prospects is about the state of the inbox, and one
 * strip that tried to serve both would serve neither.
 */
export function FindLeadsView({
  filters,
  kpis,
  prospectKpis,
  prospects,
  counts,
  options,
  viewMode,
  canManage,
  discover,
  intent,
  campaigns,
}: {
  filters: ProspectFilters;
  kpis: FindLeadsKpi[];
  prospectKpis: ProspectKpi[];
  prospects: { rows: ProspectListRow[]; total: number };
  counts: ProspectQuickCounts;
  options: ProspectFilterOptions;
  viewMode: ViewMode;
  canManage: boolean;
  /** Rendered server-side and passed through, so this shell stays presentational. */
  discover: React.ReactNode;
  intent: React.ReactNode;
  campaigns: React.ReactNode;
}) {
  const params = useFindLeadsParams();

  const items = [
    { value: "discover", label: "Discover" },
    { value: "prospects", label: "Prospects", count: counts.all },
    { value: "intent", label: "Intent" },
    { value: "campaigns", label: "Campaigns" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Find Leads"
          description="Use AI to find, verify and engage high-quality prospects for your business."
          size="lg"
        />
        <FindLeadsViewSwitch
          items={items}
          value={filters.view}
          onChange={(value) => params.setView(value)}
        />
      </div>

      {filters.view === "prospects" ? (
        <ProspectKpiStrip kpis={prospectKpis} />
      ) : filters.view === "discover" ? (
        <FindLeadsKpiStrip kpis={kpis} />
      ) : null}

      {/* The bridge into Agents. A search plan that has been approved once can
          run unattended, and this is the only place that connection is
          discoverable — it sits under the header rather than in it, so it never
          competes with the view the customer is actually using. */}
      {canManage && filters.view === "discover" && (
        <p className="text-[12.5px] text-content-muted">
          <Link
            href="/app/agents/new?type=SOURCING"
            className="font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Run an approved search in the background with an agent
          </Link>{" "}
          — it repeats on a schedule, within the same limits.
        </p>
      )}

      <div
        role="tabpanel"
        id={`tabpanel-${filters.view}`}
        aria-labelledby={`tab-${filters.view}`}
      >
        {filters.view === "prospects" ? (
          <ProspectsView
            rows={prospects.rows}
            total={prospects.total}
            counts={counts}
            filters={filters}
            options={options}
            viewMode={viewMode}
            canManage={canManage}
          />
        ) : filters.view === "intent" ? (
          intent
        ) : filters.view === "campaigns" ? (
          campaigns
        ) : (
          discover
        )}
      </div>
    </div>
  );
}

export type { ViewKey };
