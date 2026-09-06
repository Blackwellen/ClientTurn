"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Database,
  ListTree,
  RefreshCw,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  IconTile,
  Panel,
  PanelEmpty,
  ProviderMark,
  ProviderStatusBadge,
  QueueStatusBadge,
  type TileTone,
} from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { refreshProviderHealth } from "@/lib/admin/actions";
import {
  formatDateTime,
  formatMs,
  formatNumber,
  formatRelative,
  formatUptime,
} from "@/lib/admin/format";
import type { SystemHealth } from "@/lib/admin/types";

const SUMMARY: {
  key: keyof SystemHealth["summary"];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
}[] = [
  {
    key: "providersMonitored",
    label: "Providers monitored",
    icon: Database,
    tone: "accent",
  },
  {
    key: "healthyProviders",
    label: "Healthy providers",
    icon: CheckCircle2,
    tone: "success",
  },
  {
    key: "degradedServices",
    label: "Degraded services",
    icon: AlertTriangle,
    tone: "warning",
  },
  {
    key: "failedJobs",
    label: "Failed jobs",
    icon: CircleAlert,
    tone: "danger",
  },
  {
    key: "workspacesWithIssues",
    label: "Workspaces with issues",
    icon: Users,
    tone: "warning",
  },
];

const IMPACT_TONE = {
  Investigating: "warning",
  Degraded: "warning",
  Critical: "danger",
} as const;

