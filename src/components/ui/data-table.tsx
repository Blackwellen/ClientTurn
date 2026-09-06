"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { SkeletonTable } from "./feedback";
import { Checkbox } from "./form";
import { Pagination } from "./pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection };

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  sortable?: boolean;
  numeric?: boolean;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  stickyHeader?: boolean;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Pluralised noun for the count line, e.g. "prospects". */
  paginationNoun?: string;
  pageSizeOptions?: number[];
  className?: string;
};

/**
 * Server-oriented: sorting and paging are reported upward only. This component
 * never reorders or slices `rows` itself.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  selectedKeys,
  onSelectionChange,
  sort,
  onSortChange,
  stickyHeader,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  paginationNoun,
  pageSizeOptions,
  className,
}: DataTableProps<T>) {
  const selectable = !!onSelectionChange;
  const selected = React.useMemo(
    () => new Set(selectedKeys ?? []),
    [selectedKeys],
  );
  const colSpan = columns.length + (selectable ? 1 : 0);

  const allKeys = rows.map(rowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k));

  const headerRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  function toggleAll() {
    onSelectionChange?.(allSelected ? [] : allKeys);
  }

  function toggleRow(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange?.([...next]);
  }

  function handleSort(col: Column<T>) {
    if (!col.sortable || !onSortChange) return;
    const direction: SortDirection =
      sort?.key === col.key && sort.direction === "asc" ? "desc" : "asc";
    onSortChange({ key: col.key, direction });
  }

  const showPagination =
    onPageChange !== undefined &&
    page !== undefined &&
    pageSize !== undefined &&
    total !== undefined;

  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-xl shadow-xs overflow-hidden",
        className,
      )}
    >
      {loading ? (
        <SkeletonTable rows={pageSize && pageSize < 10 ? pageSize : 8} />
      ) : (
        <Table>
          <TableHeader sticky={stickyHeader}>
            <tr>
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    ref={headerRef}
                    aria-label="Select all rows on this page"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </TableHead>
              )}
              {columns.map((col) => {
                const active = sort?.key === col.key;
                return (
                  <TableHead
                    key={col.key}
                    align={col.align}
                    numeric={col.numeric}
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={
                      active
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-xs",
                          "hover:text-content transition-colors duration-[var(--lr-duration-fast)]",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                          active && "text-content",
                          col.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {col.header}
                        {active ? (
                          sort.direction === "asc" ? (
                            <ChevronUp className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="size-3.5" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown
                            className="size-3.5 opacity-50"
                            aria-hidden
                          />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </tr>
          </TableHeader>

          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={colSpan}>{empty}</TableEmpty>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                return (
                  <TableRow
                    key={key}
                    selected={selected.has(key)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                  >
                    {selectable && (
                      <TableCell
                        className="w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          aria-label={`Select row ${key}`}
                          checked={selected.has(key)}
                          onChange={() => toggleRow(key)}
                        />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        align={col.align}
                        numeric={col.numeric}
                      >
                        {col.render
                          ? col.render(row)
                          : String(
                              (row as Record<string, unknown>)[col.key] ?? "",
                            )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}

      {showPagination && !loading && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={pageSizeOptions}
          noun={paginationNoun}
        />
      )}
    </div>
  );
}
