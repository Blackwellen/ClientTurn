import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  defaultOptimizationConfig,
  optimizationAllowed,
  optimizationConfigSchema,
  type Grade,
  type OptimizationConfig,
  type OptimizationProposal,
} from "../campaign-draft";
import { recordCampaignEvent } from "./lifecycle";

/**
 * Bounded auto-optimisation (V4 section 18.22-18.26).
 *
 * The optimiser proposes; this module decides. Every proposal is checked
 * against the campaign's stored bounds before anything is written, and a
 * refusal is recorded with its reason rather than silently dropped — the whole
 * value of "optimisation within your limits" is that the limits are inspectable
 * afterwards.
 *
 * There is deliberately no code path here that touches spend, allowance,
 * overage, suppression, contactability or the sender. Those are not bounded
 * dimensions with wide bounds; they are simply not dimensions.
 */

/** Columns an optimisation is ever allowed to write. */
const WRITABLE: Record<string, string> = {
  GRADE_THRESHOLD: "minimum_grade",
  CAMPAIGN_PRIORITY: "priority",
};

export type ApplyResult =
  | { ok: true; applied: boolean; reason?: string }
  | { ok: false; error: string };

export async function loadOptimizationConfig(
  businessId: string,
  campaignId: string,
): Promise<OptimizationConfig | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("outreach_campaigns")
    .select("auto_optimize, auto_optimize_config, minimum_grade")
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!data) return null;

  const parsed = optimizationConfigSchema.safeParse(data.auto_optimize_config);
  if (parsed.success) return { ...parsed.data, enabled: data.auto_optimize };

  return {
    ...defaultOptimizationConfig(data.minimum_grade as Grade),
    enabled: data.auto_optimize,
  };
}

export async function saveOptimizationConfig(input: {
  businessId: string;
  campaignId: string;
  config: OptimizationConfig;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = optimizationConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: "Those optimisation settings are not valid." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("outreach_campaigns")
    .update({
      auto_optimize: parsed.data.enabled,
      // `budgetImmutable` is re-asserted rather than taken from the input, so a
      // crafted payload cannot store a config claiming budget is optimisable.
      auto_optimize_config: { ...parsed.data, budgetImmutable: true },
    })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId);

  if (error) return { ok: false, error: "Those settings could not be saved." };

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: parsed.data.enabled ? "OPTIMIZE_ENABLED" : "OPTIMIZE_DISABLED",
    actorUserId: input.userId,
    summary: parsed.data.enabled
      ? "Auto optimise turned on within the configured bounds."
      : "Auto optimise turned off.",
    metadata: { dimensions: parsed.data.dimensions },
  });

  return { ok: true };
}

/**
 * Applies one proposed adjustment, or refuses it.
 *
 * Records an `optimization_actions` row either way. An unapplied row is the
 * evidence that the bound did its job, which is what makes the constraint
 * auditable rather than merely asserted.
 */
export async function applyOptimization(input: {
  businessId: string;
  campaignId: string;
  proposal: OptimizationProposal;
  rationale: string;
}): Promise<ApplyResult> {
  const admin = createAdminClient();
  const config = await loadOptimizationConfig(input.businessId, input.campaignId);
  if (!config) return { ok: false, error: "That campaign could not be found." };

  const verdict = optimizationAllowed(config, input.proposal);

  await admin.from("optimization_actions").insert({
    business_id: input.businessId,
    campaign_id: input.campaignId,
    action_type: input.proposal.dimension,
    before_json: JSON.parse(JSON.stringify({ value: input.proposal.before ?? null })),
    after_json: JSON.parse(JSON.stringify({ value: input.proposal.after ?? null })),
    bound_json: {
      minGradeFloor: config.minGradeFloor,
      maxGradeCeiling: config.maxGradeCeiling,
      sendWindow: [config.sendWindowStartHour, config.sendWindowEndHour],
      spacing: [config.followUpSpacingMinDays, config.followUpSpacingMaxDays],
      priority: [config.priorityFloor, config.priorityCeiling],
    },
    // The reason, not the reasoning. Model deliberation is never logged.
    rationale: verdict.allowed ? input.rationale : `Refused: ${verdict.reason}`,
    applied: verdict.allowed,
    applied_at: verdict.allowed ? new Date().toISOString() : null,
  });

  if (!verdict.allowed) return { ok: true, applied: false, reason: verdict.reason };

  const column = WRITABLE[input.proposal.dimension];
  if (column) {
    const { error } = await admin
      .from("outreach_campaigns")
      .update({ [column]: input.proposal.after } as Record<string, never>)
      .eq("business_id", input.businessId)
      .eq("id", input.campaignId)
      // Only a running campaign is optimised. A paused one is waiting on a
      // person, and changing it under them would be a surprise.
      .in("status", ["ACTIVE", "OPTIMIZING"]);

    if (error) return { ok: false, error: "That adjustment could not be applied." };
  }

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: "OPTIMIZATION_APPLIED",
    actorType: "OPTIMIZATION",
    summary: describeOptimization(input.proposal),
    metadata: {
      dimension: input.proposal.dimension,
      before: input.proposal.before ?? null,
      after: input.proposal.after ?? null,
    },
  });

  return { ok: true, applied: true };
}

/** A sentence a customer can read in the activity feed. */
export function describeOptimization(proposal: OptimizationProposal): string {
  const before = formatValue(proposal.before);
  const after = formatValue(proposal.after);

  switch (proposal.dimension) {
    case "VARIANT_ALLOCATION":
      return `Variant allocation changed from ${before}% to ${after}%`;
    case "SUBJECT_VARIANT":
      return `Subject line allocation changed from ${before}% to ${after}%`;
    case "SEND_TIME":
      return `Send window shifted from ${before} to ${after}`;
    case "GRADE_THRESHOLD":
      return `Grade threshold adjusted ${before} to ${after} within the allowed bound`;
    case "FOLLOW_UP_SPACING":
      return `Follow-up spacing changed from ${before} to ${after} days`;
    case "ROLE_PRIORITY":
      return `Role priority changed from ${before} to ${after}`;
    case "CAMPAIGN_PRIORITY":
      return `Campaign priority changed from ${before} to ${after}`;
    case "PROSPECT_ORDERING":
      return `Prospect ordering changed from ${before} to ${after}`;
    default:
      return `${proposal.dimension} changed from ${before} to ${after}`;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "unset";
  if (typeof value === "object") {
    const window = value as { startHour?: number; endHour?: number };
    if (typeof window.startHour === "number" && typeof window.endHour === "number") {
      const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
      return `${pad(window.startHour)}-${pad(window.endHour)}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}
