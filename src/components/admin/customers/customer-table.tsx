"use client";

import * as React from "react";
import {
  ChevronsUpDown,
  ChevronDown,
  ChevronUp,
  Ban,
  MoreHorizontal,
  PanelRightOpen,
  RotateCw,
  Send,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/feedback";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import {
  BusinessCell,
  ConnectionHealthBadge,
  InitialAvatar,
  PlanBadge,
  UsageCellView,
} from "@/components/admin/ui";
import { formatDate, formatRelative, initialsOf } from "@/lib/admin/format";
import type {
  CustomerListResult,
  CustomerRow,
  CustomerSort,
} from "@/lib/admin/types";

type SortableKey = CustomerSort;

const COLUMNS: {
  key: string;
  label: string;
  sort?: SortableKey;
  className?: string;
}[] = [
  { key: "business", label: "Business", sort: "business" },
  { key: "owner", label: "Owner" },
  { key: "plan", label: "Plan", sort: "plan" },
  { key: "subscription", label: "Subscription", sort: "subscription" },
  { key: "lead_usage", label: "Lead usage", sort: "lead_usage" },
  { key: "message_usage", label: "Message usage", sort: "message_usage" },
  { key: "connection", label: "Connection health" },
  { key: "joined", label: "Joined", sort: "joined" },
  { key: "last_activity", label: "Last activity", sort: "last_activity" },
  { key: "actions", label: "Actions", className: "w-14 text-right" },
];

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-[11.5px] font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        active ? "text-content" : "text-content-muted hover:text-content",
      )}
    >
      {label}
      <Icon className="size-3 shrink-0" aria-hidden />
    </button>
  );
}

export function CustomerTable({
  result,
  sort,
  direction,
  onChange,
  onOpen,
  onAction,
}: {
  result: CustomerListResult;
  sort: CustomerSort;
  direction: "asc" | "desc";
  onChange: (patch: Record<string, string | null>) => void;
  onOpen: (row: CustomerRow) => void;
  onAction: (
    row: CustomerRow,
    action: "health" | "onboarding" | "suspend" | "unsuspend",
  ) => void;
}) {
  function toggleSort(key: SortableKey) {
    const nextDirection = sort === key && direction === "desc" ? "asc" : "desc";
    onChange({
      sort: key === "joined" ? null : key,
      dir: nextDirection === "desc" ? null : nextDirection,
      page: null,
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse">
          <caption className="sr-only">
            Every customer workspace on the platform, with plan, usage and
            connection health.
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface-sunken/60">
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "h-9 px-2.5 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted",
                    column.key === "business" && "pl-4",
                    column.className,
                  )}
                >
                  {column.sort ? (
                    <SortButton
                      label={column.label}
                      active={sort === column.sort}
                      direction={direction}
                      onClick={() => toggleSort(column.sort!)}
                    />
                  ) : column.key === "actions" ? (
                    <span className="sr-only">{column.label}</span>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-0">
                  <EmptyState
                    title="No customers match these filters"
                    description="Try a different status chip, or clear the search."
                  />
                </td>
              </tr>
            ) : (
              result.rows.map((row) => {
                const suspended = row.workspaceStatus === "suspended";
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover"
                    onClick={() => onOpen(row)}
                  >
                    <td className="py-2 pr-2.5 pl-4">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row);
                        }}
                        className="block w-full rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                      >
                        <BusinessCell name={row.name} domain={row.domain} />
                        {suspended && (
                          <span className="mt-1 inline-block text-[11px] font-medium text-danger-600">
                            Suspended
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <InitialAvatar initials={initialsOf(row.ownerName)} />
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium text-content">
                            {row.ownerName}
                          </p>
                          <p className="max-w-[150px] truncate text-[11.5px] text-content-subtle">
                            {row.ownerEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-2">
                      <PlanBadge plan={row.plan} label={row.planLabel} />
                    </td>
                    <td className="px-2.5 py-2">
                      <StatusBadge kind="subscription" value={row.subscriptionStatus} />
                    </td>
                    <td className="px-2.5 py-2">
                      <UsageCellView usage={row.leadUsage} label="Lead usage" />
                    </td>
                    <td className="px-2.5 py-2">
                      <UsageCellView usage={row.messageUsage} label="Message usage" />
                    </td>
                    <td className="px-2.5 py-2">
                      <ConnectionHealthBadge health={row.connectionHealth} />
                    </td>
                    <td className="px-2.5 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                      {formatDate(row.joinedAt)}
                    </td>
                    <td className="px-2.5 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                      {formatRelative(row.lastActivityAt)}
                    </td>
                    <td
                      className="px-2.5 py-2 text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DropdownMenu
                        trigger={
                          <button
                            type="button"
                            aria-label={`Actions for ${row.name}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-content-muted transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        }
                      >
                        <DropdownItem
                          icon={PanelRightOpen}
                          onSelect={() => onOpen(row)}
                        >
                          Open support drawer
                        </DropdownItem>
                        <DropdownItem
                          icon={RotateCw}
                          onSelect={() => onAction(row, "health")}
                        >
                          Run health check
                        </DropdownItem>
                        <DropdownItem
                          icon={Send}
                          onSelect={() => onAction(row, "onboarding")}
                        >
                          Resend onboarding
                        </DropdownItem>
                        {suspended ? (
                          <DropdownItem
                            icon={Undo2}
                            onSelect={() => onAction(row, "unsuspend")}
                          >
                            Restore workspace
                          </DropdownItem>
                        ) : (
                          <DropdownItem
                            icon={Ban}
                            destructive
                            onSelect={() => onAction(row, "suspend")}
                          >
                            Suspend workspace
                          </DropdownItem>
                        )}
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {result.total > 0 && (
        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          noun="customers"
          onPageChange={(page) =>
            onChange({ page: page === 1 ? null : String(page) })
          }
        />
      )}
    </div>
  );
}
