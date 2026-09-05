"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type TabItem = {
  value: string;
  label: React.ReactNode;
  count?: number;
  disabled?: boolean;
};

function useArrowNav(
  items: TabItem[],
  value: string,
  onChange: (value: string) => void,
) {
  return React.useCallback(
    (e: React.KeyboardEvent) => {
      const enabled = items.filter((i) => !i.disabled);
      const index = enabled.findIndex((i) => i.value === value);
      if (index < 0) return;
      let next = index;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = enabled.length - 1;
      else return;
      e.preventDefault();
      const target = enabled[(next + enabled.length) % enabled.length];
      onChange(target.value);
      document.getElementById(`tab-${target.value}`)?.focus();
    },
    [items, value, onChange],
  );
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const onKeyDown = useArrowNav(items, value, onChange);

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "flex items-center gap-1 border-b border-line overflow-x-auto",
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
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 whitespace-nowrap",
              "px-3 h-9 text-[13px] font-medium -mb-px border-b-2",
              "transition-colors duration-[var(--lr-duration-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              active
                ? "border-accent-600 text-content"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="lr-tabular rounded-full bg-surface-sunken px-1.5 text-[11px] text-content-secondary">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  value,
  activeValue,
  className,
  children,
}: {
  value: string;
  activeValue: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (value !== activeValue) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}

/** Route-based tabs. The active state comes from the caller's pathname check. */
export function TabLink({
  href,
  active,
  count,
  className,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex items-center gap-1.5 whitespace-nowrap",
        "px-3 h-9 text-[13px] font-medium -mb-px border-b-2",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
        active
          ? "border-accent-600 text-content"
          : "border-transparent text-content-muted hover:text-content",
        className,
      )}
    >
      {children}
      {count !== undefined && (
        <span className="lr-tabular rounded-full bg-surface-sunken px-1.5 text-[11px] text-content-secondary">
          {count}
        </span>
      )}
    </Link>
  );
}

export function TabLinkBar({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        "flex items-center gap-1 border-b border-line overflow-x-auto",
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedControl({
  items,
  value,
  onChange,
  size = "md",
  accent = false,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
  /** Ring the active segment in the accent colour, for page-level switches. */
  accent?: boolean;
  className?: string;
}) {
  const onKeyDown = useArrowNav(items, value, onChange);

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5",
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
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap",
              "transition-colors duration-[var(--lr-duration-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              active
                ? accent
                  ? "bg-surface text-content shadow-xs ring-1 ring-accent-500"
                  : "bg-surface text-content shadow-xs"
                : "text-content-muted hover:text-content",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
