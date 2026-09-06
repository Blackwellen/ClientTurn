import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAffiliate, listCommissions } from "@/lib/affiliates/queries";
import {
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_MEANING,
  COMMISSION_STATUS_TONE,
  COMMISSION_STATUSES,
  formatMinor,
  type CommissionRow,
} from "@/lib/affiliates/types";
import { Badge } from "@/components/ui/badge";
import {
  Cell,
  DataGrid,
  Section,
  SectionEmpty,
  Stat,
} from "@/components/affiliates/ui";

export const metadata: Metadata = {
  title: "Commissions | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliateCommissionsPage() {
  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const commissions = await listCommissions(affiliate.id);
  const totals = totalsByStatus(commissions);
  const plan = affiliate.plan;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="In the hold period"
          value={formatMinor(totals.PENDING)}
          hint={plan ? `${plan.holdDays}-day hold against refunds` : undefined}
        />
        <Stat
          label="Approved"
          value={formatMinor(totals.APPROVED + totals.PAYABLE)}
          hint="Joins the next payout run"
          tone={totals.APPROVED + totals.PAYABLE > 0 ? "success" : undefined}
        />
        <Stat label="Paid to date" value={formatMinor(totals.PAID)} />
        <Stat
          label="Reversed"
          value={formatMinor(totals.REVERSED)}
          hint="Refunds and chargebacks"
          tone={totals.REVERSED > 0 ? "danger" : undefined}
        />
      </div>

      {plan && (
        <Section
          title="Your commission terms"
          description={plan.name}
          className="min-w-0"
        >
          <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-[13px] sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <Term
              label="Rate"
              value={
                plan.commissionType === "FLAT_AMOUNT"
                  ? formatMinor(plan.flatAmountMinor ?? 0, plan.currency)
                  : `${plan.percent ?? 0}%`
              }
              detail={
                plan.commissionType === "RECURRING_PERCENT"
                  ? plan.recurringMonths
                    ? `For the first ${plan.recurringMonths} months`
                    : "For the life of the customer"
                  : plan.commissionType === "FIRST_PAYMENT_PERCENT"
                    ? "On the first payment only"
                    : "Per paying customer"
              }
            />
            <Term
              label="Attribution window"
              value={`${plan.cookieWindowDays} days`}
              detail="From the click to the sign-up"
            />
            <Term
              label="Hold period"
              value={`${plan.holdDays} days`}
              detail="Before commission is confirmed"
            />
            <Term
              label="Minimum payout"
              value={formatMinor(plan.minimumPayoutMinor, plan.currency)}
              detail="Carried over until reached"
            />
          </dl>
        </Section>
      )}

      <Section
        title="Commission history"
        description="One entry per customer payment."
      >
        {commissions.length === 0 ? (
          <SectionEmpty>
            Nothing yet. Commission is recorded the first time a referred
            business pays an invoice.
          </SectionEmpty>
        ) : (
          <DataGrid
            headers={["Referral", "Period", "Customer paid", "Your commission", "Status"]}
          >
            {commissions.map((commission) => (
              <tr key={commission.id}>
                <Cell>{commission.referralLabel}</Cell>
                <Cell>
                  {commission.periodMonth
                    ? new Date(commission.periodMonth).toLocaleDateString("en-GB", {
                        month: "short",
                        year: "numeric",
                      })
                    : new Date(commission.createdAt).toLocaleDateString("en-GB")}
                </Cell>
                <Cell numeric>
                  {formatMinor(commission.baseAmountMinor, commission.currency)}
                </Cell>
                <Cell numeric className="font-medium">
                  {formatMinor(commission.commissionAmountMinor, commission.currency)}
                </Cell>
                <Cell>
                  <Badge tone={COMMISSION_STATUS_TONE[commission.status]} dense>
                    {COMMISSION_STATUS_LABEL[commission.status]}
                  </Badge>
                  {commission.reversalReason && (
                    <span className="mt-0.5 block text-[11.5px] text-content-subtle">
                      {commission.reversalReason}
                    </span>
                  )}
                </Cell>
              </tr>
            ))}
          </DataGrid>
        )}
      </Section>

      {/* What each status means for the partner's money. A payouts page that
          cannot answer "when do I get paid" just generates support tickets. */}
      <Section title="What the statuses mean">
        <dl className="divide-y divide-line-subtle">
          {COMMISSION_STATUSES.map((status) => (
            <div
              key={status}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5"
            >
              <dt className="w-32 shrink-0">
                <Badge tone={COMMISSION_STATUS_TONE[status]} dense>
                  {COMMISSION_STATUS_LABEL[status]}
                </Badge>
              </dt>
              <dd className="min-w-0 flex-1 text-[12.5px] text-content-muted">
                {COMMISSION_STATUS_MEANING[status]}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

function Term({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-content">{value}</dd>
      <dd className="text-[11.5px] text-content-subtle">{detail}</dd>
    </div>
  );
}

function totalsByStatus(rows: CommissionRow[]): Record<string, number> {
  const totals: Record<string, number> = {
    PENDING: 0,
    APPROVED: 0,
    REVERSED: 0,
    PAYABLE: 0,
    PAID: 0,
  };
  for (const row of rows) {
    totals[row.status] = (totals[row.status] ?? 0) + row.commissionAmountMinor;
  }
  return totals;
}
