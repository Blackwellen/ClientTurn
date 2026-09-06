import * as React from "react";
import { cn } from "@/lib/cn";

const TONES = {
  positive: "text-success-500",
  negative: "text-danger-500",
  neutral: "text-content-subtle",
} as const;

/**
 * A hand-rolled SVG spark — no charting library for a 56×20 line. Values are
 * real per-bucket counts from the selected window; a series with no movement
 * draws a flat baseline rather than an invented wiggle.
 */
export function Sparkline({
  values,
  tone = "neutral",
  width = 52,
  height = 22,
  className,
}: {
  values: number[];
  tone?: keyof typeof TONES;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);

  // A period with no activity at all has nothing to plot: drawing a flat line
  // would imply a measured trend, and it steals the width the delta needs.
  if (max === 0 && min === 0) return null;
  const span = max - min;
  const step = width / (values.length - 1);
  // 1.5px of padding top and bottom keeps the stroke inside the viewBox.
  const plot = height - 3;

  const points = values.map((value, index) => {
    const y = span === 0 ? plot / 2 + 1.5 : 1.5 + plot - ((value - min) / span) * plot;
    return [index * step, y] as const;
  });

  // Curved through the real points, never past them: a monotone cubic keeps
  // the line calm at this size without inventing peaks the data does not have.
  const line = points
    .map(([x, y], index) => {
      if (index === 0) return `M${x.toFixed(1)} ${y.toFixed(1)}`;
      const [previousX, previousY] = points[index - 1];
      const midX = (previousX + x) / 2;
      return `C${midX.toFixed(1)} ${previousY.toFixed(1)} ${midX.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      focusable="false"
      preserveAspectRatio="none"
      className={cn("overflow-visible", TONES[tone], className)}
    >
      <path d={area} fill="currentColor" opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Bars, for a quantity that accumulates rather than fluctuates — the value
 * added to the pipeline in each bucket of the window. An all-zero series
 * renders nothing at all rather than a flat row of stubs.
 */
export function Sparkbars({
  values,
  tone = "positive",
  width = 52,
  height = 22,
  className,
}: {
  values: number[];
  tone?: keyof typeof TONES;
  width?: number;
  height?: number;
  className?: string;
}) {
  const max = Math.max(...values, 0);
  if (values.length === 0 || max <= 0) return null;

  const slot = width / values.length;
  const barWidth = Math.max(1.5, slot - 1.5);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      focusable="false"
      className={cn(TONES[tone], className)}
    >
      {values.map((value, index) => {
        const barHeight = value <= 0 ? 0 : Math.max(1.5, (value / max) * height);
        if (barHeight === 0) return null;
        return (
          <rect
            key={index}
            x={(index * slot).toFixed(1)}
            y={(height - barHeight).toFixed(1)}
            width={barWidth.toFixed(1)}
            height={barHeight.toFixed(1)}
            rx={0.75}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
