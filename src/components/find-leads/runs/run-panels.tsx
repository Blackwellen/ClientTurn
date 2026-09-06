import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Copy,
  Database,
  Info,
  Mail,
  Send,
  ShieldOff,
  Users,
  Wallet,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  COUNTER_DEFINITIONS,
  type ProviderActivity,
  type RunBudgetView,
  type RunCounters,
  type RunIssueView,
} from "@/lib/find-leads/types";

/**
 * The run's right-hand operational panels.
 *
 * Server components: none of this is interactive, and the run page's polling
 * hook re-renders them with fresh data. Every number here is a count of real
 * rows the run wrote — there is no path in this file that can display an
 * estimate, and no prop that carries a provider unit price.
 */

/* --------------------------------------------------------- run counters */

const COUNTER_ICONS: Record<keyof RunCounters, React.ComponentType<{ className?: string }>> = {
  companiesFound: Building2,
  contactsFound: Users,
  emailsDiscovered: Mail,
  verified: CheckCircle2,
  duplicates: Copy,
  suppressed: ShieldOff,
  reviewRequired: AlertTriangle,
  ready: Send,
};

const COUNTER_TONE: Partial<Record<keyof RunCounters, string>> = {
  verified: "text-success-600",
  duplicates: "text-content-subtle",
  suppressed: "text-danger-600",
  reviewRequired: "text-warning-600",
  ready: "text-accent-600",
};

