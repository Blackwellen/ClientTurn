import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import {
  computeExperimentResult,
  EXPERIMENT_KINDS,
  experimentProblems,
  MAX_HOLDOUT_PERCENT,
  MIN_SAMPLE_FLOOR,
  PRIMARY_METRICS,
  type ExperimentVariant,
} from "@/lib/learning/experiments";
import {
  EXPERIMENT_FIELDS,
  EXPERIMENT_FIELDS_WITH_PROMOTION,
  experimentArmOutcomes,
  experimentResults,
  promotionDecisionFor,
  promotionHistory,
  type ExperimentRow,
} from "@/lib/learning/experiments-service";
import {
  assertPromotionAllowed,
  AutoPromotionRefused,
  promotionRecord,
  rollbackRecord,
  sensitiveFieldsOf,
  type PromotionRecord,
} from "@/lib/learning/promotion";
import { logEvent } from "@/lib/observability/log";
import { questionIntentKeySchema } from "@/lib/qualification-intelligence/types";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Governed experiments (brief §§62-63). A draft is created, started and
 * stopped by an admin; results are computed on read with a minimum sample and
 * 95% intervals. The send paths (automation-advance) read the running
 * experiment and the lead's deterministic arm.
 */

/** 0131 post-dates the generated types. */
type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as unknown as Untyped;

function unavailable(error: { code?: string | null; message: string }): never {
  if (isSchemaLag(error)) throw new ServiceError("UNAVAILABLE", "Experiments are not available on this database yet.");
  throw new ServiceError("UNAVAILABLE", "Experiments could not be read.");
}

async function loadExperiment(businessId: string, id: string): Promise<ExperimentRow> {
  const { data, error } = await db()
    .from("experiments")
    .select(EXPERIMENT_FIELDS)
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  if (error) unavailable(error);
  if (!data) throw new ServiceError("NOT_FOUND", "That experiment could not be found.");
  return data as ExperimentRow;
}

const variantSchema = z.object({
  key: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_]+$/, "Use capital letters, digits or _ for a variant key."),
  label: z.string().trim().min(1).max(80),
  templates: z.record(z.string().regex(/^\d{1,2}$/), z.string().trim().max(2000)).optional(),
  /** QUESTION_STRATEGY: intent key -> wording family (and optional rendering). */
  questions: z
    .record(
      questionIntentKeySchema,
      z.object({ wordingFamily: z.string().trim().min(1).max(80), rendering: z.string().trim().min(3).max(300).optional() }).strict(),
    )
    .optional(),
  strategyVersion: z.string().trim().min(1).max(80).optional(),
});

defineOperation("experiment.list", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const { data, error } = await db()
      .from("experiments")
      .select(EXPERIMENT_FIELDS)
      .eq("business_id", context.businessId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) unavailable(error);
    return { data: { experiments: (data ?? []) as ExperimentRow[] } };
  },
});

defineOperation("experiment.results", {
  schema: z.object({ experimentId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ experimentId: string }>) {
    const experiment = await loadExperiment(context.businessId, args.experimentId);
    const result = await experimentResults(context.businessId, experiment).catch(() => {
      throw new ServiceError("UNAVAILABLE", "The results could not be computed.");
    });
    return { data: { experiment, result }, entityId: experiment.id };
  },
});

