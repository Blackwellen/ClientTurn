import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Banknote,
  BarChart3,
  Clock,
  CreditCard,
  MousePointerClick,
  TestTube,
  Users,
} from "lucide-react";
import {
  getAffiliateAccount,
  listReferralEvents,
  listReferralPage,
} from "@/lib/affiliates/portal";
import {
  buildLifecycle,
  countDelta,
  getDailySeries,
  getOverview,
  rateDelta,
} from "@/lib/affiliates/analytics";
import { formatMinor } from "@/lib/affiliates/types";
import {
  formatPercent,
  parseCustomRange,
  rangeComparisonLabel,
  parseRange,
} from "@/lib/affiliates/programme";
import {
  Donut,
  KpiCard,
  KpiGrid,
  Panel,
  PanelLink,
  PortalHeader,
  RangeTabs,
} from "@/components/affiliates/portal-ui";
import {
  AboutAttribution,
  ReferralLifecycle,
  ReferralsView,
} from "@/components/affiliates/referrals/referrals-view";

export const metadata: Metadata = { title: "Referrals | ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * The referrals page (V4 §32).
 *
 * The KPI strip is the same eight metrics as the dashboard, from the same
 * service, for the same window — deliberately, so the two pages can never
 * disagree about how many signups this month produced.
 */
export default async function AffiliateReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    page?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const params = await searchParams;
  const range = parseRange(params.range ?? affiliate.preferences.defaultRange);
  const custom = parseCustomRange(params.from, params.to);
  const currency = affiliate.policy.currency;

  const [overview, series, page, events] = await Promise.all([
    getOverview(affiliate.id, range, affiliate.joinedAt, custom),
    getDailySeries(affiliate.id, range, custom),
    listReferralPage(affiliate.id, {
      page: Number(params.page ?? 1),
      search: params.q,
      status: params.status,
    }),
    listReferralEvents(affiliate.id, 5),
  ]);

  const { current, previous } = overview;
  const baseline = rangeComparisonLabel(range, overview.days);
  const clicks = series.map((point) => point.clicks);
  const signups = series.map((point) => point.signups);
  const paid = series.map((point) => point.paidCustomers);

  const totalEarnings =
    current.pendingMinor + current.approvedMinor + current.paidMinor;

  const lifecycle = buildLifecycle(current, totalEarnings, current.paidMinor);

  return (
    <>
      <PortalHeader
        title="Referrals"
        description="Track your referred accounts through the lifecycle and monitor attribution and commission progress."
        action={
          <RangeTabs
            basePath="/affiliates/app/referrals"
            current={range}
            extraParams={{ q: params.q, status: params.status }}
            customFrom={custom?.fromDate}
            customTo={custom?.toDate}
          />
        }
      />

      <KpiGrid>
        <KpiCard
          icon={MousePointerClick}
          label="Clicks"
          value={current.clicks.toLocaleString("en-GB")}
          delta={countDelta(current.clicks, previous?.clicks, baseline)}
          series={clicks}
        />
        <KpiCard
          icon={Users}
          label="Signups"
          value={current.signups.toLocaleString("en-GB")}
          delta={countDelta(current.signups, previous?.signups, baseline)}
          series={signups}
        />
        <KpiCard
          icon={TestTube}
          label="Trials"
          value={current.trials.toLocaleString("en-GB")}
          delta={countDelta(current.trials, previous?.trials, baseline)}
          series={signups}
        />
        <KpiCard
          icon={CreditCard}
          label="Paid customers"
          value={current.paidCustomers.toLocaleString("en-GB")}
          delta={countDelta(current.paidCustomers, previous?.paidCustomers, baseline)}
          series={paid}
        />
        <KpiCard
          icon={Clock}
          label="Pending commission"
          value={formatMinor(current.pendingMinor, currency)}
          delta={countDelta(current.pendingMinor, previous?.pendingMinor, baseline)}
        />
        <KpiCard
          icon={BadgeCheck}
          label="Approved commission"
          value={formatMinor(current.approvedMinor, currency)}
          delta={countDelta(current.approvedMinor, previous?.approvedMinor, baseline)}
        />
        <KpiCard
          icon={Banknote}
          label="Paid commission"
          value={formatMinor(current.paidMinor, currency)}
          delta={countDelta(current.paidMinor, previous?.paidMinor, baseline)}
        />
        <KpiCard
          icon={BarChart3}
          label="Conversion rate"
          value={formatPercent(current.conversionRate)}
          delta={rateDelta(current.conversionRate, previous?.conversionRate, baseline)}
          series={paid}
        />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 space-y-3">
          <ReferralLifecycle stages={lifecycle} currency={currency} />
          <ReferralsView page={page} currency={currency} />
        </div>

        <div className="min-w-0 space-y-3">
          <Panel
            icon={BarChart3}
            title="Commission Summary"
            description="Your earnings from referred customers."
          >
            <div className="flex flex-wrap items-center gap-4 px-4 pb-4">
              <Donut
                size={140}
                centreValue={formatMinor(totalEarnings, currency)}
                centreLabel="Total earnings"
                segments={[
                  {
                    key: "pending",
                    label: "Pending commission",
                    value: current.pendingMinor,
                    colour: "var(--lr-warning-500)",
                  },
                  {
                    key: "approved",
                    label: "Approved commission",
                    value: current.approvedMinor,
                    colour: "var(--lr-success-500)",
                  },
                  {
                    key: "paid",
                    label: "Paid commission",
                    value: current.paidMinor,
                    colour: "var(--lr-success-700)",
                  },
                ]}
              />
              <dl className="min-w-[150px] flex-1 space-y-2.5">
                {[
                  ["Pending commission", current.pendingMinor, "var(--lr-warning-500)"],
                  ["Approved commission", current.approvedMinor, "var(--lr-success-500)"],
                  ["Paid commission", current.paidMinor, "var(--lr-success-700)"],
                ].map(([label, value, colour]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-[12px] text-content-secondary">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: String(colour) }}
                        aria-hidden
                      />
                      {String(label)}
                    </dt>
                    <dd className="text-[13px] font-semibold tabular-nums text-content">
                      {formatMinor(Number(value), currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="px-4 pb-4">
              <PanelLink href="/affiliates/app/performance">
                View full commission report
              </PanelLink>
            </div>
          </Panel>

          <Panel
            icon={Clock}
            title="Recent Referral Events"
            description="Latest activity from your referred accounts."
          >
            {events.length === 0 ? (
              <p className="px-4 pb-5 text-[13px] text-content-muted">
                Nothing has happened yet. Activity appears here as your referrals
                sign up, start trials and pay.
              </p>
            ) : (
              <ul className="space-y-3 px-4 pb-4">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-50">
                      <Users className="size-4 text-content-accent" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium leading-snug text-content">
                        {event.label}
                      </p>
                      <p className="text-[11.5px] text-content-muted">
                        {relativeTime(event.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <AboutAttribution
            windowDays={affiliate.policy.attributionWindowDays}
            model={affiliate.policy.attributionModel}
          />
        </div>
      </div>
    </>
  );
}

/** "2 hours ago" — short enough for a sidebar row. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
