"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { Tooltip } from "@/components/ui/tooltip";
import type { ViewMode } from "@/components/ui/view-toggle";
import {
  PAGE_SIZES,
  activeFilterCount,
  type ProspectFilters,
} from "@/lib/prospects/filters";
import type { ProspectListRow, ProspectQuickCounts } from "@/lib/prospects/types";
import type { ProspectFilterOptions } from "@/lib/prospects/queries";
import { useFindLeadsParams } from "./use-find-leads-params";
import { ProspectFilterPanel } from "./prospect-filter-panel";
import { ProspectCard } from "./prospect-card";
import { ProspectQuickFilters } from "./prospects/prospect-quick-filters";
import { ProspectToolbar } from "./prospects/prospect-toolbar";
import { ProspectBulkBar } from "./prospects/prospect-bulk-bar";
import {
  ProspectActivityCell,
  ProspectCampaignCell,
  ProspectEligibilityCell,
  ProspectFitCell,
  ProspectIdentityCell,
  ProspectIntentCell,
  ProspectLocationCell,
  ProspectOpenCell,
  ProspectRoleCell,
  ProspectStatusCell,
  ProspectVerificationCell,
} from "./prospect-cells";

/**
 * The Prospects inbox (V4 §12).
 *
 * Deliberately a different surface from Leads: this is where cold, unproven
 * records are reviewed and approved, and nothing here is presented as an active
 * conversation. The visual separation is the point — §112 requires that
 * Prospect vs Lead be obvious at a glance, which is why a promoted record
 * leaves this list entirely rather than sitting in both.
 *
 * Filtering, sorting and paging all happen in Postgres. Selection is the only
 * state this component owns, and it is deliberately cleared whenever the result
 * set changes: acting on ids that are no longer on screen is how bulk actions
 * hit the wrong records.
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
  const router = useRouter();
  const params = useFindLeadsParams();
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [mode, setMode] = React.useState<ViewMode>(viewMode);
  const [selected, setSelected] = React.useState<string[]>([]);

  const filterCount = activeFilterCount(filters);
  const filtered = filterCount > 0 || filters.search.length > 0;

  // The filter signature, not the rows themselves: rows are a new array on
  // every render, and comparing them would clear the selection constantly.
  const signature = React.useMemo(
    () => JSON.stringify([filters.quick, filters.search, filters.page, filters.sort, filterCount]),
    [filters.quick, filters.search, filters.page, filters.sort, filterCount],
  );

  // Derived during render rather than in an effect: an effect would paint one
  // frame with the old selection against the new rows, and briefly show a
  // "3 selected" bar over prospects the customer never chose.
  const [selectionSignature, setSelectionSignature] = React.useState(signature);
  if (selectionSignature !== signature) {
    setSelectionSignature(signature);
    setSelected([]);
  }

  const openScore = React.useCallback(
    (id: string) => router.push(`/app/find-leads/scoring/${id}`),
    [router],
  );

  const columns: Column<ProspectListRow>[] = [
    {
      key: "prospect",
      header: "Prospect",
      width: "minmax(220px, 2fr)",
      render: (row) => <ProspectIdentityCell row={row} />,
    },
    {
      key: "fit",
      header: <HeaderWithHelp label="Fit" help="A deterministic 0-100 score against your ideal customer profile. Click a grade to see exactly how it was calculated." />,
      width: "130px",
      render: (row) => <ProspectFitCell row={row} onOpenScore={openScore} />,
    },
    {
      key: "intent",
      header: <HeaderWithHelp label="Intent" help="The strongest buying signal still inside its freshness window. Expired signals are not counted." />,
      width: "150px",
      render: (row) => <ProspectIntentCell row={row} />,
    },
    { key: "role", header: "Role", width: "140px", render: (row) => <ProspectRoleCell row={row} /> },
    { key: "location", header: "Location", width: "115px", render: (row) => <ProspectLocationCell row={row} /> },
    {
      key: "verification",
      header: <HeaderWithHelp label="Verification" help="Whether the email address itself was confirmed by a verification provider." />,
      width: "115px",
      render: (row) => <ProspectVerificationCell row={row} />,
    },
    {
      key: "eligibility",
      header: <HeaderWithHelp label="Eligibility" help="Whether this person may lawfully be contacted. Independent of the score — a high-scoring prospect can still be suppressed." />,
      width: "135px",
      render: (row) => <ProspectEligibilityCell row={row} />,
    },
    { key: "campaign", header: "Campaign", width: "140px", render: (row) => <ProspectCampaignCell row={row} /> },
    {
      key: "status",
      header: <HeaderWithHelp label="Outreach" help="Where this prospect has reached in the outreach lifecycle." />,
      width: "115px",
      render: (row) => <ProspectStatusCell row={row} />,
    },
    {
      key: "activity",
      header: "Last activity",
      width: "150px",
      render: (row) => <ProspectActivityCell row={row} />,
    },
    { key: "open", header: "", width: "80px", align: "right", render: () => <ProspectOpenCell /> },
  ];

  return (
    <div className="space-y-4">
      <ProspectQuickFilters
        value={filters.quick}
        counts={counts}
        onChange={(value) => params.setParam("quick", value === "all" ? null : value)}
      />

      <ProspectToolbar
        filters={filters}
        options={options}
        mode={mode}
        onModeChange={setMode}
        onOpenFilterPanel={() => setFiltersOpen((open) => !open)}
      />

      {filtersOpen && (
        <ProspectFilterPanel
          filters={filters}
          options={options}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {canManage && (
        <ProspectBulkBar
          selected={selected}
          campaigns={options.campaigns}
          onClear={() => setSelected([])}
        />
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={Radar}
            title={filtered ? "No prospects match these filters" : "No prospects found"}
            description={
              filtered
                ? "Try widening the grade, location or intent filters."
                : "Start a search in Discover to find businesses that match what you sell. Nothing is contacted until you approve it."
            }
            action={
              filtered ? (
                <Button variant="secondary" size="sm" onClick={() => params.clearFilters(filters)}>
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button size="sm" onClick={() => params.setView("discover")}>
                  Run a search
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
          selectedKeys={canManage ? selected : undefined}
          onSelectionChange={canManage ? setSelected : undefined}
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={params.setPage}
          onPageSizeChange={(size) => params.setParam("size", String(size))}
          paginationNoun="prospects"
          pageSizeOptions={PAGE_SIZES}
          stickyHeader
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((row) => (
              <ProspectCard
                key={row.id}
                row={row}
                onOpen={() => params.openProspect(row.id)}
              />
            ))}
          </div>
          <div className="rounded-xl border border-line bg-surface">
            <Pagination
              page={filters.page}
              pageSize={filters.pageSize}
              total={total}
              noun="prospects"
              pageSizeOptions={PAGE_SIZES}
              onPageChange={params.setPage}
              onPageSizeChange={(size) => params.setParam("size", String(size))}
              className="border-t-0"
            />
          </div>
        </>
      )}
    </div>
  );
}

/** A column header with the one sentence that stops it being misread. */
function HeaderWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <Tooltip content={help}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span
          aria-hidden
          className="inline-flex size-3.5 items-center justify-center rounded-full border border-line text-[8px] font-semibold text-content-subtle"
        >
          ?
        </span>
        <span className="sr-only">{help}</span>
      </span>
    </Tooltip>
  );
}