export function RunCountersCard({
  counters,
  updatedAtLabel,
}: {
  counters: RunCounters;
  updatedAtLabel: string | null;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <BarChart3 className="size-3.5" />
          </span>
          <div>
            <h2 className="text-[14.5px] font-semibold text-content">Run counters</h2>
            <p className="text-[11.5px] text-content-muted">Live data from all providers</p>
          </div>
        </div>
        {updatedAtLabel && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-content-subtle">
            <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
            Last updated {updatedAtLabel}
          </span>
        )}
      </header>

      <dl className="grid grid-cols-2 border-t border-line-subtle sm:grid-cols-4">
        {COUNTER_DEFINITIONS.map((definition, index) => {
          const Icon = COUNTER_ICONS[definition.key];
          return (
            <Tooltip key={definition.key} content={definition.definition}>
              <div
                className={cn(
                  "px-3.5 py-3",
                  index % 2 === 1 && "border-l border-line-subtle sm:border-l",
                  index % 4 !== 0 && "sm:border-l",
                  index >= 2 && "border-t border-line-subtle sm:border-t-0",
                  index >= 4 && "sm:border-t sm:border-line-subtle",
                )}
              >
                <dt className="flex items-center gap-1.5 text-[11.5px] text-content-muted">
                  <Icon
                    className={cn(
                      "size-3.5",
                      COUNTER_TONE[definition.key] ?? "text-content-subtle",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{definition.label}</span>
                </dt>
                <dd className="mt-0.5 text-[19px] font-semibold tabular-nums text-content">
                  {counters[definition.key].toLocaleString("en-GB")}
                </dd>
              </div>
            </Tooltip>
          );
        })}
      </dl>
    </section>
  );
}

/* ----------------------------------------------------------- run budget */

export function RunBudgetCard({ budget }: { budget: RunBudgetView }) {
  const warn = budget.state !== "WITHIN_BUDGET";

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Wallet className="size-3.5" />
          </span>
          <div>
            <h2 className="text-[14.5px] font-semibold text-content">Run budget</h2>
            <p className="text-[11.5px] text-content-muted">
              Provider costs across all data sources
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {/* Formatted server-side. The browser never receives the raw
              minor-unit figures these strings came from. */}
          <p className="text-[14px] font-semibold tabular-nums text-content">
            {budget.spent} of {budget.cap}
          </p>
          <p className="text-[11.5px] tabular-nums text-content-muted">
            {budget.percentUsed}% used
          </p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div
          role="progressbar"
          aria-label="Run budget used"
          aria-valuenow={budget.percentUsed}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-700",
              warn ? "bg-warning-500" : "bg-success-500",
            )}
            style={{ width: `${budget.percentUsed}%` }}
          />
        </div>
        {budget.state === "BUDGET_LIMIT_REACHED" && (
          <p role="status" className="mt-2 text-[12px] font-medium text-warning-700">
            This run paused because it reached its cost limit.
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ provider activity */

export function ProviderActivityCard({
  providers,
}: {
  providers: ProviderActivity[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Database className="size-3.5" />
          </span>
          <div>
            <h2 className="text-[14.5px] font-semibold text-content">Provider activity</h2>
            <p className="text-[11.5px] text-content-muted">Live status from data providers</p>
          </div>
        </div>
      </header>

      {providers.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] text-content-muted">
          No provider has been called yet on this run.
        </p>
      ) : (
        <ul className="border-t border-line-subtle">
          {providers.map((provider) => (
            <li
              key={provider.provider}
              className="flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 first:border-t-0"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  provider.state === "ACTIVE"
                    ? "bg-success-500"
                    : provider.state === "DEGRADED"
                      ? "bg-warning-500"
                      : provider.state === "FAILED"
                        ? "bg-danger-500"
                        : "bg-content-subtle",
                )}
              />
              <span className="w-[104px] shrink-0 truncate text-[12.5px] font-medium text-content">
                {provider.displayName}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-content-muted">
                {provider.activity}
                {/* Screen readers get the state as words, not as a dot. */}
                <span className="sr-only"> — {provider.state.toLowerCase()}</span>
              </span>
              <span className="shrink-0 text-right text-[12px] tabular-nums text-content-secondary">
                {provider.resultCount.toLocaleString("en-GB")} {provider.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------ result breakdown */

export function ResultBreakdownCard({ counters }: { counters: RunCounters }) {
  const rows: [string, number][] = [
    ["Companies found", counters.companiesFound],
    ["Contacts found", counters.contactsFound],
    ["Verified (deliverable)", counters.verified],
    ["Suppressed", counters.suppressed],
    ["Review required", counters.reviewRequired],
    ["Ready for outreach", counters.ready],
  ];

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex gap-2.5 px-4 py-3.5">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
        >
          <BarChart3 className="size-3.5" />
        </span>
        <div>
          <h2 className="text-[14.5px] font-semibold text-content">Result breakdown</h2>
          <p className="text-[11.5px] text-content-muted">
            From discovery to ready prospects
          </p>
        </div>
      </header>

      <dl className="border-t border-line-subtle">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-2 first:border-t-0"
          >
            <dt className="text-[12.5px] text-content-secondary">{label}</dt>
            <dd className="text-[12.5px] font-semibold tabular-nums text-content">
              {value.toLocaleString("en-GB")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------------------------------------------------------- run issues */

const SEVERITY_DOT: Record<RunIssueView["severity"], string> = {
  ERROR: "bg-danger-500",
  WARNING: "bg-warning-500",
  INFO: "bg-info-500",
};

const SEVERITY_ICON: Record<
  RunIssueView["severity"],
  React.ComponentType<{ className?: string }>
> = {
  ERROR: AlertTriangle,
  WARNING: AlertTriangle,
  INFO: Info,
};

export function RunIssuesCard({
  issues,
  runId,
}: {
  issues: RunIssueView[];
  runId: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-danger-50 text-danger-600"
          >
            <AlertTriangle className="size-3.5" />
          </span>
          <h2 className="text-[14.5px] font-semibold text-content">Run issues</h2>
          {issues.length > 0 && (
            <span className="rounded-full bg-danger-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-danger-700">
              {issues.length}
            </span>
          )}
        </div>
        {issues.length > 0 && (
          <Link
            href={`/app/find-leads?view=prospects&runId=${runId}&quick=review`}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            View all
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </header>

      {issues.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] text-content-muted">
          Nothing needs your attention on this run.
        </p>
      ) : (
        <ul className="border-t border-line-subtle">
          {issues.slice(0, 5).map((issue) => {
            const Icon = SEVERITY_ICON[issue.severity];
            return (
              <li
                key={issue.id}
                className="flex items-start gap-2.5 border-t border-line-subtle px-4 py-2.5 first:border-t-0"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    SEVERITY_DOT[issue.severity],
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-content">
                    <Icon className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                    <span className="sr-only">{issue.severity.toLowerCase()}: </span>
                    {issue.message}
                  </p>
                  {issue.detail && (
                    <p className="mt-0.5 text-[11.5px] leading-snug text-content-muted">
                      {issue.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* Deliberately absent: any control that would ignore compliance,
          bypass suppression or force a record through. V4 §11.18. */}
    </section>
  );
}
