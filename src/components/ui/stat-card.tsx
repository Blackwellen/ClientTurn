import * as React from "react";
import { HelpCircle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./feedback";
import { Tooltip } from "./tooltip";

export type Delta = {
  value: string;
  direction: "up" | "down" | "flat";
  /** e.g. "vs. previous 30 days" — a delta without a baseline is meaningless. */
  comparison: string;
  /** Set when a rise is bad (cost, no-shows) so tone follows meaning, not sign. */
  invert?: boolean;
};

function deltaTone(d: Delta) {
  if (d.direction === "flat") return "text-content-muted";
  const good = d.invert ? d.direction === "down" : d.direction === "up";
  return good ? "text-success-600" : "text-danger-600";
}

const DELTA_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

export function KpiCard({
  label,
  value,
  delta,
  hint,
  sparkline,
  loading,
  compact,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: Delta;
  hint?: string;
  sparkline?: React.ReactNode;
  loading?: boolean;
  /**
   * Dense dashboard row: the comparison moves to a tooltip so seven cards fit
   * on one line, and the spark sits beside the trend rather than the value.
   */
  compact?: boolean;
  className?: string;
}) {
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;

  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-xl shadow-xs",
        compact ? "@container px-3.5 py-3" : "px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <p
          className={cn(
            "text-[12px] font-medium text-content-muted",
            compact && "truncate",
          )}
        >
          {label}
        </p>
        {hint && (
          <Tooltip content={hint}>
            <button
              type="button"
              aria-label={`What ${label} means`}
              className="text-content-subtle hover:text-content-muted shrink-0 rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
            >
              <HelpCircle className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </div>

      {loading ? (
        <>
          <Skeleton className="mt-2 h-7 w-24" />
          <Skeleton className="mt-2 h-3.5 w-32" />
        </>
      ) : compact ? (
        <>
          <p className="lr-tabular mt-1.5 truncate text-[24px] font-semibold leading-none tracking-[-0.02em] text-content 2xl:text-[26px]">
            {value}
          </p>
          <div className="mt-2 flex h-[22px] items-center justify-between gap-2">
            {delta && DeltaIcon ? (
              <span
                className="flex min-w-0 items-center gap-1 text-[12px]"
                title={`${delta.value} ${delta.comparison}`}
              >
                <DeltaIcon
                  className={cn("size-3.5 shrink-0", deltaTone(delta))}
                  aria-hidden
                />
                <span
                  className={cn(
                    "lr-tabular truncate font-medium",
                    deltaTone(delta),
                  )}
                >
                  {delta.value}
                </span>
                <span className="sr-only">{delta.comparison}</span>
              </span>
            ) : (
              <span />
            )}
            {/* The trend number matters more than the shape of the line, so
                the spark is what gives way when the card gets narrow. */}
            {sparkline && (
              <span className="hidden shrink-0 @[7.5rem]:block">{sparkline}</span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <p className="lr-tabular text-[24px] font-semibold leading-none text-content">
              {value}
            </p>
            {sparkline && <div className="min-w-0 shrink-0">{sparkline}</div>}
          </div>
          {delta && DeltaIcon && (
            <p className="mt-2 flex items-center gap-1 text-[12px]">
              <DeltaIcon
                className={cn("size-3.5 shrink-0", deltaTone(delta))}
                aria-hidden
              />
              <span className={cn("lr-tabular font-medium", deltaTone(delta))}>
                {delta.value}
              </span>
              <span className="text-content-muted">{delta.comparison}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[12px] font-medium text-content-muted">{label}</p>
      <p className="lr-tabular mt-0.5 text-[15px] font-semibold text-content">
        {value}
      </p>
    </div>
  );
}
