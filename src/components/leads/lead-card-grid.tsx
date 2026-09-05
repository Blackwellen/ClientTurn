"use client";

import * as React from "react";
import type { LeadListRow } from "@/lib/leads/types";
import { LeadCard } from "./lead-card";

/**
 * Four columns at the widest, stepping down rather than letting cards stretch
 * — a lead card past ~380px wide stops reading as a dense scan target and
 * starts reading as a profile, which is not what this page is.
 */
export function LeadCardGrid({
  rows,
  assigneeNames,
  onOpen,
}: {
  rows: LeadListRow[];
  assigneeNames: Map<string, string>;
  onOpen: (row: LeadListRow) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 min-[1440px]:grid-cols-4">
      {rows.map((row) => (
        <LeadCard
          key={row.id}
          row={row}
          assigneeName={
            row.assigned_user_id
              ? (assigneeNames.get(row.assigned_user_id) ?? "Unknown user")
              : null
          }
          onOpen={() => onOpen(row)}
        />
      ))}
    </div>
  );
}
