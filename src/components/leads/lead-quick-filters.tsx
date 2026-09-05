"use client";

import * as React from "react";
import {
  AlertTriangle,
  CalendarCheck,
  MessageSquare,
  PhoneCall,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  QUICK_FILTERS,
  type LeadView,
  type QuickFilter,
} from "@/lib/leads/filters";
import type { LeadQuickCounts } from "@/lib/leads/types";
import { useLeadParams } from "./use-lead-params";

const ICONS: Record<QuickFilter, React.ComponentType<{ className?: string }>> = {
  all: Users,
  active: PhoneCall,
  attention: AlertTriangle,
  qualified: MessageSquare,
  booked: CalendarCheck,
};

/**
 * The same five filters in two presentations: compact chips above the card
 * grid, larger summary cards above the table. Semantics are identical — only
 * the density changes, matching the approved designs for each view.
 */
export function LeadQuickFilters({
  value,
  counts,
  view,
}: {
  value: QuickFilter;
  counts: LeadQuickCounts;
  view: LeadView;
}) {
  const { setFilter } = useLeadParams();
  const select = (next: QuickFilter) =>
    setFilter({ quick: next === "all" ? null : next });

  if (view === "table") {
    return (
      <div
        role="group"
        aria-label="Quick filters"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        {QUICK_FILTERS.map((item) => (
          <QuickFilterSummaryCard
            key={item.value}
            item={item}
            count={counts[item.value]}
            selected={item.value === value}
            onSelect={() => select(item.value)}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Quick filters"
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl",
        "border border-line bg-surface p-1 shadow-xs",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {QUICK_FILTERS.map((item) => (
        <QuickFilterChip
          key={item.value}
          label={item.label}
          count={counts[item.value]}
          selected={item.value === value}
          onSelect={() => select(item.value)}
        />
      ))}
    </div>
  );
}

export function QuickFilterChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
        selected
          ? "bg-accent-50 text-content ring-1 ring-accent-300"
          : "text-content-muted hover:bg-surface-hover hover:text-content",
      )}
    >
      {label}
      <span
        className={cn(
          "lr-tabular rounded-md px-1.5 py-px text-[11px] font-semibold",
          selected
            ? "bg-accent-200/70 text-accent-800"
            : "bg-surface-sunken text-content-secondary",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function QuickFilterSummaryCard({
  item,
  count,
  selected,
  onSelect,
}: {
  item: (typeof QUICK_FILTERS)[number];
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = ICONS[item.value];
  // Attention is the one filter that carries a warning colour — everything
  // else stays neutral so a genuinely urgent count is the only thing that
  // reads as red on the page.
  const warn = item.value === "attention" && count > 0;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-surface px-3.5 py-3 text-left",
        "transition-[background-color,border-color,box-shadow] duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        selected
          ? "border-accent-400 bg-accent-50/60 shadow-xs"
          : "border-line shadow-xs hover:border-line-strong hover:bg-surface-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          warn ? "bg-danger-50 text-danger-600" : "bg-accent-50 text-content-accent",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium text-content-secondary">
          {item.label}
        </span>
        <span
          className={cn(
            "lr-tabular block text-[22px] font-semibold leading-tight",
            warn ? "text-danger-600" : "text-content",
          )}
        >
          {count}
        </span>
        <span className="block truncate text-[11px] text-content-subtle">
          {item.caption}
        </span>
      </span>
    </button>
  );
}
