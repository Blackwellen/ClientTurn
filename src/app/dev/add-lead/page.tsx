import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DevShell } from "@/components/dev/dev-shell";
import { AddLeadHarness } from "@/components/leads/add-lead/dev-harness";

export const metadata: Metadata = { title: "Add Lead wizard preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for the four Add Lead steps.
 *
 * The live wizard cannot reach Steps 3 and 4 without a database, because the
 * contactability assessment is resolved on the server. This renders the same
 * step components against fixed data so each layout can be checked:
 *
 *   /dev/add-lead?step=1 … ?step=4
 *
 * It 404s outside development and is never linked from the product.
 */
export default async function AddLeadPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const raw = params.step;
  const step = Number(Array.isArray(raw) ? raw[0] : (raw ?? "1"));

  return (
    <DevShell>
      <AddLeadHarness step={Number.isFinite(step) ? step : 1} />
    </DevShell>
  );
}
