"use server";

import { randomUUID } from "node:crypto";
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
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That test is not valid." };
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
