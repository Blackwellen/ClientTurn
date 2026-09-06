import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import {
  getAffiliate,
  listCommissions,
  listPayouts,
} from "@/lib/affiliates/queries";
import {
  formatMinor,
  payoutBlocker,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
} from "@/lib/affiliates/types";
import { Badge } from "@/components/ui/badge";
import {
  Cell,
  DataGrid,
  Section,
  SectionEmpty,
  Stat,
} from "@/components/affiliates/ui";
import { PaymentDetailsForm } from "@/components/affiliates/payment-details-form";

export const metadata: Metadata = {
  title: "Payouts | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliatePayoutsPage() {
  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const [payouts, commissions] = await Promise.all([
    listPayouts(affiliate.id),
    listCommissions(affiliate.id),
  ]);

  const payableMinor = commissions
    .filter((row) => row.status === "APPROVED" || row.status === "PAYABLE")
    .reduce((sum, row) => sum + row.commissionAmountMinor, 0);

  const minimumPayoutMinor = affiliate.plan?.minimumPayoutMinor ?? 5000;

  const blocker = payoutBlocker({
    status: affiliate.status,
    taxStatus: affiliate.taxStatus,
    hasPaymentDetails: affiliate.hasPaymentDetails,
    payableMinor,
    minimumPayoutMinor,
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Ready for the next payout"
          value={formatMinor(payableMinor)}
          tone={payableMinor > 0 ? "success" : undefined}
        />
        <Stat
          label="Minimum payout"
          value={formatMinor(minimumPayoutMinor)}
          hint="Balances below this carry over"
        />
        <Stat
          label="Paid to date"
          value={formatMinor(
            payouts
              .filter((row) => row.status === "PAID")
              .reduce((sum, row) => sum + row.amountMinor, 0),
          )}
        />
      </div>

      {blocker && (
        <p className="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-[12.5px] text-warning-700">
          <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
          {blocker}
        </p>
      )}

      {/* Payouts are raised by the platform on a schedule, not requested by the
          partner. Saying so removes the obvious "where is the button" question. */}
      <Section
        title="Payment details"
        description="Where we send your payouts. Payout runs happen monthly, once approved commission clears the minimum."
      >
        <PaymentDetailsForm hasDetails={affiliate.hasPaymentDetails} />
      </Section>

      <Section title="Payout history">
        {payouts.length === 0 ? (
          <SectionEmpty>
            No payouts yet. The first is raised once your approved commission
            reaches {formatMinor(minimumPayoutMinor)}.
          </SectionEmpty>
        ) : (
          <DataGrid
            headers={["Reference", "Period", "Commissions", "Amount", "Status", "Paid"]}
          >
            {payouts.map((payout) => (
              <tr key={payout.id}>
                <Cell>{payout.batchReference ?? payout.id.slice(0, 8)}</Cell>
                <Cell>
                  {payout.periodStart && payout.periodEnd
                    ? `${short(payout.periodStart)} – ${short(payout.periodEnd)}`
                    : "—"}
                </Cell>
                <Cell numeric>{payout.commissionCount}</Cell>
                <Cell numeric className="font-medium">
                  {formatMinor(payout.amountMinor, payout.currency)}
                </Cell>
                <Cell>
                  <Badge tone={PAYOUT_STATUS_TONE[payout.status]} dense>
                    {PAYOUT_STATUS_LABEL[payout.status]}
                  </Badge>
                  {payout.failureReason && (
                    <span className="mt-0.5 block text-[11.5px] text-danger-600">
                      {payout.failureReason}
                    </span>
                  )}
                </Cell>
                <Cell>
                  {payout.paidAt
                    ? new Date(payout.paidAt).toLocaleDateString("en-GB")
                    : "—"}
                </Cell>
              </tr>
            ))}
          </DataGrid>
        )}
      </Section>
    </div>
  );
}

function short(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
