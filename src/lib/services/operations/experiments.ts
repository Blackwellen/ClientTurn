import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import {
  EXPERIMENT_KINDS,
  experimentProblems,
  MAX_HOLDOUT_PERCENT,
  MIN_SAMPLE_FLOOR,
  PRIMARY_METRICS,
  type ExperimentVariant,
} from "@/lib/learning/experiments";
import { EXPERIMENT_FIELDS, experimentResults, type ExperimentRow } from "@/lib/learning/experiments-service";
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
    /** WARM_FOLLOW_UP: an automation (sequence) id; REACTIVATION: a campaign id. */
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
    });
    if (problems.length > 0) throw new ServiceError("INVALID_INPUT", problems[0]);

    // The target must be this workspace's own sequence or campaign.
    const admin = createAdminClient();
    const target =
      args.kind === "WARM_FOLLOW_UP"
        ? await admin.from("automation_definitions").select("id").eq("business_id", context.businessId).eq("id", args.targetId).maybeSingle()
        : await admin.from("campaigns").select("id").eq("business_id", context.businessId).eq("id", args.targetId).maybeSingle();
    if (target.error) throw new ServiceError("UNAVAILABLE", "The sequence or campaign could not be read.");
    if (!target.data) throw new ServiceError("NOT_FOUND", "That sequence or campaign could not be found.");

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
