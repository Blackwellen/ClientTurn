import * as React from "react";
import {
  AlertTriangle,
  CalendarDays,
  MessageSquare,
  PoundSterling,
  Target,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { Sparkline } from "@/components/dashboard/sparkline";
import { IconTile, type TileTone } from "@/components/admin/ui";
import { formatChange, formatMoney, formatNumber } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import {
  ADMIN_RANGE_COMPARISON,
  type AdminMetric,
  type AdminRange,
} from "@/lib/admin/types";

const ICONS: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; tone: TileTone }
> = {
  active_customers: { icon: Users, tone: "success" },
  trials: { icon: Target, tone: "accent" },
  mrr: { icon: PoundSterling, tone: "success" },
  signups: { icon: UserPlus, tone: "accent" },
  leads: { icon: TrendingUp, tone: "info" },
  messages: { icon: MessageSquare, tone: "accent" },
  bookings: { icon: CalendarDays, tone: "info" },
  failed_jobs: { icon: AlertTriangle, tone: "danger" },
};

function direction(metric: AdminMetric): "up" | "down" | "flat" {
  if (metric.changeRatio === null || metric.changeRatio === 0) return "flat";
  return metric.changeRatio > 0 ? "up" : "down";
}

/** Tone follows meaning, not sign: fewer failed jobs is good news. */
function toneFor(metric: AdminMetric): "positive" | "negative" | "neutral" {
  const dir = direction(metric);
  if (dir === "flat") return "neutral";
  const good = metric.invert ? dir === "down" : dir === "up";
  return good ? "positive" : "negative";
}

function AdminStatCard({
  metric,
  comparison,
}: {
  metric: AdminMetric;
  comparison: string;
}) {
  const config = ICONS[metric.key] ?? {
    icon: TrendingUp,
    tone: "accent" as const,
  };
  const tone = toneFor(metric);
  const dir = direction(metric);
  const TrendIcon = dir === "down" ? TrendingDown : TrendingUp;
  const value = metric.money
    ? formatMoney(metric.value)
    : formatNumber(metric.value);
  const changeText = formatChange(metric.changeRatio);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col px-3 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconTile
            icon={config.icon}
            tone={config.tone}
            className="size-6 rounded-[7px] [&>svg]:size-3.5"
          />
          {/*
            The full label always fits: the tooltip trigger that used to sit
            here stole enough width to ellipsise "Active customers", and a
            truncated metric name is worse than no tooltip. The derivation is
            still available on hover through the title attribute.
          */}
          <p
            className="min-w-0 truncate text-[11px] font-medium text-content-muted"
            title={metric.hint}
          >
            {metric.label}
          </p>
        </div>

        <p className="lr-tabular mt-2.5 truncate text-[30px] leading-none font-semibold tracking-[-0.03em] text-content">
          {value}
        </p>

        <p className="mt-2 mb-2.5 flex min-w-0 items-center gap-0.5 text-[11px]">
          {dir !== "flat" && (
            <TrendIcon
              className={cn(
                "size-3 shrink-0",
                tone === "positive" && "text-success-600",
                tone === "negative" && "text-danger-600",
              )}
              aria-hidden
            />
          )}
          <span
            className={cn(
              "lr-tabular shrink-0 font-semibold",
              tone === "positive" && "text-success-600",
              tone === "negative" && "text-danger-600",
              tone === "neutral" && "text-content-muted",
            )}
          >
            {changeText}
          </span>
          <span className="truncate text-[10.5px] text-content-muted">
            {metric.changeRatio === null ? "no baseline" : comparison}
          </span>
        </p>
      </div>

      {/* Flush to the card edge, the way the reference tiles read. */}
      {metric.series.length > 1 && (
        <div className="min-w-0">
          <Sparkline
            values={metric.series}
            tone={tone}
            width={200}
            height={34}
            className="block w-full"
          />
          <span className="sr-only">
            {`${metric.label} across the period, from ${formatNumber(metric.series[0])} to ${formatNumber(metric.series[metric.series.length - 1])}.`}
          </span>
        </div>
      )}
    </div>
  );
}

export function AdminKpiGrid({
  metrics,
  range,
}: {
  metrics: AdminMetric[];
  range: AdminRange;
}) {
  const comparison = ADMIN_RANGE_COMPARISON[range];
  return (
    <div className="@container/kpis">
      <div className="grid grid-cols-2 gap-2.5 @[46rem]/kpis:grid-cols-4 @[78rem]/kpis:grid-cols-8">
        {metrics.map((metric) => (
          <AdminStatCard
            key={metric.key}
            metric={metric}
            comparison={comparison}
          />
        ))}
      </div>
    </div>
  );
}
