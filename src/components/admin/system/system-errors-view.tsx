"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpDown,
  Bug,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/feedback";
import { Sparkline } from "@/components/dashboard/sparkline";
import {
  IconTile,
  Panel,
  SeverityBadge,
  type TileTone,
} from "@/components/admin/ui";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { ErrorDetailPanel } from "./error-detail-panel";
import { setErrorStatus } from "@/lib/admin/actions";
import { formatChange, formatNumber, formatRelative } from "@/lib/admin/format";
import {
  ADMIN_RANGES,
  ADMIN_RANGE_COMPARISON,
  ADMIN_RANGE_LABEL,
  ERROR_SEVERITIES,
  ERROR_SEVERITY_LABEL,
  ERROR_STATUSES,
  ERROR_STATUS_LABEL,
  type AdminRange,
  type ErrorListResult,
  type ErrorSeverity,
  type ErrorTriageStatus,
  type PlatformErrorRow,
} from "@/lib/admin/types";

const SEVERITY_CARD: Record<
  ErrorSeverity,
  { icon: React.ComponentType<{ className?: string }>; tone: TileTone }
> = {
  CRITICAL: { icon: Bug, tone: "danger" },
  HIGH: { icon: AlertTriangle, tone: "warning" },
  MEDIUM: { icon: CircleAlert, tone: "warning" },
  LOW: { icon: Info, tone: "info" },
};

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "severity", label: "Severity" },
  { value: "occurrences", label: "Occurrences" },
] as const;

