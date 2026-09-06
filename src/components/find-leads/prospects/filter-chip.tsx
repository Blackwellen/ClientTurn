"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

/**
 * One dropdown chip in the advanced filter row (V4 §12.4).
 *
 * A chip rather than a labelled field because thirteen labelled fields would
 * be a form, and this is a toolbar: the label *is* the current value once one
 * is chosen, so the row shows the active filter set at a glance without a
 * separate summary of applied filters.
 *
 * Built on `Popover` — a labelled dialog — rather than `DropdownMenu`, because
 * the panel holds checkboxes and a menu announces those wrongly.
 */

export type FilterChipOption = {
  value: string;
  label: string;
  /** Optional right-aligned count, where the loader knows one. */
  hint?: string;
};

export function FilterChip({
  label,
  options,
  selected,
  onToggle,
  onClear,
  multiple = true,
  disabled,
}: {
  label: string;
  options: FilterChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Single-select chips replace the selection instead of adding to it. */
  multiple?: boolean;
  disabled?: boolean;
}) {
  const active = selected.length > 0;

  // The chip shows the chosen value once there is exactly one, and a count
  // beyond that: "Location: Bournemouth" is useful, "Location: Bournemouth,
  // Poole, Christchurch, +4" is just wide.
  const summary = React.useMemo(() => {
    if (selected.length === 0) return null;
    if (selected.length === 1) {
      return options.find((o) => o.value === selected[0])?.label ?? selected[0];
    }
    return `${selected.length} selected`;
  }, [options, selected]);

  if (options.length === 0 || disabled) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-line bg-surface-sunken/60 px-3 text-[12.5px] font-medium text-content-subtle"
        title={`No ${label.toLowerCase()} values have been recorded yet`}
      >
        {label}
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <Popover
      label={label}
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex h-8 max-w-[15rem] items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
            active
              ? "border-accent-500 bg-accent-50 text-content-accent"
              : "border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content",
          )}
        >
          <span className="truncate">
            {label}
            {summary && (
              <span className="font-normal opacity-80">: {summary}</span>
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <div className="min-w-[13rem] max-w-[18rem]">
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => {
                    onToggle(option.value);
                    if (!multiple) close();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent",
                    checked
                      ? "text-content-accent"
                      : "text-content-secondary hover:bg-surface-hover",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      checked
                        ? "border-accent-500 bg-accent-500 text-white"
                        : "border-line bg-surface",
                    )}
                  >
                    {checked && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">
                      {option.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {active && (
            <div className="border-t border-line-subtle px-3 py-1.5">
              <button
                type="button"
                onClick={() => {
                  onClear();
                  close();
                }}
                className="text-[12px] font-medium text-content-muted underline-offset-4 hover:text-content hover:underline"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}
