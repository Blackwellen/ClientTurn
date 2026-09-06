"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  Download,
  Info,
  Lightbulb,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Select } from "@/components/ui/form";
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
import type {
  CampaignRow,
  ChannelRow,
  GoalRow,
  Insight,
  ProviderRow,
  SenderHealthPoint,
  TrendPoint,
} from "@/lib/analytics/v4-extras";
import { TrendChart } from "./trend-chart";
import { AnalyticsCard, FunnelCard, SourceDonut } from "./cards";

/**
 * Analytics (V4 §21).
 *
 * Every number rendered here comes from the analytics service. This component
 * formats and arranges; it never computes a metric, because a card and a table
 * that each define "reply rate" for themselves will eventually disagree, and
 * then neither can be trusted.
 *
 * Each metric card exposes its own definition on hover, so a figure is never
 * unexplained.
 */

const VIEWS: { value: ViewKey; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "acquisition", label: "Acquisition" },
  { value: "outreach", label: "Outreach" },
  { value: "conversion", label: "Conversion" },
];

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
];

export function AnalyticsView({
  data,
  range,
  trends,
  channels,
  goals,
  campaigns,
  providers,
  senderHealth,
  insights,
  canExport,
}: {
  data: AnalyticsData;
  range: AnalyticsRange;
  trends: TrendPoint[];
  channels: ChannelRow[];
  goals: GoalRow[];
  campaigns: CampaignRow[];
  providers: ProviderRow[];
  senderHealth: SenderHealthPoint[];
  insights: Insight[];
  canExport: boolean;
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

  const exportHref = `/api/analytics/export?view=${data.view}&range=${range}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        description="Track performance across your entire acquisition, outreach and conversion journey."
        size="lg"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-content-muted"
              />
              <Select
                aria-label="Date range"
                value={range}
                onChange={(event) => navigate("range", event.target.value)}
                className="h-9 pl-8 text-[13px]"
              >
                {RANGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            {canExport && (
              <a
                href={exportHref}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3",
                  "text-[13px] font-medium text-content shadow-xs hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                )}
              >
                <Download className="size-4" aria-hidden />
                Export
              </a>
            )}
          </div>
        }
      />

      <nav
        aria-label="Analytics views"
        className="flex items-center gap-1 overflow-x-auto border-b border-line"
      >
        {VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-current={data.view === item.value ? "page" : undefined}
            onClick={() => navigate("view", item.value)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium",
              "transition-colors duration-[var(--lr-duration-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
              data.view === item.value
                ? "border-success-600 text-content"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {!active ? (
        <EmptyState
          title="Nothing to show yet"
          description="This view has no data for the selected period."
        />
      ) : (
        <div className="space-y-4">
          <MetricGrid metrics={active.metrics} />

          {data.view === "overview" && (
            <div className="grid gap-4 xl:grid-cols-2">
              {data.overview?.funnel && (
                <FunnelCard
                  title="Full journey performance"
                  description="From prospect discovery to won opportunities."
                  stages={data.overview.funnel}
                />
              )}
              <AnalyticsCard
                icon={TrendingUp}
                title="Lead and conversion trends"
                description="Track key metrics over time."
              >
                <TrendChart points={trends} />
              </AnalyticsCard>
            </div>
          )}

          {data.view !== "overview" && "funnel" in active && active.funnel && (
            <FunnelCard
              title={funnelTitle(data.view)}
              description={funnelDescription(data.view)}
              stages={active.funnel}
            />
          )}

          {data.view === "overview" && (
            <div className="grid gap-4 xl:grid-cols-3">
              {data.overview && data.overview.sources.length > 0 && (
                <SourceDonut rows={data.overview.sources} />
              )}
              {channels.length > 0 && <ChannelCard rows={channels} />}
              {goals.length > 0 && <GoalsCard rows={goals} />}
            </div>
          )}

          {data.view === "outreach" && channels.length > 0 && (
            <ChannelCard rows={channels} wide />
          )}

          {data.view === "outreach" && senderHealth.length > 0 && (
            <SenderHealthCard points={senderHealth} />
          )}

          {data.view === "acquisition" && providers.length > 0 && (
            <ProviderCard rows={providers} />
          )}

          {data.view === "conversion" && goals.length > 0 && (
            <GoalsCard rows={goals} wide />
          )}

          {(data.view === "overview" || data.view === "conversion") && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              {campaigns.length > 0 && <CampaignCard rows={campaigns} />}
              <InsightsCard insights={insights} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function funnelTitle(view: ViewKey): string {
  if (view === "acquisition") return "Sourcing funnel";
  if (view === "conversion") return "Conversion funnel";
  return "Full journey performance";
}

function funnelDescription(view: ViewKey): string {
  if (view === "acquisition") return "From discovery to a prospect ready to contact.";
  if (view === "conversion") return "From lead created to won.";
  return "From prospect discovery to won opportunities.";
}

/* ----------------------------------------------------------------- metrics */

function MetricGrid({ metrics }: { metrics: MetricValue[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
    <div className="rounded-xl border border-line bg-surface p-3.5 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] leading-tight text-content-muted">
          {definition.label}
        </span>
        <Tooltip content={definition.definition}>
          <span tabIndex={0} className="shrink-0 text-content-subtle">
            <Info className="size-3.5" aria-hidden />
            <span className="sr-only">{definition.definition}</span>
          </span>
        </Tooltip>
      </div>

      <p className="lr-tabular mt-1.5 text-[22px] font-semibold leading-none text-content">
        {formatMetric(value.value, definition.format)}
      </p>

      {change !== null && change !== undefined && (
        <p
          className={cn(
            "lr-tabular mt-1.5 text-[11.5px]",
            positive ? "text-success-600" : "text-danger-600",
          )}
        >
          {change > 0 ? "↑" : "↓"} {Math.abs(Math.round(change * 100))}%
          <span className="ml-1 text-content-subtle">vs previous</span>
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- channels */

function ChannelCard({ rows, wide }: { rows: ChannelRow[]; wide?: boolean }) {
  return (
    <AnalyticsCard
      title="Channel performance"
      description="Outreach performance by channel."
      className={wide ? "xl:col-span-3" : undefined}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-[13px]">
          <caption className="sr-only">
            Messages sent, delivery rate, reply rate and opt-outs by channel.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
              <th scope="col" className="pb-2 font-medium">Channel</th>
              <th scope="col" className="pb-2 text-right font-medium">Sent</th>
              <th scope="col" className="pb-2 text-right font-medium">Delivery</th>
              <th scope="col" className="pb-2 text-right font-medium">Replies</th>
              <th scope="col" className="pb-2 text-right font-medium">Reply rate</th>
              <th scope="col" className="pb-2 text-right font-medium">Opt-outs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <tr key={row.channel}>
                <th scope="row" className="py-2 text-left font-normal text-content">
                  {row.channel}
                </th>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.sent.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {percent(row.deliveryRate)}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.replies.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {percent(row.replyRate)}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.optOuts.toLocaleString("en-GB")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}

/* ------------------------------------------------------------------- goals */

function GoalsCard({ rows, wide }: { rows: GoalRow[]; wide?: boolean }) {
  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <AnalyticsCard
      title="Conversion goals"
      description="Results by conversion goal."
      className={wide ? "xl:col-span-3" : undefined}
    >
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-[13px] text-content">
              {row.name}
            </span>
            <span className="lr-tabular w-8 shrink-0 text-right text-[13px] font-semibold text-content">
              {row.count}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className="block h-full rounded-full bg-info-500"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="lr-tabular w-10 shrink-0 text-right text-[12px] text-content-muted">
              {percent(row.share)}
            </span>
          </li>
        ))}
      </ul>
    </AnalyticsCard>
  );
}

/* --------------------------------------------------------------- campaigns */

function CampaignCard({ rows }: { rows: CampaignRow[] }) {
  return (
    <AnalyticsCard
      title="Recent campaigns"
      description="Top performing campaigns."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-[13px]">
          <caption className="sr-only">
            Prospects, replies, leads and conversion rate by campaign.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
              <th scope="col" className="pb-2 font-medium">Campaign</th>
              <th scope="col" className="pb-2 font-medium">Status</th>
              <th scope="col" className="pb-2 text-right font-medium">Prospects</th>
              <th scope="col" className="pb-2 text-right font-medium">Replies</th>
              <th scope="col" className="pb-2 text-right font-medium">Leads</th>
              <th scope="col" className="pb-2 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="max-w-[14rem] truncate py-2 text-left font-normal text-content"
                >
                  {row.name}
                </th>
                <td className="py-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      row.status === "ACTIVE" || row.status === "OPTIMIZING"
                        ? "border-success-100 bg-success-50 text-success-700"
                        : "border-line bg-surface-sunken text-content-muted",
                    )}
                  >
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.prospects.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.replies.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.leads.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {percent(row.conversionRate, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}

/* ---------------------------------------------------------------- insights */

function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <AnalyticsCard
      icon={Lightbulb}
      title="Key insights"
      description="Derived from the figures on this page."
    >
      {insights.length === 0 ? (
        <p className="text-[13px] text-content-muted">
          Not enough activity in this period to say anything useful yet. Insights
          appear once there is enough data to compare.
        </p>
      ) : (
        <ul className="space-y-3">
          {insights.map((insight) => (
            <li key={insight.key} className="flex gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 size-2 shrink-0 rounded-full",
                  insight.tone === "positive"
                    ? "bg-success-500"
                    : insight.tone === "attention"
                      ? "bg-warning-500"
                      : "bg-info-500",
                )}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-content">
                  {insight.title}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-[1.45] text-content-muted">
                  {insight.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}

/* --------------------------------------------------------------- providers */

function ProviderCard({ rows }: { rows: ProviderRow[] }) {
  return (
    <AnalyticsCard
      title="Provider waterfall efficiency"
      description="How each sourcing provider performed. Provider pricing is not shown."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-[13px]">
          <caption className="sr-only">
            Candidates supplied, verified prospects and yield by provider.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
              <th scope="col" className="pb-2 font-medium">Provider</th>
              <th scope="col" className="pb-2 text-right font-medium">Candidates</th>
              <th scope="col" className="pb-2 text-right font-medium">Verified</th>
              <th scope="col" className="pb-2 text-right font-medium">Yield</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <tr key={row.provider}>
                <th scope="row" className="py-2 text-left font-normal text-content">
                  {row.provider}
                </th>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.candidates.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {row.verified.toLocaleString("en-GB")}
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {percent(row.yield)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}

/* ----------------------------------------------------------- sender health */

function SenderHealthCard({ points }: { points: SenderHealthPoint[] }) {
  // One row per domain, showing its most recent snapshot: a customer wants to
  // know how their domains are doing now, with the trend as context.
  const latest = new Map<string, SenderHealthPoint>();
  for (const point of points) latest.set(point.domain, point);

  return (
    <AnalyticsCard
      title="Sender and domain health"
      description="From daily provider and DNS snapshots. No composite score is invented."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-[13px]">
          <caption className="sr-only">
            Bounce rate, complaint rate and health state by sending domain.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
              <th scope="col" className="pb-2 font-medium">Domain</th>
              <th scope="col" className="pb-2 text-right font-medium">Bounce rate</th>
              <th scope="col" className="pb-2 text-right font-medium">Complaint rate</th>
              <th scope="col" className="pb-2 text-right font-medium">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {[...latest.values()].map((row) => (
              <tr key={row.domain}>
                <th scope="row" className="py-2 text-left font-normal text-content">
                  {row.domain}
                </th>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {(row.bounceRate * 100).toFixed(2)}%
                </td>
                <td className="lr-tabular py-2 text-right text-content-secondary">
                  {(row.complaintRate * 100).toFixed(2)}%
                </td>
                <td className="py-2 text-right">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      row.state === "HEALTHY"
                        ? "border-success-100 bg-success-50 text-success-700"
                        : row.state === "PAUSED"
                          ? "border-danger-100 bg-danger-50 text-danger-700"
                          : "border-warning-100 bg-warning-50 text-warning-700",
                    )}
                  >
                    {row.state.charAt(0) + row.state.slice(1).toLowerCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}

/* ------------------------------------------------------------------ shared */

/** Null renders as "—": a rate with an empty denominator is undefined, not 0%. */
function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export type { FunnelStage };
