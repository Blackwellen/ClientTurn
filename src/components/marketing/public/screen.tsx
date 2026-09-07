"use client";

import * as React from "react";
import { GrowBar } from "./reveal";
import { cn } from "@/lib/cn";
import { IllustrativeTag } from "./shell";

/**
 * Light product surfaces, rendered inside the dark marketing pages.
 *
 * Drawn in markup rather than shipped as screenshots: a PNG of the app goes
 * stale silently, cannot reflow on a phone, and stops being legible at 200%
 * zoom. The navigation labels, column headings and state names are the ones
 * the product actually uses, so a visitor recognises the screen after signup.
 *
 * Every number inside one of these is a fixture, and `Screen` stamps the
 * sample-data marker itself — there is no variant that renders metrics
 * without one.
 */

/** The app's primary destinations, in the order the sidebar shows them. */
export const APP_NAV = [
  "Dashboard",
  "Leads",
  "Find Leads",
  "Follow-Up",
  "Reactivation",
  "Analytics",
  "Settings",
] as const;

export function Screen({
  nav,
  active,
  title,
  meta,
  children,
  className,
  label,
}: {
  nav?: readonly string[];
  active: string;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Describes the whole screen for anyone who cannot see it. */
  label: string;
}) {
  const items = nav ?? APP_NAV;

  return (
    <figure className={cn("pub-screen", className)} role="img" aria-label={label}>
      <div className="pub-screen-bar" aria-hidden>
        <span className="grid size-[18px] place-items-center rounded-[5px] bg-[#b7f34a] text-[11px] font-extrabold text-[#0b1020]">
          C
        </span>
        <span className="text-[12px] font-[650] tracking-[-0.02em] text-[#0b1020]">
          ClientTurn
        </span>
        <span className="pub-screen-dots">
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="pub-screen-body">
        <div className="pub-screen-nav" aria-hidden>
          {items.map((item) => (
            <span key={item} data-active={item === active ? "true" : undefined}>
              <i className="size-[5px] shrink-0 rounded-[2px] bg-current opacity-45" />
              {item}
            </span>
          ))}
        </div>

        <div className="pub-screen-main">
          <div className="pub-screen-head">
            <span className="pub-screen-title">{title}</span>
            <span className="inline-flex items-center gap-2">
              {meta}
              <IllustrativeTag surface="light">Sample data</IllustrativeTag>
            </span>
          </div>
          {children}
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ parts --- */

export function Kpis({
  items,
  columns,
}: {
  items: readonly { value: string; label: string; delta?: string }[];
  columns?: number;
}) {
  return (
    <div
      className="pub-kpis"
      style={{ "--pub-kpi-cols": columns ?? items.length } as React.CSSProperties}
    >
      {items.map((item) => (
        <div key={item.label} className="pub-kpi">
          <b>{item.value}</b>
          <span>{item.label}</span>
          {item.delta && <em>{item.delta}</em>}
        </div>
      ))}
    </div>
  );
}

/** Horizontal funnel bars — the shape the journey is read in. */
export function FunnelBars({
  rows,
  max,
}: {
  rows: readonly { label: string; value: number; colour: string }[];
  max?: number;
}) {
  const ceiling = max ?? Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="pub-bars">
      {rows.map((row, index) => (
        <div key={row.label} className="pub-bar">
          <span>{row.label}</span>
          <span className="pub-bar-track">
            <GrowBar
              className="pub-bar-fill"
              width={`${Math.max((row.value / ceiling) * 100, 3)}%`}
              colour={row.colour}
              delay={index * 0.07}
            />
          </span>
          <b>{row.value.toLocaleString("en-GB")}</b>
        </div>
      ))}
    </div>
  );
}

/** A light-surface table for lead lists and campaign breakdowns. */
export function ScreenTable({
  head,
  rows,
}: {
  head: readonly string[];
  rows: readonly (readonly React.ReactNode[])[];
}) {
  return (
    <div className="pub-screen-scroll">
      <table className="pub-screen-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Light-surface status pill, matching the app's badge vocabulary. */
export function Pill({
  tone,
  children,
}: {
  tone: "new" | "progress" | "won" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    new: "bg-[#e4effd] text-[#1e4f96]",
    progress: "bg-[#fdf1dc] text-[#8a5a12]",
    won: "bg-[#e7f5da] text-[#3f6b10]",
    neutral: "bg-[#eef1f6] text-[#5b6577]",
  } as const;

  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A labelled block inside a light screen. */
export function ScreenBlock({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pub-screen-block">
      <div className="pub-screen-block-head">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A definition row inside a screen block. */
export function ScreenRows({
  rows,
}: {
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <dl className="grid gap-2 text-[11.5px]">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="flex justify-between gap-3 border-b border-[#eef1f6] pb-[7px] last:border-0 last:pb-0"
        >
          <dt className="text-[#6b7686]">{term}</dt>
          <dd className="text-right font-[550] text-[#0b1020]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The "Last 30 days" control the product's report headers carry. */
export function RangeChip({ children = "Last 30 days" }: { children?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#dfe5ee] bg-white px-2.5 py-1 text-[10.5px] font-medium text-[#5b6577]">
      {children}
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden>
        <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
}

/**
 * The caption under a product frame.
 *
 * The frames rebuilt in `home/app-frames.tsx` show a sample workspace with
 * sample names and sample figures. That has to be said in visible copy next
 * to the frame, not only in an aria-label — a sighted visitor is exactly who
 * would otherwise read a dashboard mock as a result.
 */
export function IllustrativeNote({
  children = "A rebuild of the ClientTurn workspace with sample data. Not a customer, and not a result.",
}: {
  children?: React.ReactNode;
}) {
  return <p className="pub-small mt-3">{children}</p>;
}
