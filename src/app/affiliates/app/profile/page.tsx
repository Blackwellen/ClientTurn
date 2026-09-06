import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAffiliate } from "@/lib/affiliates/queries";
import { serverEnv } from "@/lib/env";
import {
  AFFILIATE_STATUS_LABEL,
  AFFILIATE_STATUS_TONE,
  formatMinor,
  referralUrl,
} from "@/lib/affiliates/types";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/affiliates/ui";
import { ProfileForm } from "@/components/affiliates/profile-form";
import { PaymentDetailsForm } from "@/components/affiliates/payment-details-form";
import { CopyBlock } from "@/components/affiliates/copy-block";

export const metadata: Metadata = {
  title: "Profile | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliateProfilePage() {
  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");

  const plan = affiliate.plan;

  return (
    <div className="space-y-4">
      <Section
        title="Your partner account"
        description={`Joined ${new Date(affiliate.createdAt).toLocaleDateString("en-GB")}`}
        action={
          <Badge tone={AFFILIATE_STATUS_TONE[affiliate.status]} dense>
            {AFFILIATE_STATUS_LABEL[affiliate.status]}
          </Badge>
        }
      >
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div>
            <p className="text-[12px] font-medium text-content-secondary">
              Your referral code
            </p>
            <p className="mt-0.5 text-[11.5px] text-content-subtle">
              Fixed once issued — links already in circulation point at it.
            </p>
            <CopyBlock text={referralUrl(serverEnv.siteUrl, affiliate.code)} />
          </div>
        </div>
      </Section>

      <Section
        title="Your details"
        description="How we contact you about the programme and your payouts."
      >
        <ProfileForm
          displayName={affiliate.displayName}
          contactEmail={affiliate.contactEmail}
        />
      </Section>

      <Section
        title="Payment details"
        description="Where payouts are sent."
      >
        <PaymentDetailsForm hasDetails={affiliate.hasPaymentDetails} />
      </Section>

      {plan && (
        <Section title="Programme terms" description={plan.name}>
          <ul className="divide-y divide-line-subtle text-[13px]">
            <Term label="Commission">
              {plan.commissionType === "FLAT_AMOUNT"
                ? `${formatMinor(plan.flatAmountMinor ?? 0, plan.currency)} per paying customer`
                : plan.commissionType === "FIRST_PAYMENT_PERCENT"
                  ? `${plan.percent ?? 0}% of the first payment`
                  : plan.recurringMonths
                    ? `${plan.percent ?? 0}% of every payment for ${plan.recurringMonths} months`
                    : `${plan.percent ?? 0}% of every payment, for the life of the customer`}
            </Term>
            <Term label="Attribution">
              Last touch. The most recent link clicked within{" "}
              {plan.cookieWindowDays} days of signing up gets the credit.
            </Term>
            <Term label="Hold period">
              {plan.holdDays} days from the payment, so refunds and chargebacks
              can be reflected before commission is confirmed.
            </Term>
            <Term label="Minimum payout">
              {formatMinor(plan.minimumPayoutMinor, plan.currency)}. Anything
              below carries over to the next run.
            </Term>
            <Term label="Self-referral">
              Signing up through your own link earns nothing.
            </Term>
            <Term label="What you can see">
              Sign-up dates, plan and lifetime revenue for the businesses you
              referred. Never their account, data, leads or contacts.
            </Term>
          </ul>
        </Section>
      )}
    </div>
  );
}

function Term({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
      <span className="w-40 shrink-0 font-medium text-content">{label}</span>
      <span className="min-w-0 flex-1 text-content-secondary">{children}</span>
    </li>
  );
}
