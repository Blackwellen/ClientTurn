"use client";

import * as React from "react";
import type { LeadFilters } from "@/lib/leads/filters";
import { hasActiveFilters } from "@/lib/leads/filters";
import type { LeadListRow, WorkspaceMember } from "@/lib/leads/types";
import { LeadCardGrid } from "./lead-card-grid";
import { LeadsTable } from "./leads-table";
import { LeadBulkBar } from "./lead-bulk-bar";
import { LeadsPagination } from "./leads-pagination";
import { LeadsEmptyState, LeadsFilteredEmptyState } from "./leads-states";
import { useLeadParams } from "./use-lead-params";

/**
 * Both views read the same rows, filters and pagination — switching view never
 * refetches, never resets a filter and never changes what the user is looking
 * at, only how it is laid out.
 */
export function LeadsContent({
  rows,
  total,
  filters,
  members,
  role,
}: {
  rows: LeadListRow[];
  total: number;
  filters: LeadFilters;
  members: WorkspaceMember[];
  /** The viewer's workspace role; the bar offers only what it permits. */
  role: string;
}) {
  const { openLead } = useLeadParams();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const assigneeNames = React.useMemo(
    () => new Map(members.map((member) => [member.userId, member.name])),
    [members],
  );

  // A page or filter change makes the previous selection meaningless — those
  // rows are no longer on screen for the user to reason about.
  const rowKey = rows.map((row) => row.id).join(",");
  const [trackedKey, setTrackedKey] = React.useState(rowKey);
  if (rowKey !== trackedKey) {
    setTrackedKey(rowKey);
    setSelected(new Set());
  }

  const open = React.useCallback(
    (row: LeadListRow) => openLead(row.id),
    [openLead],
  );

  // A viewer has no bulk action to take, so offers no selection to make.
  const canSelect = role !== "viewer";

  const narrowed = hasActiveFilters(filters) || filters.quick !== "all";

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-xs" data-tour="leads-list">
        {narrowed ? <LeadsFilteredEmptyState /> : <LeadsEmptyState />}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-tour="leads-list">
      {filters.view === "cards" ? (
        <LeadCardGrid
          rows={rows}
          assigneeNames={assigneeNames}
          onOpen={open}
          selected={canSelect ? selected : undefined}
          onSelectedChange={canSelect ? setSelected : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <LeadsTable
            rows={rows}
            assigneeNames={assigneeNames}
            filters={filters}
            selected={selected}
            onSelectedChange={canSelect ? setSelected : undefined}
            onOpen={open}
          />
        </div>
      )}

      <LeadsPagination filters={filters} total={total} />

      <LeadBulkBar
        selected={selected}
        pageIds={rows.map((row) => row.id)}
        members={members}
        role={role}
        onSelectedChange={setSelected}
      />
    </div>
  );
}
