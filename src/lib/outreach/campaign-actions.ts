"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import {
  campaignDraftSchema,
  optimizationConfigSchema,
  parseDraft,
  WIZARD_STEP_KEYS,
  type CampaignDraft,
  type WizardStepKey,
} from "./campaign-draft";
import type { LaunchCheck } from "./campaign-validation";
import { CAMPAIGN_PRIORITIES, type CampaignPriority } from "./types";
import { createDraft, loadDraft, saveDraft } from "./campaigns/draft";
import { estimateAudience, type AudienceEstimate } from "./campaigns/audience";
import { launchCampaign } from "./campaigns/launch";
import {
  duplicateCampaign,
  setArchived,
  setPriority,
  transition,
} from "./campaigns/lifecycle";
import { saveOptimizationConfig } from "./campaigns/optimization";
import { validateForLaunch } from "./campaigns/validation";
import { generateVariants, type VariantProposal } from "./campaigns/variants";

/**
 * Server actions for the acquisition campaign wizard and Campaign Detail.
 *
 * Every one of them re-establishes who is asking and which workspace they are
 * in. `businessId` is never accepted from the browser — a campaign id plus the
 * caller's own workspace is the only addressing these actions understand, so a
 * crafted request cannot reach across tenants.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function refresh(campaignId?: string) {
  revalidatePath("/app/find-leads");
  if (campaignId) revalidatePath(`/app/find-leads/campaigns/${campaignId}`);
}

/**
 * Admin, plus the cold-email capability.
 *
 * A plan can include finding prospects without including emailing them, so the
 * two are separate checks rather than one.
 */
async function requireCampaignAdmin(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return fail("Only owners and admins can manage acquisition campaigns.");
  }
  try {
    await assertCapability(workspace.businessId, "cold_email");
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Cold email campaigns are unavailable right now.");
  }
  return { ok: true, workspace };
}

/* ------------------------------------------------------------------ draft */

export async function createCampaignDraftAction(): Promise<ActionResult<{ id: string }>> {
  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const created = await createDraft({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
  });

  if (!created) return fail("That campaign could not be created.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "outreach_campaign.created",
    entityType: "outreach_campaign",
    entityId: created.id,
    metadata: { status: "DRAFT" },
  });

  return ok({ id: created.id });
}

const saveSchema = z.object({
  campaignId: z.uuid(),
  step: z.enum(WIZARD_STEP_KEYS as [WizardStepKey, ...WizardStepKey[]]),
  draft: campaignDraftSchema,
});

/**
 * Autosave.
 *
 * Accepts the whole draft rather than a patch: the wizard holds one object and
 * a partial write is how a campaign ends up with step 4's messages beside step
 * 2's audience from a different edit.
 */
export async function saveCampaignDraftAction(
  input: unknown,
): Promise<ActionResult<{ savedAt: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Some of those settings are not valid, so nothing was saved.");
  }

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await saveDraft({
    businessId: access.workspace.businessId,
    campaignId: parsed.data.campaignId,
    draft: parsed.data.draft,
    step: parsed.data.step,
  });

  if (!result.ok) return fail(result.error);
  return ok({ savedAt: result.savedAt });
}

/* --------------------------------------------------------------- estimate */

const estimateSchema = z.object({
  campaignId: z.uuid().nullable(),
  draft: campaignDraftSchema,
});

/**
 * The audience preview.
 *
 * Counts the workspace's own prospects; no provider is called, because
 * estimating must never cost money. Debounced by the caller — this is the
 * expensive part of typing in step 2.
 */