defineOperation("experiment.create", {
  schema: z.object({
    kind: z.enum(EXPERIMENT_KINDS),
    /**
     * WARM_FOLLOW_UP: an automation (sequence) id; REACTIVATION: a campaign id;
     * QUESTION_STRATEGY: a service (offer) id, or the business id for the whole workspace.
     */
    targetId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    holdoutPercent: z.number().int().min(0).max(MAX_HOLDOUT_PERCENT).default(0),
    variants: z.array(variantSchema).min(2).max(4),
    primaryMetric: z.enum(PRIMARY_METRICS).default("BOOKING"),
    minSamplePerArm: z.number().int().min(MIN_SAMPLE_FLOOR).max(100_000).default(MIN_SAMPLE_FLOOR),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{
    kind: (typeof EXPERIMENT_KINDS)[number];
    targetId: string;
    name: string;
    holdoutPercent: number;
    variants: ExperimentVariant[];
    primaryMetric: (typeof PRIMARY_METRICS)[number];
    minSamplePerArm: number;
  }>) {
    const problems = experimentProblems({
      holdoutPercent: args.holdoutPercent,
      variants: args.variants,
      minSamplePerArm: args.minSamplePerArm,
      kind: args.kind,
      primaryMetric: args.primaryMetric,
    });
    if (problems.length > 0) throw new ServiceError("INVALID_INPUT", problems[0]);

    // The target must be this workspace's own sequence or campaign.
    const admin = createAdminClient();
    // A QUESTION_STRATEGY experiment targets an offer, or the workspace itself (CD-19).
    const target =
      args.kind === "QUESTION_STRATEGY" && args.targetId === context.businessId
        ? { data: { id: context.businessId }, error: null }
        : args.kind === "QUESTION_STRATEGY"
          ? await admin.from("services").select("id").eq("business_id", context.businessId).eq("id", args.targetId).maybeSingle()
          : args.kind === "WARM_FOLLOW_UP"
            ? await admin.from("automation_definitions").select("id").eq("business_id", context.businessId).eq("id", args.targetId).maybeSingle()
            : await admin.from("campaigns").select("id").eq("business_id", context.businessId).eq("id", args.targetId).maybeSingle();
    if (target.error) throw new ServiceError("UNAVAILABLE", "The sequence or campaign could not be read.");
    if (!target.data) throw new ServiceError("NOT_FOUND", "That sequence, campaign or offer could not be found.");

    const { data, error } = await db()
      .from("experiments")
      .insert({
        business_id: context.businessId,
        kind: args.kind,
        target_id: args.targetId,
        name: args.name,
        holdout_percent: args.holdoutPercent,
        variants: args.variants,
        primary_metric: args.primaryMetric,
        min_sample_per_arm: args.minSamplePerArm,
        created_by: context.userId,
      })
      .select(EXPERIMENT_FIELDS)
      .single();
    if (error || !data) unavailable(error ?? { message: "no row" });
    const row = data as ExperimentRow;
    return { data: { experiment: row }, entityId: row.id, after: { status: row.status, name: row.name } };
  },
});

async function setStatus(
  businessId: string,
  id: string,
  from: ExperimentRow["status"],
  to: ExperimentRow["status"],
) {
  const before = await loadExperiment(businessId, id);
  if (before.status !== from) {
    throw new ServiceError("CONFLICT", `Only a ${from.toLowerCase()} experiment can be ${to === "RUNNING" ? "started" : "stopped"}.`);
  }
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("experiments")
    .update(to === "RUNNING" ? { status: to, started_at: now } : { status: to, stopped_at: now })
    .eq("business_id", businessId)
    .eq("id", id)
    .eq("status", from)
    .select(EXPERIMENT_FIELDS)
    .maybeSingle();
  if (error?.code === "23505") {
    throw new ServiceError("CONFLICT", "Another experiment is already running on that sequence or campaign.");
  }
  if (error) unavailable(error);
  if (!data) throw new ServiceError("CONFLICT", "The experiment changed while this was being saved.");
  const after = data as ExperimentRow;
  return { data: { experiment: after }, entityId: id, before: { status: before.status }, after: { status: after.status } };
}

defineOperation("experiment.start", {
  schema: z.object({ experimentId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ experimentId: string }>) {
    return setStatus(context.businessId, args.experimentId, "DRAFT", "RUNNING");
  },
});

defineOperation("experiment.stop", {
  schema: z.object({ experimentId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ experimentId: string }>) {
    return setStatus(context.businessId, args.experimentId, "RUNNING", "STOPPED");
  },
});

/* ------------------------------------------------ promote / rollback (0158) */

/**
 * Promote a winning variant to everyone, or roll back to control (brief §43).
 * The decision is pure (learning/promotion.ts): a minimum sample in every
 * arm, a non-control WINNER, and -- for an automatic promotion only -- a
 * significance threshold, the experiment's own opt-in, and no
 * compliance-sensitive change (opener, disclosure, pricing). A person always
 * confirms a promotion from the UI; SYSTEM is the only caller that can
 * promote automatically, and only on an AUTO_PROMOTE decision.
 *
 * Writes are compare-and-swap on `version`, so two admins (or an admin and
 * the automatic path) cannot both promote. Every promote and rollback appends
 * an experiment_promotions row with the evidence at the time.
 */

async function loadForPromotion(businessId: string, id: string): Promise<ExperimentRow> {
  const { data, error } = await db()
    .from("experiments")
    .select(EXPERIMENT_FIELDS_WITH_PROMOTION)
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isSchemaLag(error)) throw new ServiceError("UNAVAILABLE", "Promoting variants is not available on this database yet.");
    unavailable(error);
  }
  if (!data) throw new ServiceError("NOT_FOUND", "That experiment could not be found.");
  return data as ExperimentRow;
}

