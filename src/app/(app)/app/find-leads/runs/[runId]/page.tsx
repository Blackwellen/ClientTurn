import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { getRun } from "@/lib/find-leads/server/runs";
import { SourcingRunView } from "@/components/find-leads/runs/sourcing-run-view";
import { PlanLimitState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Sourcing run · ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * A sourcing run.
 *
 * Rendered server-side with the run's current state, then kept live by the
 * client view polling `/api/find-leads/runs/[runId]`. First paint is complete
 * and correct rather than a skeleton that fills in — a customer opening a run
 * they just started should see it, not a spinner.
 */
export default async function SourcingRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const [{ runId }, workspace] = await Promise.all([params, requireWorkspace()]);

  const entitlements = await getV4Entitlements(workspace.businessId);

  if (!entitlements.sourcingEnabled) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Find Leads"
          description="Discover businesses that fit what you sell, then reach the ones you approve."
          size="lg"
        />
        <PlanLimitState
          title="Find Leads is not included on your plan"
          description="Sourcing new prospects is available on Starter and above."
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

  const run = await getRun(workspace.businessId, runId, {
    canManage: hasRole(workspace.role, "admin"),
  });

  if (!run) notFound();

  return <SourcingRunView initialRun={run} />;
}
