import * as React from "react";
import type { Metadata } from "next";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { loadLiveEconomics, loadOpenMarginAlerts } from "@/lib/admin/economics-live";
import { EconomicsView } from "@/components/admin/economics/economics-view";

export const metadata: Metadata = {
  title: "Economics · Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  period: z.enum(["mtd", "last"]).default("mtd").catch("mtd"),
});

/**
 * Admin → Economics. Loading: `loading.tsx`. Error: the (ops) error boundary.
 * Permission denied: a non-operator is sent to /admin/login by the guard, so
 * the page never confirms it exists (CLAUDE.md, admin login). Empty and
 * "read model not installed" are rendered by the view.
 */
export default async function EconomicsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout already guards, but this page reads raw provider cost, so it
  // asserts the operator role itself rather than inheriting the assumption.
  await requirePlatformAdmin();

  const raw = await searchParams;
  const { period } = paramsSchema.parse({
    period: Array.isArray(raw.period) ? raw.period[0] : raw.period,
  });

  const [data, alerts] = await Promise.all([loadLiveEconomics(), loadOpenMarginAlerts()]);

  return <EconomicsView data={data} periodKey={period} alerts={alerts} />;
}
