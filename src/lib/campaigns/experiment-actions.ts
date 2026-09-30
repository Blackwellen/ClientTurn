"use server";

import { randomUUID } from "node:crypto";
import { friendlyIssue } from "@/lib/validation/friendly-issue";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";

/**
 * Reactivation A/B tests from the campaign drawer. Every write is the registry
 * operation the API and MCP use (`experiment.create/start/stop`): same role
 * check, same validation (a control, 2-4 variants, a holdout of at most 50%,
 * at least 100 leads per arm before any verdict), same audit. Nothing here, or
 * anywhere, applies a winning variant automatically.
 */

export type ExperimentActionResult = { ok: true } | { ok: false; error: string };

async function admin(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

function context(workspace: ActiveWorkspace) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    correlationId: randomUUID(),
  };
}

const createSchema = z.object({
  campaignId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  variantBody: z.string().trim().min(1, "Write the variant message.").max(2000),
  variantFollowup: z.string().trim().max(2000).optional(),
  holdoutPercent: z.number().int().min(0).max(50),
  primaryMetric: z.enum(["BOOKING", "WIN"]),
});

export async function createCampaignExperiment(input: unknown): Promise<ExperimentActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendlyIssue(parsed.error, "That test is not valid.") };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an admin can set up an A/B test." };

  const templates: Record<string, string> = { "0": parsed.data.variantBody };
  if (parsed.data.variantFollowup) templates["1"] = parsed.data.variantFollowup;

  const result = await runOperation(
    "experiment.create",
    {
      kind: "REACTIVATION",
      targetId: parsed.data.campaignId,
      name: parsed.data.name,
      holdoutPercent: parsed.data.holdoutPercent,
      primaryMetric: parsed.data.primaryMetric,
      minSamplePerArm: 100,
      variants: [
        { key: "A", label: "Current message" },
        { key: "B", label: "Variant B", templates },
      ],
    },
    context(workspace),
  );
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/reactivation");
  return { ok: true };
}

export async function setCampaignExperimentState(input: unknown): Promise<ExperimentActionResult> {
  const parsed = z.object({ experimentId: z.uuid(), to: z.enum(["start", "stop"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That test could not be found." };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an admin can start or stop an A/B test." };
  const result = await runOperation(
    parsed.data.to === "start" ? "experiment.start" : "experiment.stop",
    { experimentId: parsed.data.experimentId },
    context(workspace),
  );
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/reactivation");
  return { ok: true };
}

/**
 * Promote the winning variant to every contact, roll back to the control
 * copy, or allow automatic promotion (§43, 0158). Admin/owner only. The
 * registry operations re-check everything: the minimum sample per arm, a
 * non-control winner, and that nothing compliance-sensitive (opener,
 * disclosure, pricing) is ever promoted automatically.
 */
const promotionSchema = z.object({
  experimentId: z.uuid(),
  to: z.enum(["promote", "rollback"]),
  reason: z.string().trim().min(3, "Say why, for the history.").max(500),
  confirm: z.literal(true, { message: "Tick the confirmation first." }),
});

export async function setCampaignExperimentPromotion(input: unknown): Promise<ExperimentActionResult> {
  const parsed = promotionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: friendlyIssue(parsed.error, "That request is not valid.") };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an admin or owner can promote or roll back a variant." };
  const result = await runOperation(
    parsed.data.to === "promote" ? "experiment.promote" : "experiment.rollback",
    { experimentId: parsed.data.experimentId, reason: parsed.data.reason, confirm: true },
    { ...context(workspace), confirmed: true },
  );
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/reactivation");
  return { ok: true };
}

export async function setCampaignExperimentAutoPromote(input: unknown): Promise<ExperimentActionResult> {
  const parsed = z.object({ experimentId: z.uuid(), enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That test could not be found." };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an admin or owner can change automatic promotion." };
  const result = await runOperation("experiment.set_auto_promote", parsed.data, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/reactivation");
  return { ok: true };
}
