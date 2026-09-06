"use client";

import * as React from "react";
import { ArrowUpDown, LayoutGrid, Search, SlidersHorizontal, Table2 } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  GRADES,
  PROSPECT_SORTS,
  PROSPECT_SORT_LABELS,
  PROSPECT_STATUSES,
  VERIFICATION_STATUSES,
  activeFilterCount,
  type ProspectFilters,
  type ProspectSort,
} from "@/lib/prospects/filters";
import { prospectStatusLabel, verificationLabel } from "@/lib/prospects/types";
import { eligibilityLabel } from "@/lib/policy/types";
import type { ProspectFilterOptions } from "@/lib/prospects/queries";
import type { ViewMode } from "@/components/ui/view-toggle";
import { useFindLeadsParams } from "../use-find-leads-params";
import { FilterChip, type FilterChipOption } from "./filter-chip";

/**
 * Search, the advanced filter chips, sort and the table/card switch (§12.3-12.5).
 *
 * Every control writes straight to the URL. There is no "apply" button to
 * forget and no local mirror of the filter state, so the result set always
 * matches the address bar and a shared link reproduces the view exactly.
 *
 * Options come from the server (`ProspectFilterOptions`), which resolves the
 * distinct values that actually exist in this workspace. A chip whose column
 * has no values is disabled rather than hidden, so the row does not reflow as
 * a workspace fills up.
 */

const ELIGIBILITY_VALUES = ["ELIGIBLE", "REVIEW", "CONSENT_REQUIRED", "SUPPRESSED"] as const;

