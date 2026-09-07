import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Calendar,
  Clock,
  CreditCard,
  FileText,
  Image as ImageIcon,
  Layers,
  Link2,
  Mail,
  MousePointerClick,
  Share2,
  TestTube,
  Users,
} from "lucide-react";
import { getAffiliateAccount, listReferralPage } from "@/lib/affiliates/portal";
import { getResourceHub } from "@/lib/affiliates/portal";
import {
  countDelta,
  getDailySeries,
  getLinkMetrics,
  getOverview,
  rateDelta,
} from "@/lib/affiliates/analytics";
import { getBalances, nextPayoutDate } from "@/lib/affiliates/payouts";
import { formatMinor } from "@/lib/affiliates/types";
import {
  formatPercent,
  parseCustomRange,
  rangeComparisonLabel,
  parseRange,
  PAYOUT_READINESS_LABEL,
  PAYOUT_READINESS_TONE,
  TAX_STATE_LABEL,
  TAX_STATE_TONE,
} from "@/lib/affiliates/programme";
import { Badge } from "@/components/ui/badge";
import {
  CopyButton,
  Donut,
  KpiCard,
  KpiGrid,
  Panel,
  PanelEmpty,
  PanelLink,
  PortalHeader,
  RangeTabs,
  Table,
  Td,
} from "@/components/affiliates/portal-ui";
import { ApplicationStatusPanel } from "@/components/affiliates/application-status-panel";
import { REFERRAL_STATUS_LABEL, REFERRAL_STATUS_TONE } from "@/lib/affiliates/types";
import { COMMISSION_STATUS_LABEL, COMMISSION_STATUS_TONE } from "@/lib/affiliates/types";

