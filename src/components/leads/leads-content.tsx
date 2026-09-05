"use client";

import * as React from "react";
import type { LeadFilters } from "@/lib/leads/filters";
import { hasActiveFilters } from "@/lib/leads/filters";
import type { LeadListRow, WorkspaceMember } from "@/lib/leads/types";
import { LeadCardGrid } from "./lead-card-grid";
import { LeadsTable } from "./leads-table";
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
}: {
  rows: LeadListRow[];
  total: number;
  filters: LeadFilters;
  members: WorkspaceMember[];
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

  const narrowed = hasActiveFilters(filters) || filters.quick !== "all";

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-xs">
        {narrowed ? <LeadsFilteredEmptyState /> : <LeadsEmptyState />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filters.view === "cards" ? (
        <LeadCardGrid rows={rows} assigneeNames={assigneeNames} onOpen={open} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <LeadsTable
            rows={rows}
            assigneeNames={assigneeNames}
            filters={filters}
            selected={selected}
            onSelectedChange={setSelected}
            onOpen={open}
          />
        </div>
      )}

      <LeadsPagination filters={filters} total={total} />
    </div>
  );
}
