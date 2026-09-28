import * as React from "react";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { loadAdminAffiliates } from "@/lib/admin/affiliates";
import { parseTab } from "@/lib/admin/affiliates-types";
import { AffiliatesView } from "@/components/admin/affiliates/affiliates-view";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = {
  title: "Affiliates · Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminAffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards too, but this page reads partner earnings and the names
  // of referred businesses, so it asserts the operator role itself.
  await requirePlatformAdmin();

  const raw = await searchParams;
  const tab = parseTab(Array.isArray(raw.tab) ? raw.tab[0] : raw.tab);
  const detailRaw = Array.isArray(raw.affiliate) ? raw.affiliate[0] : raw.affiliate;
  // A uuid or nothing: the id reaches a service-role query.
  const detailId = detailRaw && /^[0-9a-f-]{36}$/i.test(detailRaw) ? detailRaw : null;
  const data = await loadAdminAffiliates(tab, detailId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Affiliates"
        description="Partner applications, referrals, commission, fraud review, tiers and payouts."
      />
      <AffiliatesView data={data} />
    </div>
  );
}
