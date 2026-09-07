import * as React from "react";
import type { Metadata } from "next";
import { getAffiliateAccount, listReferralPage } from "@/lib/affiliates/portal";
import {
  assessReadiness,
  getBalances,
  syncReadiness,
} from "@/lib/affiliates/payouts";
import { refreshConnectState } from "@/lib/affiliates/stripe-connect";
import { parseSettingsSection } from "@/lib/affiliates/nav";
import { PortalHeader } from "@/components/affiliates/portal-ui";
import { AffiliateSettingsView } from "@/components/affiliates/settings/settings-view";

export const metadata: Metadata = { title: "Affiliate Settings | ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * Affiliate settings (V4 §36).
 *
 * Reachable in every account state, unlike the earning surfaces: someone whose
 * application is pending still needs to be able to correct their email address.
 *
 * On returning from Stripe (`?connected=1`) the Connect account is re-read from
 * Stripe before the page renders, so the partner sees their real state rather
 * than the state we cached before they left.
 */
export default async function AffiliateSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const section = parseSettingsSection(params.section);
  const justConnected = params.connected === "1";

  let affiliate = await getAffiliateAccount();
  if (!affiliate) return null;

  if (justConnected && affiliate.hasConnectAccount) {
    await refreshConnectState(affiliate.id);
    // Re-read so the page renders the refreshed state rather than the snapshot
    // taken before the round trip to Stripe.
    affiliate = (await getAffiliateAccount()) ?? affiliate;
  }

  const [balances, referrals] = await Promise.all([
    getBalances(affiliate.id),
    listReferralPage(affiliate.id, { pageSize: 1 }),
  ]);

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

  // Persisted so admin lists can filter on readiness without recomputing it.
  if (readiness.readiness !== affiliate.payoutReadiness) {
    await syncReadiness(affiliate.id, readiness.readiness);
  }

  return (
    <>
      <PortalHeader
        title="Affiliate Settings"
        description="Manage your account, payments and preferences."
      />

      <AffiliateSettingsView
        affiliate={affiliate}
        section={section}
        readinessChecks={readiness.checks}
        totals={{
          referrals: referrals.total,
          lifetimeMinor: balances.lifetimeMinor,
          nextPayoutMinor: balances.availableMinor,
        }}
        justConnected={justConnected}
      />
    </>
  );
}
