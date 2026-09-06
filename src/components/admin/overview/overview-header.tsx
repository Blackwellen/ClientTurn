"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { ADMIN_RANGES, ADMIN_RANGE_LABEL, type AdminRange } from "@/lib/admin/types";

/**
 * The greeting and stamp are computed on the server in the platform timezone
 * (Europe/London) and passed in, so the first paint is correct and there is no
 * hydration mismatch from reading the browser clock during render.
 */
export function OverviewHeader({
  greeting,
  stamp,
  range,
}: {
  greeting: string;
  stamp: string;
  range: AdminRange;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  function selectRange(next: AdminRange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "24h") params.delete("range");
    else params.set("range", next);
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] text-content sm:text-[34px]">
          {greeting}
        </h1>
        <p className="mt-1.5 text-[14.5px] text-content-muted">
          Here&rsquo;s what&rsquo;s happening across the ClientTurn platform.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2.5 xl:items-end">
        <p className="lr-tabular text-[12.5px] text-content-muted">{stamp}</p>
        <div
          role="group"
          aria-label="Time range"
          aria-busy={pending || undefined}
          className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
        >
          {ADMIN_RANGES.map((option) => {
            const active = option === range;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => selectRange(option)}
                className={cn(
                  "h-8 rounded-md px-3 text-[12.5px] font-medium whitespace-nowrap",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
                  active
                    ? "bg-surface text-content shadow-xs ring-1 ring-accent-500"
                    : "text-content-muted hover:text-content",
                )}
              >
                {ADMIN_RANGE_LABEL[option]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
