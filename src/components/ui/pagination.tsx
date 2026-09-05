"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";
import { Select } from "./form";

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

/** Windowed page list with ellipsis gaps, 1-indexed. `null` renders a gap. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}

export type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** Pluralised noun for the count line, e.g. "campaigns". */
  noun?: string;
  className?: string;
};

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  noun,
  className,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = pageWindow(page, pageCount);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
        "border-t border-line-subtle",
        className,
      )}
    >
      <p className="text-[13px] text-content-muted lr-tabular">
        Showing {from}&ndash;{to} of {total}
        {noun ? ` ${noun}` : ""}
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-[13px] text-content-muted">
            Rows
            <Select
              className="h-8 w-[72px] text-[13px]"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <IconButton
            variant="secondary"
            size="sm"
            label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </IconButton>

          {pages.map((p, i) =>
            p === null ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-[13px] text-content-subtle"
              >
                &hellip;
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPageChange(p)}
                className={cn(
                  "h-8 min-w-8 px-2 rounded-md text-[13px] font-medium lr-tabular",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  p === page
                    ? "bg-accent-600 text-white"
                    : "text-content-secondary hover:bg-surface-hover hover:text-content",
                )}
              >
                {p}
              </button>
            ),
          )}

          <IconButton
            variant="secondary"
            size="sm"
            label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>
    </nav>
  );
}
