import * as React from "react";
import {
  Bot,
  Calendar,
  Cloud,
  Database,
  Mail,
  MessageCircle,
  MessageSquare,
  Radar,
  Search,
  Send,
  Target,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  STATUS_META,
  type RecentFailure,
  type JobSummary,
  type ServiceStatus,
  type StatusGroup as StatusGroupData,
  type StatusService,
} from "@/lib/status/types";

/**
 * The public status page's building blocks (V4 §22.5-§22.9).
 *
 * Every one of these renders only what `StatusService` returned. There is no
 * fallback that invents a green tick, and no component computes a status of its
 * own — if the service could not determine a state, the component says so.
 */

const SERVICE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  lead_sources: Database,
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageCircle,
  booking: Calendar,
  sourcing: Search,
  intent: Target,
  campaigns: Send,
  agents: Bot,
  queues: Database,
  database: Database,
  storage: Cloud,
};

const DOT: Record<ServiceStatus, string> = {
  OPERATIONAL: "bg-emerald-500",
  DEGRADED: "bg-amber-500",
  OUTAGE: "bg-red-500",
  MAINTENANCE: "bg-slate-400",
};

const CHIP: Record<ServiceStatus, string> = {
  OPERATIONAL: "border-success-100 bg-success-50 text-success-700",
  DEGRADED: "border-warning-100 bg-warning-50 text-warning-700",
  OUTAGE: "border-danger-100 bg-danger-50 text-danger-700",
  MAINTENANCE: "border-line bg-bg text-content-muted",
};

/** Status is never colour-only: the chip always carries its word. */
export function StatusChip({ status }: { status: ServiceStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
        CHIP[status],
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status])} />
      {meta.label}
    </span>
  );
}

