import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Banknote,
  BarChart3,
  Clock,
  CreditCard,
  Link2,
  Megaphone,
  MousePointerClick,
  TestTube,
  Users,
} from "lucide-react";
import { getAffiliateAccount } from "@/lib/affiliates/portal";
import {
  buildFunnel,
  countDelta,
  getCampaignMetrics,
  getDailySeries,
  getLinkMetrics,
  getOverview,
  rateDelta,
} from "@/lib/affiliates/analytics";
import { formatMinor } from "@/lib/affiliates/types";
import {
  formatPercent,
  parseCustomRange,
  rangeComparisonLabel,
  parseRange,
  RANGE_LABEL,
} from "@/lib/affiliates/programme";
import { siteOrigin } from "@/lib/affiliates/origin";
import {
  AreaChart,
  BarChart,
  CopyButton,
  FunnelBars,
  KpiCard,
  KpiGrid,
  MultiLineChart,
  Panel,
  PanelEmpty,
  PanelLink,
  PortalHeader,
  RangeTabs,
  Table,
  Td,
} from "@/components/affiliates/portal-ui";

export const metadata: Metadata = { title: "Affiliate Performance | ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * The performance page (V4 §34).
 *
 * Charts and tables only — every figure comes from the analytics service, and
 * this page adds no arithmetic of its own beyond formatting. The funnel and the
 * campaign table are both derived from the same link metrics as the dashboard's
 * Top Links panel, so a partner comparing the two pages sees the same numbers.
 */
export default async function AffiliatePerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const params = await searchParams;
  const range = parseRange(params.range ?? affiliate.preferences.defaultRange);
  const custom = parseCustomRange(params.from, params.to);
  const currency = affiliate.policy.currency;

  const [overview, series, links, campaigns, origin] = await Promise.all([
    getOverview(affiliate.id, range, affiliate.joinedAt, custom),
    getDailySeries(affiliate.id, range, custom),
    getLinkMetrics(affiliate.id, range, custom),
    getCampaignMetrics(affiliate.id, range, custom),
    siteOrigin(),
  ]);

  const { current, previous } = overview;
  const baseline = rangeComparisonLabel(range, overview.days);
  const funnel = buildFunnel(current);

  const from = new Date(overview.from);
  const to = new Date(overview.to);
  const rangeCaption = `${from.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} – ${new Date(to.getTime() - 86400000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  const hasActivity = current.clicks > 0 || current.signups > 0;

  return (
    <>
      <PortalHeader
        title="Affiliate Performance"
        description="Track clicks, signups, conversions and commission performance across your referral activity."
        action={
          <div className="flex flex-col items-end gap-1.5">
            <RangeTabs
              basePath="/affiliates/app/performance"
              current={range}
              customFrom={custom?.fromDate}
              customTo={custom?.toDate}
            />
            <p className="text-[11.5px] text-content-muted">
              {RANGE_LABEL[range]} · {rangeCaption}
            </p>
          </div>
        }
      />

      <KpiGrid>
        <KpiCard
          icon={MousePointerClick}
          label="Clicks"
          value={current.clicks.toLocaleString("en-GB")}
          delta={countDelta(current.clicks, previous?.clicks, baseline)}
          series={series.map((point) => point.clicks)}
        />
        <KpiCard
          icon={Users}
          label="Signups"
          value={current.signups.toLocaleString("en-GB")}
          delta={countDelta(current.signups, previous?.signups, baseline)}
          series={series.map((point) => point.signups)}
        />
        <KpiCard
          icon={TestTube}
          label="Trials"
          value={current.trials.toLocaleString("en-GB")}
          delta={countDelta(current.trials, previous?.trials, baseline)}
          series={series.map((point) => point.signups)}
        />
        <KpiCard
          icon={CreditCard}
          label="Paid customers"
          value={current.paidCustomers.toLocaleString("en-GB")}
          delta={countDelta(current.paidCustomers, previous?.paidCustomers, baseline)}
          series={series.map((point) => point.paidCustomers)}
        />
        <KpiCard
          icon={BarChart3}
          label="Conversion rate"
          value={formatPercent(current.conversionRate)}
          delta={rateDelta(current.conversionRate, previous?.conversionRate, baseline)}
          series={series.map((point) => point.paidCustomers)}
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
      </KpiGrid>

      {!hasActivity ? (
        <Panel className="mt-3" icon={BarChart3} title="Performance">
          <PanelEmpty
            title="Not enough referral activity yet."
            description="Once your links start getting clicks, your trends, funnel and campaign performance will appear here."
          />
        </Panel>
      ) : (
        <>
          <div className="mt-3 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
            <Panel
              icon={MousePointerClick}
              title="Click Trend"
              description={`Daily clicks over the ${RANGE_LABEL[range].toLowerCase()}.`}
            >
              <div className="px-4 pb-4">
                <AreaChart
                  label="Clicks"
                  points={series.map((point) => ({
                    day: point.day,
                    value: point.clicks,
                  }))}
                />
              </div>
            </Panel>

            <Panel
              icon={Users}
              title="Signup Funnel"
              description="From clicks to paid customers."
            >
              <FunnelBars steps={funnel} />
            </Panel>

            <Panel
              icon={BarChart3}
              title="Paid Conversion Chart"
              description="Daily paid customers."
            >
              <div className="px-4 pb-4">
                <BarChart
                  label="Paid customers"
                  points={series.map((point) => ({
                    day: point.day,
                    value: point.paidCustomers,
                  }))}
                />
              </div>
            </Panel>

            <Panel
              icon={Banknote}
              title="Commission Trend"
              description={`Daily commission (${currency}).`}
            >
              <div className="px-4 pb-4">
                <MultiLineChart
                  points={series}
                  formatValue={(value) => formatMinor(value, currency)}
                  series={[
                    {
                      key: "pending",
                      label: "Pending",
                      colour: "var(--lr-warning-500)",
                      values: series.map((point) => point.pendingMinor),
                    },
                    {
                      key: "approved",
                      label: "Approved",
                      colour: "var(--lr-success-500)",
                      values: series.map((point) => point.approvedMinor),
                    },
                    {
                      key: "paid",
                      label: "Paid",
                      colour: "var(--lr-success-700)",
                      values: series.map((point) => point.paidMinor),
                    },
                  ]}
                />
              </div>
            </Panel>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <Panel
              icon={Link2}
              title="Top Link Performance"
              description="Your best performing affiliate links."
              action={<PanelLink href="/affiliates/app/links">View all links</PanelLink>}
            >
              {links.length === 0 ? (
                <PanelEmpty title="No links to report on yet." />
              ) : (
                <Table
                  minWidth={640}
                  headers={[
                    { label: "Link / Campaign" },
                    { label: "Clicks", numeric: true },
                    { label: "Signups", numeric: true },
                    { label: "Trials", numeric: true },
                    { label: "Paid", numeric: true },
                    { label: "Conversion Rate", numeric: true },
                    { label: "Commission", numeric: true },
                    { label: "Copy", srOnly: true },
                  ]}
                >
                  {links.slice(0, 6).map((link) => (
                    <tr key={link.linkId} className="hover:bg-surface-hover">
                      <Td>
                        <p className="font-medium text-content">{link.label}</p>
                        <p className="text-[11.5px] text-content-muted">
                          clientturn.com
                          {link.destinationPath === "/" ? "" : link.destinationPath}
                        </p>
                      </Td>
                      <Td numeric>{link.clicks.toLocaleString("en-GB")}</Td>
                      <Td numeric>{link.signups.toLocaleString("en-GB")}</Td>
                      <Td numeric>{link.trials.toLocaleString("en-GB")}</Td>
                      <Td numeric>{link.paidCustomers.toLocaleString("en-GB")}</Td>
                      <Td numeric>{formatPercent(link.conversionRate)}</Td>
                      <Td numeric className="font-semibold">
                        {formatMinor(link.commissionMinor, currency)}
                      </Td>
                      <Td>
                        <CopyButton value={`${origin}/r/${link.slug}`} label="Copy" />
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>

            <Panel
              icon={Megaphone}
              title="Campaign Performance"
              description="Performance across all your campaigns."
            >
              {campaigns.length === 0 ? (
                <PanelEmpty title="No campaigns to report on yet." />
              ) : (
                <Table
                  minWidth={640}
                  headers={[
                    { label: "Campaign" },
                    { label: "Clicks", numeric: true },
                    { label: "Signups", numeric: true },
                    { label: "Paid Customers", numeric: true },
                    { label: "Conversion Rate", numeric: true },
                    { label: "Revenue Attributed", numeric: true },
                    { label: "Commission Earned", numeric: true },
                  ]}
                >
                  {campaigns.slice(0, 6).map((campaign) => (
                    <tr key={campaign.campaign} className="hover:bg-surface-hover">
                      <Td className="font-medium">{campaign.campaign}</Td>
                      <Td numeric>{campaign.clicks.toLocaleString("en-GB")}</Td>
                      <Td numeric>{campaign.signups.toLocaleString("en-GB")}</Td>
                      <Td numeric>
                        {campaign.paidCustomers.toLocaleString("en-GB")}
                      </Td>
                      <Td numeric>{formatPercent(campaign.conversionRate)}</Td>
                      {/* Attributed revenue only — never an invoice, a price or
                          anything that would identify what one customer pays. */}
                      <Td numeric>{formatMinor(campaign.revenueMinor, currency)}</Td>
                      <Td numeric className="font-semibold">
                        {formatMinor(campaign.commissionMinor, currency)}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