export function SystemErrorsView({
  result,
  filters,
  selected,
}: {
  result: ErrorListResult;
  filters: {
    search: string;
    severity: ErrorSeverity | "all";
    area: string;
    status: ErrorTriageStatus | "all";
    range: AdminRange;
    sort: (typeof SORTS)[number]["value"];
  };
  selected: PlatformErrorRow | null;
}) {
  const { setParams } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();
  const comparison = ADMIN_RANGE_COMPARISON[filters.range];

  const changeStatus = React.useCallback(
    (row: PlatformErrorRow, status: ErrorTriageStatus) =>
      void run(
        `triage:${row.fingerprint}`,
        () =>
          setErrorStatus({
            fingerprint: row.fingerprint,
            area: row.area,
            severity: row.severity,
            status,
            businessId: row.businessId,
          }),
        "Error status updated.",
      ),
    [run],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          defaultValue={filters.search}
          label="Search platform errors"
          placeholder="Search errors, businesses, or references..."
          onChange={(value) => setParams({ q: value || null, page: null })}
          className="w-full min-w-[220px] sm:w-[352px]"
        />

        <FilterSelect
          label="Severity"
          value={filters.severity}
          onChange={(value) =>
            setParams({ severity: value === "all" ? null : value, page: null })
          }
          options={[
            { value: "all", label: "All severities" },
            ...ERROR_SEVERITIES.map((option) => ({
              value: option,
              label: ERROR_SEVERITY_LABEL[option],
            })),
          ]}
        />

        <FilterSelect
          label="Area"
          value={filters.area}
          onChange={(value) =>
            setParams({ area: value === "all" ? null : value, page: null })
          }
          options={[
            { value: "all", label: "All areas" },
            ...result.areas.map((option) => ({ value: option, label: option })),
          ]}
        />

        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(value) =>
            setParams({ status: value === "all" ? null : value, page: null })
          }
          options={[
            { value: "all", label: "All statuses" },
            ...ERROR_STATUSES.map((option) => ({
              value: option,
              label: ERROR_STATUS_LABEL[option],
            })),
          ]}
        />

        <FilterSelect
          label="Date range"
          icon={CalendarDays}
          value={filters.range}
          onChange={(value) =>
            setParams({ range: value === "7d" ? null : value, page: null })
          }
          options={ADMIN_RANGES.map((option) => ({
            value: option,
            label: ADMIN_RANGE_LABEL[option],
          }))}
        />

        <Popover
          label="More filters"
          align="end"
          className="ml-auto"
          trigger={
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              More filters
            </button>
          }
        >
          {(close) => (
            <div className="w-60 space-y-3 p-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-content-muted">
                  Rows per page
                </span>
                <Select
                  value={result.pageSize}
                  onChange={(event) =>
                    setParams({ size: event.target.value, page: null })
                  }
                >
                  {[10, 25, 50].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setParams({
                      q: null,
                      severity: null,
                      area: null,
                      status: null,
                      range: null,
                      size: null,
                      sort: null,
                      page: null,
                    });
                    close();
                  }}
                >
                  Reset
                </Button>
                <Button size="sm" onClick={close}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </Popover>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ERROR_SEVERITIES.map((severity) => {
          const config = SEVERITY_CARD[severity];
          const current = result.counts[severity];
          const previous = result.previousCounts[severity];
          const ratio =
            previous === 0
              ? current === 0
                ? 0
                : null
              : (current - previous) / previous;
          const tone =
            ratio === null || ratio === 0
              ? "neutral"
              : ratio > 0
                ? "negative"
                : "positive";

          return (
            <button
              key={severity}
              type="button"
              aria-pressed={filters.severity === severity}
              onClick={() =>
                setParams({
                  severity: filters.severity === severity ? null : severity,
                  page: null,
                })
              }
              className={cn(
                "rounded-xl border bg-surface px-4 py-3.5 text-left shadow-xs",
                "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                filters.severity === severity
                  ? "border-accent-500"
                  : "border-line hover:bg-surface-hover",
              )}
            >
              <div className="flex items-center gap-2.5">
                <IconTile icon={config.icon} tone={config.tone} />
                <p className="text-[12.5px] font-medium text-content-muted">
                  {ERROR_SEVERITY_LABEL[severity]}
                </p>
              </div>
              <p className="lr-tabular mt-2.5 text-[28px] leading-none font-semibold tracking-[-0.025em] text-content">
                {formatNumber(current)}
              </p>
              <p className="mt-2 flex items-center gap-1 text-[11.5px]">
                <span
                  className={cn(
                    "lr-tabular font-semibold",
                    tone === "negative" && "text-danger-600",
                    tone === "positive" && "text-success-600",
                    tone === "neutral" && "text-content-muted",
                  )}
                >
                  {formatChange(ratio)}
                </span>
                <span className="truncate text-content-muted">
                  {ratio === null ? "no baseline" : comparison}
                </span>
              </p>
              {result.series[severity].some((value) => value > 0) && (
                <Sparkline
                  values={result.series[severity]}
                  tone={tone}
                  width={150}
                  height={24}
                  className="mt-2 w-full"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="@container/errors">
        <div
          className={cn(
            "grid gap-4",
            selected && "@[72rem]/errors:grid-cols-[minmax(0,1fr)_400px]",
          )}
        >
          <Panel
            icon={AlertTriangle}
            tone="danger"
            title="Platform errors"
            description="Track and investigate the most important operational failures."
            action={
              <div className="flex items-center gap-2">
                <span className="text-[12px] whitespace-nowrap text-content-muted">
                  {formatNumber(result.total)}{" "}
                  {result.total === 1 ? "error" : "errors"}
                </span>
                <div className="relative">
                  <label htmlFor="error-sort" className="sr-only">
                    Sort errors
                  </label>
                  <ArrowUpDown
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-content-subtle"
                    aria-hidden
                  />
                  <Select
                    id="error-sort"
                    value={filters.sort}
                    onChange={(event) =>
                      setParams({
                        sort:
                          event.target.value === "newest"
                            ? null
                            : event.target.value,
                        page: null,
                      })
                    }
                    className="h-8 pl-7 text-[12.5px]"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse">
                <caption className="sr-only">
                  Platform errors grouped by fingerprint, with severity and
                  reference.
                </caption>
                <thead>
                  <tr className="border-y border-line-subtle bg-surface-sunken/60">
                    <Th className="pl-5">Area</Th>
                    <Th>Business</Th>
                    <Th>Message</Th>
                    <Th>Severity</Th>
                    <Th>Time</Th>
                    <Th>Reference</Th>
                    <Th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {result.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <EmptyState
                          title="No platform errors in this period"
                          description="Nothing has failed across the selected window and filters."
                        />
                      </td>
                    </tr>
                  ) : (
                    result.rows.map((row) => (
                      <tr
                        key={row.fingerprint}
                        onClick={() => setParams({ error: row.fingerprint })}
                        className={cn(
                          "cursor-pointer hover:bg-surface-hover",
                          selected?.fingerprint === row.fingerprint &&
                            "bg-accent-50",
                        )}
                      >
                        <td className="py-2 pr-3 pl-5 text-[12.5px] font-medium whitespace-nowrap text-content">
                          {row.area}
                        </td>
                        <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                          {row.businessId ? (
                            <Link
                              href={`/admin/customers?customer=${row.businessId}`}
                              onClick={(event) => event.stopPropagation()}
                              className="hover:text-content-accent"
                            >
                              {row.businessName}
                            </Link>
                          ) : (
                            row.businessName
                          )}
                        </td>
                        <td className="max-w-[320px] px-3 py-2 text-[12.5px] text-content-secondary">
                          <span className="block truncate">{row.message}</span>
                        </td>
                        <td className="px-3 py-2">
                          <SeverityBadge severity={row.severity} />
                        </td>
                        <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                          {formatRelative(row.lastSeen)}
                        </td>
                        <td className="lr-tabular px-3 py-2 text-[12.5px] whitespace-nowrap text-content-accent">
                          {row.reference}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ChevronRight
                            className="inline size-4 text-content-subtle"
                            aria-hidden
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {result.total > 0 && (
              <Pagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                noun="errors"
                onPageChange={(page) =>
                  setParams({ page: page === 1 ? null : String(page) })
                }
              />
            )}
          </Panel>

          {selected && (
            <ErrorDetailPanel
              error={selected}
              pending={pending === `triage:${selected.fingerprint}`}
              onClose={() => setParams({ error: null })}
              onStatusChange={(status) => changeStatus(selected, status)}
            />
          )}
        </div>
      </div>

      {stepUpDialog}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "h-8 px-3 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted",
        className,
      )}
    >
      {children ?? <span className="sr-only">Open</span>}
    </th>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon: Icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const id = React.useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {Icon && (
        <Icon
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-content-subtle"
          aria-hidden
        />
      )}
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn("h-9 text-[12.5px]", Icon && "pl-8")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
