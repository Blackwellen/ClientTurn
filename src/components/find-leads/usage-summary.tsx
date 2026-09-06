"use client";

import * as React from "react";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/**
 * The Find Leads allowance strip (V4 §8.3, §52.1).
 *
 * Customers see capacity — verified prospects, sourcing runs, intent monitors —
 * never tokens or provider cost. That separation is a product rule, not a
 * presentation choice: §114 explicitly rejects a customer-facing token economy.
 */

export type UsageMeter = {
  label: string;
  used: number;
  limit: number;
  /** True once the soft limit is passed, so the meter warns before it bites. */
  nearLimit: boolean;
};

export type UsageSummary = {
  prospects: UsageMeter;
  searches: UsageMeter;
  monitors: UsageMeter;
  /** Null when the workspace has no period end (trial without a subscription). */
  resetsAt: string | null;
};

export function FindLeadsUsageSummary({ usage }: { usage: UsageSummary }) {
  const meters = [usage.prospects, usage.searches, usage.monitors];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface px-3.5 py-2">
      {meters.map((meter) => (
        <Meter key={meter.label} meter={meter} />
      ))}
      <Link
        href="/app/settings?view=billing"
        className="text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        Manage
      </Link>
    </div>
  );
}

function Meter({ meter }: { meter: UsageMeter }) {
  const exhausted = meter.limit > 0 && meter.used >= meter.limit;
  const percent = meter.limit > 0 ? Math.min(100, (meter.used / meter.limit) * 100) : 0;

  return (
    <Tooltip
      content={`${meter.used.toLocaleString("en-GB")} of ${meter.limit.toLocaleString("en-GB")} used this billing period`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] text-content-muted">{meter.label}</span>
          <span
            className={cn(
              "text-[12.5px] font-semibold tabular-nums",
              exhausted
                ? "text-danger-600"
                : meter.nearLimit
                  ? "text-warning-700"
                  : "text-content",
            )}
          >
            {meter.used.toLocaleString("en-GB")}
            <span className="font-normal text-content-subtle">
              /{meter.limit.toLocaleString("en-GB")}
            </span>
          </span>
        </div>
        <div
          className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={meter.label}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              exhausted
                ? "bg-danger-500"
                : meter.nearLimit
                  ? "bg-warning-500"
                  : "bg-accent-500",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </Tooltip>
  );
}
