"use client";

import * as React from "react";
import { GrowColumn } from "./reveal";

/**
 * The two chart shapes the evaluation pages need, drawn as inline SVG.
 *
 * No charting library: these render four fixed fixtures and a library would
 * cost more bytes than the whole page. Neither chart animates — a public page
 * that redraws a line while the visitor is reading it is noise, not motion.
 *
 * Both are `role="img"` with a full text alternative, because a screen-reader
 * user needs the split, not a list of unlabelled path elements. Every value is
 * a fixture and is labelled as such by the surrounding surface.
 */

export type Slice = {
  label: string;
  value: number;
  colour: string;
};

export function Donut({
  slices,
  total,
  totalLabel,
  size = 132,
}: {
  slices: readonly Slice[];
  total: string;
  totalLabel: string;
  size?: number;
}) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0) || 1;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  const arcs = slices.map((slice, index) => {
    const length = (slice.value / sum) * circumference;
    const offset = slices.slice(0, index).reduce((acc, previous) => acc + previous.value, 0) / sum * circumference;
    const arc = {
      ...slice,
      dash: `${length} ${circumference - length}`,
      offset: -offset,
      percent: Math.round((slice.value / sum) * 100),
    };
    return arc;
  });

  const description = arcs
    .map((arc) => `${arc.label} ${arc.percent}%`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={`${totalLabel}: ${total}. Split by source: ${description}.`}
      style={{ position: "relative", width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
        <g transform="rotate(-90 66 66)">
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx="66"
              cy="66"
              r={radius}
              fill="none"
              stroke={arc.colour}
              strokeWidth="18"
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
            />
          ))}
        </g>
      </svg>
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeContent: "center",
          textAlign: "center",
          lineHeight: 1.25,
        }}
      >
        <b
          style={{
            fontSize: 17,
            fontWeight: 650,
            color: "#f2f6fa",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {total}
        </b>
        <span style={{ fontSize: 9.5, color: "#7f8b9f" }}>{totalLabel}</span>
      </span>
    </div>
  );
}

export function DonutLegend({ slices }: { slices: readonly Slice[] }) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0) || 1;

  return (
    <ul className="pub-donut-legend">
      {slices.map((slice) => (
        <li key={slice.label}>
          <i style={{ background: slice.colour }} aria-hidden />
          <span>{slice.label}</span>
          <b>{Math.round((slice.value / sum) * 100)}%</b>
        </li>
      ))}
    </ul>
  );
}

/**
 * A single decaying trend line — the "time to conversion" shape. Static,
 * unlabelled at the point level, and always accompanied by the figure it is
 * illustrating in text.
 */
export function TrendLine({
  points,
  label,
  colour = "#7fb2ff",
  height = 74,
}: {
  points: readonly number[];
  label: string;
  colour?: string;
  height?: number;
}) {
  const max = Math.max(...points, 1);
  const step = 100 / Math.max(points.length - 1, 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = 100 - (point / max) * 92;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const gradientId = React.useId();

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.28" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L100 100 L0 100 Z`} fill={`url(#${gradientId})`} />
      <path
        d={path}
        fill="none"
        stroke={colour}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The vertical column chart used for "prospects by source". */
export function Columns({
  bars,
  label,
  height = 150,
}: {
  bars: readonly { label: string; value: number; colour: string }[];
  label: string;
  height?: number;
}) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div
      role="img"
      aria-label={`${label}. ${bars
        .map((bar) => `${bar.label} ${bar.value.toLocaleString("en-GB")}`)
        .join(", ")}.`}
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "minmax(0, 1fr)",
        alignItems: "end",
        gap: 10,
        height,
      }}
    >
      {bars.map((bar, index) => (
        <div
          key={bar.label}
          style={{ display: "grid", gap: 6, alignContent: "end" }}
          aria-hidden
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "#cfd6e0",
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {bar.value.toLocaleString("en-GB")}
          </span>
          <GrowColumn
            height={`${Math.max((bar.value / max) * (height - 46), 4)}px`}
            colour={bar.colour}
            delay={index * 0.06}
            className="block rounded-t-[4px]"
          />
          <span
            style={{
              fontSize: 9.5,
              color: "#7f8b9f",
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  );
}
