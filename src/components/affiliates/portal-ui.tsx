"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import type { MetricDelta } from "@/lib/affiliates/analytics";

/**
 * Shared presentation for the partner portal (V4 §30-36).
 *
 * Every portal page is built from these, so the eight surfaces cannot drift
 * into eight different card paddings and table densities. Charts are
 * hand-rolled SVG for the same reason the rest of the app is: there is no
 * charting dependency here, and these shapes are simple enough that adding one
 * would cost more than it saves.
 *
 * Colour discipline: green is the single accent, and it means "this is the
 * measured series". Amber and grey carry the commission states that are not
 * yet money in hand. Nothing is distinguished by colour alone — every chart
 * has a legend or a value label, and every status chip has text.
 */

/* ---------------------------------------------------------------- header -- */

export function PortalHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-content sm:text-[34px]">
          {title}
        </h1>
        <p className="mt-1 max-w-3xl text-[14.5px] leading-relaxed text-content-secondary">
          {description}
        </p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------- range tabs --- */

const RANGE_OPTIONS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
] as const;

/**
 * The date range control.
 *
 * A link group rather than client state: the range belongs in the URL so a
 * partner can bookmark or share "my last 90 days", and so the server renders
 * the right numbers on first paint instead of flashing the default.
 *
 * "Custom" is presented but not yet a working range — it links to the 90-day
 * view and says so on hover rather than opening a picker that does nothing.
 */
export function RangeTabs({
  basePath,
  current,
  extraParams,
}: {
  basePath: string;
  current: string;
  extraParams?: Record<string, string | undefined>;
}) {
  function href(range: string) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      if (value) params.set(key, value);
    }
    params.set("range", range);
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-surface p-1 shadow-xs"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = current === option.key;
        return (
          <Link
            key={option.key}
            href={href(option.key)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-surface text-content shadow-xs ring-1 ring-line"
                : "text-content-muted hover:bg-surface-hover hover:text-content",
            )}
          >
            {option.label}
          </Link>
        );
      })}
      <span
        title="Custom ranges are not available yet"
        aria-disabled="true"
        className="cursor-not-allowed rounded-[7px] px-3 py-1.5 text-[13px] font-medium text-content-subtle"
      >
        Custom
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- kpi cards -- */

/**
 * One headline metric.
 *
 * The delta is optional and the card renders cleanly without it. That matters:
 * when the comparison window predates the account there is no honest trend to
 * show, and the analytics service returns `undefined` rather than inventing
 * one. A KPI card that always shows a green arrow is a decoration.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  series,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta?: MetricDelta;
  series?: number[];
}) {
  return (
    <div className="min-w-0 rounded-[12px] border border-line bg-surface px-3.5 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-accent-50">
          <Icon className="size-3.5 text-content-accent" aria-hidden />
        </span>
        <p className="truncate text-[12.5px] font-medium text-content-secondary">
          {label}
        </p>
      </div>

      <p className="mt-2 text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums text-content">
        {value}
      </p>

      {delta ? (
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px]">
          {delta.direction === "down" ? (
            <TrendingDown className="size-3 shrink-0 text-danger-600" aria-hidden />
          ) : (
            <TrendingUp
              className={cn(
                "size-3 shrink-0",
                delta.direction === "flat" ? "text-content-muted" : "text-success-600",
              )}
              aria-hidden
            />
          )}
          <span
            className={cn(
              "font-semibold tabular-nums",
              delta.direction === "down"
                ? "text-danger-600"
                : delta.direction === "flat"
                  ? "text-content-muted"
                  : "text-success-600",
            )}
          >
            {delta.value}
          </span>
          <span className="truncate text-content-subtle">{delta.comparison}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-content-subtle">
          No comparable period yet
        </p>
      )}

      {series && series.length > 1 && (
        <Sparkline values={series} className="mt-2 h-8 w-full" />
      )}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ panel -- */

