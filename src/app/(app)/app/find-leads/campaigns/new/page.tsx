import * as React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAzureConfigured } from "@/lib/ai/azure-client";
import { EmptyState, PlanLimitState } from "@/components/ui/feedback";
import {
  createDraft,
  findResumableDraft,
  loadDraft,
} from "@/lib/outreach/campaigns/draft";
import { estimateAudience, loadIntentInsights, loadWizardOptions } from "@/lib/outreach/campaigns/audience";
import { resolveCampaignBudgetContext } from "@/lib/outreach/campaigns/budget";
import { loadSenderHealth } from "@/lib/outreach/campaigns/sender";
import { emptyDraft, type WizardStepKey } from "@/lib/outreach/campaign-draft";
import { CampaignWizard } from "@/components/find-leads/campaigns/wizard/campaign-wizard";

export const metadata: Metadata = { title: "New acquisition campaign · ClientTurn" };
export const dynamic = "force-dynamic";

/** Identical on all six steps, per the wizard design. */
function WizardHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div>
      <Link
        href="/app/find-leads?view=campaigns"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to Campaigns
      </Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight text-content">
        New Acquisition Campaign
      </h1>
      <p className="mt-1 text-[14px] text-content-muted">
        {subtitle ??
          "Create a targeted outreach campaign to engage high-potential prospects and drive real results."}
      </p>
    </div>
  );
}

/**
 * `/app/find-leads/campaigns/new`
 *
 * A draft is a real DRAFT campaign row, so the wizard needs an id before it can
 * save anything. The page resolves one and redirects to `?draft=<id>` rather
 * than creating it inside the render that also reads it back — a read after a
 * write in the same render returns the pre-write state.
 */
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, workspace] = await Promise.all([searchParams, requireWorkspace()]);
  const entitlements = await getV4Entitlements(workspace.businessId);
  const canManage = hasRole(workspace.role, "admin");

  // Hiding the destination is a courtesy; this is the enforcement.
  if (!entitlements.coldEmailEnabled) {
    return (
      <div className="space-y-5">
        <WizardHeader />
        <PlanLimitState
          title="Cold email campaigns are not included on your plan"
          description="Acquisition campaigns are available on Starter and above. Your existing leads, follow-up and reactivation are unaffected."
          action={
            <Link
              href="/app/settings?view=billing"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              See plans
            </Link>
          }
        />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-5">
        <WizardHeader />
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={Lock}
            title="You do not have permission to create campaigns"
            description="Only owners and admins can create or launch an acquisition campaign. Ask an owner for admin access, or view results on the Campaigns list."
            action={
              <Link
                href="/app/find-leads?view=campaigns"
                className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Back to Campaigns
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const requestedDraft = Array.isArray(params.draft) ? params.draft[0] : params.draft;
  const requestedStep = Array.isArray(params.step) ? params.step[0] : params.step;

  if (!requestedDraft) {
    // Resume what this person left unfinished rather than silently abandoning
    // it and starting again.
    const resumable = await findResumableDraft(workspace.businessId, workspace.userId);
    const draftId = resumable?.id ?? (await createDraft({
      businessId: workspace.businessId,
      userId: workspace.userId,
    }))?.id;

    if (!draftId) {
      return (
        <div className="space-y-5">
          <WizardHeader />
          <PlanLimitState
            title="That campaign could not be created"
            description="Something went wrong setting up a new draft. Try again, and if it keeps happening let us know."
          />
        </div>
      );
    }

    const step = resumable?.step ?? "goal";
    redirect(`/app/find-leads/campaigns/new?draft=${draftId}&step=${step}`);
  }

  const loaded = await loadDraft(workspace.businessId, requestedDraft);

  // A launched campaign is no longer a draft. Send the reader to the campaign
  // rather than letting the wizard edit something that is already sending.
  if (loaded && loaded.meta.status !== "DRAFT") {
    redirect(`/app/find-leads/campaigns/${requestedDraft}`);
  }

  if (!loaded) {
    return (
      <div className="space-y-5">
        <WizardHeader />
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={Lock}
            title="That draft could not be found"
            description="It may have been launched, deleted, or belongs to another workspace."
            action={
              <Link
                href="/app/find-leads/campaigns/new"
                className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Start a new campaign
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const draft = loaded.draft ?? emptyDraft();

  // Nothing below depends on anything else, so the page never waterfalls.
  const [options, senders, budgetContext, estimate, aiEnabled] = await Promise.all([
    loadWizardOptions(workspace.businessId),
    loadSenderHealth(workspace.businessId),
    resolveCampaignBudgetContext({
      businessId: workspace.businessId,
      senderIdentityId: draft.outreach.senderIdentityId,
      excludeCampaignId: requestedDraft,
    }),
    estimateAudience(workspace.businessId, draft),
    aiAssistEnabled(workspace.businessId),
  ]);

  const insights = await loadIntentInsights(
    workspace.businessId,
    draft.intentScore.intentCategoryIds,
    draft.intentScore.maxIntentAgeDays,
  );

  const isReview = requestedStep === "review";

  return (
    <div className="space-y-5">
      <WizardHeader
        subtitle={
          isReview
            ? "Review your campaign settings and launch when you're ready."
            : undefined
        }
      />
      <CampaignWizard
        campaignId={requestedDraft}
        initialDraft={draft}
        initialStep={(loaded.meta.step ?? "goal") as WizardStepKey}
        options={options}
        senders={senders}
        budgetContext={budgetContext}
        initialEstimate={estimate}
        initialInsights={insights}
        aiAvailable={isAzureConfigured() && aiEnabled}
      />
    </div>
  );
}

/** The per-workspace assist toggle, read from the column Settings writes. */
async function aiAssistEnabled(businessId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_settings")
    .select("ai_assist_enabled")
    .eq("business_id", businessId)
    .maybeSingle();

  return Boolean(data?.ai_assist_enabled);
}
