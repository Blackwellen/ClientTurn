import * as React from "react";
import { BarChart3, PieChart } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FunnelStage } from "@/lib/analytics/v4-metrics";

/**
 * The shared chrome for every Analytics panel.
 *
 * One card component rather than a bespoke `<section>` per chart, so heading
 * level, padding, border and icon treatment cannot drift between the four
 * views.
 */
export function AnalyticsCard({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-line bg-surface p-4 shadow-xs",
        className,
      )}
    >
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span
              aria-hidden
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-info-100 bg-info-50 text-info-600"
            >
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-[14.5px] font-semibold text-content">{title}</h3>
            {description && (
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ funnel */

/**
 * The journey funnel.
 *
 * Every stage shows both its share of the top and its step conversion, because
 * showing only one of the two is exactly how a funnel misleads: 90% of the
 * previous stage sounds excellent until you notice it is 4% of the first.
 */
export function FunnelCard({
  title,
  description,
  stages,
}: {
  title: string;
  description?: string;
  stages: FunnelStage[];
}) {
  const hasData = stages.some((stage) => stage.count > 0);

  return (
    <AnalyticsCard icon={BarChart3} title={title} description={description}>
      {!hasData ? (
        <p className="py-10 text-center text-[13px] text-content-muted">
          No activity in this period yet.
        </p>
      ) : (
        <>
          {/* Column chart on wide screens: the shape of the drop-off is the
              point, and a row of bars reads it faster than a list. */}
          <ol className="hidden h-[180px] items-end gap-2 sm:flex" aria-hidden>
            {stages.map((stage, index) => (
              <li
                key={stage.key}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
              >
                <span className="lr-tabular text-[12.5px] font-semibold text-content">
                  {stage.count.toLocaleString("en-GB")}
                </span>
                <span
                  className={cn("w-full rounded-t-md", FUNNEL_TONES[index % FUNNEL_TONES.length])}
                  style={{
                    height: `${Math.max(3, (stage.shareOfTop ?? 0) * 100)}%`,
                  }}
                />
              </li>
            ))}
          </ol>
          <ol className="mt-1.5 hidden gap-2 sm:flex" aria-hidden>
            {stages.map((stage) => (
              <li key={stage.key} className="min-w-0 flex-1 text-center">
                <span className="block truncate text-[11.5px] leading-tight text-content-secondary">
                  {stage.label}
                </span>
                {stage.shareOfTop !== null && (
                  <span className="lr-tabular block text-[11px] leading-tight text-content-subtle">
                    ({(stage.shareOfTop * 100).toFixed(1)}%)
                  </span>
                )}
              </li>
            ))}
          </ol>

          {/* The same data as a real list: the sole content on small screens,
              and the accessible reading of the chart above on every screen. */}
          <ul className="space-y-2.5 sm:sr-only">
            {stages.map((stage) => (
              <li key={stage.key}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-content">{stage.label}</span>
                  <span className="flex items-baseline gap-2">
                    {stage.shareOfPrevious !== null && (
                      <span className="lr-tabular text-[11.5px] text-content-subtle">
                        {(stage.shareOfPrevious * 100).toFixed(0)}% of previous
                      </span>
                    )}
                    <span className="lr-tabular text-[13px] font-semibold text-content">
                      {stage.count.toLocaleString("en-GB")}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken sm:hidden">
                  <div
                    className="h-full rounded-full bg-info-500"
                    style={{ width: `${Math.min(100, (stage.shareOfTop ?? 0) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </AnalyticsCard>
  );
}

const FUNNEL_TONES = [
  "bg-info-400",
  "bg-info-300",
  "bg-purple-400",
  "bg-pink-300",
  "bg-warning-300",
  "bg-success-300",
  "bg-success-400",
  "bg-success-600",
];

/* ------------------------------------------------------------ source donut */

const SOURCE_TONES = [
  { fill: "#3b82f6", chip: "bg-info-500" },
  { fill: "#22c55e", chip: "bg-success-500" },
  { fill: "#a855f7", chip: "bg-purple-500" },
  { fill: "#f97316", chip: "bg-warning-500" },
  { fill: "#94a3b8", chip: "bg-content-subtle" },
];

/**
 * Where leads came from.
 *
 * A donut is used for one reason only: these are parts of a single whole, and
 * the shares sum to 100% because attribution is single-source — a lead counts
 * once, to the source that created it, never to every source that touched it.
 */
export function SourceDonut({
  rows,
}: {
  rows: { label: string; leads: number; won: number }[];
}) {
  const total = rows.reduce((sum, row) => sum + row.leads, 0);

  if (total === 0) {
    return (
      <AnalyticsCard
        icon={PieChart}
        title="Source performance"
        description="Where your prospects come from."
      >
        <p className="py-10 text-center text-[13px] text-content-muted">
          No leads attributed in this period.
        </p>
      </AnalyticsCard>
    );
  }

  // Stroke-dasharray on a single circle: no chart library, no layout shift,
  // and it renders identically on the server.
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  const segments = rows.map((row, index) => {
    const share = row.leads / total;
    const segment = {
      key: row.label,
      share,
      dash: share * circumference,
      offset: rows.slice(0, index).reduce((sum, previous) => sum + previous.leads, 0) / total * circumference,
      tone: SOURCE_TONES[index % SOURCE_TONES.length],
    };
    return segment;
  });

  return (
    <AnalyticsCard
      icon={PieChart}
      title="Source performance"
      description="Where your prospects come from."
    >
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          <svg
            viewBox="0 0 100 100"
            className="size-[124px] -rotate-90"
            role="img"
            aria-label={`Leads by source: ${rows
              .map((row) => `${row.label} ${Math.round((row.leads / total) * 100)}%`)
              .join(", ")}`}
          >
            {segments.map((segment) => (
              <circle
                key={segment.key}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={segment.tone.fill}
                strokeWidth="14"
                strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
                strokeDashoffset={-segment.offset}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="lr-tabular text-[17px] font-bold leading-none text-content">
              {total.toLocaleString("en-GB")}
            </span>
            <span className="text-[11px] text-content-muted">Leads</span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {rows.map((row, index) => (
            <li key={row.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  SOURCE_TONES[index % SOURCE_TONES.length].chip,
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-content">
                {row.label}
              </span>
              <span className="lr-tabular shrink-0 text-[12.5px] font-medium text-content">
                {row.leads.toLocaleString("en-GB")}
              </span>
              <span className="lr-tabular w-9 shrink-0 text-right text-[12px] text-content-muted">
                {Math.round((row.leads / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </AnalyticsCard>
  );
}
