import * as React from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import { formatWhen, type CheckStatus, type SystemCheckReport } from "@/lib/system-check/types";

/**
 * The System check report. Presentational only (no server or client-only
 * imports), so Settings renders it on the server and Admin -> Customers'
 * support drawer renders the same report, read-only, on the client.
 *
 * Accessibility (docs/ACCESSIBILITY_AUDIT_2026-09-28.md): each engine is a
 * section named by its h2 (the page's h1 is Settings); status is always a
 * text label, never colour alone; rows are a real list; fix links carry a
 * visible focus outline and say where they go.
 */

const SUMMARY_ORDER: CheckStatus[] = ["ATTENTION", "UNKNOWN", "READY", "OFF"];
const SUMMARY_LABEL: Record<CheckStatus, string> = {
  ATTENTION: "need attention",
  UNKNOWN: "couldn't be checked",
  READY: "ready",
  OFF: "off by choice",
};

export function SystemCheckReportView({
  report,
  readOnly = false,
  refreshHref,
  headingLevel = 2,
}: {
  report: SystemCheckReport;
  /** Admin support view: fixes are shown as where to look, not as links. */
  readOnly?: boolean;
  /** Where "Check again" reloads; omitted in the read-only view. */
  refreshHref?: string;
  /** 2 on the Settings page (under its h1); 4 inside the admin drawer's h3 block. */
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = (`h${headingLevel}` as "h2" | "h3" | "h4");
  const attention = report.counts.ATTENTION;

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4 shadow-xs"
        role="status"
      >
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-content">
            {attention === 0
              ? "Nothing needs fixing right now."
              : `${attention} ${attention === 1 ? "area needs" : "areas need"} attention.`}
          </p>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            {SUMMARY_ORDER.filter((status) => report.counts[status] > 0)
              .map((status) => `${report.counts[status]} ${SUMMARY_LABEL[status]}`)
              .join(" · ")}
            {" · "}checked {formatWhen(report.generatedAt, report.timezone)}
          </p>
        </div>
        {refreshHref && (
          <Link
            href={refreshHref}
            prefetch={false}
            scroll={false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-content hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Check again
          </Link>
        )}
      </div>

      {report.engines.map((engine) => {
        const headingId = `system-check-${engine.id}`;
        return (
          <section
            key={engine.id}
            aria-labelledby={headingId}
            data-engine={engine.id}
            className="min-w-0 rounded-xl border border-line bg-surface shadow-xs"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-5 py-3">
              <Heading id={headingId} className="text-[14.5px] font-semibold text-content">
                {engine.title}
              </Heading>
              <StatusBadge kind="system_check" value={engine.status} />
            </header>
            <ul className="divide-y divide-line-subtle">
              {engine.rows.map((row) => (
                <li key={row.id} data-check={row.id} className="min-w-0 px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="text-[13px] font-medium text-content">{row.label}</p>
                    <StatusBadge kind="system_check" value={row.status} dense />
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-content-secondary">{row.reason}</p>
                  {row.fix &&
                    (readOnly ? (
                      <p className="mt-1.5 text-[12px] text-content-muted">
                        Customer fixes this at: <span className="font-mono">{row.fix.href}</span>
                      </p>
                    ) : (
                      <Link
                        href={row.fix.href}
                        className={cn(
                          "mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline",
                          "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                        )}
                      >
                        {row.fix.label}
                        <span className="sr-only"> (fixes {row.label.toLowerCase()})</span>
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function SystemCheckSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Checking your workspace">
      <Skeleton className="h-16 w-full rounded-xl" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}
