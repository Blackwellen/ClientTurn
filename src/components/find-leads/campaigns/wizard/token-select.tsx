"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Chip } from "./pieces";
import { Select } from "@/components/ui/form";

/**
 * A multi-select that shows its selection as removable chips.
 *
 * Adding goes through the shared `Select` primitive (keyboard, typeahead, a
 * search box once the list is long, a hidden native select for forms), and
 * the chips stay real buttons underneath.
 *
 * `allowCustom` adds a text input for values that are not in the list yet,
 * which is what the exclusion and named-company fields need.
 */
export function TokenSelect({
  id,
  label,
  values,
  options,
  placeholder = "Add",
  allowCustom = false,
  customPlaceholder = "Type and press Enter",
  max = 20,
  onChange,
  emptyHint,
}: {
  id: string;
  label: string;
  values: string[];
  options: string[];
  placeholder?: string;
  allowCustom?: boolean;
  customPlaceholder?: string;
  max?: number;
  onChange: (values: string[]) => void;
  emptyHint?: string;
}) {
  const [custom, setCustom] = React.useState("");

  const remaining = options.filter((option) => !values.includes(option));
  const full = values.length >= max;

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || values.includes(trimmed) || full) return;
    onChange([...values, trimmed]);
  };

  const remove = (value: string) => onChange(values.filter((item) => item !== value));

  return (
    <div>
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1.5 shadow-xs",
          "focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-[var(--lr-ring)]",
        )}
      >
        {values.length === 0 && (
          <span className="px-1 text-[13px] text-content-subtle">
            {emptyHint ?? "None selected"}
          </span>
        )}
        {values.map((value) => (
          <Chip key={value} label={value} onRemove={() => remove(value)} />
        ))}

        <div className="relative ml-auto shrink-0">
          <Select
            id={id}
            aria-label={`Add ${label}`}
            value=""
            disabled={full || remaining.length === 0}
            onChange={(event) => add(event.target.value)}
            className="h-6 w-auto rounded-sm border-transparent bg-transparent gap-1 pl-1.5 pr-1 text-[12px] text-content-muted shadow-none hover:border-line [&>svg]:size-3.5"
          >
            <option value="" disabled hidden>
              {remaining.length === 0 ? "All added" : placeholder}
            </option>
            {remaining.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {allowCustom && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={custom}
            maxLength={200}
            disabled={full}
            placeholder={customPlaceholder}
            aria-label={`Add a custom ${label}`}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Enter inside a wizard would otherwise submit the step.
              event.preventDefault();
              add(custom);
              setCustom("");
            }}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px]",
              "focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-[var(--lr-ring)]",
              "disabled:cursor-not-allowed disabled:bg-surface-sunken",
            )}
          />
          <button
            type="button"
            disabled={full || custom.trim().length === 0}
            onClick={() => {
              add(custom);
              setCustom("");
            }}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-surface px-2.5",
              "text-[12.5px] font-medium text-content transition-colors hover:bg-surface-hover",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Plus className="size-3.5" aria-hidden />
            Add
          </button>
        </div>
      )}

      {full && (
        <p className="mt-1.5 text-[12px] text-content-muted">
          That is the maximum of {max}. Remove one to add another.
        </p>
      )}
    </div>
  );
}
