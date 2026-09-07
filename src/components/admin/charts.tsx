import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The two chart shapes the Platform Admin surfaces need beyond the sparklines
 * already in `components/dashboard/sparkline`. Hand-rolled SVG, for the same
 * reason: a charting library would be the single largest dependency in the
 * admin bundle to draw a donut and five polylines.
 *
 * Both render server-side with no interactivity, so they stay in Server
 * Components and cost the browser nothing.
 */

/** One accessible palette, used by every admin chart so a series colour means
 *  the same thing on Jobs as it does on Billing. */
export const SERIES_COLORS = [
  "var(--lr-chart-1, #3B82F6)",
  "var(--lr-chart-2, #22C55E)",
  "var(--lr-chart-3, #F59E0B)",
  "var(--lr-chart-4, #A855F7)",
  "var(--lr-chart-5, #EF4444)",
  "var(--lr-chart-6, #06B6D4)",
  "var(--lr-chart-7, #EC4899)",
  "var(--lr-chart-8, #64748B)",
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/* ----------------------------------------------------------------- donut --- */

export type DonutSlice = {
  label: string;
  value: number;
  /** Overrides the palette when a slice has a fixed meaning (e.g. "Failed"). */
  color?: string;
};

/**
 * A ring with the total in the middle and a legend beside it. Slices below a
 * pixel of arc are still listed in the legend but contribute no visible arc —
 * a sliver that cannot be seen or hovered is noise, not information.
 */
export function DonutChart({
  slices,
  total,
  totalLabel = "Total",
  size = 168,
  thickness = 22,
  className,
  legendClassName,
  formatValue,
}: {
  slices: DonutSlice[];
  /** Defaults to the sum of the slices. Pass it when the ring shows a subset. */
  total?: number;
  totalLabel?: string;
  size?: number;
  thickness?: number;
  className?: string;
  legendClassName?: string;
  formatValue?: (value: number) => string;
}) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);
  const displayTotal = total ?? sum;
  const format = formatValue ?? ((value: number) => value.toLocaleString("en-GB"));

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices.map((slice, index) => {
    const fraction = sum === 0 ? 0 : slice.value / sum;
    const length = fraction * circumference;
    const arc = {
      key: `${slice.label}-${index}`,
      color: slice.color ?? seriesColor(index),
      dash: `${length} ${circumference - length}`,
      // SVG circles start at 3 o'clock; the negative offset walks each arc
      // round from 12 o'clock so the first slice starts where a reader expects.
      offset: -offset,
    };
    offset += length;
    return arc;
  });

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
          focusable="false"
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            className="stroke-[var(--lr-surface-sunken,#F1F5F9)]"
          />
          {sum > 0 &&
            arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={thickness}
                strokeDasharray={arc.dash}
                strokeDashoffset={arc.offset}
                strokeLinecap="butt"
              />
            ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="lr-tabular text-[19px] leading-none font-semibold text-content">
            {format(displayTotal)}
          </span>
          <span className="mt-1 text-[11.5px] text-content-muted">{totalLabel}</span>
        </div>
      </div>

      <ul className={cn("min-w-0 flex-1 space-y-1.5", legendClassName)}>
        {slices.map((slice, index) => (
          <li
            key={`${slice.label}-${index}`}
            className="flex items-center gap-2 text-[12.5px]"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: slice.color ?? seriesColor(index) }}
            />
            <span className="min-w-0 flex-1 truncate text-content-secondary">
              {slice.label}
            </span>
            <span className="lr-tabular shrink-0 text-content">
              {format(slice.value)}
            </span>
            <span className="lr-tabular w-11 shrink-0 text-right text-content-muted">
              {sum === 0 ? "—" : `${Math.round((slice.value / sum) * 1000) / 10}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ line chart --- */

export type LineSeries = {
  label: string;
  values: number[];
  color?: string;
};

/**
 * A multi-series line chart with a shared y-axis. Used for queue lag by
 * priority and provider response times — both cases where the comparison
 * between the lines is the whole point, so they must share a scale.
 */
export function MultiLineChart({
  series,
  labels,
  height = 190,
  formatValue,
  emptyMessage = "No data in this window.",
  className,
}: {
  series: LineSeries[];
  /** X-axis tick labels. Rendered evenly; pass 4-6 for a readable axis. */
  labels: string[];
  height?: number;
  formatValue?: (value: number) => string;
  emptyMessage?: string;
  className?: string;
}) {
  const format = formatValue ?? ((value: number) => value.toLocaleString("en-GB"));
  const width = 640;
  const padding = { top: 10, right: 8, bottom: 22, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const points = series.flatMap((line) => line.values);
  const max = Math.max(...points, 0);
  const length = Math.max(...series.map((line) => line.values.length), 0);

  if (length < 2 || max <= 0) {
    return (
      <p className={cn("px-5 py-12 text-center text-[13px] text-content-muted", className)}>
        {emptyMessage}
      </p>
    );
  }

  // Round the ceiling up to something a human reads off an axis.
  const ceiling = niceCeiling(max);
  const step = plotWidth / (length - 1);
  const y = (value: number) =>
    padding.top + plotHeight - (value / ceiling) * plotHeight;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className={cn("min-w-0", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Line chart: ${series.map((line) => line.label).join(", ")}`}
        className="overflow-visible"
      >
        {gridLines.map((fraction) => {
          const lineY = padding.top + plotHeight * (1 - fraction);
          return (
            <g key={fraction}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={lineY}
                y2={lineY}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={padding.left - 6}
                y={lineY + 3.5}
                textAnchor="end"
                className="fill-[var(--lr-content-subtle,#94A3B8)] text-[9px]"
              >
                {format(ceiling * fraction)}
              </text>
            </g>
          );
        })}

        {series.map((line, index) => {
          const color = line.color ?? seriesColor(index);
          const path = line.values
            .map(
              (value, pointIndex) =>
                `${pointIndex === 0 ? "M" : "L"}${(padding.left + pointIndex * step).toFixed(1)} ${y(value).toFixed(1)}`,
            )
            .join(" ");
          return (
            <path
              key={line.label}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {labels.map((label, index) => (
          <text
            key={`${label}-${index}`}
            x={padding.left + (plotWidth / Math.max(1, labels.length - 1)) * index}
            y={height - 6}
            textAnchor={
              index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle"
            }
            className="fill-[var(--lr-content-subtle,#94A3B8)] text-[9px]"
          >
            {label}
          </text>
        ))}
      </svg>

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((line, index) => (
          <li key={line.label} className="flex items-center gap-1.5 text-[11.5px]">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: line.color ?? seriesColor(index) }}
            />
            <span className="text-content-secondary">{line.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function niceCeiling(max: number): number {
  if (max <= 5) return Math.ceil(max) || 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const rounded = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return rounded * magnitude;
}

/* ---------------------------------------------------------- share bars --- */

/**
 * A labelled horizontal bar list — the Acquisition Operations funnel and the
 * "jobs by type" breakdowns. Kept here rather than in each view so the bar
 * height, radius and label column are identical everywhere.
 */
export function ShareBars({
  rows,
  formatValue,
  className,
}: {
  rows: { label: string; value: number; share?: number; color?: string }[];
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const format = formatValue ?? ((value: number) => value.toLocaleString("en-GB"));
  const max = Math.max(...rows.map((row) => row.value), 0);

  return (
    <ul className={cn("space-y-2.5", className)}>
      {rows.map((row, index) => {
        const width = max === 0 ? 0 : (row.value / max) * 100;
        return (
          <li key={row.label} className="flex items-center gap-3 text-[12.5px]">
            <span className="w-36 shrink-0 truncate text-content-secondary">
              {row.label}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${width}%`,
                  background: row.color ?? seriesColor(index),
                }}
              />
            </span>
            {row.share !== undefined && (
              <span className="lr-tabular w-11 shrink-0 text-right text-content-muted">
                {Math.round(row.share * 1000) / 10}%
              </span>
            )}
            <span className="lr-tabular w-16 shrink-0 text-right text-content">
              {format(row.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
