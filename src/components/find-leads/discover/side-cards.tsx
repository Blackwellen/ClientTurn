import * as React from "react";
import Link from "next/link";
import { ArrowRight, Clock, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import type { RecentRun } from "@/lib/find-leads/server/runs";
import { RUN_STATUS_LABELS, runStatusTone } from "@/lib/find-leads/types";

/**
 * The Discover right rail's smaller cards.
 *
 * Server components — none of these needs interactivity, and keeping them off
 * the client boundary is what lets Discover render without shipping the run
 * list as JSON to the browser.
 */

/* ------------------------------------------------------- recent runs */

export function RecentSourcingRunsCard({ runs }: { runs: RecentRun[] }) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Clock className="size-3.5" />
          </span>
          <h2 className="text-[14.5px] font-semibold text-content">
            Recent sourcing runs
          </h2>
        </div>
        {runs.length > 0 && (
          <Link
            href="/app/find-leads?view=prospects"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            View all runs
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </header>

      {runs.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] leading-relaxed text-content-muted">
          Run your first sourcing search and it will appear here.
        </p>
      ) : (
        <ul className="px-2 pb-2">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/app/find-leads/runs/${run.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-content">
                    {run.title}
                  </p>
                  <p className="text-[11.5px] tabular-nums text-content-muted">
                    {run.prospects.toLocaleString("en-GB")} prospects
                  </p>
                </div>
                <Badge tone={runStatusTone(run.status)} dot dense>
                  {RUN_STATUS_LABELS[run.status]}
                </Badge>
                <span className="w-[62px] shrink-0 text-right text-[11px] text-content-subtle">
                  {relativeTime(run.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ usage */

export function UsageThisMonthCard({
  used,
  limit,
  percent,
  resetsAt,
}: {
  used: number;
  limit: number;
  percent: number;
  resetsAt: string | null;
}) {
  const exhausted = limit > 0 && used >= limit;

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Gauge className="size-3.5" />
          </span>
          <h2 className="text-[14.5px] font-semibold text-content">Usage this month</h2>
        </div>
        <Link
          href="/app/settings?view=billing"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          View usage
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </header>

      <div className="px-4 pb-4">
        <p
          className={cn(
            "text-[15px] font-semibold tabular-nums",
            exhausted ? "text-danger-600" : "text-content",
          )}
        >
          {used.toLocaleString("en-GB")} / {limit.toLocaleString("en-GB")} searches
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Progress
            value={percent}
            label="Sourcing runs used this billing period"
            tone={exhausted ? "danger" : percent >= 80 ? "warning" : "accent"}
            className="flex-1"
          />
          <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-content-muted">
            {percent}%
          </span>
        </div>
        <p className="mt-2.5 text-[11.5px] text-content-subtle">
          {resetsAt
            ? `Resets on ${new Date(resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
            : "Resets at the end of your billing period"}
          {" · "}
          <Link
            href="/app/settings?view=billing"
            className="font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Need more? Upgrade your plan
          </Link>
        </p>
      </div>
    </section>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
