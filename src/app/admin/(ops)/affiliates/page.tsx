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
  const data = await loadAdminAffiliates(tab);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Affiliates"
        description="Partner applications, referrals, commission and payouts."
      />
      <AffiliatesView data={data} />
    </div>
  );
}
