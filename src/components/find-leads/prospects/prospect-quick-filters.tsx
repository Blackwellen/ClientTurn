"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  PROSPECT_QUICK_FILTERS,
  QUICK_FILTER_LABELS,
  type ProspectQuickFilter,
} from "@/lib/prospects/filters";
import type { ProspectQuickCounts } from "@/lib/prospects/types";

/**
 * The seven quick filters above the inbox (V4 §12.3).
 *
 * Presets, not a separate filter dimension: each one writes an ordinary
 * predicate to the URL, so it composes with whatever the advanced chips are
 * doing rather than replacing them. That is why "A Grade" plus a Location chip
 * narrows rather than fighting.
 *
 * Rendered as a `tablist` because exactly one is always active and arrow keys
 * should move between them — a group of toggle buttons would announce seven
 * independent states, only one of which can be true.
 */
export function ProspectQuickFilters({
  value,
  counts,
  onChange,
}: {
  value: ProspectQuickFilter;
  counts: ProspectQuickCounts;
  onChange: (value: ProspectQuickFilter) => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = PROSPECT_QUICK_FILTERS.indexOf(value);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % PROSPECT_QUICK_FILTERS.length
        : (index - 1 + PROSPECT_QUICK_FILTERS.length) % PROSPECT_QUICK_FILTERS.length;
    onChange(PROSPECT_QUICK_FILTERS[next]);
  };

  return (
    <div
      role="tablist"
      aria-label="Quick filters"
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-2"
    >
      {PROSPECT_QUICK_FILTERS.map((key) => {
        const active = key === value;
        const count = countFor(counts, key);
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-4 text-[13px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
              active
                ? "border-accent-500 bg-accent-50 text-content-accent"
                : "border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content",
            )}
          >
            {QUICK_FILTER_LABELS[key]}
            {count > 0 && (
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-content-accent/70" : "text-content-subtle",
                )}
              >
                {count.toLocaleString("en-GB")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function countFor(counts: ProspectQuickCounts, key: ProspectQuickFilter): number {
  switch (key) {
    case "a-grade":
      return counts.aGrade;
    case "intent":
      return counts.intent;
    case "ready":
      return counts.ready;
    case "contacted":
      return counts.contacted;
    case "replied":
      return counts.replied;
    case "review":
      return counts.review;
    default:
      return counts.all;
  }
}
