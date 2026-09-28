import * as React from "react";
import { cn } from "@/lib/cn";
import { ScrollRegion } from "./scroll-region";

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  // Keyboard-scrollable when it overflows (SC 2.1.1). A tab stop only, not a
  // named landmark: a page with several tables would otherwise have several
  // identically named regions.
  return (
    <ScrollRegion className="w-full overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </ScrollRegion>
  );
}

export function TableHeader({
  className,
  sticky,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return (
    <thead
      className={cn(
        "bg-surface-sunken",
        sticky && "sticky top-0 z-10",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn("divide-y divide-line-subtle", className)}
      {...props}
    />
  );
}

export function TableRow({
  className,
  selected,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cn(
        "h-11 transition-colors duration-[var(--lr-duration-fast)]",
        "hover:bg-surface-hover",
        selected && "bg-accent-50",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  align = "left",
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "center" | "right";
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-3 text-[12px] font-medium text-content-muted whitespace-nowrap",
        "border-b border-line",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        numeric && "lr-tabular",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align = "left",
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "center" | "right";
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 text-[13px] text-content align-middle",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && "lr-tabular",
        className,
      )}
      {...props}
    />
  );
}

export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}
