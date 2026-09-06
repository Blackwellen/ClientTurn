import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAffiliate, listReferrals } from "@/lib/affiliates/queries";
import {
  formatMinor,
  REFERRAL_STATUS_LABEL,
  REFERRAL_STATUS_TONE,
} from "@/lib/affiliates/types";
import { Badge } from "@/components/ui/badge";
import { Cell, DataGrid, Section, SectionEmpty } from "@/components/affiliates/ui";

export const metadata: Metadata = {
  title: "Referrals | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliateReferralsPage() {
  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const referrals = await listReferrals(affiliate.id);

  return (
    <div className="space-y-4">
      <Section
        title="Referrals"
        description="Every business that signed up through one of your links."
      >
        {referrals.length === 0 ? (
          <SectionEmpty>
            No referrals yet. They appear here as soon as someone creates an
            account through one of your links.
          </SectionEmpty>
        ) : (
          <DataGrid
            headers={["Referral", "Status", "Plan", "Signed up", "Started paying", "Revenue"]}
          >
            {referrals.map((referral) => (
              <tr key={referral.id}>
                <Cell>{referral.label}</Cell>
                <Cell>
                  <Badge tone={REFERRAL_STATUS_TONE[referral.status]} dense>
                    {REFERRAL_STATUS_LABEL[referral.status]}
                  </Badge>
                </Cell>
                <Cell>{referral.planKey ?? "—"}</Cell>
                <Cell>{formatDate(referral.signupAt)}</Cell>
                <Cell>{formatDate(referral.paidAt)}</Cell>
                <Cell numeric>
                  {referral.lifetimeRevenueMinor > 0
                    ? formatMinor(referral.lifetimeRevenueMinor)
                    : "—"}
                </Cell>
              </tr>
            ))}
          </DataGrid>
        )}
      </Section>

      {/* Said plainly rather than buried in terms: partners ask, and the honest
          answer is a feature of the programme, not an apology for it. */}
      <p className="px-1 text-[12px] text-content-subtle">
        Referrals are shown by sign-up date, not by customer name. You have no
        access to a referred business&rsquo;s account, data or contacts.
      </p>
    </div>
  );
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-GB") : "—";
}
