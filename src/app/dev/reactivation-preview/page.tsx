import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { primaryNavFor } from "@/lib/app/nav";
import { ToastProvider } from "@/components/ui/toast";
import { ReactivationView } from "@/components/reactivation/reactivation-view";
import {
  applyReactivationFilters,
  parseReactivationFilters,
} from "@/lib/campaigns/reactivation-filters";
import {
  fixtureDetail,
  fixtureRows,
  fixtureSummary,
} from "@/lib/campaigns/reactivation-fixtures";

export const metadata: Metadata = { title: "Reactivation preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for `/app/reactivation`.
 *
 * It renders the real `ReactivationView` inside the real `AppShell` with the
 * reference campaign set, so the three design states can be checked without a
 * Supabase session or seeded workspace:
 *
 *   /dev/reactivation-preview?view=cards
 *   /dev/reactivation-preview?view=list
 *   /dev/reactivation-preview?view=cards&campaign=autumn-roof-check
 *
 * It 404s outside development and is never linked from the product.
 */
export default async function ReactivationPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const filters = parseReactivationFilters(params);
  const campaignId = Array.isArray(params.campaign)
    ? params.campaign[0]
    : params.campaign;

  const rows = fixtureRows();
  const page = applyReactivationFilters(rows, filters);
  const detail = campaignId ? fixtureDetail(campaignId) : null;

  return (
    <ToastProvider>
      <AppShell
        businessName="Blackwellen Roofing & Exteriors"
        planLabel="Enterprise"
        plan="enterprise"
        canManageBilling={false}
        primaryNav={primaryNavFor({ sourcing: true, analytics: true }).map(item => item.href)}
        integrationStatus="DISCONNECTED"
        notifications={[]}
        user={{ name: "Jamahl Thomas", email: "jt@blackwellen.co.uk" }}
      >
        <ReactivationView
          summary={fixtureSummary()}
          campaigns={page.rows}
          total={page.total}
          page={page.page}
          pageSize={page.pageSize}
          filters={filters}
          audiences={[...new Set(rows.map((row) => row.audienceLabel))].sort()}
          tags={[...new Set(rows.flatMap((row) => row.tags))].sort()}
          detail={detail}
          canManage
          enabled
        />
      </AppShell>
    </ToastProvider>
  );
}
