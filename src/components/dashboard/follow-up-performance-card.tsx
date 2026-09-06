import * as React from "react";
import Link from "next/link";
import {
  BellOff,
  MessageSquare,
  MessagesSquare,
  Timer,
  TriangleAlert,
} from "lucide-react";
import type { FollowUpMetric, FollowUpMetricKey } from "@/lib/dashboard/types";
import { formatDuration, formatPercent } from "@/lib/dates";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { CardActionLink } from "./card-action-link";
import { cn } from "@/lib/cn";

const ICONS: Record<
  FollowUpMetricKey,
  React.ComponentType<{ className?: string }>
> = {
  latency: Timer,
  repliesFirst: MessageSquare,
  repliesFollowUp: MessagesSquare,
  failureRate: TriangleAlert,
  optOutRate: BellOff,
};

function formatValue(metric: FollowUpMetric) {
  if (metric.current === null) return "—";
  if (metric.format === "duration") return formatDuration(metric.current);
  // One decimal below 10% keeps small rates such as 2.1% honest.
  return formatPercent(metric.current, metric.current < 10 ? 1 : 0);
}

/**
 * Rates are compared in percentage points, durations relatively — a failure
 * rate moving 2.1% → 1.3% is "0.8 pts", not "38%". Tone follows meaning, not
 * sign: a falling latency, failure or opt-out rate is good news.
 */
function change(metric: FollowUpMetric) {
  if (metric.current === null || metric.previous === null) return null;

  const rising = metric.current > metric.previous;
  const flat =
    metric.format === "duration"
      ? metric.previous === 0 ||
        Math.abs((metric.current - metric.previous) / metric.previous) < 0.005
      : Math.abs(metric.current - metric.previous) < 0.05;

  if (flat) return { text: "No change", tone: "text-content-muted" };

  const text =
    metric.format === "duration"
      ? `${rising ? "↑" : "↓"} ${Math.abs(
          ((metric.current - metric.previous) / metric.previous) * 100,
        ).toFixed(0)}%`
      : `${rising ? "↑" : "↓"} ${Math.abs(metric.current - metric.previous).toFixed(1)} pts`;

  const good = metric.invert ? !rising : rising;
  return { text, tone: good ? "text-success-600" : "text-danger-600" };
}

function PerformanceMetricRow({ metric }: { metric: FollowUpMetric }) {
  const Icon = ICONS[metric.key];
  const delta = change(metric);

  return (
    <div className="border-line-subtle flex h-10 items-center gap-2.5 border-b last:border-b-0">
      <Icon className="text-content-subtle size-4 shrink-0" aria-hidden />
      {/* Native title: the definition is available on hover without adding a
          tab stop to every one of these five rows. */}
      <span
        title={metric.hint}
        className="text-content-secondary min-w-0 flex-1 truncate text-[12.5px]"
      >
        {metric.label}
      </span>
      <span className="text-content lr-tabular shrink-0 text-[13px] font-semibold">
        {formatValue(metric)}
      </span>
      <span
        className={cn(
          "lr-tabular w-[5.5rem] shrink-0 text-right text-[12px] font-medium",
          delta?.tone ?? "text-content-subtle",
        )}
      >
        {delta?.text ?? "—"}
      </span>
    </div>
  );
}

/** Is the automated follow-up engine still fast, still earning replies, still delivering? */
export function FollowUpPerformanceCard({
  metrics,
}: {
  metrics: FollowUpMetric[];
}) {
  const hasData = metrics.some((metric) => metric.current !== null);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Follow-up performance"
          action={<CardActionLink href="/app/follow-up">Manage</CardActionLink>}
        />
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {!hasData ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1.5 px-6 text-center">
            <p className="text-content text-[14px] font-semibold">
              No follow-up activity yet
            </p>
            <p className="text-content-muted text-[12.5px]">
              These figures appear once the sequence has sent its first messages.
            </p>
            <Link
              href="/app/follow-up"
              className="text-content-accent mt-2 text-[13px] font-medium"
            >
              Review Follow-Up
            </Link>
          </div>
        ) : (
          <>
            <div className="text-content-subtle flex h-7 items-center gap-2.5 text-[11px] font-medium">
              <span className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">Metric</span>
              <span className="shrink-0">Value</span>
              <span className="w-[5.5rem] shrink-0 text-right">
                vs. previous
              </span>
            </div>
            {metrics.map((metric) => (
              <PerformanceMetricRow key={metric.key} metric={metric} />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
