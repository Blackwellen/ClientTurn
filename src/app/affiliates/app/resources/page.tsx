import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bookmark, CalendarPlus, Layers, LayoutGrid } from "lucide-react";
import { getAffiliateAccount, getResourceHub } from "@/lib/affiliates/portal";
import { KpiCard, PortalHeader } from "@/components/affiliates/portal-ui";
import { ResourcesView } from "@/components/affiliates/resources/resources-view";

export const metadata: Metadata = { title: "Resources Hub | ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * The resources hub (V4 §33).
 *
 * The counts are of what this partner can actually see — published rows only —
 * so the header never advertises assets that are still in draft.
 */
export default async function AffiliateResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string }>;
}) {
  const affiliate = await getAffiliateAccount();
  if (!affiliate) return null;
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const [hub, params] = await Promise.all([
    getResourceHub(affiliate.id),
    searchParams,
  ]);

  return (
    <>
      <PortalHeader
        title="Resources Hub"
        description="Your brand and sales enablement hub. Access marketing assets, copy, screenshots and campaign packs to grow your referrals."
      />

      <div className="mb-3 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <KpiCard
          icon={LayoutGrid}
          label="Total assets"
          value={hub.counts.total.toLocaleString("en-GB")}
        />
        <KpiCard
          icon={Layers}
          label="Featured campaign packs"
          value={hub.counts.packs.toLocaleString("en-GB")}
        />
        <KpiCard
          icon={CalendarPlus}
          label="Updated this month"
          value={hub.counts.updatedThisMonth.toLocaleString("en-GB")}
        />
        <KpiCard
          icon={Bookmark}
          label="Saved resources"
          value={hub.counts.saved.toLocaleString("en-GB")}
        />
      </div>

      <ResourcesView
        resources={hub.resources}
        initialResourceId={params.resource}
      />
    </>
  );
}