export function StatusLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {(Object.keys(STATUS_META) as ServiceStatus[]).map((status) => (
        <li key={status} className="flex items-center gap-2 text-[12.5px] text-content-muted">
          <span aria-hidden className={cn("size-2 rounded-full", DOT[status])} />
          {STATUS_META[status].label}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- group */

export function StatusGroup({ group }: { group: StatusGroupData }) {
  return (
    <section aria-labelledby={`group-${group.key}`}>
      <h3 id={`group-${group.key}`} className="sr-only">
        {group.name}
      </h3>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {group.services.map((service) => (
          <li key={service.key}>
            <StatusRow service={service} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StatusRow({ service }: { service: StatusService }) {
  const Icon = SERVICE_ICON[service.key] ?? Radar;

  return (
    <article className="h-full rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-emerald-100 bg-success-50 text-success-600"
          >
            <Icon className="size-4" />
          </span>
          <h4 className="min-w-0 text-[13.5px] font-semibold leading-tight text-content">
            {service.name}
          </h4>
        </div>
        <StatusChip status={service.status} />
      </div>

      <p className="mt-2 text-[12px] leading-[1.45] text-content-subtle">
        {service.description}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-[12.5px] font-medium text-content-secondary">
          {service.uptime === null
            ? "Uptime not measured"
            : `${(service.uptime * 100).toFixed(1)}% uptime`}
        </p>
        <UptimeSparkline history={service.history} name={service.name} />
      </div>
    </article>
  );
}

/**
 * Thirty daily bars.
 *
 * A day with no probe is rendered as a neutral gap rather than as green: we do
 * not know what happened that day, and drawing it as healthy would be an
 * invention.
 */
function UptimeSparkline({
  history,
  name,
}: {
  history: (ServiceStatus | null)[];
  name: string;
}) {
  const known = history.filter(Boolean).length;

  return (
    <div
      className="flex h-6 items-end gap-[2px]"
      role="img"
      aria-label={`${name}: daily status for the last ${history.length} days, ${known} days measured.`}
    >
      {history.map((status, index) => (
        <span
          key={index}
          className={cn(
            "w-[3px] rounded-[1px]",
            status === null ? "h-2 bg-line" : DOT[status],
            status === "OPERATIONAL" && "h-4",
            status === "DEGRADED" && "h-5",
            status === "OUTAGE" && "h-6",
            status === "MAINTENANCE" && "h-3",
          )}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- failures */

export function RecentFailures({ failures }: { failures: RecentFailure[] }) {
  return (
    <StatusPanel title="Recent failures" tone="danger">
      {failures.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-content-subtle">
          No failures recorded recently.
        </p>
      ) : (
        <table className="w-full text-left text-[12.5px]">
          <caption className="sr-only">
            Recent provider failures and whether they are resolved.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11.5px] text-content-subtle">
              <th scope="col" className="pb-2 font-medium">Time</th>
              <th scope="col" className="pb-2 font-medium">Service</th>
              <th scope="col" className="pb-2 font-medium">Error</th>
              <th scope="col" className="pb-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {failures.map((failure) => (
              <tr key={failure.id}>
                <td className="py-2 whitespace-nowrap text-content-subtle">
                  {formatShort(failure.at)}
                </td>
                <td className="py-2 text-content-secondary">{failure.service}</td>
                <td className="py-2 text-content-secondary">{failure.label}</td>
                <td className="py-2 text-right">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      failure.resolved
                        ? "border-success-100 bg-success-50 text-success-700"
                        : "border-warning-100 bg-warning-50 text-warning-700",
                    )}
                  >
                    {failure.resolved ? "Resolved" : "Investigating"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StatusPanel>
  );
}

/* -------------------------------------------------------------------- jobs */

export function BackgroundJobs({ jobs }: { jobs: JobSummary }) {
  const rows = [
    { label: "Total jobs (24h)", value: jobs.total24h, share: null, tone: "" },
    {
      label: "Completed",
      value: jobs.completed,
      share: jobs.completedShare,
      tone: "bg-emerald-500",
    },
    { label: "Failed", value: jobs.failed, share: jobs.failedShare, tone: "bg-red-500" },
    {
      label: "Retrying",
      value: jobs.retrying,
      share: jobs.retryingShare,
      tone: "bg-amber-500",
    },
  ];

  return (
    <StatusPanel title="Background jobs" tone="info">
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3">
            <span className="w-[8.5rem] shrink-0 text-[12.5px] text-content-muted">
              {row.label}
            </span>
            <span className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums text-content">
              {row.value.toLocaleString("en-GB")}
            </span>
            {row.share !== null && (
              <>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <span
                    className={cn("block h-full rounded-full", row.tone)}
                    style={{ width: `${Math.max(1, row.share * 100)}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-content-subtle">
                  {(row.share * 100).toFixed(1)}%
                </span>
              </>
            )}
          </li>
        ))}

        <li className="flex items-center justify-between gap-3 border-t border-line-subtle pt-2.5">
          <span className="text-[12.5px] text-content-muted">Average processing time</span>
          <span className="text-[13px] font-semibold tabular-nums text-content">
            {jobs.averageProcessingSeconds === null
              ? "—"
              : `${jobs.averageProcessingSeconds}s`}
          </span>
        </li>
      </ul>
    </StatusPanel>
  );
}

/* ---------------------------------------------------------------- last sync */

export function LastSync({
  rows,
}: {
  rows: { key: string; name: string; at: string | null }[];
}) {
  return (
    <StatusPanel title="Last successful sync" tone="info">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  row.at ? "bg-emerald-500" : "bg-line-strong",
                )}
              />
              <span className="truncate text-[12.5px] text-content-secondary">{row.name}</span>
            </span>
            <span className="shrink-0 text-[12.5px] tabular-nums text-content-subtle">
              {row.at ? formatShort(row.at) : "No recent sync"}
            </span>
          </li>
        ))}
      </ul>
    </StatusPanel>
  );
}

/* ------------------------------------------------------------------ shared */

export function StatusPanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "info" | "danger";
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <h3
        className={cn(
          "mb-3 text-[14px] font-semibold",
          tone === "danger" ? "text-content" : "text-content",
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** UTC, spelled out — a status page is read from every timezone at once. */
export function formatShort(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}
