import * as React from "react";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { currentPeriod, loadEconomics } from "@/lib/admin/economics";
import { EconomicsView } from "@/components/admin/economics/economics-view";

export const metadata: Metadata = {
  title: "Usage & Margins · Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PERIOD_PATTERN = /^\d{4}-\d{2}-01$/;

export default async function EconomicsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  // The layout already guards, but this page reads raw provider cost, so it
  // asserts the operator role itself rather than inheriting the assumption.
  await requirePlatformAdmin();

  const params = await searchParams;
  const period =
    params.period && PERIOD_PATTERN.test(params.period) ? params.period : currentPeriod();

  const data = await loadEconomics(period);

  return <EconomicsView data={data} />;
}
