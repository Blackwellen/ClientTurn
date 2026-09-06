import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAffiliate, loadOverview } from "@/lib/affiliates/queries";
import {
  AFFILIATE_STATUS_LABEL,
  conversionRate,
  formatMinor,
  formatRate,
  REFERRAL_STATUS_LABEL,
  REFERRAL_STATUS_TONE,
  type AffiliateSummary,
} from "@/lib/affiliates/types";
import { Badge } from "@/components/ui/badge";
import {
  Cell,
  DataGrid,
  Section,
  SectionEmpty,
  Stat,
} from "@/components/affiliates/ui";
import { ClickSparkline } from "@/components/affiliates/click-sparkline";

export const metadata: Metadata = {
  title: "Overview | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliateOverviewPage() {
  // The layout has already guarded. This re-reads rather than trusting it: a
  // page should not depend on a parent having done the check.
  const affiliate = await getAffiliate();
  if (!affiliate) return null;

  if (affiliate.status !== "ACTIVE") {
    return <PendingState affiliate={affiliate} />;
  }

  const data = await loadOverview(affiliate);
  const { totals } = data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Clicks"
          value={totals.clicks.toLocaleString("en-GB")}
          hint="Last 30 days, excluding bots"
        />
        <Stat
          label="Sign-ups"
          value={totals.signups.toLocaleString("en-GB")}
          hint={`${formatRate(conversionRate(totals.signups, totals.clicks))} of clicks`}
        />
        <Stat
          label="Paying customers"
          value={totals.paying.toLocaleString("en-GB")}
          tone={totals.paying > 0 ? "success" : undefined}
        />
        <Stat
          label="Ready to pay"
          value={formatMinor(totals.payableMinor)}
          hint={`${formatMinor(totals.pendingMinor)} still in the hold period`}
          tone={totals.payableMinor > 0 ? "success" : undefined}
        />
      </div>

      <Section title="Clicks" description="The last 30 days. Bot traffic is excluded.">
        <div className="px-4 py-4 sm:px-5">
          <ClickSparkline series={data.clickSeries} />
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Your best links"
          description="Ordered by clicks."
          action={
            <Link
              href="/affiliates/app/links"
              className="text-[12.5px] text-content-accent underline-offset-4 hover:underline"
            >
              All links
            </Link>
          }
        >
          {data.topLinks.length === 0 ? (
            <SectionEmpty>
              You have not created a referral link yet.{" "}
              <Link
                href="/affiliates/app/links"
                className="text-content-accent underline-offset-4 hover:underline"
              >
                Create one
              </Link>{" "}
              to start tracking.
            </SectionEmpty>
          ) : (
            <DataGrid headers={["Link", "Clicks", "Sign-ups", "Paying"]}>
              {data.topLinks.map((link) => (
                <tr key={link.id}>
                  <Cell>
                    <span className="font-medium">{link.label}</span>
                    <span className="block text-[11.5px] text-content-subtle">
                      /r/{link.slug}
                    </span>
                  </Cell>
                  <Cell numeric>{link.clickCount.toLocaleString("en-GB")}</Cell>
                  <Cell numeric>{link.signupCount.toLocaleString("en-GB")}</Cell>
                  <Cell numeric>{link.paidCount.toLocaleString("en-GB")}</Cell>
                </tr>
              ))}
            </DataGrid>
          )}
        </Section>

        <Section
          title="Recent referrals"
          description="Businesses that signed up through your links."
          action={
            <Link
              href="/affiliates/app/referrals"
              className="text-[12.5px] text-content-accent underline-offset-4 hover:underline"
            >
              All referrals
            </Link>
          }
        >
          {data.recentReferrals.length === 0 ? (
            <SectionEmpty>
              No sign-ups yet. Referrals appear here as soon as someone creates an
              account through one of your links.
            </SectionEmpty>
          ) : (
            <DataGrid headers={["Referral", "Status", "Plan", "Signed up"]}>
              {data.recentReferrals.map((referral) => (
                <tr key={referral.id}>
                  <Cell>{referral.label}</Cell>
                  <Cell>
                    <Badge tone={REFERRAL_STATUS_TONE[referral.status]} dense>
                      {REFERRAL_STATUS_LABEL[referral.status]}
                    </Badge>
                  </Cell>
                  <Cell>{referral.planKey ?? "—"}</Cell>
                  <Cell>
                    {referral.signupAt
                      ? new Date(referral.signupAt).toLocaleDateString("en-GB")
                      : "—"}
                  </Cell>
                </tr>
              ))}
            </DataGrid>
          )}
        </Section>
      </div>
    </div>
  );
}

/**
 * What an applicant, or a suspended partner, sees instead of a dashboard.
 *
 * Empty tables would read as "you have earned nothing", which is a different
 * and much more discouraging message than "we have not finished reviewing you".
 */
function PendingState({ affiliate }: { affiliate: AffiliateSummary }) {
  const applied = affiliate.status === "APPLIED";

  return (
    <Section
      title={AFFILIATE_STATUS_LABEL[affiliate.status]}
      description={
        applied
          ? "We review new partners within two working days."
          : "Your partner account is not currently active."
      }
    >
      <div className="space-y-3 px-4 py-5 text-[13px] text-content-secondary sm:px-5">
        {affiliate.statusReason && (
          <p className="rounded-lg border border-line bg-surface-sunken px-3.5 py-2.5">
            {affiliate.statusReason}
          </p>
        )}
        <p>
          {applied
            ? "Your referral code is reserved. As soon as you are approved you can create tracked links, and commission accrues from that point."
            : "Existing links have stopped tracking. Get in touch if you think this is a mistake."}
        </p>
        <p className="text-content-muted">
          Your referral code is{" "}
          <span className="font-medium text-content">{affiliate.code}</span>.
        </p>
      </div>
    </Section>
  );
}
