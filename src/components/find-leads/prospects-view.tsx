"use client";

import * as React from "react";
import { Radar, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/tabs";
import { ViewToggle, type ViewMode } from "@/components/ui/view-toggle";
import { cn } from "@/lib/cn";
import {
  QUICK_FILTER_LABELS,
  PROSPECT_QUICK_FILTERS,
  activeFilterCount,
  type ProspectFilters,
  type ProspectQuickFilter,
} from "@/lib/prospects/filters";
import type { ProspectListRow, ProspectQuickCounts } from "@/lib/prospects/types";
import type { ProspectFilterOptions } from "@/lib/prospects/queries";
import { useFindLeadsParams } from "./use-find-leads-params";
import { ProspectFilterPanel } from "./prospect-filter-panel";
import { ProspectCard } from "./prospect-card";
import {
  ProspectCampaignCell,
  ProspectEligibilityCell,
  ProspectFitCell,
  ProspectIdentityCell,
  ProspectIntentCell,
  ProspectLocationCell,
  ProspectRoleCell,
  ProspectStatusCell,
  ProspectVerificationCell,
  RelativeTime,
} from "./prospect-cells";

/**
 * The Prospects inbox (V4 §12).
 *
 * Deliberately a different surface from Leads: this is where cold, unproven
 * records are reviewed and approved, and nothing here is presented as an active
 * conversation. The visual separation is the point — §112 requires that
 * Prospect vs Lead be obvious at a glance.
 */
export function ProspectsView({
  rows,
  total,
  counts,
  filters,
  options,
  viewMode,
  canManage,
}: {
  rows: ProspectListRow[];
  total: number;
  counts: ProspectQuickCounts;
  filters: ProspectFilters;
  options: ProspectFilterOptions;
  viewMode: ViewMode;
  canManage: boolean;
}) {
  const params = useFindLeadsParams();
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [mode, setMode] = React.useState<ViewMode>(viewMode);

  const filterCount = activeFilterCount(filters);

  const quickItems = PROSPECT_QUICK_FILTERS.map((key) => ({
    value: key,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {QUICK_FILTER_LABELS[key]}
        <span className="tabular-nums text-content-subtle">{countFor(counts, key)}</span>
      </span>
    ),
  }));

  const columns: Column<ProspectListRow>[] = [
    {
      key: "prospect",
      header: "Prospect",
      width: "minmax(220px, 2fr)",
      render: (row) => <ProspectIdentityCell row={row} />,
    },
    { key: "fit", header: "Fit", width: "100px", render: (row) => <ProspectFitCell row={row} /> },
    { key: "intent", header: "Intent", width: "160px", render: (row) => <ProspectIntentCell row={row} /> },
    { key: "role", header: "Role", width: "150px", render: (row) => <ProspectRoleCell row={row} /> },
    { key: "location", header: "Location", width: "130px", render: (row) => <ProspectLocationCell row={row} /> },
    { key: "verification", header: "Verification", width: "110px", render: (row) => <ProspectVerificationCell row={row} /> },
    { key: "eligibility", header: "Eligibility", width: "130px", render: (row) => <ProspectEligibilityCell row={row} /> },
    { key: "campaign", header: "Campaign", width: "140px", render: (row) => <ProspectCampaignCell row={row} /> },
    { key: "status", header: "Outreach", width: "120px", render: (row) => <ProspectStatusCell row={row} /> },
    {
      key: "activity",
      header: "Last activity",
      width: "120px",
      render: (row) => <RelativeTime value={row.last_activity_at ?? row.created_at} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          items={quickItems}
          value={filters.quick}
          onChange={(value) => params.setParam("quick", value === "all" ? null : value)}
          size="sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[240px] flex-1">
          <SearchInput
            defaultValue={filters.search}
            placeholder="Search prospects by name, company, email or role…"
            onChange={(value) => params.setParam("q", value || null)}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
          {filterCount > 0 && (
            <span className="ml-0.5 size-1.5 rounded-full bg-accent-500" aria-hidden />
          )}
        </Button>

        {filterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => params.clearFilters(filters)}>
            <X className="size-3.5" />
            Clear {filterCount}
          </Button>
        )}

        <div className="ml-auto">
          <ViewToggle value={mode} onChange={setMode} />
        </div>
      </div>

      {filtersOpen && (
        <ProspectFilterPanel
          filters={filters}
          options={options}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={Radar}
            title={filterCount > 0 || filters.search ? "No prospects match these filters" : "No prospects yet"}
            description={
              filterCount > 0 || filters.search
                ? "Try widening the grade, location or intent filters."
                : "Start a search in Discover to find businesses that match what you sell. Nothing is contacted until you approve it."
            }
            action={
              filterCount > 0 || filters.search ? (
                <Button variant="secondary" size="sm" onClick={() => params.clearFilters(filters)}>
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button size="sm" onClick={() => params.setView("discover")}>
                  Go to Discover
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : mode === "list" ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => params.openProspect(row.id)}
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={params.setPage}
          stickyHeader
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((row) => (
            <ProspectCard
              key={row.id}
              row={row}
              onOpen={() => params.openProspect(row.id)}
            />
          ))}
        </div>
      )}

      {rows.length > 0 && mode === "card" && (
        <CardPagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={params.setPage}
        />
      )}
    </div>
  );
}

function countFor(counts: ProspectQuickCounts, key: ProspectQuickFilter): number {
  switch (key) {
    case "a-grade":
      return counts.aGrade;
    case "intent":
      return counts.intent;
    case "ready":
      return counts.ready;
    case "contacted":
      return counts.contacted;
    case "replied":
      return counts.replied;
    case "review":
      return counts.review;
    default:
      return counts.all;
  }
}

function CardPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-[12.5px] text-content-muted">
        Showing {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")} of{" "}
        {total.toLocaleString("en-GB")} prospects
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className={cn("px-2 text-[12.5px] tabular-nums text-content-muted")}>
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export { Badge };
