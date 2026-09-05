"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatRelative } from "@/lib/dates";
import {
  attentionReasonLabel,
  lastActivity,
  leadDisplayName,
  shortName,
  type LeadListRow,
} from "@/lib/leads/types";
import type { LeadFilters, SortColumn } from "@/lib/leads/filters";
import { LeadSourceBadge } from "./lead-source-badge";
import { LeadRowActions } from "./lead-row-actions";
import { useLeadParams } from "./use-lead-params";

/** Time-of-day beneath the date, in the workspace's own timezone. */
function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function SortHeader({
  column,
  label,
  filters,
  align,
}: {
  column: SortColumn;
  label: string;
  filters: LeadFilters;
  align?: "right";
}) {
  const { setParams } = useLeadParams();
  const active = filters.sort === column;
  const Icon = !active ? ChevronsUpDown : filters.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
      className="px-3 py-0 text-left font-medium"
    >
      <button
        type="button"
        onClick={() =>
          setParams({
            sort: column,
            dir: active && filters.dir === "desc" ? "asc" : "desc",
            page: null,
          })
        }
        className={cn(
          "inline-flex h-9 items-center gap-1 text-[12px] font-semibold transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
          align === "right" && "justify-end",
          active ? "text-content" : "text-content-secondary hover:text-content",
        )}
      >
        {label}
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </button>
    </th>
  );
}

export function LeadsTable({
  rows,
  assigneeNames,
  filters,
  selected,
  onSelectedChange,
  onOpen,
}: {
  rows: LeadListRow[];
  assigneeNames: Map<string, string>;
  filters: LeadFilters;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (row: LeadListRow) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = rows.some((row) => selected.has(row.id));

  const toggleAll = () => {
    if (allSelected) onSelectedChange(new Set());
    else onSelectedChange(new Set(rows.map((row) => row.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-surface-sunken/50 text-[12px] font-semibold text-content-secondary">
            <th scope="col" className="w-11 px-4 py-0">
              <Checkbox
                checked={allSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleAll}
                aria-label="Select all leads on this page"
              />
            </th>
            <th scope="col" className="px-3 py-0 font-semibold">
              <span className="inline-flex h-9 items-center">Lead</span>
            </th>
            <th scope="col" className="px-3 py-0 font-semibold">
              <span className="inline-flex h-9 items-center">Service</span>
            </th>
            <th scope="col" className="px-3 py-0 font-semibold">
              <span className="inline-flex h-9 items-center">Source</span>
            </th>
            <th scope="col" className="px-3 py-0 font-semibold">
              <span className="inline-flex h-9 items-center">Status</span>
            </th>
            <th scope="col" className="px-3 py-0 font-semibold">
              <span className="inline-flex h-9 items-center">Assigned</span>
            </th>
            <SortHeader column="created_at" label="Created" filters={filters} />
            <SortHeader
              column="last_contact_at"
              label="Last Activity"
              filters={filters}
            />
            <th scope="col" className="w-12 px-3 py-0">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const name = leadDisplayName(row);
            const activity = lastActivity(row);
            const assignee = row.assigned_user_id
              ? (assigneeNames.get(row.assigned_user_id) ?? "Unknown user")
              : null;

            return (
              <tr
                key={row.id}
                tabIndex={0}
                aria-label={`Open lead ${name}`}
                onClick={() => onOpen(row)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(row);
                  }
                }}
                className={cn(
                  "cursor-pointer border-b border-line-subtle last:border-b-0",
                  "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
                  selected.has(row.id) && "bg-accent-50/50",
                  row.opted_out && "opacity-75",
                )}
              >
                <td className="px-4 py-2 align-middle">
                  <span onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`Select ${name}`}
                    />
                  </span>
                </td>

                {/* identity — name over contact details, two dense lines */}
                <td className="px-3 py-2 align-middle">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={name} src={row.avatarUrl} size="md" />
                    <div className="min-w-0 leading-[1.35]">
                      <div className="flex items-center gap-1.5">
                        {row.needs_attention && (
                          <AlertCircle
                            className="size-3.5 shrink-0 text-danger-500"
                            aria-hidden
                          />
                        )}
                        <span className="truncate text-[13px] font-semibold text-content">
                          {name}
                        </span>
                        {/* Attention rides with the identity rather than the
                            Status column: it is a separate fact from status,
                            and stacking two chips would cost ~14px a row. */}
                        {row.needs_attention && (
                          <span
                            title={attentionReasonLabel(row.attention_reason)}
                            className="shrink-0 rounded-full bg-danger-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-danger-700"
                          >
                            Attention
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-content-muted">
                        {[row.email, row.phone].filter(Boolean).join(" • ") ||
                          "No contact details"}
                      </p>
                      {row.postcode && (
                        <p className="truncate text-[11px] text-content-subtle">
                          {row.postcode}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                <td className="max-w-[180px] px-3 py-2 align-middle">
                  <span className="block truncate text-[13px] text-content-secondary">
                    {row.services?.name ?? "—"}
                  </span>
                </td>

                <td className="px-3 py-2 align-middle">
                  <LeadSourceBadge source={row.lead_sources} size="sm" />
                </td>

                {/* Status and attention are separate facts: a lead can be
                    Qualified *and* need attention, so they never share a chip. */}
                <td className="px-3 py-2 align-middle">
                  <StatusBadge kind="lead" value={row.status} />
                </td>

                <td className="px-3 py-2 align-middle">
                  {assignee ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar name={assignee} size="sm" />
                      <span
                        title={assignee}
                        className="truncate text-[12px] text-content-secondary"
                      >
                        {shortName(assignee)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[12px] text-content-subtle">Unassigned</span>
                  )}
                </td>

                <td className="px-3 py-2 align-middle">
                  <p className="lr-tabular whitespace-nowrap text-[12px] leading-[1.35] text-content-secondary">
                    {formatDate(row.created_at)}
                  </p>
                  <p className="lr-tabular whitespace-nowrap text-[11px] leading-[1.35] text-content-subtle">
                    {timeLabel(row.created_at)}
                  </p>
                </td>

                <td className="px-3 py-2 align-middle">
                  <p className="whitespace-nowrap text-[12px] leading-[1.35] text-content-secondary">
                    {formatRelative(activity.at)}
                  </p>
                  <p
                    className={cn(
                      "max-w-[140px] truncate text-[11px] leading-[1.35]",
                      row.needs_attention ? "text-danger-600" : "text-content-subtle",
                    )}
                  >
                    {activity.label}
                  </p>
                </td>

                <td className="px-3 py-2 text-right align-middle">
                  <LeadRowActions
                    leadId={row.id}
                    leadName={name}
                    onOpen={() => onOpen(row)}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Actions for ${name}`}
                        onClick={(event) => event.stopPropagation()}
                        className="rounded-md p-1.5 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                      </button>
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