export function SystemHealthView({ health }: { health: SystemHealth }) {
  const { run, pending, stepUpDialog } = useAdminAction();

  /**
   * Every caption below is derived from the payload already on screen. No
   * trend line is drawn for these five figures because nothing records their
   * history yet, and an invented sparkline would be worse than none.
   */
  const unconfigured = health.providers.filter((row) => !row.configured).length;
  const down = health.providers.filter((row) => row.status === "DOWN").length;
  const degraded = health.providers.filter(
    (row) => row.status === "DEGRADED",
  ).length;
  const queuesWithFailures = health.queues.filter(
    (row) => row.failed > 0,
  ).length;
  const impactedAreas = new Set(
    health.degradedWorkspaces.map((row) => row.area),
  ).size;

  const captions: Record<keyof SystemHealth["summary"], string> = {
    providersMonitored:
      unconfigured === 0
        ? "All providers configured"
        : `${unconfigured} not configured here`,
    healthyProviders: `of ${health.summary.providersMonitored} monitored`,
    degradedServices:
      down > 0
        ? `${degraded} slow, ${down} not answering`
        : degraded === 0
          ? "No provider is degraded"
          : `${degraded} answering slowly`,
    failedJobs:
      queuesWithFailures === 0
        ? "All queues draining"
        : `across ${queuesWithFailures} ${queuesWithFailures === 1 ? "queue" : "queues"}`,
    workspacesWithIssues:
      impactedAreas === 0
        ? "No customer impact recorded"
        : `${impactedAreas} ${impactedAreas === 1 ? "area" : "areas"} affected`,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {SUMMARY.map((card) => (
          <div
            key={card.key}
            className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
          >
            <div className="flex items-center gap-2.5">
              <IconTile icon={card.icon} tone={card.tone} />
              <p className="min-w-0 truncate text-[12.5px] font-medium text-content-muted">
                {card.label}
              </p>
            </div>
            <p className="lr-tabular mt-3 text-[28px] leading-none font-semibold tracking-[-0.025em] text-content">
              {formatNumber(health.summary[card.key])}
            </p>
            <p className="mt-2 truncate text-[11.5px] text-content-muted">
              {captions[card.key]}
            </p>
          </div>
        ))}
      </div>

      {/* The container has to be an ancestor of the queried element — an
          element cannot respond to its own container query. */}
      <div className="@container/panels">
        {/* Asymmetric on purpose: the provider table carries six columns
            including an action, the queue table five narrow numeric ones, so
            an even split would clip the former while padding the latter. */}
        <div className="grid items-start gap-4 @[78rem]/panels:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
          <Panel
            icon={Activity}
            tone="success"
            title="Provider health"
            description="Real-time status of connected providers and key services."
            action={
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  disabled={pending === "refresh"}
                  aria-busy={pending === "refresh" || undefined}
                  onClick={() =>
                    void run(
                      "refresh",
                      () => refreshProviderHealth(),
                      "Provider health refreshed.",
                    )
                  }
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3",
                    "text-[12.5px] font-medium text-content-secondary shadow-xs",
                    "transition-colors hover:bg-surface-hover hover:text-content",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      pending === "refresh" && "animate-spin",
                    )}
                    aria-hidden
                  />
                  Refresh now
                </button>
                <p className="text-[11px] text-content-subtle">
                  {health.checkedAt
                    ? `Last updated: ${formatDateTime(health.checkedAt)}`
                    : "Never probed"}
                </p>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse">
                <thead>
                  <tr className="border-y border-line-subtle bg-surface-sunken/60">
                    <Th className="pl-5">Provider</Th>
                    <Th>Status</Th>
                    <Th>Response time (p95)</Th>
                    <Th>Uptime (30d)</Th>
                    <Th>Last incident</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {health.providers.map((row) => (
                    <tr key={row.provider} className="hover:bg-surface-hover">
                      <td className="py-2 pr-2.5 pl-5">
                        <span className="flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-content">
                          <ProviderMark provider={row.provider} />
                          {row.label}
                          {row.detail && (
                            <Tooltip content={row.detail}>
                              <button
                                type="button"
                                aria-label={`About ${row.label} monitoring`}
                                className="size-4 shrink-0 rounded-full border border-line text-[10px] leading-[14px] text-content-subtle hover:text-content-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                              >
                                ?
                              </button>
                            </Tooltip>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <ProviderStatusBadge status={row.status} />
                      </td>
                      <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                        {formatMs(row.p95Ms)}
                      </td>
                      <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                        {formatUptime(row.uptime30d)}
                      </td>
                      <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                        {row.lastIncidentAt
                          ? formatDateTime(row.lastIncidentAt)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/admin/system?view=events&provider=${row.provider}`}
                          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent hover:underline"
                        >
                          View
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            icon={ListTree}
            tone="accent"
            title="Queue health"
            description="Background jobs and queue status across the platform."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[530px] border-collapse">
                <thead>
                  <tr className="border-y border-line-subtle bg-surface-sunken/60">
                    <Th className="pl-5">Queue</Th>
                    <Th numeric>Pending</Th>
                    <Th numeric>Processing</Th>
                    <Th numeric>Failed</Th>
                    <Th>Last run</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {health.queues.map((row) => (
                    <tr key={row.key} className="hover:bg-surface-hover">
                      <td className="py-2 pr-3 pl-5 text-[13px] font-medium whitespace-nowrap text-content">
                        {row.label}
                      </td>
                      <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                        {formatNumber(row.pending)}
                      </td>
                      <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                        {formatNumber(row.processing)}
                      </td>
                      <td
                        className={cn(
                          "lr-tabular px-3 py-2 text-[12.5px]",
                          row.failed > 0
                            ? "text-danger-600"
                            : "text-content-secondary",
                        )}
                      >
                        {formatNumber(row.failed)}
                      </td>
                      <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                        {formatRelative(row.lastRunAt)}
                      </td>
                      <td className="px-3 py-2">
                        <QueueStatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        icon={AlertTriangle}
        tone="danger"
        title="Degraded workspaces"
        description="Customer businesses currently experiencing issues."
      >
        {health.degradedWorkspaces.length === 0 ? (
          <PanelEmpty>All customer workspaces are healthy.</PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse">
              <thead>
                <tr className="border-y border-line-subtle bg-surface-sunken/60">
                  <Th className="pl-5">Business</Th>
                  <Th>Area</Th>
                  <Th>Impact</Th>
                  <Th>Since</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {health.degradedWorkspaces.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="py-2 pr-3 pl-5 text-[13px] font-medium whitespace-nowrap text-content">
                      {row.businessName}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                      {row.area}
                    </td>
                    <td className="max-w-[320px] px-3 py-2 text-[12.5px] text-content-secondary">
                      <span className="block truncate">{row.impact}</span>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                      {row.since ? formatDateTime(row.since) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={IMPACT_TONE[row.status]} dot>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/customers?customer=${row.businessId}`}
                        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent hover:underline"
                      >
                        View
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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
        "h-8 px-2.5 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted",
        numeric && "lr-tabular",
        className,
      )}
    >
      {children}
    </th>
  );
}
