import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { getSession } from "@/lib/find-leads/server/sessions";
import { resolveBudget } from "@/lib/find-leads/server/budget";
import { SearchSessionView } from "@/components/find-leads/search/search-session-view";
import { PlanLimitState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Search session · ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * A search session.
 *
 * The session id comes from the URL and proves nothing: `getSession` is scoped
 * by the authenticated workspace, so a session belonging to another tenant is
 * indistinguishable from one that does not exist. That is the intended
 * behaviour — a 404 leaks less than a 403.
 */
export default async function SearchSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const [{ sessionId }, workspace] = await Promise.all([params, requireWorkspace()]);

  const entitlements = await getV4Entitlements(workspace.businessId);

  // Plan gating is enforced here, not only by hiding the nav entry.
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

  const session = await getSession(workspace.businessId, sessionId);
  if (!session) notFound();

  const verdict = await resolveBudget({
    businessId: workspace.businessId,
    requestedTarget: session.plan.targetVerifiedProspects,
    requestedCostCapMinor: session.plan.maxProviderCostMinor,
    intentEnabled: session.plan.intent.categories.length > 0,
  });

  return (
    <SearchSessionView
      session={session}
      canManage={hasRole(workspace.role, "admin")}
      initialBudget={{
        maxTarget: verdict.maxTarget,
        maxProviderCostMinor: verdict.maxProviderCostMinor,
        allowed: verdict.allowed,
        reason: verdict.reason,
      }}
    />
  );
}
