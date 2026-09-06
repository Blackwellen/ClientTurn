import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { SCORE_VERSION } from "@/lib/prospects/scoring";
import {
  defaultOptimizationConfig,
  validateAll,
  type CampaignDraft,
  type WizardStepKey,
} from "../campaign-draft";
import { assertTransition, CampaignTransitionError } from "../campaign-state";
import type { LaunchCheck } from "../campaign-validation";
import type { CampaignStatus } from "../types";
import { reserveCampaignBudget } from "./budget";
import { loadDraft } from "./draft";
import { validateForLaunch } from "./validation";
import { recordCampaignEvent } from "./lifecycle";

/**
 * The launch transaction (V4 section 17.8).
 *
 * Ordered so that nothing irreversible happens before everything reversible
 * has succeeded: validate, reserve, freeze, transition, then queue. The queue
 * is last because a job that finds a campaign it cannot send from is harmless,
 * whereas a campaign marked ACTIVE with no reserved budget is not.
 *
 * No provider is called from inside this path. The audience is materialised by
 * a background job, so the request never holds a transaction open across a
 * network call to somebody else's API.
 */

export type LaunchResult =
  | { ok: true; campaignId: string; status: CampaignStatus }
  | { ok: false; error: string; checks?: LaunchCheck[]; step?: WizardStepKey };

export async function launchCampaign(input: {
  businessId: string;
  campaignId: string;
  userId: string;
  /** What the customer chose on the last screen, re-checked here. */
  startMode: "MANUAL_REVIEW" | "IMMEDIATE";
  country?: string | null;
}): Promise<LaunchResult> {
  const admin = createAdminClient();

  const loaded = await loadDraft(input.businessId, input.campaignId);
  if (!loaded) return { ok: false, error: "That campaign could not be found." };

  const target: CampaignStatus = input.startMode === "IMMEDIATE" ? "ACTIVE" : "READY";

  try {
    assertTransition(loaded.meta.status, target);
  } catch (error) {
    if (error instanceof CampaignTransitionError) return { ok: false, error: error.message };
    throw error;
  }

  // Step-by-step validation is re-run server-side. Reaching step 6 in the
  // browser proves nothing about what is stored.
  const validation = await validateForLaunch({
    businessId: input.businessId,
    draft: loaded.draft,
    campaignId: input.campaignId,
    country: input.country ?? null,
  });

  const stepErrors = validateAll(loaded.draft, validation.facts.ceilings);
  const incomplete = (Object.keys(stepErrors) as WizardStepKey[]).find(
    (key) => Object.keys(stepErrors[key]).length > 0,
  );
  if (incomplete) {
    return {
      ok: false,
      error: Object.values(stepErrors[incomplete])[0] ?? "This campaign is not complete yet.",
      step: incomplete,
      checks: validation.checks,
    };
  }

  if (validation.blocked) {
    const blocking = validation.checks.find((check) => check.state === "BLOCK");
    return {
      ok: false,
      error: blocking ? `${blocking.label}: ${blocking.detail}` : "Launch checks failed.",
      checks: validation.checks,
    };
  }

  // Reserve before transitioning. A campaign that goes ACTIVE and then fails to
  // reserve would be sending against a budget nobody agreed to.
  const reserved = await reserveCampaignBudget({
    businessId: input.businessId,
    campaignId: input.campaignId,
    providerCostCeilingMinor: loaded.draft.budget.providerCostCeilingMinor,
    communicationAllowance: loaded.draft.budget.communicationAllowance,
  });
  if (!reserved.ok) return { ok: false, error: reserved.error, checks: validation.checks };

  const sequenceId = await publishSequence(input.businessId, input.campaignId);
  if (!sequenceId) {
    return { ok: false, error: "The email sequence could not be published." };
  }

  const now = new Date().toISOString();
  const version = await snapshotVersion({
    businessId: input.businessId,
    campaignId: input.campaignId,
    draft: loaded.draft,
    userId: input.userId,
    policyVersion: validation.facts.policyPackVersion,
  });

  const { data: updated } = await admin
    .from("outreach_campaigns")
    .update({
      status: target,
      active_sequence_id: sequenceId,
      launch_mode: input.startMode,
      review_before_outreach: input.startMode === "MANUAL_REVIEW",
      launch_validated_at: now,
      launched_by: input.userId,
      launched_at: target === "ACTIVE" ? now : null,
      // Frozen so a later change to the scoring policy or the compliance pack
      // does not make this campaign's historical decisions unexplainable.
      scoring_policy_version: SCORE_VERSION,
      compliance_policy_version: validation.facts.policyPackVersion,
      auto_optimize_config: loaded.draft.budget.autoOptimize
        ? {
            ...defaultOptimizationConfig(loaded.draft.intentScore.minimumGrade),
            enabled: true,
          }
        : defaultOptimizationConfig(loaded.draft.intentScore.minimumGrade),
      draft_step: null,
      pause_reason: null,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .eq("status", "DRAFT")
    .select("id");

  if (!updated?.length) {
    // Another request got there first. Reporting success would be a lie about
    // which configuration is live.
    return { ok: false, error: "This campaign was changed elsewhere. Reload and try again." };
  }

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: target === "ACTIVE" ? "ACTIVATED" : "READY",
    fromStatus: "DRAFT",
    toStatus: target,
    actorUserId: input.userId,
    summary:
      target === "ACTIVE"
        ? "Campaign launched and activated."
        : "Campaign launched and is awaiting manual activation.",
    metadata: { version, checks: validation.checks.map((c) => `${c.key}:${c.state}`) },
  });

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "outreach_campaign.launched",
    entityType: "outreach_campaign",
    entityId: input.campaignId,
    metadata: {
      status: target,
      version,
      minimumGrade: loaded.draft.intentScore.minimumGrade,
      dailyContacts: loaded.draft.budget.dailyContacts,
    },
  });

  // Audience selection always runs: even a READY campaign should show the
  // customer who it would contact before they activate it.
  await enqueue(
    "outreach.audience",
    { businessId: input.businessId, campaignId: input.campaignId },
    {
      businessId: input.businessId,
      idempotencyKey: `outreach.audience:${input.campaignId}:${version}`,
    },
  );

  if (target === "ACTIVE" && input.startMode === "IMMEDIATE") {
    await enqueue(
      "outreach.dispatch",
      { campaignId: input.campaignId, businessId: input.businessId },
      {
        businessId: input.businessId,
        idempotencyKey: `outreach.dispatch:launch:${input.campaignId}:${version}`,
      },
    );
  }

  return { ok: true, campaignId: input.campaignId, status: target };
}

