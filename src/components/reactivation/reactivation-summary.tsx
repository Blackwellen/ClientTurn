import * as React from "react";
import {
  BarChart3,
  CalendarCheck,
  MessageSquare,
  Megaphone,
  TrendingDown,
  TrendingUp,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/feedback";
import { formatGbp, formatPercent } from "@/lib/dates";
import type {
  ReactivationSummary as SummaryData,
  ReactivationTrend,
} from "@/lib/campaigns/reactivation-types";

const TILE_TONES = {
  success: "bg-success-50 text-success-600",
  info: "bg-info-50 text-info-600",
  purple: "bg-purple-50 text-purple-600",
  warning: "bg-warning-50 text-warning-600",
} as const;

type Tone = keyof typeof TILE_TONES;

/**
 * One KPI in the strip above the campaign grid: tinted icon tile, the figure,
 * a compact label and a muted line saying what the figure counts. The trend
 * chip is only rendered when there is a real previous period to compare with
 * — a delta without a baseline is meaningless.
 */
export function SummaryStatCard({
  icon: Icon,
  tone,
  value,
  label,
  hint,
  trend,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  value: string;
  label: string;
  hint: string;
  trend?: ReactivationTrend | null;
  className?: string;
}) {
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-xs",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          TILE_TONES[tone],
        )}
      >
        <Icon className="size-[18px]" />
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="lr-tabular truncate text-[21px] font-semibold leading-none tracking-[-0.02em] text-content">
            {value}
          </p>
          {trend && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium",
                trend.direction === "up" ? "text-success-600" : "text-danger-600",
              )}
            >
              <TrendIcon className="size-3" aria-hidden />
              <span className="lr-tabular">{trend.value}</span>
              <span className="sr-only">vs. the previous 30 days</span>
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-[13px] font-medium text-content-secondary">
          {label}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-content-subtle" title={hint}>
          {hint}
        </p>
      </div>
    </div>
  );
}

const GRID =
  "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6";

export function ReactivationSummarySkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-xs"
        >
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** `ReactivationSummary` — the six-card KPI strip. Every figure is live. */
export function ReactivationSummary({ summary }: { summary: SummaryData }) {
  const number = (value: number) => value.toLocaleString("en-GB");

  const campaignHint =
    summary.runningCampaigns === 0 && summary.scheduledCampaigns === 0
      ? "None running or scheduled"
      : number(summary.runningCampaigns) +
        " running • " +
        number(summary.scheduledCampaigns) +
        " scheduled";

  return (
    <div className={GRID}>
      <SummaryStatCard
        icon={Users}
        tone="success"
        value={number(summary.eligibleLeads)}
        label="Eligible leads"
        hint={"Haven't booked in " + summary.eligibleThresholdDays + "+ days"}
      />
      <SummaryStatCard
        icon={Megaphone}
        tone="info"
        value={number(summary.totalCampaigns)}
        label="Total campaigns"
        hint={campaignHint}
      />
      <SummaryStatCard
        icon={MessageSquare}
        tone="purple"
        value={number(summary.replies)}
        label="Replies"
        hint="From reactivation campaigns"
        trend={summary.repliesTrend}
      />
      <SummaryStatCard
        icon={UserRoundCheck}
        tone="success"
        value={number(summary.qualified)}
        label="Qualified"
        hint={formatPercent(summary.qualificationRate, 1) + " qualification rate"}
        trend={summary.qualifiedTrend}
      />
      <SummaryStatCard
        icon={CalendarCheck}
        tone="info"
        value={number(summary.booked)}
        label="Booked"
        hint={formatPercent(summary.bookingRate, 1) + " booking rate"}
        trend={summary.bookedTrend}
      />
      <SummaryStatCard
        icon={BarChart3}
        tone="purple"
        value={formatGbp(summary.revenue)}
        label="Revenue"
        hint="From reactivated leads"
      />
    </div>
  );
}
