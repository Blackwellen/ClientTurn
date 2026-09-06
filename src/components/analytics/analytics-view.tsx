"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SegmentedControl } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import {
  formatMetric,
  metric as metricDefinition,
  type AnalyticsView as ViewKey,
  type FunnelStage,
  type MetricValue,
} from "@/lib/analytics/v4-metrics";
import type { AnalyticsData, AnalyticsRange } from "@/lib/analytics/v4-queries";

/**
 * Analytics (V4 §21).
 *
 * Deliberately does NOT duplicate the Dashboard (§112): Dashboard answers
 * "what needs me today", this answers "what is working". Every number rendered
 * here comes from `lib/analytics/v4-metrics.ts`, and every card exposes its own
 * definition on hover so a figure is never unexplained.
 */

const VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "acquisition", label: "Acquisition" },
  { value: "outreach", label: "Outreach" },
  { value: "conversion", label: "Conversion" },
];

const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
];

export function AnalyticsView({
  data,
  range,
}: {
  data: AnalyticsData;
  range: AnalyticsRange;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const active =
    data.overview ?? data.acquisition ?? data.outreach ?? data.conversion ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        description="How acquisition, outreach and conversion are actually performing."
        size="lg"
        action={
          <SegmentedControl
            items={RANGES}
            value={range}
            onChange={(value) => navigate("range", value)}
            size="sm"
          />
        }
      />

      <SegmentedControl
        items={VIEWS}
        value={data.view}
        onChange={(value) => navigate("view", value)}
        accent
      />

      {!active ? (
        <EmptyState title="Nothing to show yet" description="This view has no data for the selected period." />
      ) : (
        <div className="space-y-5">
          <MetricGrid metrics={active.metrics} />

          {"funnel" in active && active.funnel && (
            <FunnelCard title={funnelTitle(data.view)} stages={active.funnel} />
          )}

          {data.overview && data.overview.sources.length > 0 && (
            <SourceTable rows={data.overview.sources} />
          )}

          {data.outreach && data.outreach.channels.length > 0 && (
            <ChannelTable rows={data.outreach.channels} />
          )}
        </div>
      )}
    </div>
  );
}

function funnelTitle(view: ViewKey): string {
  if (view === "acquisition") return "Sourcing funnel";
  if (view === "conversion") return "Conversion funnel";
  return "Full journey";
}

function MetricGrid({ metrics }: { metrics: MetricValue[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {metrics.map((value) => (
        <MetricCard key={value.key} value={value} />
      ))}
    </div>
  );
}

function MetricCard({ value }: { value: MetricValue }) {
  const definition = metricDefinition(value.key);
  const change = value.change;

  // "Better" depends on the metric: a falling bounce rate is good news.
  const positive =
    change === null || change === undefined
      ? null
      : definition.higherIsBetter
        ? change > 0
        : change < 0;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] text-content-muted">{definition.label}</span>
        <Tooltip content={definition.definition}>
          <span className="text-content-subtle">
            <Info className="size-3.5" aria-hidden />
            <span className="sr-only">{definition.definition}</span>
          </span>
        </Tooltip>
      </div>

      <p className="mt-1.5 text-[24px] font-semibold tabular-nums leading-none text-content">
        {formatMetric(value.value, definition.format)}
      </p>

      {change !== null && change !== undefined && (
        <p
          className={cn(
            "mt-2 text-[12px] tabular-nums",
            positive ? "text-success-600" : "text-danger-600",
          )}
        >
          {change > 0 ? "+" : ""}
          {(change * 100).toFixed(0)}%{" "}
          <span className="text-content-subtle">vs previous period</span>
        </p>
      )}
    </div>
  );
}

function FunnelCard({ title, stages }: { title: string; stages: FunnelStage[] }) {
  const hasData = stages.some((stage) => stage.count > 0);

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h3 className="text-[14px] font-semibold text-content">{title}</h3>

      {!hasData ? (
        <p className="py-8 text-center text-[13px] text-content-muted">
          No activity in this period yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {stages.map((stage) => (
            <li key={stage.key}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-content">{stage.label}</span>
                <span className="flex items-baseline gap-2">
                  {/* Step conversion is what people act on, so it sits next to
                      the count rather than being hidden behind a hover. */}
                  {stage.shareOfPrevious !== null && (
                    <span className="text-[11.5px] tabular-nums text-content-subtle">
                      {(stage.shareOfPrevious * 100).toFixed(0)}%
                    </span>
                  )}
                  <span className="text-[13px] font-semibold tabular-nums text-content">
                    {stage.count.toLocaleString("en-GB")}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, (stage.shareOfTop ?? 0) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceTable({ rows }: { rows: { label: string; leads: number; won: number }[] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h3 className="text-[14px] font-semibold text-content">Where leads came from</h3>
      <table className="mt-3 w-full text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
            <th className="pb-2 font-medium">Source</th>
            <th className="pb-2 text-right font-medium">Leads</th>
            <th className="pb-2 text-right font-medium">Won</th>
            <th className="pb-2 text-right font-medium">Win rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="py-2 text-[13px] text-content">{row.label}</td>
              <td className="py-2 text-right text-[13px] tabular-nums text-content-secondary">
                {row.leads.toLocaleString("en-GB")}
              </td>
              <td className="py-2 text-right text-[13px] tabular-nums text-content-secondary">
                {row.won.toLocaleString("en-GB")}
              </td>
              <td className="py-2 text-right text-[13px] tabular-nums text-content-secondary">
                {row.leads > 0 ? `${Math.round((row.won / row.leads) * 100)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ChannelTable({
  rows,
}: {
  rows: { channel: string; sent: number; delivered: number; replies: number }[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h3 className="text-[14px] font-semibold text-content">Channel performance</h3>
      <table className="mt-3 w-full text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
            <th className="pb-2 font-medium">Channel</th>
            <th className="pb-2 text-right font-medium">Sent</th>
            <th className="pb-2 text-right font-medium">Replies</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((row) => (
            <tr key={row.channel}>
              <td className="py-2 text-[13px] text-content">{row.channel}</td>
              <td className="py-2 text-right text-[13px] tabular-nums text-content-secondary">
                {row.sent.toLocaleString("en-GB")}
              </td>
              <td className="py-2 text-right text-[13px] tabular-nums text-content-secondary">
                {row.replies.toLocaleString("en-GB")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
