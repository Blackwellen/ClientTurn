import * as React from "react";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/auth/session";
import {
  getDashboardData,
  getHealthStripData,
  sortAttention,
  systemAttentionItems,
  type PeriodCounts,
  type SeriesKey,
} from "@/lib/dashboard/queries";
import { getBookingDestination, listBookings } from "@/lib/bookings/queries";
import { listCampaigns } from "@/lib/campaigns/queries";
import {
  comparisonLabel,
  formatGbp,
  formatPercent,
  formatRangeLabel,
  greetingFor,
  resolveRange,
} from "@/lib/dates";
import { KpiCard, type Delta } from "@/components/ui/stat-card";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { HealthStrip } from "@/components/dashboard/health-strip";
import { Sparkline } from "@/components/dashboard/sparkline";
import { LeadFunnelCard } from "@/components/dashboard/lead-funnel-card";
import { NeedsAttentionPanel } from "@/components/dashboard/needs-attention-panel";
import { RecentLeadsCard } from "@/components/dashboard/recent-leads-card";
import { UpcomingBookingsCard } from "@/components/dashboard/upcoming-bookings-card";
import { SourcePerformanceCard } from "@/components/dashboard/source-performance-card";
import { FollowUpPerformanceCard } from "@/components/dashboard/follow-up-performance-card";
import { ReactivationPerformanceCard } from "@/components/dashboard/reactivation-performance-card";

export const metadata: Metadata = { title: "Dashboard · Client Turn" };
export const dynamic = "force-dynamic";

const UPCOMING_BOOKINGS = 6;
const RECENT_CAMPAIGNS = 5;

function delta(
  current: number,
  previous: number,
  comparison: string,
  invert = false,
): Delta {
  if (previous === 0) {
    return {
      // No prior period to compare against: say so rather than imply growth.
      value: current === 0 ? "No change" : "No prior data",
      direction: "flat",
      comparison,
      invert,
    };
  }
  const change = ((current - previous) / previous) * 100;
  return {
    value: `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
    direction: Math.abs(change) < 0.5 ? "flat" : change > 0 ? "up" : "down",
    comparison,
    invert,
  };
}

/** Tone follows meaning: green only when the movement is genuinely good news. */
function sparkTone(value: Delta): "positive" | "negative" | "neutral" {
  if (value.direction === "flat") return "neutral";
  const good = value.invert ? value.direction === "down" : value.direction === "up";
  return good ? "positive" : "negative";
}

const KPIS: {
  key: keyof PeriodCounts;
  series: SeriesKey;
  label: string;
  hint: string;
  percent?: boolean;
}[] = [
  {
    key: "leads",
    series: "leads",
    label: "New leads",
    hint: "Leads received in this period.",
  },
  {
    key: "contacted",
    series: "contacted",
    label: "Contacted",
    hint: "Leads that received a first outbound message.",
  },
  {
    key: "replied",
    series: "replied",
    label: "Replies",
    hint: "Leads that replied at least once.",
  },
  {
    key: "qualified",
    series: "qualified",
    label: "Qualified",
    hint: "Leads that met every qualifying rule.",
  },
  {
    key: "booked",
    series: "booked",
    label: "Bookings",
    hint: "Leads with a confirmed booking.",
  },
  {
    key: "bookingRate",
    series: "bookingRate",
    label: "Booking rate",
    hint: "Bookings divided by leads received in this period.",
    percent: true,
  },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const workspace = await requireWorkspace();
  const range = resolveRange({
    range: typeof params.range === "string" ? params.range : undefined,
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
  });

  // Every section's data is independent, so it is fetched in one parallel
  // batch rather than a sequential waterfall. `getDashboardData` carries the
  // KPIs, funnel, sparklines, sources and follow-up metrics in a single pass
  // over the lead cohort, so the page never reads the same rows twice.
  const [data, health, bookings, destination, campaigns] = await Promise.all([
    getDashboardData(workspace.businessId, range),
    getHealthStripData(workspace.businessId),
    listBookings(
      workspace.businessId,
      {
        tab: "upcoming",
        view: "list",
        status: "all",
        page: 1,
        pageSize: UPCOMING_BOOKINGS,
      },
      workspace.timezone,
    ),
    getBookingDestination(workspace.businessId),
    listCampaigns(workspace.businessId),
  ]);

  const comparison = comparisonLabel(range);

  // Broken integrations and send failures rank alongside the lead-level rows,
  // so the panel shows the single most urgent thing first whatever it is.
  const attention = sortAttention([
    ...systemAttentionItems(health, data.failedMessages),
    ...data.leadAttention,
  ]);

  return (
    <div className="space-y-4">
      <DashboardHeader
        greeting={greetingFor(workspace.timezone)}
        businessName={workspace.businessName}
        description="Here's what's happening with your leads today."
        action={
          <DateRangePicker
            value={range.key}
            label={range.label}
            dateLabel={formatRangeLabel(range)}
          />
        }
      />

      <HealthStrip items={health} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {KPIS.map((kpi) => {
          const current = data.current[kpi.key];
          const previous = data.previous[kpi.key];
          const movement = delta(current, previous, comparison);
          return (
            <KpiCard
              key={kpi.key}
              compact
              label={kpi.label}
              hint={kpi.hint}
              value={
                kpi.percent
                  ? formatPercent(current, 1)
                  : current.toLocaleString("en-GB")
              }
              delta={movement}
              sparkline={
                <Sparkline
                  values={data.series[kpi.series]}
                  tone={sparkTone(movement)}
                />
              }
            />
          );
        })}

        <KpiCard
          compact
          label="Estimated pipeline"
          hint="Estimate based on configured average service values. It is not booked or recognised revenue."
          value={formatGbp(data.estimatedPipeline)}
          delta={{
            value: `${data.qualifyingLeads.toLocaleString("en-GB")} ${
              data.qualifyingLeads === 1 ? "lead" : "leads"
            }`,
            direction: "flat",
            comparison: "qualifying right now",
          }}
          className="border-accent-200 bg-accent-50/50"
        />
      </div>

      <div className="dashboard-middle-grid grid gap-4">
        <LeadFunnelCard current={data.current} previous={data.previous} />
        <NeedsAttentionPanel items={attention} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentLeadsCard leads={data.recentLeads} />
        <UpcomingBookingsCard
          rows={bookings.rows}
          timezone={workspace.timezone}
          destinationConfigured={destination.configured}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SourcePerformanceCard rows={data.sources} />
        <FollowUpPerformanceCard metrics={data.followUp} />
        <ReactivationPerformanceCard
          campaigns={campaigns.slice(0, RECENT_CAMPAIGNS)}
        />
      </div>

      <p className="text-content-subtle text-[12px]">
        Test leads are excluded from every figure on this page. Recent leads,
        upcoming bookings and anything needing attention show current state
        rather than the selected date range.
      </p>
    </div>
  );
}
