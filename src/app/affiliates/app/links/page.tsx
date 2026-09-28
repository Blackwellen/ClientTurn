import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAffiliateAccount } from "@/lib/affiliates/portal";
import { getDailySeries, getLinkMetrics, getOverview } from "@/lib/affiliates/analytics";
import { PortalHeader } from "@/components/affiliates/portal-ui";
import { LinksView } from "@/components/affiliates/links/links-view";
import { siteOrigin } from "@/lib/affiliates/origin";

export const metadata: Metadata = { title: "Affiliate Links" };
export const dynamic = "force-dynamic";

/**
 * The links page (V4 §31).
 *
 * Only reachable by an ACTIVE partner: a suspended or pending account must not
 * be able to put new links into circulation, and the guard is here rather than
 * only in the rail because a URL typed directly is not filtered by navigation.
 */
export default async function AffiliateLinksPage() {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const [links, overview, series, origin] = await Promise.all([
    getLinkMetrics(affiliate.id, "30d"),
    getOverview(affiliate.id, "30d", affiliate.joinedAt),
    getDailySeries(affiliate.id, "30d"),
    siteOrigin(),
  ]);

  return (
    <>
      <PortalHeader
        title="Affiliate Links"
        description="Create, organise and track referral links and campaign URLs."
      />

      <LinksView
        affiliateCode={affiliate.code}
        origin={origin}
        links={links}
        clickSeries={series.map((point) => point.clicks)}
        monthly={{
          clicks: overview.current.clicks,
          signups: overview.current.signups,
          conversionRate: overview.current.conversionRate,
        }}
      />
    </>
  );
}
