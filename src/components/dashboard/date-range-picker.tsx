"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/dates";
import { DropdownItem, DropdownMenu } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";

/**
 * The dashboard's single global control. Labels are computed on the server and
 * passed in, so the button never renders a different date on the client than it
 * did during SSR.
 */
export function DateRangePicker({
  value,
  label,
  dateLabel,
}: {
  value: RangeKey;
  label: string;
  dateLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const apply = React.useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, entry] of Object.entries(next)) {
        if (entry === null) params.delete(key);
        else params.set(key, entry);
      }
      const query = params.toString();
      startTransition(() =>
        router.replace(query ? `${pathname}?${query}` : pathname),
      );
    },
    [pathname, router, searchParams],
  );

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2",
        pending && "opacity-70",
      )}
    >
      {value === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="From date"
            value={from}
            max={to || undefined}
            onChange={(event) => apply({ from: event.target.value || null })}
            className="h-9 w-[9.5rem] text-[13px]"
          />
          <span className="text-content-subtle text-[13px]">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={to}
            min={from || undefined}
            onChange={(event) => apply({ to: event.target.value || null })}
            className="h-9 w-[9.5rem] text-[13px]"
          />
        </div>
      )}

      <DropdownMenu
        align="end"
        trigger={
          <button
            type="button"
            className={cn(
              "bg-surface border-line-strong text-content flex h-11 items-center gap-2.5 rounded-lg border px-3 shadow-xs",
              "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
              "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-2",
            )}
          >
            <CalendarDays className="text-content-muted size-4 shrink-0" aria-hidden />
            <span className="text-left">
              <span className="block text-[13px] leading-tight font-medium">
                {label}
              </span>
              <span className="text-content-muted block text-[11px] leading-tight">
                {dateLabel}
              </span>
            </span>
            <ChevronDown className="text-content-muted size-4 shrink-0" aria-hidden />
          </button>
        }
      >
        {RANGE_OPTIONS.map((option) => (
          <DropdownItem
            key={option.value}
            icon={value === option.value ? Check : undefined}
            onSelect={() =>
              apply(
                option.value === "custom"
                  ? { range: "custom" }
                  : { range: option.value, from: null, to: null },
              )
            }
            className={cn(value === option.value && "text-content font-medium")}
          >
            <span className={cn(value !== option.value && "ml-6.5")}>
              {option.label}
            </span>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