const INTENT_FRESHNESS: FilterChipOption[] = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const DATE_RANGES: FilterChipOption[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const SCORE_BANDS: FilterChipOption[] = [
  { value: "85", label: "85 and above" },
  { value: "70", label: "70 and above" },
  { value: "55", label: "55 and above" },
];

function plain(values: string[]): FilterChipOption[] {
  return values.map((value) => ({ value, label: value }));
}

export function ProspectToolbar({
  filters,
  options,
  mode,
  onModeChange,
  onOpenFilterPanel,
}: {
  filters: ProspectFilters;
  options: ProspectFilterOptions;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onOpenFilterPanel: () => void;
}) {
  const params = useFindLeadsParams();
  const filterCount = activeFilterCount(filters);

  // Uncontrolled with a debounce: typing must not push a history entry per
  // keystroke, and a controlled input would re-render the whole table on each
  // one.
  const [term, setTerm] = React.useState(filters.search);
  const debounced = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync when the URL's search term changes underneath us — a cleared
  // filter chip, or the Back button. Done during render so the box never
  // paints a stale term for a frame.
  const [syncedSearch, setSyncedSearch] = React.useState(filters.search);
  if (syncedSearch !== filters.search) {
    setSyncedSearch(filters.search);
    setTerm(filters.search);
  }

  const onSearch = (value: string) => {
    setTerm(value);
    if (debounced.current) clearTimeout(debounced.current);
    debounced.current = setTimeout(() => params.setParam("q", value || null), 350);
  };

  React.useEffect(
    () => () => {
      if (debounced.current) clearTimeout(debounced.current);
    },
    [],
  );

  /** A chip that holds at most one value, stored as a scalar param. */
  const single = (key: string, current: string | null) => ({
    selected: current ? [current] : [],
    onToggle: (value: string) => params.setParam(key, current === value ? null : value),
    onClear: () => params.setParam(key, null),
    multiple: false,
  });

  /** A chip that holds many values, stored as a comma-joined list param. */
  const many = (key: string, current: string[]) => ({
    selected: current,
    onToggle: (value: string) => params.toggleInList(key, value, current),
    onClear: () => params.setList(key, []),
  });

  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={term}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search prospects, companies or keywords..."
            aria-label="Search prospects"
            className={cn(
              "h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13.5px] text-content",
              "placeholder:text-content-subtle",
              "focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-content-accent",
            )}
          />
        </div>

        <button
          type="button"
          onClick={onOpenFilterPanel}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-[13px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {filterCount > 0 && (
            <span className="rounded-full bg-accent-500 px-1.5 text-[10.5px] font-semibold leading-4 text-white tabular-nums">
              {filterCount}
            </span>
          )}
        </button>

        <ViewSwitch mode={mode} onChange={onModeChange} />
      </div>

      {/* The chip row. Two lines on a laptop, wrapping to more on a tablet —
          never a horizontal scroller, which hides filters people then cannot
          find. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label="ICP"
          options={options.icpProfiles.map((p) => ({ value: p.id, label: p.name }))}
          {...single("icp", filters.icpProfileId)}
        />
        <FilterChip
          label="Score/grade"
          options={[...GRADES.map((g) => ({ value: g, label: `Grade ${g}` })), ...SCORE_BANDS]}
          selected={[
            ...filters.grades,
            ...(filters.minScore !== null ? [String(filters.minScore)] : []),
          ]}
          onToggle={(value) => {
            if (GRADES.includes(value as never)) {
              params.toggleInList("grade", value, filters.grades);
            } else {
              params.setParam("minScore", String(filters.minScore) === value ? null : value);
            }
          }}
          onClear={() => {
            params.setList("grade", []);
            params.setParam("minScore", null);
          }}
        />
        <FilterChip label="Industry" options={plain(options.industries)} {...many("industry", filters.industries)} />
        <FilterChip label="Location" options={plain(options.locations)} {...many("location", filters.locations)} />
        <FilterChip
          label="Company size"
          options={plain(options.companySizes)}
          {...many("size_band", filters.companySizes)}
        />
        <FilterChip label="Role/title" options={plain(options.roles)} {...many("role", filters.roles)} />
        <FilterChip
          label="Intent category"
          options={options.intentCategories.map((c) => ({ value: c.id, label: c.name }))}
          {...many("intent", filters.intentCategoryIds)}
        />
        <FilterChip
          label="Intent freshness"
          options={INTENT_FRESHNESS}
          {...single(
            "intentDays",
            filters.intentWithinDays === null ? null : String(filters.intentWithinDays),
          )}
        />
        <FilterChip
          label="Email verification"
          options={VERIFICATION_STATUSES.map((v) => ({ value: v, label: verificationLabel(v) }))}
          {...many("verification", filters.verification)}
        />
        <FilterChip
          label="Outreach status"
          options={PROSPECT_STATUSES.map((s) => ({ value: s, label: prospectStatusLabel(s) }))}
          {...many("status", filters.statuses)}
        />
        <FilterChip
          label="Campaign"
          options={options.campaigns.map((c) => ({ value: c.id, label: c.name }))}
          {...single("campaign", filters.campaignId)}
        />
        <FilterChip
          label="Source provider"
          options={plain(options.providers)}
          {...single("provider", filters.sourceProvider)}
        />
        <FilterChip
          label="Date"
          options={DATE_RANGES}
          {...single("range", filters.range === "all" ? null : filters.range)}
        />
        <FilterChip
          label="Contactability eligibility"
          options={ELIGIBILITY_VALUES.map((v) => ({ value: v, label: eligibilityLabel(v) }))}
          {...many("eligibility", filters.eligibility)}
        />

        <div className="ml-auto flex items-center gap-2">
          <SortControl
            value={filters.sort}
            onChange={(sort) =>
              params.setParam("sort", sort === "relevance" ? null : sort)
            }
          />
          {(filterCount > 0 || filters.search) && (
            <button
              type="button"
              onClick={() => params.clearFilters(filters)}
              className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SortControl({
  value,
  onChange,
}: {
  value: ProspectSort;
  onChange: (sort: ProspectSort) => void;
}) {
  return (
    <Popover
      label="Sort prospects"
      align="end"
      trigger={
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
        >
          <ArrowUpDown className="size-3.5 opacity-70" aria-hidden />
          Sort: {PROSPECT_SORT_LABELS[value]}
        </button>
      }
    >
      {(close) => (
        <div className="min-w-[13rem] py-1">
          {PROSPECT_SORTS.map((sort) => (
            <button
              key={sort}
              type="button"
              aria-current={sort === value}
              onClick={() => {
                onChange(sort);
                close();
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors",
                sort === value
                  ? "font-medium text-content-accent"
                  : "text-content-secondary hover:bg-surface-hover",
              )}
            >
              {PROSPECT_SORT_LABELS[sort]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * Table/Cards. A local switch rather than the shared `ViewToggle` because the
 * reference labels these "Table" and "Cards" with the icons inline at all
 * widths, and the shared control hides its labels below `sm`.
 */
function ViewSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const items: { value: ViewMode; label: string; icon: typeof Table2 }[] = [
    { value: "list", label: "Table", icon: Table2 },
    { value: "card", label: "Cards", icon: LayoutGrid },
  ];

  return (
    <div
      role="group"
      aria-label="Switch between table and cards"
      className="inline-flex h-10 items-center gap-1 rounded-lg border border-line bg-surface p-1"
    >
      {items.map((item) => {
        const active = item.value === mode;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent",
              active
                ? "border border-accent-500 bg-accent-50 text-content-accent"
                : "text-content-muted hover:bg-surface-hover hover:text-content",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
