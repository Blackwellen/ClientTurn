import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { getProspectScoring } from "@/lib/prospects/queries";
import { ExplainableScoring } from "@/components/find-leads/scoring/explainable-scoring";
import { PageHeader } from "@/components/app/page-header";
import { PlanLimitState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Prospect scoring · ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * Explainable Prospect Scoring (V4 §14).
 *
 * A route rather than a drawer view: the breakdown is something people link to,
 * quote in a conversation about why a prospect was or was not contacted, and
 * come back to. That is a page.
 *
 * The workspace comes from the session, never from the URL — the prospect id is
 * looked up *within* it, so a valid id from another tenant resolves to nothing
 * rather than to a "forbidden" that confirms the record exists.
 */
export default async function ProspectScoringPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  const [{ prospectId }, workspace] = await Promise.all([params, requireWorkspace()]);

  const entitlements = await getV4Entitlements(workspace.businessId);

  // Hiding the link is a courtesy; this is the enforcement. A direct URL on a
  // plan without sourcing has to be refused here.
  if (!entitlements.sourcingEnabled) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Explainable Prospect Scoring"
          description="See how prospect scores are calculated and what's driving the recommendation."
          size="lg"
        />
        <PlanLimitState
          title="Find Leads is not included on your plan"
          description="Prospect scoring is available on Starter and above."
          action={
            <a
              href="/app/settings?view=billing"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              See plans
            </a>
          }
        />
      </div>
    );
  }

  const detail = await getProspectScoring(workspace.businessId, prospectId);
  if (!detail) notFound();

  return <ExplainableScoring detail={detail} />;
}
