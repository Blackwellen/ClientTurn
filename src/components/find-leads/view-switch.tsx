"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The Find Leads internal view switch.
 *
 * A tab bar rather than four sidebar entries: the V3 navigation rule keeps the
 * sidebar at five customer destinations, and Discover / Prospects / Intent /
 * Campaigns are four views of one workspace, not four places to be.
 *
 * Distinct from `SegmentedControl` because this one is page-level chrome — a
 * white bar with an accent underline on the active view — rather than an
 * inline control inside a card.
 */

export type ViewSwitchItem = {
  value: string;
  label: string;
  count?: number;
};

export function FindLeadsViewSwitch({
  items,
  value,
  onChange,
  className,
}: {
  items: ViewSwitchItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = items.findIndex((item) => item.value === value);
    if (index < 0) return;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
      onChange(items[next].value);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Find Leads views"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-lg border border-line bg-surface-sunken",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`tab-${item.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`tabpanel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative min-w-[110px] px-5 py-2.5 text-[13.5px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent",
              active
                ? "bg-surface text-content"
                : "text-content-muted hover:bg-surface/60 hover:text-content-secondary",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {item.label}
              {typeof item.count === "number" && item.count > 0 && (
                <span className="tabular-nums text-content-subtle">{item.count}</span>
              )}
            </span>
            {/* The underline is the active affordance. It sits inside the
                button so it tracks the label width, not the cell. */}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-4 bottom-0 h-[2.5px] rounded-full bg-accent-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