async function adviceFor(businessId: string, experiment: ExperimentRow) {
  const arms = await experimentArmOutcomes(businessId, experiment).catch(() => {
    throw new ServiceError("UNAVAILABLE", "The results could not be computed.");
  });
  const result = computeExperimentResult({
    metric: experiment.primary_metric,
    minSamplePerArm: experiment.min_sample_per_arm,
    arms,
  });
  return { arms, result, decision: promotionDecisionFor(experiment, arms, result) };
}

defineOperation("experiment.promotion_advice", {
  schema: z.object({ experimentId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ experimentId: string }>) {
    const experiment = await loadForPromotion(context.businessId, args.experimentId);
    const { decision, result } = await adviceFor(context.businessId, experiment);
    const history = await promotionHistory(context.businessId, experiment.id);
    return { data: { experiment, result, decision, history }, entityId: experiment.id };
  },
});

defineOperation("experiment.promote", {
  schema: z.object({
    experimentId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    /** A person ticked the confirmation. Required for every non-SYSTEM caller. */
    confirm: z.boolean().default(false),
  }),
  async run({ args, context }: HandlerInput<{ experimentId: string; reason: string; confirm: boolean }>) {
    const mode = context.caller === "SYSTEM" ? "AUTO" : "HUMAN";
    if (mode === "HUMAN" && !args.confirm) {
      throw new ServiceError("NEEDS_CONFIRMATION", "Confirm that every lead should get this variant from now on.");
    }
    const experiment = await loadForPromotion(context.businessId, args.experimentId);
    const { decision } = await adviceFor(context.businessId, experiment);
    let arm: string;
    try {
      arm = assertPromotionAllowed(decision, mode);
    } catch (error) {
      throw new ServiceError("POLICY_BLOCKED", error instanceof AutoPromotionRefused ? error.message : "This variant cannot be promoted.");
    }
    const version = experiment.version ?? 1;
    const now = new Date().toISOString();
    const { data, error } = await db()
      .from("experiments")
      .update({ promoted_arm: arm, promoted_at: now, version: version + 1 })
      .eq("business_id", context.businessId)
      .eq("id", experiment.id)
      .eq("status", "RUNNING")
      .eq("version", version)
      .is("promoted_arm", null)
      .select("id")
      .maybeSingle();
    if (error) unavailable(error);
    if (!data) throw new ServiceError("CONFLICT", "The experiment changed while this was being saved. Reload and try again.");

    const record = promotionRecord({ experimentId: experiment.id, version, decision, decidedBy: mode, reason: args.reason, at: now });
    await appendPromotion(context.businessId, context.userId, record, decision.sensitiveFields);
    logEvent("experiment.promoted", { experimentId: experiment.id, arm, version: version + 1, mode });
    return {
      data: { promotedArm: arm, version: version + 1, decision },
      entityId: experiment.id,
      before: { promoted_arm: null, version },
      after: { promoted_arm: arm, version: version + 1, decided_by: mode, p_value: decision.pValue },
    };
  },
});

