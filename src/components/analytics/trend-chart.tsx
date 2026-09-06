"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { TrendPoint } from "@/lib/analytics/v4-extras";

/**
 * The trends chart (V4 §21.3).
 *
 * Inline SVG rather than a charting library: the whole chart is five polylines
 * over a shared scale, and pulling in a library for that would cost more bytes
 * than the page it sits on.
 *
 * Accessibility is not an afterthought here. The SVG is `aria-hidden` and a
 * real table carries the same numbers for screen readers, because a line chart
 * announced as "graphic" tells nobody anything.
 */

const SERIES = [
  { key: "prospects", label: "Prospects", stroke: "#3b82f6", fill: "#3b82f622" },
  { key: "contactsSent", label: "Contacts sent", stroke: "#a855f7", fill: "#a855f722" },
  { key: "replies", label: "Replies", stroke: "#ec4899", fill: "#ec489922" },
  { key: "leads", label: "Leads", stroke: "#f97316", fill: "#f9731622" },
  { key: "converted", label: "Converted", stroke: "#22c55e", fill: "#22c55e22" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

const WIDTH = 640;
const HEIGHT = 210;
const PAD_LEFT = 34;
const PAD_BOTTOM = 22;
const PAD_TOP = 8;

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hidden, setHidden] = React.useState<Set<SeriesKey>>(new Set());

  const visible = SERIES.filter((series) => !hidden.has(series.key));

  const max = React.useMemo(() => {
    let top = 0;
    for (const point of points) {
      for (const series of visible) {
        top = Math.max(top, point[series.key]);
      }
    }
    // A flat-zero chart still needs a scale, or every point lands on the axis
    // and the grid reads as broken rather than as empty.
    return top === 0 ? 1 : niceCeiling(top);
  }, [points, visible]);

  if (points.length === 0) {
    return (
      <p className="py-12 text-center text-[13px] text-content-muted">
        No activity in this period yet.
      </p>
    );
  }

  const plotWidth = WIDTH - PAD_LEFT;
  const plotHeight = HEIGHT - PAD_BOTTOM - PAD_TOP;

  const x = (index: number) =>
    PAD_LEFT +
    (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => PAD_TOP + plotHeight - (value / max) * plotHeight;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <ul className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {SERIES.map((series) => {
          const off = hidden.has(series.key);
          return (
            <li key={series.key}>
              <button
                type="button"
                aria-pressed={!off}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    // Never let the last series be switched off: an empty
                    // chart with no way back is a dead end.
                    if (next.has(series.key)) next.delete(series.key);
                    else if (visible.length > 1) next.add(series.key);
                    return next;
                  })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px]",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
                  off ? "text-content-subtle line-through" : "text-content-secondary",
                )}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: off ? "var(--lr-content-subtle)" : series.stroke }}
                />
                {series.label}
              </button>
            </li>
          );
        })}
      </ul>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[210px] w-full"
        aria-hidden
        focusable="false"
      >
        {gridLines.map((ratio) => {
          const gy = PAD_TOP + plotHeight - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH}
                y1={gy}
                y2={gy}
                stroke="currentColor"
                className="text-line"
                strokeWidth="1"
              />
              <text
                x={PAD_LEFT - 6}
                y={gy + 3.5}
                textAnchor="end"
                className="fill-current text-content-subtle"
                style={{ fontSize: "9px" }}
              >
                {Math.round(max * ratio).toLocaleString("en-GB")}
              </text>
            </g>
          );
        })}

        {visible.map((series) => {
          const line = points
            .map((point, index) => `${x(index)},${y(point[series.key])}`)
            .join(" ");
          const area = `${PAD_LEFT},${PAD_TOP + plotHeight} ${line} ${x(
            points.length - 1,
          )},${PAD_TOP + plotHeight}`;

          return (
            <g key={series.key}>
              <polygon points={area} fill={series.fill} />
              <polyline
                points={line}
                fill="none"
                stroke={series.stroke}
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {axisTicks(points).map(({ index, label }) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 6}
            textAnchor="middle"
            className="fill-current text-content-subtle"
            style={{ fontSize: "9px" }}
          >
            {label}
          </text>
        ))}
      </svg>

      {/* The same data, readable. Visually hidden, fully available. */}
      <table className="sr-only">
        <caption>Daily totals for the selected period.</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {SERIES.map((series) => (
              <th key={series.key} scope="col">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              {SERIES.map((series) => (
                <td key={series.key}>{point[series.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Round the axis top to something a person would choose. */
function niceCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/** At most six date labels, however long the window is. */
function axisTicks(points: TrendPoint[]): { index: number; label: string }[] {
  const wanted = Math.min(6, points.length);
  const step = Math.max(1, Math.floor(points.length / wanted));
  const ticks: { index: number; label: string }[] = [];

  for (let index = 0; index < points.length; index += step) {
    const date = new Date(`${points[index].date}T00:00:00Z`);
    ticks.push({
      index,
      label: new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(date),
    });
  }
  return ticks;
}
