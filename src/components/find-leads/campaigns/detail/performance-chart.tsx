import * as React from "react";
import type { DailyPoint } from "@/lib/outreach/campaigns/detail";

/**
 * The daily performance chart.
 *
 * Inline SVG rather than a charting dependency: four series over thirty points
 * is a polyline, and shipping a library to draw it would cost more than it
 * explains. Every point comes from the per-day rollup, so nothing here is
 * interpolated or smoothed into a shape the data does not have.
 *
 * The chart is `aria-hidden`; the table underneath it is what a screen reader
 * gets, because a line has no accessible reading.
 */

const SERIES = [
  { key: "contactsSent", label: "Contacts sent", colour: "var(--lr-info-500)" },
  { key: "replies", label: "Replies", colour: "var(--lr-purple-500)" },
  { key: "qualified", label: "Qualified", colour: "var(--lr-success-600)" },
  { key: "booked", label: "Booked", colour: "var(--lr-warning-500)" },
] as const;

const WIDTH = 520;
const HEIGHT = 168;
const PAD = { top: 8, right: 8, bottom: 22, left: 30 };

export function PerformanceChart({ series }: { series: DailyPoint[] }) {
  if (series.length === 0) return null;

  const max = Math.max(
    1,
    ...series.flatMap((point) => [
      point.contactsSent,
      point.replies,
      point.qualified,
      point.booked,
    ]),
  );

  // A round top makes the gridline labels readable rather than arbitrary.
  const ceiling = niceCeiling(max);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const y = (value: number) => PAD.top + plotHeight - (value / ceiling) * plotHeight;

  const ticks = [0, ceiling / 4, ceiling / 2, (ceiling * 3) / 4, ceiling];

  const labelEvery = Math.max(1, Math.ceil(series.length / 8));

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {SERIES.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-[11.5px] text-content-secondary">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: entry.colour }}
            />
            {entry.label}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-[168px] w-full min-w-[380px]"
          role="img"
          aria-hidden
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--lr-neutral-100)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={y(tick) + 3}
                textAnchor="end"
                fontSize="8"
                fill="var(--lr-neutral-400)"
              >
                {Math.round(tick)}
              </text>
            </g>
          ))}

          {SERIES.map((entry) => {
            const points = series
              .map((point, index) => `${x(index)},${y(point[entry.key])}`)
              .join(" ");

            return (
              <polyline
                key={entry.key}
                points={points}
                fill="none"
                stroke={entry.colour}
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {series.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.day}
                x={x(index)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize="8"
                fill="var(--lr-neutral-400)"
              >
                {shortDate(point.day)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* The accessible reading of the chart: totals, stated plainly. */}
      <p className="sr-only">
        Over the last {series.length} days:{" "}
        {SERIES.map(
          (entry) =>
            `${entry.label} ${series.reduce((total, point) => total + point[entry.key], 0)}`,
        ).join(", ")}
        .
      </p>
    </div>
  );
}

function niceCeiling(max: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