defineOperation("experiment.rollback", {
  schema: z.object({
    experimentId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    confirm: z.boolean().default(false),
  }),
  async run({ args, context }: HandlerInput<{ experimentId: string; reason: string; confirm: boolean }>) {
    if (!args.confirm) throw new ServiceError("NEEDS_CONFIRMATION", "Confirm that every lead should go back to the control copy.");
    const experiment = await loadForPromotion(context.businessId, args.experimentId);
    const version = experiment.version ?? 1;
    let record: PromotionRecord;
    try {
      record = rollbackRecord({
        experimentId: experiment.id,
        version,
        promotedArm: experiment.promoted_arm ?? null,
        reason: args.reason,
        at: new Date().toISOString(),
      });
    } catch (error) {
      throw new ServiceError("CONFLICT", error instanceof Error ? error.message : "Nothing to roll back.");
    }
    // Back to control for everyone: clear the promotion and stop the test, so
    // no running experiment remains and the target's own copy is sent.
    const { data, error } = await db()
      .from("experiments")
      .update({ promoted_arm: null, promoted_at: null, version: version + 1, status: "STOPPED", stopped_at: record.at })
      .eq("business_id", context.businessId)
      .eq("id", experiment.id)
      .eq("version", version)
      .select("id")
      .maybeSingle();
    if (error) unavailable(error);
    if (!data) throw new ServiceError("CONFLICT", "The experiment changed while this was being saved. Reload and try again.");
    await appendPromotion(context.businessId, context.userId, record, []);
    logEvent("experiment.rolled_back", { experimentId: experiment.id, fromArm: record.fromArm, version: version + 1 });
    return {
      data: { rolledBackFrom: record.fromArm, version: version + 1 },
      entityId: experiment.id,
      before: { promoted_arm: record.fromArm, status: experiment.status, version },
      after: { promoted_arm: null, status: "STOPPED", version: version + 1 },
    };
  },
});

defineOperation("experiment.set_auto_promote", {
  schema: z.object({ experimentId: z.string().uuid(), enabled: z.boolean() }),
  async run({ args, context }: HandlerInput<{ experimentId: string; enabled: boolean }>) {
    const experiment = await loadForPromotion(context.businessId, args.experimentId);
    if (args.enabled) {
      const sensitive = sensitiveFieldsOf(experiment.kind, experiment.variants);
      if (sensitive.length > 0) {
        throw new ServiceError(
          "POLICY_BLOCKED",
          `This experiment changes ${sensitive.join(", ")}, which is never promoted automatically. A person confirms instead.`,
        );
      }
    }
    const { error } = await db()
      .from("experiments")
      .update({ auto_promote: args.enabled })
      .eq("business_id", context.businessId)
      .eq("id", experiment.id);
    if (error) unavailable(error);
    return {
      data: { autoPromote: args.enabled },
      entityId: experiment.id,
      before: { auto_promote: Boolean(experiment.auto_promote) },
      after: { auto_promote: args.enabled },
    };
  },
});

async function appendPromotion(
  businessId: string,
  userId: string | null,
  record: PromotionRecord,
  sensitiveFields: readonly string[],
): Promise<void> {
  const { error } = await db().from("experiment_promotions").insert({
    business_id: businessId,
    experiment_id: record.experimentId,
    action: record.action,
    arm: record.arm,
    from_arm: record.fromArm,
    version: record.version,
    sample_by_arm: record.sampleByArm,
    conversion_by_arm: record.conversionByArm,
    p_value: record.pValue,
    sensitive_fields: [...sensitiveFields],
    decided_by_kind: record.decidedBy,
    decided_by: record.decidedBy === "HUMAN" ? userId : null,
    reason: record.reason,
  });
  // The experiment row already moved (and the audit row records it); a lost
  // history row is logged loudly rather than undoing a confirmed decision.
  if (error) console.error("[experiments] promotion history insert failed", { experimentId: record.experimentId, message: error.message });
}
