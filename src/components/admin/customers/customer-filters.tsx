"use client";

import * as React from "react";
import { Circle, Hash, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchInput } from "@/components/ui/search-input";
import { Popover } from "@/components/ui/popover";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  CUSTOMER_FILTERS,
  CUSTOMER_FILTER_LABEL,
  CUSTOMER_SORTS,
  type CustomerFilter,
  type CustomerSort,
} from "@/lib/admin/types";

const CHIP_DOT: Record<CustomerFilter, string> = {
  all: "text-content-subtle",
  trial: "text-warning-500",
  active: "text-success-500",
  past_due: "text-danger-500",
  cancelled: "text-content-subtle",
  connection_issue: "text-danger-500",
};

const SORT_LABEL: Record<CustomerSort, string> = {
  joined: "Joined",
  business: "Business",
  plan: "Plan",
  subscription: "Subscription",
  lead_usage: "Lead usage",
  message_usage: "Message usage",
  last_activity: "Last activity",
};

export function CustomerFilters({
  filter,
  search,
  sort,
  direction,
  pageSize,
  onChange,
}: {
  filter: CustomerFilter;
  search: string;
  sort: CustomerSort;
  direction: "asc" | "desc";
  pageSize: number;
  onChange: (patch: Record<string, string | null>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        defaultValue={search}
        label="Search customers"
        placeholder="Search customers, owners, or domains..."
        onChange={(value) => onChange({ q: value || null, page: null })}
        className="w-full min-w-[220px] sm:w-[352px]"
      />

      <div
        role="group"
        aria-label="Filter by status"
        className="flex flex-wrap items-center gap-2"
      >
        {CUSTOMER_FILTERS.map((option) => {
          const active = option === filter;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange({
                  filter: option === "all" ? null : option,
                  page: null,
                })
              }
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3",
                "text-[12.5px] font-medium whitespace-nowrap shadow-xs",
                "transition-colors duration-[var(--lr-duration-fast)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                active
                  ? "border-accent-500 bg-accent-50 text-content-accent"
                  : "border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content",
              )}
            >
              {option === "all" ? (
                <Hash className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <Circle
                  className={cn("size-2.5 shrink-0 fill-current", CHIP_DOT[option])}
                  aria-hidden
                />
              )}
              {CUSTOMER_FILTER_LABEL[option]}
            </button>
          );
        })}
      </div>

      <Popover
        label="More filters"
        align="end"
        className="ml-auto"
        trigger={
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3",
              "text-[12.5px] font-medium text-content-secondary shadow-xs",
              "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover hover:text-content",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            )}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Filters
          </button>
        }
      >
        {(close) => (
          <div className="w-64 space-y-3 p-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-content-muted">
                Sort by
              </span>
              <Select
                value={sort}
                onChange={(event) =>
                  onChange({ sort: event.target.value, page: null })
                }
              >
                {CUSTOMER_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABEL[option]}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-content-muted">
                Direction
              </span>
              <Select
                value={direction}
                onChange={(event) =>
                  onChange({ dir: event.target.value, page: null })
                }
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-content-muted">
                Rows per page
              </span>
              <Select
                value={pageSize}
                onChange={(event) =>
                  onChange({ size: event.target.value, page: null })
                }
              >
                {[10, 25, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange({
                    sort: null,
                    dir: null,
                    size: null,
                    filter: null,
                    q: null,
                    page: null,
                  });
                  close();
                }}
              >
                Reset
              </Button>
              <Button size="sm" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
