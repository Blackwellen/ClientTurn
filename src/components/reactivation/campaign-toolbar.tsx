"use client";

import * as React from "react";
import { LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form";
import { SearchInput } from "@/components/ui/search-input";
import {
  CAMPAIGN_CHANNEL_OPTIONS,
  CAMPAIGN_STATUS_OPTIONS,
  REACTIVATION_RANGE_OPTIONS,
  REACTIVATION_SORT_OPTIONS,
  advancedFilterCount,
  type ReactivationFilters,
  type ReactivationView,
} from "@/lib/campaigns/reactivation-filters";
import { useReactivationParams } from "./use-reactivation-params";

/** Every control in the bar shares one height so the row reads as a unit. */
const CONTROL = "h-9";

export function CampaignViewSwitch({ value }: { value: ReactivationView }) {
  const { setView } = useReactivationParams();

  const options: {
    value: ReactivationView;
    label: string;
    icon: typeof LayoutGrid;
  }[] = [
    { value: "cards", label: "Cards", icon: LayoutGrid },
    { value: "list", label: "List", icon: List },
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
            onClick={() => {
              if (!active) setView(option.value);
            }}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium",
              "transition-colors duration-[var(--lr-duration-base)]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
              active
                ? "bg-surface text-content ring-1 ring-accent-400"
                : "text-content-muted hover:bg-surface-hover hover:text-content",
            )}
          >
            <Icon
              className={cn("size-4", active && "text-content-accent")}
              aria-hidden
            />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------ more filters --- */

type Draft = {
  channel: string;
  tag: string;
  hasReplies: boolean;
  hasBookings: boolean;
};

function toDraft(filters: ReactivationFilters): Draft {
  return {
    channel: filters.channel ?? "",
    tag: filters.tag ?? "",
    hasReplies: filters.hasReplies,
    hasBookings: filters.hasBookings,
  };
}

/**
 * The secondary filters, in the same draft-then-apply popover pattern
 * `LeadFilterButton` uses on `/app/leads` — the URL only changes on Apply, so
 * the grid is not re-queried on every checkbox.
 */
export function CampaignFilterPopover({
  filters,
  tags,
}: {
  filters: ReactivationFilters;
  tags: string[];
}) {
  const { setFilter } = useReactivationParams();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(filters));
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const count = advancedFilterCount(filters);

  const openPanel = () => {
    setDraft(toDraft(filters));
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    panelRef.current?.querySelector<HTMLElement>("select,input,button")?.focus();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const apply = () => {
    setFilter({
      channel: draft.channel || null,
      tag: draft.tag || null,
      hasReplies: draft.hasReplies ? "1" : null,
      hasBookings: draft.hasBookings ? "1" : null,
    });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          CONTROL,
          "inline-flex items-center gap-2 rounded-lg border px-3 text-[13px] font-medium",
          "transition-colors duration-[var(--lr-duration-fast)]",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
          count > 0 || open
            ? "border-accent-400 bg-accent-50 text-content"
            : "border-line-strong bg-surface text-content-secondary hover:bg-surface-hover",
        )}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        More filters
        {count > 0 && (
          <span className="lr-tabular rounded-full bg-accent-500 px-1.5 text-[10px] font-semibold text-[var(--lr-on-primary)]">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="More campaign filters"
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-40 w-[min(360px,calc(100vw-2rem))]",
            "rounded-xl border border-line bg-surface p-4 shadow-lg",
            "animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)]",
          )}
        >
          <p className="mb-3 text-[13px] font-semibold text-content">
            More filters
          </p>

          <div className="space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                Channel
              </span>
              <Select
                value={draft.channel}
                onChange={(event) =>
                  setDraft((c) => ({ ...c, channel: event.target.value }))
                }
                className="h-9 text-[13px]"
              >
                {CAMPAIGN_CHANNEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                Tag
              </span>
              <Select
                value={draft.tag}
                onChange={(event) =>
                  setDraft((c) => ({ ...c, tag: event.target.value }))
                }
                className="h-9 text-[13px]"
                disabled={tags.length === 0}
              >
                <option value="">
                  {tags.length === 0 ? "No tags in use yet" : "Any tag"}
                </option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
            </label>

            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-content-secondary">
              <Checkbox
                checked={draft.hasReplies}
                onChange={(event) =>
                  setDraft((c) => ({ ...c, hasReplies: event.target.checked }))
                }
              />
              Has replies
            </label>

            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-content-secondary">
              <Checkbox
                checked={draft.hasBookings}
                onChange={(event) =>
                  setDraft((c) => ({ ...c, hasBookings: event.target.checked }))
                }
              />
              Has bookings
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line-subtle pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDraft({
                  channel: "",
                  tag: "",
                  hasReplies: false,
                  hasBookings: false,
                })
              }
            >
              Clear
            </Button>
            <Button size="sm" onClick={apply}>
              Apply filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- toolbar --- */

/**
 * `CampaignControls` — the one-row control bar under the KPI strip. It is the
 * same component in both views, so switching Cards/List never resets the
 * search, filters or sort.
 */
export function CampaignToolbar({
  filters,
  audiences,
  tags,
}: {
  filters: ReactivationFilters;
  audiences: string[];
  tags: string[];
}) {
  const { setFilter } = useReactivationParams();

  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          defaultValue={filters.q ?? ""}
          placeholder="Search campaigns..."
          label="Search campaigns"
          onChange={(value) => setFilter({ q: value || null })}
          className="w-full sm:w-[260px] xl:w-[300px]"
        />

        <Select
          aria-label="Status"
          value={filters.status}
          onChange={(event) =>
            setFilter({
              status: event.target.value === "all" ? null : event.target.value,
            })
          }
          className={cn(CONTROL, "w-auto min-w-[124px] rounded-lg text-[13px]")}
        >
          {CAMPAIGN_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "all" ? "Status" : option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Audience"
          value={filters.audience ?? ""}
          onChange={(event) => setFilter({ audience: event.target.value || null })}
          className={cn(CONTROL, "w-auto min-w-[136px] rounded-lg text-[13px]")}
        >
          <option value="">Audience</option>
          {audiences.map((audience) => (
            <option key={audience} value={audience}>
              {audience}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Date range"
          value={filters.range}
          onChange={(event) =>
            setFilter({
              range: event.target.value === "all" ? null : event.target.value,
              // A preset range makes any previously supplied custom dates
              // meaningless, so they are dropped together.
              from: event.target.value === "custom" ? filters.from ?? null : null,
              to: event.target.value === "custom" ? filters.to ?? null : null,
            })
          }
          className={cn(CONTROL, "w-auto min-w-[136px] rounded-lg text-[13px]")}
        >
          {REACTIVATION_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "all" ? "Date range" : option.label}
            </option>
          ))}
        </Select>

        {filters.range === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="From date"
              value={filters.from ?? ""}
              onChange={(event) => setFilter({ from: event.target.value || null })}
              className={cn(
                CONTROL,
                "rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-content shadow-xs",
              )}
            />
            <span className="text-[13px] text-content-subtle">to</span>
            <input
              type="date"
              aria-label="To date"
              value={filters.to ?? ""}
              onChange={(event) => setFilter({ to: event.target.value || null })}
              className={cn(
                CONTROL,
                "rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-content shadow-xs",
              )}
            />
          </div>
        )}

        <CampaignFilterPopover filters={filters} tags={tags} />

        <div className="ml-auto flex items-center gap-2">
          <label
            htmlFor="reactivation-sort"
            className="hidden text-[13px] text-content-muted sm:block"
          >
            Sort by
          </label>
          <Select
            id="reactivation-sort"
            aria-label="Sort by"
            value={filters.sort}
            onChange={(event) => setFilter({ sort: event.target.value })}
            className={cn(CONTROL, "w-auto min-w-[152px] rounded-lg text-[13px]")}
          >
            {REACTIVATION_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}
