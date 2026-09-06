"use client";

import * as React from "react";
import { ArrowUpRight, CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { readSystemStatus } from "@/lib/support/actions";
import { STATUS_META, type ServiceStatus } from "@/lib/status/service";

type Summary = Awaited<ReturnType<typeof readSystemStatus>>;

const DOT: Record<ServiceStatus, string> = {
  OPERATIONAL: "bg-success-500",
  DEGRADED: "bg-warning-500",
  OUTAGE: "bg-danger-500",
  MAINTENANCE: "bg-content-subtle",
};

/**
 * System Status inside the popout (V4 §23.12).
 *
 * Reads `StatusService` — the same source the public page renders from — so
 * the two surfaces cannot contradict each other. This view is deliberately a
 * summary: the full per-service detail lives on the status page, and
 * duplicating it here would be a second thing to keep in step.
 */
export function SystemStatusView() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let active = true;
    readSystemStatus()
      .then((row) => {
        if (!active) return;
        setSummary(row);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h2 className="text-[24px] font-bold leading-tight text-content">
          System status
        </h2>
        <p className="mt-1 text-[13.5px] text-content-muted">
          Live status of ClientTurn services and integrations.
        </p>
      </div>

      {state === "loading" && (
        <div aria-hidden className="space-y-2.5">
          <div className="h-20 animate-pulse rounded-xl bg-surface-sunken" />
          <div className="h-40 animate-pulse rounded-xl bg-surface-sunken" />
        </div>
      )}

      {state === "error" && (
        <p role="alert" className="text-[13px] text-danger-600">
          Status could not be loaded right now. The full status page may still
          be reachable.
        </p>
      )}

      {state === "ready" && summary && (
        <>
          <div
            className={cn(
              "rounded-xl border p-4",
              summary.overall === "OPERATIONAL"
                ? "border-success-100 bg-success-50"
                : summary.overall === "OUTAGE"
                  ? "border-danger-100 bg-danger-50"
                  : "border-warning-100 bg-warning-50",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full text-white",
                  summary.overall === "OPERATIONAL"
                    ? "bg-success-500"
                    : summary.overall === "OUTAGE"
                      ? "bg-danger-500"
                      : "bg-warning-500",
                )}
              >
                {summary.overall === "OPERATIONAL" ? (
                  <CircleCheck className="size-5" />
                ) : (
                  <CircleAlert className="size-5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold text-content">
                  {summary.overall === "OPERATIONAL"
                    ? "All systems operational"
                    : `${STATUS_META[summary.overall].label} — some services affected`}
                </p>
                <p className="mt-0.5 text-[12.5px] text-content-muted">
                  {summary.stale
                    ? "These readings are older than expected and may not be current."
                    : "Updated a moment ago."}
                </p>
              </div>
            </div>
          </div>

          <ul className="divide-y divide-line-subtle rounded-xl border border-line">
            {summary.groups.map((group) => (
              <li
                key={group.name}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
              >
                <span className="min-w-0 truncate text-[13px] text-content">
                  {group.name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-content-muted">
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", DOT[group.status])}
                  />
                  {STATUS_META[group.status].label}
                </span>
              </li>
            ))}
          </ul>

          <a
            href="https://status.clientturn.com"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5",
              "text-[13px] font-medium text-content hover:bg-surface-hover",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            )}
          >
            View full status page
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </>
      )}
    </div>
  );
}
