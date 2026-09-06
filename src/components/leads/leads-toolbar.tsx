"use client";

import * as React from "react";
import { LayoutGrid, List, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { LEAD_STATUS } from "@/components/ui/badge";
import {
  DATE_RANGES,
  hasActiveFilters,
  type LeadFilters,
  type LeadView,
} from "@/lib/leads/filters";
import type { FilterOptions } from "@/lib/leads/types";
import { LeadFilterButton } from "./lead-filter-popover";
import { LeadSearchInput } from "./lead-search-input";
import { useLeadParams } from "./use-lead-params";

const VIEW_KEY = "clientturn.leads.view";
const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The view preference is written to a cookie as well as localStorage so the
 * server can render the right view on first paint — the same approach the
 * shell uses for the collapsed sidebar, and the reason there is no flash of
 * card view before a table-view user's preference loads.
 */
function persistView(view: LeadView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage unavailable; the cookie below still carries the preference.
  }
  try {
    document.cookie = `${VIEW_KEY}=${view}; path=/; max-age=${VIEW_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // Cookies unavailable; the view simply resets to the default next visit.
  }
}

export function LeadViewToggle({ value }: { value: LeadView }) {
  const { setParams } = useLeadParams();

  const change = (next: LeadView) => {
    if (next === value) return;
    persistView(next);
    // Page size is view-specific (12 cards / 10 rows), so the explicit size
    // and offset are dropped and re-derived rather than carried across.
    setParams({ view: next, page: null, pageSize: null });
  };

  const options: { value: LeadView; label: string; icon: typeof LayoutGrid }[] = [
    { value: "cards", label: "Card view", icon: LayoutGrid },
    { value: "table", label: "Table view", icon: List },
  ];

  return (
    <div
      role="group"
      aria-label="Switch view"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-xs"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => change(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium",
              "transition-colors duration-[var(--lr-duration-base)]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
              active
                ? "bg-accent-50 text-content ring-1 ring-accent-300"
                : "text-content-muted hover:bg-surface-hover hover:text-content",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ActiveFilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-content-secondary">
      <span className="max-w-[160px] truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
        className="rounded-xs text-content-subtle transition-colors hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/** Builds the chip row from what is actually applied, in a stable order. */
function useActiveChips(filters: LeadFilters, options: FilterOptions) {
  return React.useMemo(() => {
    const chips: { key: string; label: string; patch: Record<string, string | null> }[] =
      [];

    if (filters.status?.length) {
      chips.push({
        key: "status",
        label: `Status: ${filters.status
          .map((status) => LEAD_STATUS[status]?.label ?? status)
          .join(", ")}`,
        patch: { status: null },
      });
    }

    if (filters.service?.length) {
      const names = filters.service
        .map((id) => options.services.find((s) => s.id === id)?.name)
        .filter(Boolean);
      chips.push({
        key: "service",
        label: `Service: ${names.length ? names.join(", ") : filters.service.length}`,
        patch: { service: null },
      });
    }

    if (filters.source?.length) {
      const names = filters.source
        .map((id) => options.sources.find((s) => s.id === id)?.label)
        .filter(Boolean);
      chips.push({
        key: "source",
        label: `Source: ${names.length ? names.join(", ") : filters.source.length}`,
        patch: { source: null },
      });
    }

    if (filters.form) {
      chips.push({ key: "form", label: filters.form, patch: { form: null } });
    }

    if (filters.campaign) {
      const label =
        options.campaigns.find((c) => c.id === filters.campaign)?.label ??
        filters.campaign;
      chips.push({ key: "campaign", label, patch: { campaign: null } });
    }

    if (filters.assignee) {
      const label =
        filters.assignee === "unassigned"
          ? "Unassigned"
          : (options.members.find((m) => m.userId === filters.assignee)?.name ??
            "Assigned user");
      chips.push({ key: "assignee", label, patch: { assignee: null } });
    }

    if (filters.attention) {
      chips.push({
        key: "attention",
        label: "Needs attention",
        patch: { attention: null },
      });
    }

    if (filters.range !== "all") {
      const label =
        DATE_RANGES.find((range) => range.value === filters.range)?.label ??
        "Custom range";
      chips.push({ key: "range", label, patch: { range: null, from: null, to: null } });
    }

    if (filters.q) {
      chips.push({ key: "q", label: `“${filters.q}”`, patch: { q: null } });
    }

    return chips;
  }, [filters, options]);
}

export function LeadsToolbar({
  filters,
  options,
}: {
  filters: LeadFilters;
  options: FilterOptions;
}) {
  const { setFilter, clearFilters } = useLeadParams();
  const chips = useActiveChips(filters, options);

  return (
    <div className="flex items-center gap-2">
      <LeadSearchInput
        value={filters.q ?? ""}
        onChange={(value) => setFilter({ q: value || null })}
        className="w-full shrink-0 sm:w-[380px] xl:w-[460px]"
      />

      <div className="shrink-0">
        <LeadFilterButton filters={filters} options={options} />
      </div>

      {chips.length > 0 && (
        // Chips scroll rather than wrap, so a long filter set can never push
        // the view toggle onto a second row and double the toolbar height.
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((chip) => (
            <ActiveFilterChip
              key={chip.key}
              label={chip.label}
              onRemove={() => setFilter(chip.patch)}
            />
          ))}
        </div>
      )}

      {/* Pinned outside the scroller: the escape hatch must never be the part
          that scrolls out of reach. */}
      {chips.length > 1 && hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={clearFilters}
          className="h-8 shrink-0 rounded-lg px-2 text-[12px] font-medium text-content-muted transition-colors hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
        >
          Clear all
        </button>
      )}

      <div className="ml-auto shrink-0">
        <LeadViewToggle value={filters.view} />
      </div>
    </div>
  );
}
