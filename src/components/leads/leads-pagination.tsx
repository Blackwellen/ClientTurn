"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/form";
import { PAGE_SIZE_OPTIONS, type LeadFilters } from "@/lib/leads/filters";
import { useLeadParams } from "./use-lead-params";

/** Windowed page list with ellipsis gaps, 1-indexed. `null` renders a gap. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}

export function LeadsPagination({
  filters,
  total,
}: {
  filters: LeadFilters;
  total: number;
}) {
  const { setParams } = useLeadParams();
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const from = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(filters.page * filters.pageSize, total);
  const pages = pageWindow(filters.page, pageCount);

  const step = (delta: number) =>
    setParams({ page: String(Math.min(pageCount, Math.max(1, filters.page + delta))) });

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 pt-1"
    >
      <p className="lr-tabular text-[13px] text-content-muted">
        Showing {from}&ndash;{to} of {total} lead{total === 1 ? "" : "s"}
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <PageButton
            label="Previous page"
            disabled={filters.page <= 1}
            onClick={() => step(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </PageButton>

          {/* Page numbers are hidden on phones — Prev / current / Next is
              enough there, and the numbers would wrap the toolbar. */}
          <span className="hidden items-center gap-1 sm:inline-flex">
            {pages.map((page, index) =>
              page === null ? (
                <span
                  key={`gap-${index}`}
                  aria-hidden
                  className="px-1 text-[13px] text-content-subtle"
                >
                  &hellip;
                </span>
              ) : (
                <button
                  key={page}
                  type="button"
                  aria-label={`Page ${page}`}
                  aria-current={page === filters.page ? "page" : undefined}
                  onClick={() => setParams({ page: String(page) })}
                  className={cn(
                    "lr-tabular h-9 min-w-9 rounded-lg border px-2 text-[13px] font-medium",
                    "transition-colors duration-[var(--lr-duration-fast)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
                    page === filters.page
                      ? "border-accent-400 bg-accent-50 text-content"
                      : "border-transparent text-content-secondary hover:bg-surface-hover hover:text-content",
                  )}
                >
                  {page}
                </button>
              ),
            )}
          </span>

          <span className="lr-tabular px-1 text-[13px] text-content-muted sm:hidden">
            {filters.page} / {pageCount}
          </span>

          <PageButton
            label="Next page"
            disabled={filters.page >= pageCount}
            onClick={() => step(1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </PageButton>
        </div>

        <label className="hidden items-center gap-2 text-[13px] text-content-muted sm:flex">
          <span className="hidden lg:inline">
            {filters.view === "table" ? "Rows per page" : "Per page"}
          </span>
          <Select
            className="h-9 w-[86px] rounded-lg text-[13px]"
            value={filters.pageSize}
            aria-label="Results per page"
            onChange={(event) =>
              setParams({ pageSize: event.target.value, page: null })
            }
          >
            {PAGE_SIZE_OPTIONS[filters.view].map((size) => (
              <option key={size} value={size}>
                {filters.view === "table" ? size : `${size} per page`}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </nav>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface",
        "text-content-secondary shadow-xs transition-colors duration-[var(--lr-duration-fast)]",
        "hover:bg-surface-hover hover:text-content",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
      )}
    >
      {children}
    </button>
  );
}