export const metadata: Metadata = { title: "Affiliate Dashboard | ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * The partner dashboard (V4 §30).
 *
 * Every number on this page comes from `AffiliateAnalyticsService` or the
 * payout ledger — nothing is computed in a component, and nothing is derived a
 * second time from a table that happens to be on screen. That is what keeps
 * this page, Referrals and Performance in agreement.
 */
export default async function AffiliateDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;

  // Not yet earning: there is nothing to chart, and rendering eight zeroes
  // reads as failure rather than as "your application is with a reviewer".
  if (affiliate.status !== "ACTIVE") {
    return <ApplicationStatusPanel affiliate={affiliate} />;
  }

  const params = await searchParams;
  const range = parseRange(params.range ?? affiliate.preferences.defaultRange);
  // Re-parsed and clamped server-side: both dates arrived in a query string.
  const custom = parseCustomRange(params.from, params.to);

  const [overview, series, referrals, links, balances, resources] = await Promise.all([
    getOverview(affiliate.id, range, affiliate.joinedAt, custom),
    getDailySeries(affiliate.id, range, custom),
    listReferralPage(affiliate.id, { pageSize: 5 }),
    getLinkMetrics(affiliate.id, range, custom),
    getBalances(affiliate.id),
    getResourceHub(affiliate.id),
  ]);

  const { current, previous } = overview;
  const baseline = rangeComparisonLabel(range, overview.days);
  const currency = affiliate.policy.currency;

  const clicks = series.map((point) => point.clicks);
  const signups = series.map((point) => point.signups);
  const paid = series.map((point) => point.paidCustomers);

  const totalEarnings =
    current.pendingMinor + current.approvedMinor + current.paidMinor;

  const payout = nextPayoutDate();
  const thresholdPct = Math.min(
    100,
    Math.round(
      (balances.availableMinor / Math.max(affiliate.policy.minimumPayoutMinor, 1)) * 100,
    ),
  );

  return (
    <>
      <PortalHeader
        title="Affiliate Dashboard"
        description="Track clicks, referrals, commissions and payouts across your ClientTurn affiliate account."
        action={
          <RangeTabs
            basePath="/affiliates/app"
            current={range}
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
          icon={BarChart3}
          label="Conversion rate"
          value={formatPercent(current.conversionRate)}
          delta={rateDelta(current.conversionRate, previous?.conversionRate, baseline)}
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
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel
          icon={Users}
          title="Recent Referrals"
          description="Your latest referred customers and their status."
          action={<PanelLink href="/affiliates/app/referrals">View all referrals</PanelLink>}
          bodyClassName="pb-1"
        >
          {referrals.rows.length === 0 ? (
            <PanelEmpty
              title="No referrals yet."
              description="Share a referral link and the accounts you introduce will appear here."
              action={
                <Link
                  href="/affiliates/app/links"
                  className="inline-flex items-center gap-1.5 rounded-[9px] bg-accent-500 px-3.5 py-2 text-[13px] font-semibold text-brand-midnight hover:bg-[#a6e238]"
                >
                  Create your first link
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            />
          ) : (
            <Table
              minWidth={620}
              headers={[
                { label: "Customer / Company" },
                { label: "Status" },
                { label: "Stage" },
                { label: "Referral date" },
                { label: "Commission", numeric: true },
              ]}
            >
              {referrals.rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-hover">
                  <Td>
                    <Link
                      href={`/affiliates/app/referrals?highlight=${row.id}`}
                      className="font-medium text-content hover:underline"
                    >
                      {row.label}
                    </Link>
                    {row.sourceLabel && (
                      <p className="text-[11.5px] text-content-muted">{row.sourceLabel}</p>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={REFERRAL_STATUS_TONE[row.status]} dot dense>
                      {REFERRAL_STATUS_LABEL[row.status]}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="rounded-[6px] bg-info-50 px-2 py-0.5 text-[11.5px] font-medium text-info-700">
                      {stageLabel(row.paidState, row.trialState)}
                    </span>
                  </Td>
                  <Td className="text-content-secondary">
                    {row.signupAt
                      ? new Date(row.signupAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </Td>
                  <Td numeric>
                    <span className="font-semibold">
                      {formatMinor(row.commissionMinor, currency)}
                    </span>
                    {row.commissionState && (
                      <Badge
                        tone={COMMISSION_STATUS_TONE[row.commissionState]}
                        dense
                        className="ml-2"
                      >
                        {COMMISSION_STATUS_LABEL[row.commissionState]}
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel
          icon={BarChart3}
          title="Commission Summary"
          description="Your earnings across different stages."
          action={<PanelLink href="/affiliates/app/performance">View full report</PanelLink>}
        >
          <div className="flex flex-wrap items-center gap-6 px-4 pb-4">
            <Donut
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

            <dl className="min-w-[200px] flex-1 space-y-3">
              <LegendRow
                colour="var(--lr-warning-500)"
                label="Pending commission"
                value={formatMinor(current.pendingMinor, currency)}
              />
              <LegendRow
                colour="var(--lr-success-500)"
                label="Approved commission"
                value={formatMinor(current.approvedMinor, currency)}
              />
              <LegendRow
                colour="var(--lr-success-700)"
                label="Paid commission"
                value={formatMinor(current.paidMinor, currency)}
              />
            </dl>
          </div>

          <div className="mx-4 mb-4 flex flex-wrap items-center gap-4 rounded-[10px] border border-line-subtle bg-surface-sunken/50 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-[8px] bg-surface">
                <Calendar className="size-4 text-content-muted" aria-hidden />
              </span>
              <div>
                <p className="text-[11.5px] text-content-muted">Next payout date</p>
                <p className="text-[14px] font-semibold text-content">
                  {payout.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
            <p className="min-w-[200px] flex-1 text-[12px] leading-relaxed text-content-muted">
              Payouts are processed monthly once you reach the{" "}
              {formatMinor(affiliate.policy.minimumPayoutMinor, currency)} minimum
              threshold.
            </p>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)]">
        <Panel
          icon={Link2}
          title="Top Links"
          description="Your best performing affiliate links."
          action={<PanelLink href="/affiliates/app/links">View all links</PanelLink>}
          bodyClassName="pb-1"
        >
          {links.length === 0 ? (
            <PanelEmpty
              title="No affiliate links yet."
              description="Create a link to start tracking clicks and signups."
            />
          ) : (
            <Table
              minWidth={520}
              headers={[
                { label: "Link name" },
                { label: "Destination" },
                { label: "Clicks", numeric: true },
                { label: "Signups", numeric: true },
                { label: "Conversion", numeric: true },
                { label: "Copy", srOnly: true },
              ]}
            >
              {links.slice(0, 5).map((link) => (
                <tr key={link.linkId} className="hover:bg-surface-hover">
                  <Td className="font-medium">{link.label}</Td>
                  <Td>
                    <span className="text-content-accent">
                      clientturn.com{link.destinationPath === "/" ? "" : link.destinationPath}
                    </span>
                  </Td>
                  <Td numeric>{link.clicks.toLocaleString("en-GB")}</Td>
                  <Td numeric>{link.signups.toLocaleString("en-GB")}</Td>
                  <Td numeric>{formatPercent(link.conversionRate)}</Td>
                  <Td>
                    <CopyButton value={referralUrlFor(link.slug)} label="Copy" />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel
          icon={FileText}
          title="Resource Highlights"
          description="Tools to help you promote ClientTurn."
          action={<PanelLink href="/affiliates/app/resources">View all resources</PanelLink>}
        >
          {resources.resources.length === 0 ? (
            <PanelEmpty title="No resources published yet." />
          ) : (
            <ul className="divide-y divide-line-subtle border-t border-line-subtle">
              {resources.resources.slice(0, 5).map((resource) => (
                <li
                  key={resource.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-50">
                    {resourceIcon(resource.category)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-content">
                      {resource.title}
                    </p>
                    <p className="truncate text-[11.5px] text-content-muted">
                      {resource.description ?? resource.usageRights}
                    </p>
                  </div>
                  <Link
                    href={
                      resource.hasFile
                        ? `/affiliates/app/resources/${resource.id}/download`
                        : `/affiliates/app/resources?resource=${resource.id}`
                    }
                    className="shrink-0 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-content hover:bg-surface-hover"
                  >
                    {resource.hasFile ? "Download" : "View"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={CreditCard}
          title="Payout Status"
          description="Your payout settings and progress."
        >
          <div className="space-y-3 px-4 pb-4">
            <StatusRow
              icon={Banknote}
              label="Payout method"
              value={
                affiliate.hasConnectAccount ? "Stripe Connect" : "Not connected"
              }
              action={
                <Link
                  href="/affiliates/app/settings?section=payments"
                  className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] font-medium text-content hover:bg-surface-hover"
                >
                  Manage
                </Link>
              }
            />

            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-surface-sunken">
                <BarChart3 className="size-4 text-content-muted" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-content-muted">Payout threshold</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-accent-500"
                      style={{ width: `${thresholdPct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-content-muted">
                    {thresholdPct}%
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] tabular-nums text-content-secondary">
                  {formatMinor(balances.availableMinor, currency)} /{" "}
                  {formatMinor(affiliate.policy.minimumPayoutMinor, currency)}
                </p>
              </div>
            </div>

            <StatusRow
              icon={Calendar}
              label="Next payout (estimated)"
              value={formatMinor(balances.availableMinor, currency)}
              hint={payout.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            />

            <StatusRow
              icon={FileText}
              label="Tax profile"
              value={
                <Badge tone={TAX_STATE_TONE[affiliate.taxStatus]} dot dense>
                  {TAX_STATE_LABEL[affiliate.taxStatus]}
                </Badge>
              }
              action={
                <Link
                  href="/affiliates/app/settings?section=tax"
                  className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] font-medium text-content hover:bg-surface-hover"
                >
                  View
                </Link>
              }
            />

            {affiliate.payoutReadiness !== "READY" && (
              <p className="rounded-[9px] border border-warning-100 bg-warning-50 px-3 py-2 text-[12px] leading-relaxed text-warning-700">
                <Badge tone={PAYOUT_READINESS_TONE[affiliate.payoutReadiness]} dense>
                  {PAYOUT_READINESS_LABEL[affiliate.payoutReadiness]}
                </Badge>{" "}
                Finish your payout setup so commission can be sent to you.
              </p>
            )}

            <Link
              href="/affiliates/app/payouts"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[9px] bg-accent-500 text-[13.5px] font-semibold text-brand-midnight transition-colors hover:bg-[#a6e238]"
            >
              Manage payouts
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- fragments -- */

function LegendRow({
  colour,
  label,
  value,
}: {
  colour: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-[13px] text-content-secondary">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: colour }}
          aria-hidden
        />
        {label}
      </dt>
      <dd className="text-[14px] font-semibold tabular-nums text-content">{value}</dd>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  hint,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-surface-sunken">
        <Icon className="size-4 text-content-muted" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-content-muted">{label}</p>
        <p className="text-[13px] font-medium text-content">{value}</p>
      </div>
      {hint && (
        <span className="shrink-0 text-[11.5px] text-content-muted">{hint}</span>
      )}
      {action}
    </div>
  );
}

/** The customer's furthest point in the lifecycle, as one word. */
function stageLabel(paidState: string, trialState: string): string {
  if (paidState === "PAID") return "Paid customer";
  if (trialState === "ACTIVE_TRIAL") return "Trial";
  if (trialState === "CONVERTED") return "Paid customer";
  return "Signup";
}

function resourceIcon(category: string) {
  const className = "size-4 text-content-accent";
  if (category === "COPY") return <Mail className={className} aria-hidden />;
  if (category === "AD_CREATIVE") return <Share2 className={className} aria-hidden />;
  if (category === "CAMPAIGN_PACK") return <Layers className={className} aria-hidden />;
  if (category === "SCREENSHOT") return <ImageIcon className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

/**
 * The public referral URL for a slug.
 *
 * Uses the configured site origin so a copied link works from any environment,
 * and falls back to the production host rather than to localhost — a link
 * copied from a preview deploy should still point somewhere real.
 */
function referralUrlFor(slug: string): string {
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://clientturn.com"
  ).replace(/\/+$/, "");
  return `${origin}/r/${slug}`;
}
