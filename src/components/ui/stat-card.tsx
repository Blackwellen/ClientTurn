import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  HelpCircle,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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

/** Dense cards use a plain arrow: at 12px a trend glyph reads as noise. */
const COMPACT_DELTA_ICON = {
  up: ArrowUp,
  down: ArrowDown,
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
  const DeltaIcon = delta
    ? (compact ? COMPACT_DELTA_ICON : DELTA_ICON)[delta.direction]
    : null;

  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-xl shadow-xs",
        // A column with a bottom-anchored value block. Grid rows already
        // stretch these cards to a common height; without the anchor a card
        // whose label wrapped to two lines pushed its own value down while
        // its neighbours' stayed put, which is what read as the row
        // "warping". Anchoring means every value and delta in a row sits on
        // the same line whatever the labels do.
        "flex min-w-0 flex-col",
        compact ? "@container px-3.5 py-2.5" : "px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <p
          className={cn(
            "min-w-0 text-[12px] font-medium text-content-muted",
            // Two lines is the designed maximum. A label long enough to need
            // a third is a copy problem, not a layout one, and silently
            // reflowing it would break the row alignment this card exists to
            // hold. `title` keeps the full string reachable either way.
            compact ? "truncate" : "line-clamp-2",
          )}
          title={label}
        >
          {label}
        </p>
        {hint && (
          <Tooltip content={hint}>
            <button
              type="button"
              aria-label={`What ${label} means`}
              className="text-content-subtle hover:text-content-muted mt-px shrink-0 rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
            >
              <HelpCircle className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </div>

      {loading ? (
        <>
          <Skeleton className="mt-auto h-7 w-24" />
          <Skeleton className="mt-2 h-3.5 w-32" />
        </>
      ) : compact ? (
        <>
          {/* 24px holds "£34,500" inside a 101px content box at 1280; the
              wider step only unlocks once seven cards have room for it. */}
          <p className="lr-tabular mt-1.5 truncate whitespace-nowrap text-[24px] font-semibold leading-none tracking-[-0.025em] text-content 2xl:text-[28px]">
            {value}
          </p>
          <div className="mt-auto flex h-[22px] items-center justify-between gap-2 pt-2">
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
          <div className="mt-auto flex items-end justify-between gap-3 pt-1.5">
            {/* The number is the point of the card: it never wraps and never
                shrinks to make room for the spark, which is why the spark is
                the element carrying `shrink`. */}
            <p className="lr-tabular min-w-0 truncate whitespace-nowrap text-[24px] font-semibold leading-none text-content">
              {value}
            </p>
            {sparkline && <div className="min-w-0 shrink">{sparkline}</div>}
          </div>
          {delta && DeltaIcon && (
            <p
              className="mt-2 flex items-center gap-1 text-[12px]"
              title={`${delta.value} ${delta.comparison}`}
            >
              <DeltaIcon
                className={cn("size-3.5 shrink-0", deltaTone(delta))}
                aria-hidden
              />
              <span
                className={cn(
                  "lr-tabular shrink-0 font-medium",
                  deltaTone(delta),
                )}
              >
                {delta.value}
              </span>
              {/* The baseline is what makes the delta mean anything, so it
                  stays on the row and ellipsises rather than wrapping the
                  card to a second line at a narrow column. */}
              <span className="min-w-0 truncate text-content-muted">
                {delta.comparison}
              </span>
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
