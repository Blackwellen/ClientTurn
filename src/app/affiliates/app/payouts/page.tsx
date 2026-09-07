import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgeCheck, Banknote, Clock, Wallet } from "lucide-react";
import { getAffiliateAccount, listPortalPayouts } from "@/lib/affiliates/portal";
import {
  assessReadiness,
  getBalances,
  nextPayoutDate,
} from "@/lib/affiliates/payouts";
import { getDailySeries } from "@/lib/affiliates/analytics";
import { formatMinor } from "@/lib/affiliates/types";
import {
  KpiCard,
  Panel,
  PortalHeader,
} from "@/components/affiliates/portal-ui";
import {
  NextPayoutCard,
  PaymentMethodCard,
  PayoutHistory,
  TaxInfoCard,
} from "@/components/affiliates/payouts/payouts-view";

export const metadata: Metadata = { title: "Payouts | ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * The payouts page (V4 §35).
 *
 * Every balance comes from `affiliate_balances()` in Postgres. Nothing on this
 * page is summed from a table that happens to be rendered, and nothing is
 * computed in the browser — a payout figure a partner can influence by editing
 * a request is not a payout figure.
 */
export default async function AffiliatePayoutsPage() {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const [balances, payouts, series] = await Promise.all([
    getBalances(affiliate.id),
    listPortalPayouts(affiliate.id),
    getDailySeries(affiliate.id, "30d"),
  ]);

  const currency = affiliate.policy.currency;
  const readiness = assessReadiness({
    status: affiliate.status,
    connectState: affiliate.connectState,
    payoutsEnabled: affiliate.payoutsEnabled,
    detailsSubmitted: affiliate.detailsSubmitted,
    identityStatus: affiliate.identityStatus,
    taxStatus: affiliate.taxStatus,
    availableMinor: balances.availableMinor,
    minimumPayoutMinor: affiliate.policy.minimumPayoutMinor,
  });

  const payoutDate = nextPayoutDate().toISOString();

  return (
    <>
      <PortalHeader
        title="Payouts"
        description="Track your balances, payouts, tax details and commission history."
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          label="Available balance"
          value={formatMinor(balances.availableMinor, currency)}
          series={series.map((point) => point.approvedMinor)}
        />
        <KpiCard
          icon={Clock}
          label="Pending balance"
          value={formatMinor(balances.pendingMinor, currency)}
          series={series.map((point) => point.pendingMinor)}
        />
        <KpiCard
          icon={BadgeCheck}
          label="Approved commission"
          value={formatMinor(balances.approvedMinor, currency)}
          series={series.map((point) => point.approvedMinor)}
        />
        <KpiCard
          icon={Banknote}
          label="Paid to date"
          value={formatMinor(balances.paidMinor, currency)}
          series={series.map((point) => point.paidMinor)}
        />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 space-y-3">
          <NextPayoutCard
            availableMinor={balances.availableMinor}
            minimumMinor={affiliate.policy.minimumPayoutMinor}
            currency={currency}
            payoutDate={payoutDate}
            ready={
              readiness.readiness === "READY" &&
              balances.availableMinor >= affiliate.policy.minimumPayoutMinor
            }
          />

          {readiness.blocker && (
            <Panel icon={Clock} title="Before your first payout">
              <div className="px-4 pb-4">
                <p className="text-[13px] leading-relaxed text-content-secondary">
                  {readiness.blocker}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {readiness.checks.map((check) => (
                    <li
                      key={check.key}
                      className="flex items-center gap-2 text-[12.5px]"
                    >
                      <span
                        className={
                          check.state === "complete"
                            ? "size-1.5 rounded-full bg-success-500"
                            : check.state === "pending"
                              ? "size-1.5 rounded-full bg-info-500"
                              : "size-1.5 rounded-full bg-warning-500"
                        }
                        aria-hidden
                      />
                      <span className="text-content-secondary">{check.label}</span>
                      <span className="ml-auto text-content-muted">
                        {check.state === "complete"
                          ? "Done"
                          : check.state === "pending"
                            ? "In progress"
                            : "Outstanding"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}

          <PayoutHistory payouts={payouts} />
        </div>

        <div className="min-w-0 space-y-3">
          <PaymentMethodCard
            connectState={affiliate.connectState}
            hasAccount={affiliate.hasConnectAccount}
            payoutsEnabled={affiliate.payoutsEnabled}
          />
          <TaxInfoCard
            taxStatus={affiliate.taxStatus}
            taxCountry={affiliate.taxCountry}
            taxIdentifierLast4={affiliate.taxIdentifierLast4}
            submittedAt={affiliate.taxSubmittedAt}
          />
        </div>
      </div>
    </>
  );
}
