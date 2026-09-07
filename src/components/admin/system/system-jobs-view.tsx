"use client";

import * as React from "react";
import {
  AlertOctagon,
  CalendarDays,
  CheckCircle2,
  Cog,
  Inbox,
  ListChecks,
  Play,
  RotateCcw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover } from "@/components/ui/popover";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/feedback";
import { Sparkline } from "@/components/dashboard/sparkline";
import {
  IconTile,
  Panel,
  PanelEmpty,
  ProviderMark,
  type TileTone,
} from "@/components/admin/ui";
import { DonutChart, MultiLineChart } from "@/components/admin/charts";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { JobDetailDrawer } from "./job-detail-drawer";
import { cancelJob, moveJobToDeadLetter, retryJob } from "@/lib/admin/job-actions";
import { formatChange, formatNumber, formatRelative } from "@/lib/admin/format";
import {
  ADMIN_RANGES,
  ADMIN_RANGE_LABEL,
  type AdminRange,
} from "@/lib/admin/types";
import {
  JOB_PRIORITIES,
  JOB_PRIORITY_LABEL,
  JOB_PRIORITY_TONE,
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  type JobRow,
  type JobsViewData,
  type JobStatusFilter,
} from "@/lib/admin/jobs-types";

export function JobStatusBadge({ status }: { status: JobRow["status"] }) {
  return (
    <Badge tone={JOB_STATUS_TONE[status]} dot>
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Duration reads in the unit an operator would say out loud. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const KPI: {
  key: "total" | "completed" | "failed" | "running";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
  /** True when a rise is bad, so the delta tone follows meaning not sign. */
  invert?: boolean;
}[] = [
  { key: "total", label: "Total jobs", icon: ListChecks, tone: "accent" },
  { key: "completed", label: "Completed", icon: CheckCircle2, tone: "success" },
  { key: "failed", label: "Failed", icon: XCircle, tone: "danger", invert: true },
  { key: "running", label: "Running", icon: Play, tone: "info" },
];

export function SystemJobsView({
  data,
  filters,
}: {
  data: JobsViewData;
  filters: {
    search: string;
    type: string;
    status: JobStatusFilter;
    provider: string;
    priority: string;
    queue: string;
    range: AdminRange;
  };
}) {
  const { setParams } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();
  const { summary, list, detail } = data;

  const onRetry = React.useCallback(
    (jobId: string, confirmUnverifiable?: boolean) =>
      void run(
        `retry:${jobId}`,
        () => retryJob({ jobId, confirmUnverifiable }),
        "Job re-queued.",
      ),
    [run],
  );

  const onCancel = React.useCallback(
    (jobId: string) =>
      void run(`cancel:${jobId}`, () => cancelJob({ jobId }), "Job cancelled."),
    [run],
  );

  const onDeadLetter = React.useCallback(
    (jobId: string) =>
      void run(
        `dlq:${jobId}`,
        () => moveJobToDeadLetter({ jobId }),
        "Moved to the dead-letter queue.",
      ),
    [run],
  );

  const lagLabels = React.useMemo(
    () => axisLabels(data.queueLag.map((point) => point.bucket)),
    [data.queueLag],
  );

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPI.map((card) => {
          const value = summary[card.key];
          const ratio =
            card.key === "total"
              ? summary.previousTotal === 0
                ? null
                : (summary.total - summary.previousTotal) / summary.previousTotal
              : null;
          const share =
            card.key === "completed" && summary.completionRate !== null
              ? `${Math.round(summary.completionRate * 1000) / 10}% of finished`
              : card.key === "failed" && summary.total > 0
                ? `${Math.round((summary.failed / summary.total) * 1000) / 10}% of window`
                : card.key === "running" && summary.total > 0
                  ? `${Math.round((summary.running / summary.total) * 1000) / 10}% of window`
                  : null;
          const tone =
            ratio === null || ratio === 0
              ? "neutral"
              : (card.invert ? ratio < 0 : ratio > 0)
                ? "positive"
                : "negative";

          return (
            <div
              key={card.key}
              className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
            >
              <div className="flex items-center gap-2.5">
                <IconTile icon={card.icon} tone={card.tone} />
                <p className="min-w-0 truncate text-[12.5px] font-medium text-content-muted">
                  {card.label}
                </p>
              </div>
              <p className="lr-tabular mt-2.5 text-[28px] leading-none font-semibold tracking-[-0.025em] text-content">
                {formatNumber(value)}
              </p>
              <div className="mt-2 flex items-end justify-between gap-2">
                <p className="min-w-0 truncate text-[11.5px]">
                  {ratio !== null ? (
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
                  ) : (
                    <span className="text-content-muted">{share ?? "—"}</span>
                  )}
                </p>
                <Sparkline
                  values={summary.series[card.key]}
                  tone={
                    card.key === "failed"
                      ? "negative"
                      : card.key === "completed"
                        ? "positive"
                        : "neutral"
                  }
                  width={90}
                  height={24}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* -------------------------------------- lag · type mix · dead letter */}
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Panel
          icon={Cog}
          tone="accent"
          title="Queue lag"
          description="Average minutes waited between becoming due and being claimed."
        >
          <div className="px-4 pb-4 sm:px-5">
            <MultiLineChart
              labels={lagLabels}
              formatValue={(value) => `${Math.round(value)}m`}
              emptyMessage="No jobs were claimed in this window."
              series={[
                {
                  label: "Critical",
                  values: data.queueLag.map((point) => point.critical),
                  color: "var(--lr-chart-5, #EF4444)",
                },
                {
                  label: "High",
                  values: data.queueLag.map((point) => point.high),
                  color: "var(--lr-chart-3, #F59E0B)",
                },
                {
                  label: "Normal",
                  values: data.queueLag.map((point) => point.normal),
                  color: "var(--lr-chart-1, #3B82F6)",
                },
              ]}
            />
          </div>
        </Panel>

        <Panel
          icon={ListChecks}
          tone="info"
          title="Jobs by type"
          description="Share of the window by handler."
        >
          <div className="px-4 pb-4 sm:px-5">
            {data.byType.length === 0 ? (
              <PanelEmpty>No jobs ran in this window.</PanelEmpty>
            ) : (
              <DonutChart
                slices={data.byType.map((slice) => ({
                  label: slice.label,
                  value: slice.count,
                }))}
                totalLabel="Total"
                size={150}
                thickness={20}
              />
            )}
          </div>
        </Panel>

        <Panel
          icon={AlertOctagon}
          tone="danger"
          title="Dead letter queue"
          description="Jobs that have permanently failed."
          action={
            <button
              type="button"
              onClick={() => setParams({ status: "DEAD_LETTER", page: null })}
              className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content"
            >
              View all
            </button>
          }
        >
          {data.deadLetter.length === 0 ? (
            <PanelEmpty>Nothing has been dead-lettered in this window.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-line">
              {data.deadLetter.slice(0, 6).map((group) => (
                <li key={group.type}>
                  <button
                    type="button"
                    onClick={() =>
                      setParams({
                        type: group.type,
                        status: "DEAD_LETTER",
                        page: null,
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover sm:px-5"
                  >
                    <span className="lr-tabular flex size-7 shrink-0 items-center justify-center rounded-md bg-danger-50 text-[11.5px] font-semibold text-danger-600">
                      {group.count}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-content">
                        {group.label}
                      </span>
                      <span className="block truncate text-[11.5px] text-content-subtle">
                        Oldest {formatRelative(group.oldestAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* --------------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          defaultValue={filters.search}
          label="Search background jobs"
          placeholder="Search jobs by ID, type, provider or metadata..."
          onChange={(value) => setParams({ q: value || null, page: null })}
          className="w-full min-w-[220px] sm:w-[352px]"
        />

        <FilterSelect
          label="Job type"
          value={filters.type}
          onChange={(value) => setParams({ type: value === "all" ? null : value, page: null })}
          options={[
            { value: "all", label: "All job types" },
            ...list.types.map((option) => ({
              value: option.value,
              label: `${option.label} (${option.count})`,
            })),
          ]}
        />

        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(value) => setParams({ status: value === "all" ? null : value, page: null })}
          options={[
            { value: "all", label: "All statuses" },
            ...JOB_STATUSES.map((option) => ({
              value: option,
              label: JOB_STATUS_LABEL[option],
            })),
          ]}
        />

        <FilterSelect
          label="Provider"
          value={filters.provider}
          onChange={(value) => setParams({ provider: value === "all" ? null : value, page: null })}
          options={[
            { value: "all", label: "All providers" },
            ...list.providers.map((option) => ({ value: option, label: option })),
          ]}
        />

        <FilterSelect
          label="Date range"
          icon={CalendarDays}
          value={filters.range}
          onChange={(value) => setParams({ range: value === "7d" ? null : value, page: null })}
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
            <div className="w-64 space-y-3 p-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-content-muted">
                  Priority
                </span>
                <Select
                  value={filters.priority}
                  onChange={(event) =>
                    setParams({
                      priority: event.target.value === "all" ? null : event.target.value,
                      page: null,
                    })
                  }
                >
                  <option value="all">All priorities</option>
                  {JOB_PRIORITIES.map((band) => (
                    <option key={band} value={band}>
                      {JOB_PRIORITY_LABEL[band]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-content-muted">
                  Rows per page
                </span>
                <Select
                  value={list.pageSize}
                  onChange={(event) => setParams({ size: event.target.value, page: null })}
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
                      status: null,
                      provider: null,
                      priority: null,
                      queue: null,
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
      </div>

      {/* ----------------------------------------------------------- table */}
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No jobs match these filters"
            description="Widen the date range or clear a filter to see the queue."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-sunken/60">
                    {[
                      "Job ID",
                      "Type",
                      "Provider",
                      "Status",
                      "Priority",
                      "Attempts",
                      "Created",
                      "Started",
                      "Duration",
                      "",
                    ].map((heading, index) => (
                      <th
                        key={heading || index}
                        scope="col"
                        className="px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-content-muted uppercase"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.rows.map((job) => {
                    const selected = detail?.id === job.id;
                    return (
                      <tr
                        key={job.id}
                        className={cn(
                          "transition-colors",
                          selected ? "bg-accent-50/60" : "hover:bg-surface-hover",
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setParams({ job: job.id })}
                            className="lr-tabular truncate text-[12.5px] font-medium text-content-accent underline-offset-2 hover:underline"
                          >
                            {job.shortId}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-[12.5px] text-content">
                          {job.typeLabel}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2 text-[12.5px] text-content-secondary">
                            <ProviderMark provider={job.provider} />
                            {job.providerLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <JobStatusBadge status={job.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={JOB_PRIORITY_TONE[job.priorityBand]} className="px-2">
                            {JOB_PRIORITY_LABEL[job.priorityBand]}
                          </Badge>
                        </td>
                        <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content-secondary">
                          {job.attempts} / {job.maxAttempts}
                        </td>
                        <td className="px-4 py-2.5 text-[12.5px] whitespace-nowrap text-content-muted">
                          {formatRelative(job.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-[12.5px] whitespace-nowrap text-content-muted">
                          {job.startedAt ? formatRelative(job.startedAt) : "—"}
                        </td>
                        <td className="lr-tabular px-4 py-2.5 text-[12.5px] whitespace-nowrap text-content-secondary">
                          {formatDuration(job.durationMs)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {job.retryable && (
                              <button
                                type="button"
                                disabled={pending === `retry:${job.id}`}
                                onClick={() => setParams({ job: job.id })}
                                title="Open to review the safety check before retrying"
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content disabled:opacity-50"
                              >
                                <RotateCcw className="size-3" aria-hidden />
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setParams({ job: job.id })}
                              className="inline-flex h-7 items-center rounded-md border border-line px-2 text-[11.5px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content"
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line px-4 py-3">
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={list.total}
                onPageChange={(page) => setParams({ page: page === 1 ? null : String(page) })}
                noun="jobs"
              />
            </div>
          </>
        )}
      </section>

      {detail && (
        <JobDetailDrawer
          key={detail.id}
          job={detail}
          pending={pending}
          onClose={() => setParams({ job: null })}
          onRetry={onRetry}
          onCancel={onCancel}
          onDeadLetter={onDeadLetter}
        />
      )}

      {stepUpDialog}
    </div>
  );
}

/** Six evenly spaced ticks from a bucket list, formatted as clock times. */
function axisLabels(buckets: string[]): string[] {
  if (buckets.length === 0) return [];
  const wanted = Math.min(6, buckets.length);
  const stride = (buckets.length - 1) / Math.max(1, wanted - 1);
  return Array.from({ length: wanted }, (_, index) => {
    const bucket = buckets[Math.round(index * stride)];
    const date = new Date(bucket);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  });
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  icon: Icon,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <label className="relative inline-flex min-w-0 items-center">
      <span className="sr-only">{label}</span>
      {Icon && (
        <Icon
          className="pointer-events-none absolute left-3 size-3.5 text-content-subtle"
          aria-hidden
        />
      )}
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn("h-9 max-w-[210px] text-[12.5px]", Icon && "pl-8")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
