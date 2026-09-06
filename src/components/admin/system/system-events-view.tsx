"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Eye,
  ListTree,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/feedback";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import {
  EventStatusBadge,
  Panel,
  PanelEmpty,
  ProviderMark,
} from "@/components/admin/ui";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { EventDetailDrawer } from "./event-detail-drawer";
import { safeRetryEvent } from "@/lib/admin/actions";
import { formatNumber, formatRelative, providerLabel } from "@/lib/admin/format";
import {
  ADMIN_RANGES,
  ADMIN_RANGE_LABEL,
  EVENT_STATUS_FILTERS,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_FILTERS,
  EVENT_TYPE_FILTER_LABEL,
  type AdminRange,
  type EventDetail,
  type EventListResult,
  type EventStatusFilter,
  type EventTypeFilter,
} from "@/lib/admin/types";

const SUMMARY_DOT = {
  processed: "bg-success-500",
  retrying: "bg-warning-500",
  failed: "bg-danger-500",
  safeToRetry: "bg-info-500",
} as const;

const SUMMARY_LABEL = {
  processed: "Processed",
  retrying: "Retrying",
  failed: "Failed",
  safeToRetry: "Safe to retry",
} as const;

export function SystemEventsView({
  result,
  filters,
  detail,
}: {
  result: EventListResult;
  filters: {
    search: string;
    type: EventTypeFilter;
    provider: string;
    status: EventStatusFilter;
    range: AdminRange;
  };
  detail: EventDetail | null;
}) {
  const { setParams, pending: navigating } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();

  const retry = React.useCallback(
    (eventId: string) =>
      void run(
        `retry:${eventId}`,
        () => safeRetryEvent(eventId),
        "Event re-queued for processing.",
      ),
    [run],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          defaultValue={filters.search}
          label="Search operational events"
          placeholder="Search event IDs, businesses, or messages..."
          onChange={(value) => setParams({ q: value || null, page: null })}
          className="w-full min-w-[220px] sm:w-[352px]"
        />

        <FilterSelect
          label="Event type"
          value={filters.type}
          onChange={(value) => setParams({ type: value === "all" ? null : value, page: null })}
          options={EVENT_TYPE_FILTERS.map((option) => ({
            value: option,
            label: EVENT_TYPE_FILTER_LABEL[option],
          }))}
        />

        <FilterSelect
          label="Provider"
          value={filters.provider}
          onChange={(value) =>
            setParams({ provider: value === "all" ? null : value, page: null })
          }
          options={[
            { value: "all", label: "All providers" },
            ...result.providers.map((option) => ({
              value: option,
              label: providerLabel(option),
            })),
          ]}
        />

        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(value) =>
            setParams({ status: value === "all" ? null : value, page: null })
          }
          options={EVENT_STATUS_FILTERS.map((option) => ({
            value: option,
            label:
              option === "all"
                ? "All statuses"
                : EVENT_STATUS_LABEL[option as keyof typeof EVENT_STATUS_LABEL],
          }))}
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
                      type: null,
                      provider: null,
                      status: null,
                      range: null,
                      size: null,
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

        <button
          type="button"
          onClick={() => setParams({ _r: String(Date.now()) })}
          aria-busy={navigating || undefined}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          <RefreshCw
            className={cn("size-3.5", navigating && "animate-spin")}
            aria-hidden
          />
          Refresh feed
        </button>
      </div>

      <Panel
        icon={ListTree}
        tone="accent"
        title="Operational events"
        description="Recent inbound and outbound operational activity."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(SUMMARY_LABEL) as (keyof typeof SUMMARY_LABEL)[]).map(
              (key) => (
                <div
                  key={key}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5"
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-content-muted">
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", SUMMARY_DOT[key])}
                    />
                    {SUMMARY_LABEL[key]}
                  </p>
                  <p className="lr-tabular text-[15px] font-semibold text-content">
                    {formatNumber(result.counts[key])}
                  </p>
                </div>
              ),
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <caption className="sr-only">
              Operational events across every workspace, newest first.
            </caption>
            <thead>
              <tr className="border-y border-line-subtle bg-surface-sunken/60">
                <Th className="pl-5">Provider</Th>
                <Th>Type</Th>
                <Th>Business</Th>
                <Th>Status</Th>
                <Th numeric>Attempts</Th>
                <Th>Received</Th>
                <Th>Last error</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      title="No operational events match these filters"
                      description="Widen the date range, or clear the provider and status filters."
                    />
                  </td>
                </tr>
              ) : (
                result.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-surface-hover"
                    onClick={() => setParams({ event: row.id })}
                  >
                    <td className="py-2 pr-3 pl-5">
                      <span className="flex items-center gap-2 text-[12.5px] font-medium whitespace-nowrap text-content">
                        <ProviderMark provider={row.provider} />
                        {row.providerLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                      {row.typeLabel}
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
                        "Platform"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <EventStatusBadge status={row.status} />
                    </td>
                    <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                      {row.attempts}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                      {formatRelative(row.receivedAt)}
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-[12.5px] text-content-secondary">
                      <span className="block truncate">{row.lastError ?? "—"}</span>
                    </td>
                    <td
                      className="px-3 py-2 text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DropdownMenu
                        trigger={
                          <button
                            type="button"
                            aria-label={`Actions for ${row.providerLabel} ${row.typeLabel}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-content-muted transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        }
                      >
                        <DropdownItem
                          icon={Eye}
                          onSelect={() => setParams({ event: row.id })}
                        >
                          View details
                        </DropdownItem>
                        {/* Only genuinely replayable events are offered a
                            retry; the server re-checks regardless. */}
                        {row.retryable && (
                          <DropdownItem
                            icon={RotateCw}
                            onSelect={() => retry(row.id)}
                          >
                            Safe retry
                          </DropdownItem>
                        )}
                      </DropdownMenu>
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
            noun="events"
            onPageChange={(page) =>
              setParams({ page: page === 1 ? null : String(page) })
            }
          />
        )}
      </Panel>

      <Panel
        icon={RotateCw}
        tone="success"
        title="Safe retry queue"
        description="Failed events that can be safely retried."
        action={
          <Link
            href="/admin/system?view=events&status=FAILED"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content"
          >
            View all failed events
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      >
        {result.safeRetryQueue.length === 0 ? (
          <PanelEmpty>No events are currently safe to retry.</PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="border-y border-line-subtle bg-surface-sunken/60">
                  <Th className="pl-5">Provider</Th>
                  <Th>Type</Th>
                  <Th>Business</Th>
                  <Th>Last error</Th>
                  <Th>Failed at</Th>
                  <Th numeric>Attempts</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {result.safeRetryQueue.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="py-2 pr-3 pl-5">
                      <span className="flex items-center gap-2 text-[12.5px] font-medium whitespace-nowrap text-content">
                        <ProviderMark provider={row.provider} />
                        {row.providerLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                      {row.typeLabel}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                      {row.businessName ?? "Platform"}
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-[12.5px] text-content-secondary">
                      <span className="block truncate">{row.lastError ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                      {formatRelative(row.receivedAt)}
                    </td>
                    <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                      {row.attempts}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending === `retry:${row.id}`}
                        onClick={() => retry(row.id)}
                      >
                        <Play className="size-3.5" aria-hidden />
                        Safe retry
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {detail && (
        <EventDetailDrawer
          detail={detail}
          retrying={pending === `retry:${detail.id}`}
          onClose={() => setParams({ event: null })}
          onRetry={() => retry(detail.id)}
        />
      )}

      {stepUpDialog}
    </div>
  );
}

function Th({
  children,
  className,
  numeric,
}: {
  children: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "h-8 px-3 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted",
        numeric && "lr-tabular",
        className,
      )}
    >
      {children}
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
