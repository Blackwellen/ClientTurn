"use client";

import * as React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import type { ViewMode } from "@/components/ui/view-toggle";
import type { FindLeadsView as ViewKey, ProspectFilters } from "@/lib/prospects/filters";
import type { ProspectListRow, ProspectQuickCounts } from "@/lib/prospects/types";
import type { ProspectFilterOptions } from "@/lib/prospects/queries";
import type { FindLeadsKpi } from "@/lib/find-leads/types";
import { ProspectsView } from "./prospects-view";
import { FindLeadsViewSwitch } from "./view-switch";
import { FindLeadsKpiStrip } from "./kpi-strip";
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
 */
export function FindLeadsView({
  filters,
  kpis,
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
        <FindLeadsKpiStrip kpis={kpis} className="w-full max-w-[760px] xl:w-auto" />
      </div>

      <FindLeadsViewSwitch
        items={items}
        value={filters.view}
        onChange={(value) => params.setView(value)}
      />
      {canManage && <Link href="/app/agents/new?type=SOURCING" className="inline-flex text-sm font-medium text-content-accent">Run an approved search in the background with an agent →</Link>}

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