export function Panel({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-[12px] border border-line bg-surface shadow-xs",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-50">
              <Icon className="size-4 text-content-accent" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-content">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-[12.5px] text-content-muted">{description}</p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

/** The small ghost link that sits in a panel header. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-content transition-colors hover:bg-surface-hover"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

export function PanelEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <p className="text-[14px] font-medium text-content">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-content-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ table -- */

export function Table({
  headers,
  children,
  minWidth = 720,
}: {
  headers: { label: string; numeric?: boolean; srOnly?: boolean }[];
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table
        className="w-full border-collapse text-left"
        style={{ minWidth: `${minWidth}px` }}
      >
        <thead>
          <tr className="border-y border-line-subtle bg-surface-sunken/50">
            {headers.map((header, index) => (
              <th
                key={`${header.label}:${index}`}
                scope="col"
                className={cn(
                  "px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.03em] text-content-subtle",
                  header.numeric && "text-right",
                )}
              >
                {header.srOnly ? (
                  <span className="sr-only">{header.label}</span>
                ) : (
                  header.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  numeric,
  className,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-4 py-2.5 text-[13px] text-content",
        numeric && "text-right tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------ copy button -- */

/**
 * Copies a value and confirms it.
 *
 * The confirmation is both a toast and an inline tick, and the button's
 * accessible name changes to "Copied" — a colour-only or icon-only
 * confirmation is invisible to a screen reader, and copying is exactly the
 * action where you need to know it worked.
 */
export function CopyButton({
  value,
  label = "Copy",
  variant = "ghost",
  className,
}: {
  value: string;
  label?: string;
  variant?: "ghost" | "solid";
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ variant: "success", title: "Link copied" });
    } catch {
      toast({
        variant: "error",
        title: "Could not copy",
        description: "Select the text and copy it manually.",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={copied ? `Copied ${label}` : `${label}: ${value}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
        variant === "solid"
          ? "border border-line bg-surface text-content hover:bg-surface-hover"
          : "border border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-success-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/* ----------------------------------------------------------------- charts -- */

/**
 * A bare trend line, for KPI cards.
 *
 * Decorative by design — it has no axes and no labels, and the number above it
 * carries the meaning. Marked `aria-hidden` for exactly that reason: reading
 * out thirty unlabelled coordinates helps nobody.
 */
export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const path = React.useMemo(() => linePath(values, 100, 28), [values]);
  if (!path) return null;

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--lr-success-600)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function linePath(values: number[], width: number, height: number): string | null {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * step;
      // Padded 2px top and bottom so a peak is not clipped by the viewBox.
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * A labelled area chart with axes.
 *
 * Carries a visually-hidden summary of the series so the shape is available to
 * a screen reader as a sentence rather than as an unreadable path.
 */
export function AreaChart({
  points,
  label,
  height = 150,
  formatValue = (value: number) => String(value),
}: {
  points: { day: string; value: number }[];
  label: string;
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const values = points.map((point) => point.value);
  const max = Math.max(...values, 1);
  const ticks = axisTicks(max);
  const width = 100;

  const path = linePath(values, width, height);
  const area =
    path && points.length > 1
      ? `${path} L${width},${height} L0,${height} Z`
      : null;

  const total = values.reduce((sum, value) => sum + value, 0);

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        <div
          className="flex shrink-0 flex-col justify-between py-0.5 text-[10.5px] tabular-nums text-content-subtle"
          aria-hidden
        >
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{formatValue(tick)}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            style={{ height }}
            className="w-full"
            role="img"
            aria-label={`${label}. ${describeSeries(points, formatValue)}`}
          >
            {ticks.map((tick) => {
              const y = height - (tick / max) * height;
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--lr-border-subtle)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {area && <path d={area} fill="var(--lr-accent-50)" />}
            {path && (
              <path
                d={path}
                fill="none"
                stroke="var(--lr-success-600)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>

          <div className="mt-1 flex justify-between text-[10.5px] text-content-subtle" aria-hidden>
            {axisLabels(points).map((entry) => (
              <span key={entry.key}>{entry.label}</span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-content-muted">
        <span className="size-2 rounded-full bg-success-600" aria-hidden />
        {label}
        <span className="sr-only">
          , {formatValue(total)} in total across {points.length} days
        </span>
      </figcaption>
    </figure>
  );
}

/** A vertical bar chart, for counts per day. */
export function BarChart({
  points,
  label,
  height = 150,
}: {
  points: { day: string; value: number }[];
  label: string;
  height?: number;
}) {
  const max = Math.max(...points.map((point) => point.value), 1);
  const ticks = axisTicks(max);

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        <div
          className="flex shrink-0 flex-col justify-between py-0.5 text-[10.5px] tabular-nums text-content-subtle"
          aria-hidden
        >
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="flex items-end gap-[2px]"
            style={{ height }}
            role="img"
            aria-label={`${label}. ${describeSeries(points, String)}`}
          >
            {points.map((point) => (
              <span
                key={point.day}
                className="min-w-0 flex-1 rounded-t-[2px] bg-success-500"
                style={{
                  // 2px floor so a zero day is still a visible baseline rather
                  // than a gap that reads as missing data.
                  height: `${Math.max((point.value / max) * 100, point.value > 0 ? 3 : 1)}%`,
                  opacity: point.value > 0 ? 1 : 0.25,
                }}
              />
            ))}
          </div>

          <div className="mt-1 flex justify-between text-[10.5px] text-content-subtle" aria-hidden>
            {axisLabels(points).map((entry) => (
              <span key={entry.key}>{entry.label}</span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-content-muted">
        <span className="size-2 rounded-full bg-success-500" aria-hidden />
        {label}
      </figcaption>
    </figure>
  );
}

/** A multi-series line chart, for the commission trend. */
export function MultiLineChart({
  points,
  series,
  height = 150,
  formatValue = (value: number) => String(value),
}: {
  points: { day: string }[];
  series: { key: string; label: string; colour: string; values: number[] }[];
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(...series.flatMap((entry) => entry.values), 1);
  const ticks = axisTicks(max);
  const width = 100;

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        <div
          className="flex shrink-0 flex-col justify-between py-0.5 text-[10.5px] tabular-nums text-content-subtle"
          aria-hidden
        >
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{formatValue(tick)}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            style={{ height }}
            className="w-full"
            role="img"
            aria-label={series
              .map(
                (entry) =>
                  `${entry.label}: ${formatValue(entry.values.at(-1) ?? 0)} at the end of the period`,
              )
              .join(". ")}
          >
            {ticks.map((tick) => {
              const y = height - (tick / max) * height;
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--lr-border-subtle)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {series.map((entry) => {
              const step = width / Math.max(entry.values.length - 1, 1);
              const path = entry.values
                .map((value, index) => {
                  const x = index * step;
                  const y = height - (value / max) * (height - 4) - 2;
                  return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                })
                .join(" ");

              return (
                <path
                  key={entry.key}
                  d={path}
                  fill="none"
                  stroke={entry.colour}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          <div className="mt-1 flex justify-between text-[10.5px] text-content-subtle" aria-hidden>
            {axisLabels(points).map((entry) => (
              <span key={entry.key}>{entry.label}</span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-content-muted">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ background: entry.colour }}
              aria-hidden
            />
            {entry.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * The commission donut.
 *
 * Three segments and a total in the middle. Each segment is also listed with
 * its value beside the chart, so the ring is a summary of the list rather than
 * the only place the numbers appear.
 */
export function Donut({
  segments,
  centreValue,
  centreLabel,
  size = 170,
}: {
  segments: { key: string; label: string; value: number; colour: string }[];
  centreValue: string;
  centreLabel: string;
  size?: number;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <svg
      viewBox="0 0 160 160"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        total > 0
          ? `${centreLabel}: ${centreValue}. ${segments
              .map(
                (segment) =>
                  `${segment.label} ${Math.round((segment.value / total) * 100)}%`,
              )
              .join(", ")}`
          : `${centreLabel}: nothing yet`
      }
    >
      <circle
        cx={80}
        cy={80}
        r={radius}
        fill="none"
        stroke="var(--lr-border-subtle)"
        strokeWidth={18}
      />
      {total > 0 &&
        segments.map((segment) => {
          const length = (segment.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const rotation = (offset / circumference) * 360 - 90;
          offset += length;

          if (segment.value <= 0) return null;

          return (
            <circle
              key={segment.key}
              cx={80}
              cy={80}
              r={radius}
              fill="none"
              stroke={segment.colour}
              strokeWidth={18}
              strokeDasharray={dash}
              strokeLinecap="butt"
              transform={`rotate(${rotation} 80 80)`}
            />
          );
        })}
      <text
        x={80}
        y={76}
        textAnchor="middle"
        className="fill-content text-[20px] font-bold"
        style={{ fontSize: 20, fontWeight: 700 }}
      >
        {centreValue}
      </text>
      <text
        x={80}
        y={95}
        textAnchor="middle"
        className="fill-content-muted"
        style={{ fontSize: 10 }}
      >
        {centreLabel}
      </text>
    </svg>
  );
}

/** The signup funnel: a labelled bar per step with both denominators. */
export function FunnelBars({
  steps,
}: {
  steps: {
    key: string;
    label: string;
    count: number;
    shareOfTop: number | null;
  }[];
}) {
  return (
    <ul className="space-y-3.5 px-4 pb-4">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3">
          <div className="w-[112px] shrink-0">
            <p className="text-[13px] font-medium text-content">{step.label}</p>
          </div>
          <div className="w-[64px] shrink-0 text-right">
            <p className="text-[13px] font-semibold tabular-nums text-content">
              {step.count.toLocaleString("en-GB")}
            </p>
            <p className="text-[11px] tabular-nums text-content-muted">
              {step.shareOfTop === null
                ? "—"
                : `${(step.shareOfTop * 100).toFixed(1)}%`}
            </p>
          </div>
          <div
            className="h-6 min-w-0 flex-1 overflow-hidden rounded-[5px] bg-surface-sunken"
            role="img"
            aria-label={`${step.label}: ${step.count.toLocaleString("en-GB")}${
              step.shareOfTop === null
                ? ""
                : `, ${(step.shareOfTop * 100).toFixed(1)}% of clicks`
            }`}
          >
            <div
              className="h-full rounded-[5px] bg-success-500"
              style={{
                width: `${Math.max((step.shareOfTop ?? 0) * 100, step.count > 0 ? 2 : 0)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- helpers --- */

/** Four gridline values, rounded to something a human would choose. */
function axisTicks(max: number): number[] {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1))));
  const step = Math.ceil(max / 4 / magnitude) * magnitude;
  return [0, step, step * 2, step * 3, step * 4].filter(
    (tick, index) => index === 0 || tick <= step * 4,
  );
}

/** Five evenly-spaced x labels, whatever the series length. */
function axisLabels(points: { day: string }[]) {
  if (points.length === 0) return [];
  const wanted = Math.min(5, points.length);
  const stride = Math.max(1, Math.floor((points.length - 1) / (wanted - 1 || 1)));

  const out: { key: string; label: string }[] = [];
  for (let index = 0; index < points.length; index += stride) {
    out.push({
      key: points[index].day,
      label: new Date(points[index].day).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
    });
  }
  return out.slice(0, 5);
}

function describeSeries(
  points: { day: string; value: number }[],
  format: (value: number) => string,
): string {
  if (points.length === 0) return "No data in this period.";
  const values = points.map((point) => point.value);
  const peak = Math.max(...values);
  const peakDay = points[values.indexOf(peak)];
  const total = values.reduce((sum, value) => sum + value, 0);

  return `${format(total)} in total, peaking at ${format(peak)} on ${new Date(
    peakDay.day,
  ).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`;
}