export async function estimateAudienceAction(
  input: unknown,
): Promise<ActionResult<AudienceEstimate>> {
  const parsed = estimateSchema.safeParse(input);
  if (!parsed.success) return fail("Unable to estimate audience right now.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const estimate = await estimateAudience(access.workspace.businessId, parsed.data.draft);
  return ok(estimate);
}

/* ------------------------------------------------------------ validation */

export type LaunchPreview = { checks: LaunchCheck[]; blocked: boolean };

export async function validateCampaignAction(
  campaignId: unknown,
): Promise<ActionResult<LaunchPreview>> {
  const id = z.uuid().safeParse(campaignId);
  if (!id.success) return fail("That campaign could not be found.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const loaded = await loadDraft(access.workspace.businessId, id.data);
  if (!loaded) return fail("That campaign could not be found.");

  const validation = await validateForLaunch({
    businessId: access.workspace.businessId,
    draft: loaded.draft,
    campaignId: id.data,
  });

  return ok({ checks: validation.checks, blocked: validation.blocked });
}

/* ---------------------------------------------------------------- launch */

const launchSchema = z.object({
  campaignId: z.uuid(),
  startMode: z.enum(["MANUAL_REVIEW", "IMMEDIATE"]),
});

export async function launchAcquisitionCampaignAction(
  input: unknown,
): Promise<
  ActionResult<{ campaignId: string; status: string }> & { checks?: LaunchCheck[] }
> {
  const parsed = launchSchema.safeParse(input);
  if (!parsed.success) return fail("That campaign could not be launched.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await launchCampaign({
    businessId: access.workspace.businessId,
    campaignId: parsed.data.campaignId,
    userId: access.workspace.userId,
    startMode: parsed.data.startMode,
  });

  if (!result.ok) {
    return { ...fail(result.error), checks: result.checks };
  }

  refresh(parsed.data.campaignId);
  return ok({ campaignId: result.campaignId, status: result.status });
}

/* ------------------------------------------------------------- lifecycle */

const statusSchema = z.object({
  campaignId: z.uuid(),
  status: z.enum(["ACTIVE", "PAUSED", "STOPPED", "COMPLETED"]),
});

export async function setCampaignStateAction(input: unknown): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("That campaign could not be updated.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await transition({
    businessId: access.workspace.businessId,
    campaignId: parsed.data.campaignId,
    to: parsed.data.status,
    actorUserId: access.workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  refresh(parsed.data.campaignId);
  return ok(undefined);
}

const prioritySchema = z.object({
  campaignId: z.uuid(),
  priority: z.enum(
    CAMPAIGN_PRIORITIES.map((p) => p.value) as [CampaignPriority, ...CampaignPriority[]],
  ),
});

export async function setCampaignPriorityAction(input: unknown): Promise<ActionResult> {
  const parsed = prioritySchema.safeParse(input);
  if (!parsed.success) return fail("That priority could not be set.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await setPriority({
    businessId: access.workspace.businessId,
    campaignId: parsed.data.campaignId,
    priority: parsed.data.priority,
    actorUserId: access.workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  refresh(parsed.data.campaignId);
  return ok(undefined);
}

export async function duplicateCampaignAction(
  campaignId: unknown,
): Promise<ActionResult<{ id: string }>> {
  const id = z.uuid().safeParse(campaignId);
  if (!id.success) return fail("That campaign could not be duplicated.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await duplicateCampaign({
    businessId: access.workspace.businessId,
    campaignId: id.data,
    userId: access.workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  refresh();
  return ok({ id: result.id });
}

const archiveSchema = z.object({ campaignId: z.uuid(), archived: z.boolean() });

export async function archiveCampaignAction(input: unknown): Promise<ActionResult> {
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return fail("That campaign could not be archived.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await setArchived({
    businessId: access.workspace.businessId,
    campaignId: parsed.data.campaignId,
    archived: parsed.data.archived,
    userId: access.workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  refresh(parsed.data.campaignId);
  return ok(undefined);
}

/* ---------------------------------------------------------- optimisation */

const optimizeSchema = z.object({
  campaignId: z.uuid(),
  config: optimizationConfigSchema,
});

export async function saveOptimizationConfigAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = optimizeSchema.safeParse(input);
  if (!parsed.success) return fail("Those optimisation settings are not valid.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const result = await saveOptimizationConfig({
    businessId: access.workspace.businessId,
    campaignId: parsed.data.campaignId,
    config: parsed.data.config,
    userId: access.workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  refresh(parsed.data.campaignId);
  return ok(undefined);
}

/* --------------------------------------------------------------- audience */

/** Re-runs audience selection, for the Audience tab's refresh control. */
export async function rebuildCampaignAudienceAction(
  campaignId: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(campaignId);
  if (!id.success) return fail("That campaign could not be found.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  await enqueue(
    "outreach.audience",
    { businessId: access.workspace.businessId, campaignId: id.data },
    {
      businessId: access.workspace.businessId,
      idempotencyKey: `outreach.audience:manual:${id.data}:${Date.now()}`,
    },
  );

  return ok(undefined);
}

/* --------------------------------------------------------------- variants */

const variantSchema = z.object({
  campaignId: z.uuid(),
  stepPosition: z.number().int().min(1).max(5),
  count: z.number().int().min(1).max(3),
});

/**
 * Proposes message variants.
 *
 * Proposals only. Nothing generated here is stored or sent until a person puts
 * it into the sequence and the campaign is launched — the model contributes
 * wording, never a decision to contact anybody.
 */
export async function generateVariantsAction(
  input: unknown,
): Promise<ActionResult<{ variants: VariantProposal[] }>> {
  const parsed = variantSchema.safeParse(input);
  if (!parsed.success) return fail("Those variants could not be generated.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const loaded = await loadDraft(access.workspace.businessId, parsed.data.campaignId);
  if (!loaded) return fail("That campaign could not be found.");

  const step = loaded.draft.outreach.steps.find(
    (candidate) => candidate.position === parsed.data.stepPosition,
  );
  if (!step) return fail("That step could not be found.");

  const result = await generateVariants({
    businessId: access.workspace.businessId,
    draft: loaded.draft,
    step,
    count: parsed.data.count,
  });

  if (!result.ok) return fail(result.error);
  return ok({ variants: result.variants });
}

/* ------------------------------------------------------------------ read */

/** Reads a draft back, for the wizard's initial hydration and for Edit. */
export async function loadCampaignDraftAction(
  campaignId: unknown,
): Promise<ActionResult<{ draft: CampaignDraft; step: WizardStepKey | null }>> {
  const id = z.uuid().safeParse(campaignId);
  if (!id.success) return fail("That campaign could not be found.");

  const access = await requireCampaignAdmin();
  if (!access.ok) return access;

  const loaded = await loadDraft(access.workspace.businessId, id.data);
  if (!loaded) return fail("That campaign could not be found.");

  return ok({ draft: parseDraft(loaded.draft), step: loaded.meta.step });
}