/**
 * Promotes the draft sequence to PUBLISHED and retires the previous one.
 *
 * Retiring rather than deleting: messages already sent point at their step
 * rows, and a foreign key that dangles is a conversation that can no longer
 * explain what was said.
 */
async function publishSequence(
  businessId: string,
  campaignId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: sequences } = await admin
    .from("outreach_sequences")
    .select("id, status, version")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false });

  const draft = (sequences ?? []).find((row) => row.status === "DRAFT");
  if (!draft) {
    // Already published and unchanged since: reuse it rather than failing.
    return (sequences ?? []).find((row) => row.status === "PUBLISHED")?.id ?? null;
  }

  const { data: steps } = await admin
    .from("outreach_steps")
    .select("id")
    .eq("business_id", businessId)
    .eq("sequence_id", draft.id)
    .eq("enabled", true)
    .limit(1);

  if (!steps?.length) return null;

  await admin
    .from("outreach_sequences")
    .update({ status: "ARCHIVED" })
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .eq("status", "PUBLISHED");

  await admin
    .from("outreach_sequences")
    .update({ status: "PUBLISHED", published_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("id", draft.id);

  return draft.id;
}

/**
 * Freezes the configuration this launch is running under.
 *
 * Without this, a campaign edited three weeks later would make its own first
 * fortnight of reporting unreadable — the numbers would be attributed to
 * settings that were never in force when they were produced.
 */
async function snapshotVersion(input: {
  businessId: string;
  campaignId: string;
  draft: CampaignDraft;
  userId: string;
  policyVersion: string | null;
}): Promise<number> {
  const admin = createAdminClient();

  const { data: latest } = await admin
    .from("outreach_campaign_versions")
    .select("version")
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (latest?.version ?? 0) + 1;

  await admin.from("outreach_campaign_versions").insert({
    business_id: input.businessId,
    campaign_id: input.campaignId,
    version,
    snapshot_json: {
      goal: input.draft.goal,
      audience: input.draft.audience,
      intentScore: input.draft.intentScore,
      outreach: input.draft.outreach,
      budget: input.draft.budget,
      scoringPolicyVersion: SCORE_VERSION,
      compliancePolicyVersion: input.policyVersion,
      frozenAt: new Date().toISOString(),
    },
    changed_by: "USER",
    changed_by_user_id: input.userId,
    change_summary: "Launch configuration frozen",
  });

  return version;
}

/** The frozen configuration a campaign is currently running under. */
export async function loadLaunchedVersion(
  businessId: string,
  campaignId: string,
): Promise<{ version: number; snapshot: Record<string, unknown> } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("outreach_campaign_versions")
    .select("version, snapshot_json")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    version: data.version,
    snapshot: (data.snapshot_json ?? {}) as Record<string, unknown>,
  };
}
