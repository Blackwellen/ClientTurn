import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import {
  assignArm,
  computeExperimentResult,
  reactivationArmReport,
  type CampaignExperimentView,
  type ExperimentPromotionView,
  type ReactivationArmCounts,
  type ReactivationArmRow,
  type ArmOutcomes,
  type ExperimentKind,
  type ExperimentResult,
  type ExperimentVariant,
  type PrimaryMetric,
} from "./experiments";
import { decidePromotion, servedArm } from "./promotion";

/**
 * The server side of governed experiments (0131). Assignment and the maths
 * are pure (experiments.ts); this reads and writes the two tables and joins
 * outcomes from the workspace's own leads and replies.
 *
 * Fail-safe: a lagging schema or a failed read means "no experiment", and the
 * send path sends the control copy, which is exactly the pre-experiment
 * behaviour.
 */

/** 0131 post-dates the generated types. */
type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ExperimentRow = {
  id: string;
  business_id: string;
  kind: ExperimentKind;
  target_id: string;
  name: string;
  status: "DRAFT" | "RUNNING" | "STOPPED";
  holdout_percent: number;
  variants: ExperimentVariant[];
  primary_metric: PrimaryMetric;
  min_sample_per_arm: number;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  /** 0158. Absent (undefined) until that migration is applied. */
  promoted_arm?: string | null;
  promoted_at?: string | null;
  version?: number;
  auto_promote?: boolean;
  significance_alpha?: number | string;
};

export const EXPERIMENT_FIELDS =
  "id, business_id, kind, target_id, name, status, holdout_percent, variants, primary_metric, min_sample_per_arm, created_at, started_at, stopped_at";

/** EXPERIMENT_FIELDS plus the 0158 promotion columns. */
export const EXPERIMENT_FIELDS_WITH_PROMOTION = `${EXPERIMENT_FIELDS}, promoted_arm, promoted_at, version, auto_promote, significance_alpha`;

/**
 * Runs a select with the promotion columns, falling back to the 0131 columns
 * when 0158 is not applied yet (so nothing is promoted and every read behaves
 * exactly as before).
 */
export async function selectExperiments<T>(
  build: (fields: string) => PromiseLike<{ data: T; error: { code?: string | null; message: string } | null }>,
): Promise<{ data: T; error: { code?: string | null; message: string } | null; promotionColumns: boolean }> {
  const first = await build(EXPERIMENT_FIELDS_WITH_PROMOTION);
  if (!first.error || !isSchemaLag(first.error)) return { ...first, promotionColumns: true };
  const second = await build(EXPERIMENT_FIELDS);
  return { ...second, promotionColumns: false };
}

function db(): Untyped {
  return createAdminClient() as unknown as Untyped;
}

export async function runningExperiment(
  businessId: string,
  kind: ExperimentKind,
  targetId: string,
): Promise<ExperimentRow | null> {
  try {
    const { data, error } = await selectExperiments((fields) =>
      db()
        .from("experiments")
        .select(fields)
        .eq("business_id", businessId)
        .eq("kind", kind)
        .eq("target_id", targetId)
        .eq("status", "RUNNING")
        .maybeSingle(),
    );
    if (error) {
      if (!isSchemaLag(error)) console.error("[experiments] read failed", { businessId, message: error.message });
      return null;
    }
    return (data as ExperimentRow | null) ?? null;
  } catch (error) {
    console.error("[experiments] read threw", { businessId, error });
    return null;
  }
}

/**
 * The running QUESTION_STRATEGY experiment for a lead (CD-19): the offer's
 * own first, then a workspace-wide one (target_id = the business id). Null
 * = none, and the library's wording is used, exactly as before experiments.
 */
export async function questionStrategyExperiment(
  businessId: string,
  serviceId: string | null,
): Promise<ExperimentRow | null> {
  if (serviceId) {
    const offer = await runningExperiment(businessId, "QUESTION_STRATEGY", serviceId);
    if (offer) return offer;
  }
  return runningExperiment(businessId, "QUESTION_STRATEGY", businessId);
}

/**
 * The lead's arm. Deterministic, so nothing is stored to remember it: a retry,
 * another worker or the results query recompute the same arm. Exposure is
 * recorded where the data-rights rules already cover it (see 0131).
 */
export function armForLead(experiment: ExperimentRow, leadId: string): string {
  // A promoted experiment (0158) serves the promoted variant to everyone.
  return servedArm(experiment.promoted_arm ?? null, () =>
    assignArm(
      { id: experiment.id, holdoutPercent: experiment.holdout_percent, variants: experiment.variants },
      leadId,
    ),
  );
}

/** The randomised arm, ignoring any promotion: what the results are measured on. */
function assignedArm(experiment: ExperimentRow, leadId: string): string {
  return assignArm(
    { id: experiment.id, holdoutPercent: experiment.holdout_percent, variants: experiment.variants },
    leadId,
  );
}

/** The automation_runs.stopped_reason written for a holdout lead. */
export function holdoutStopReason(experimentId: string): string {
  return `experiment_holdout:${experimentId}`;
}

const CHUNK = 500;
const MAX_EXPOSED = 20_000;
const POSITIVE = ["POSITIVE_INTEREST", "BOOKING_INTENT"];
const OPT_OUT = ["UNSUBSCRIBE", "COMPLAINT"];

/**
 * Who was exposed, and when: the first message carrying this experiment's
 * features per lead, plus every holdout run stop. Each lead's arm is
 * recomputed from the hash, so a stray row cannot move a lead between arms.
 */
async function exposures(
  businessId: string,
  experiment: ExperimentRow,
): Promise<{ lead_id: string; arm: string; assigned_at: string }[]> {
  const [sent, held, heldContacts] = await Promise.all([
    db()
      .from("messages")
      .select("lead_id, created_at")
      .eq("business_id", businessId)
      .eq("direction", "outbound")
      .eq("features->>experimentId", experiment.id)
      .order("created_at", { ascending: true })
      .limit(MAX_EXPOSED),
    db()
      .from("automation_runs")
      .select("lead_id, stopped_at")
      .eq("business_id", businessId)
      .eq("stopped_reason", holdoutStopReason(experiment.id))
      .limit(MAX_EXPOSED),
    // A REACTIVATION holdout is a campaign contact stopped before sending.
    experiment.kind === "REACTIVATION"
      ? db()
          .from("campaign_contacts")
          .select("lead_id, updated_at")
          .eq("business_id", businessId)
          .eq("stopped_reason", holdoutStopReason(experiment.id))
          .limit(MAX_EXPOSED)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sent.error) throw new Error(`messages read: ${sent.error.message}`);
  if (held.error) throw new Error(`automation_runs read: ${held.error.message}`);
  if (heldContacts.error) throw new Error(`campaign_contacts read: ${heldContacts.error.message}`);

  const first = new Map<string, string>();
  for (const row of (sent.data ?? []) as { lead_id: string | null; created_at: string }[]) {
    if (row.lead_id && !first.has(row.lead_id)) first.set(row.lead_id, row.created_at);
  }
  for (const row of (held.data ?? []) as { lead_id: string; stopped_at: string | null }[]) {
    if (!first.has(row.lead_id)) first.set(row.lead_id, row.stopped_at ?? experiment.started_at ?? experiment.created_at);
  }
  for (const row of (heldContacts.data ?? []) as { lead_id: string; updated_at: string | null }[]) {
    if (!first.has(row.lead_id)) first.set(row.lead_id, row.updated_at ?? experiment.started_at ?? experiment.created_at);
  }
  // After a promotion everyone gets the winner: that is a rollout, not the
  // test, so only exposures before the promotion are measured.
  const cutoff = experiment.promoted_at ?? null;
  return [...first.entries()]
    .filter(([, at]) => !cutoff || at <= cutoff)
    .map(([leadId, at]) => ({ lead_id: leadId, arm: assignedArm(experiment, leadId), assigned_at: at }));
}

/**
 * Outcomes per arm, from the workspace's own data. A booking or a win counts
 * only after the lead was exposed; a positive reply or an opt-out likewise.
 */
export async function experimentResults(
  businessId: string,
  experiment: ExperimentRow,
): Promise<ExperimentResult> {
  return computeExperimentResult({
    metric: experiment.primary_metric,
    minSamplePerArm: experiment.min_sample_per_arm,
    arms: await experimentArmOutcomes(businessId, experiment),
  });
}

/** Raw per-arm outcomes (the promotion decision needs the counts, not just the intervals). */
export async function experimentArmOutcomes(
  businessId: string,
  experiment: ExperimentRow,
): Promise<ArmOutcomes[]> {
  const admin = createAdminClient();
  const assignments = await exposures(businessId, experiment);

  const byArm = new Map<string, ArmOutcomes>();
  const arm = (key: string) => {
    let entry = byArm.get(key);
    if (!entry) {
      entry = { arm: key, leads: 0, wins: 0, bookings: 0, positiveReplies: 0, optOuts: 0 };
      byArm.set(key, entry);
    }
    return entry;
  };
  for (const variant of experiment.variants) arm(variant.key);

  for (let i = 0; i < assignments.length; i += CHUNK) {
    const slice = assignments.slice(i, i + CHUNK);
    const ids = slice.map((row) => row.lead_id);
    const [leads, replies] = await Promise.all([
      admin.from("leads").select("id, booked_at, won_at, opted_out").eq("business_id", businessId).in("id", ids),
      admin
        .from("messages")
        .select("lead_id, reply_classification, created_at")
        .eq("business_id", businessId)
        .eq("direction", "inbound")
        .in("lead_id", ids)
        .in("reply_classification", [...POSITIVE, ...OPT_OUT]),
    ]);
    if (leads.error) throw new Error(`leads read: ${leads.error.message}`);
    if (replies.error) throw new Error(`messages read: ${replies.error.message}`);
    const leadById = new Map((leads.data ?? []).map((row) => [row.id, row]));
    const repliesByLead = new Map<string, { reply_classification: string | null; created_at: string }[]>();
    for (const reply of replies.data ?? []) {
      if (!reply.lead_id) continue;
      const list = repliesByLead.get(reply.lead_id) ?? [];
      list.push(reply);
      repliesByLead.set(reply.lead_id, list);
    }

    for (const row of slice) {
      const entry = arm(row.arm);
      entry.leads += 1;
      const lead = leadById.get(row.lead_id);
      const after = (at: string | null | undefined) => Boolean(at && at >= row.assigned_at);
      if (after(lead?.won_at)) entry.wins += 1;
      if (after(lead?.booked_at)) entry.bookings += 1;
      const own = (repliesByLead.get(row.lead_id) ?? []).filter((r) => after(r.created_at));
      if (own.some((r) => POSITIVE.includes(r.reply_classification ?? ""))) entry.positiveReplies += 1;
      if (own.some((r) => OPT_OUT.includes(r.reply_classification ?? ""))) entry.optOuts += 1;
    }
  }

  return [...byArm.values()];
}

/**
 * The slow-changing context a message's features record (§61): the
 * workspace's archetype and primary motion, and the lead's current grade.
 * Best effort: a failed read records nulls, never blocks a send.
 */
export async function featureContext(
  businessId: string,
  leadId: string,
): Promise<{ archetype: string | null; motion: string | null; scoreBand: string | null }> {
  try {
    const client = db();
    const [profile, score] = await Promise.all([
      client.from("business_profiles").select("archetype_key, sales_motions").eq("business_id", businessId).maybeSingle(),
      client
        .from("lead_scores")
        .select("grade")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .eq("is_current", true)
        .maybeSingle(),
    ]);
    const motions = (profile.data as { sales_motions?: unknown } | null)?.sales_motions;
    return {
      archetype: (profile.data as { archetype_key?: string | null } | null)?.archetype_key ?? null,
      motion: Array.isArray(motions) && typeof motions[0] === "string" ? motions[0] : null,
      scoreBand: (score.data as { grade?: string | null } | null)?.grade ?? null,
    };
  } catch {
    return { archetype: null, motion: null, scoreBand: null };
  }
}

/* ------------------------------------------------ reactivation report */

export type ReactivationExperimentReport = {
  experiment: ExperimentRow;
  rows: ReactivationArmRow[];
  result: ExperimentResult;
};

/**
 * The newest REACTIVATION experiment on a campaign (running, else the last
 * stopped or draft one) and its per-arm outcomes: meetings, sales and value,
 * opt-outs and complaints, and replies (shown last, never the verdict).
 * Null when the campaign has none or the table is not there yet.
 */
export async function reactivationExperimentReport(
  businessId: string,
  campaignId: string,
): Promise<ReactivationExperimentReport | null> {
  const { data, error } = await selectExperiments((fields) =>
    db()
      .from("experiments")
      .select(fields)
      .eq("business_id", businessId)
      .eq("kind", "REACTIVATION")
      .eq("target_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(5),
  );
  if (error) {
    if (!isSchemaLag(error)) console.error("[experiments] campaign read failed", { campaignId, message: error.message });
    return null;
  }
  const list = (data ?? []) as ExperimentRow[];
  const experiment = list.find((row) => row.status === "RUNNING") ?? list[0];
  if (!experiment) return null;

  const admin = createAdminClient();
  const assignments = experiment.status === "DRAFT" ? [] : await exposures(businessId, experiment);
  const counts = new Map<string, ReactivationArmCounts>();
  const entry = (arm: string) => {
    let row = counts.get(arm);
    if (!row) {
      row = { arm, leads: 0, meetings: 0, sales: 0, salesValue: 0, optOuts: 0, replies: 0 };
      counts.set(arm, row);
    }
    return row;
  };
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const slice = assignments.slice(i, i + CHUNK);
    const ids = slice.map((row) => row.lead_id);
    const [bookings, won, inbound] = await Promise.all([
      admin.from("bookings").select("lead_id, created_at, status").eq("business_id", businessId).in("lead_id", ids),
      admin
        .from("opportunities")
        .select("lead_id, closed_at, value")
        .eq("business_id", businessId)
        .eq("outcome", "WON")
        .in("lead_id", ids),
      admin
        .from("messages")
        .select("lead_id, reply_classification, created_at")
        .eq("business_id", businessId)
        .eq("direction", "inbound")
        .in("lead_id", ids),
    ]);
    if (bookings.error) throw new Error(`bookings read: ${bookings.error.message}`);
    if (won.error) throw new Error(`opportunities read: ${won.error.message}`);
    if (inbound.error) throw new Error(`messages read: ${inbound.error.message}`);
    for (const row of slice) {
      const arm = entry(row.arm);
      arm.leads += 1;
      const after = (at: string | null | undefined) => Boolean(at && at >= row.assigned_at);
      if ((bookings.data ?? []).some((b) => b.lead_id === row.lead_id && b.status !== "cancelled" && after(b.created_at))) arm.meetings += 1;
      const wins = (won.data ?? []).filter((w) => w.lead_id === row.lead_id && after(w.closed_at));
      if (wins.length > 0) {
        arm.sales += 1;
        arm.salesValue += wins.reduce((sum, w) => sum + (Number(w.value) || 0), 0);
      }
      const own = (inbound.data ?? []).filter((m) => m.lead_id === row.lead_id && after(m.created_at));
      if (own.some((m) => OPT_OUT.includes(m.reply_classification ?? ""))) arm.optOuts += 1;
      if (own.some((m) => !["AUTO_RESPONSE", "BOUNCE"].includes(m.reply_classification ?? ""))) arm.replies += 1;
    }
  }
  const { rows, result } = reactivationArmReport({
    variants: experiment.variants,
    metric: experiment.primary_metric,
    minSamplePerArm: experiment.min_sample_per_arm,
    counts: [...counts.values()],
  });
  return { experiment, rows, result };
}

/** The drawer's view of a campaign's experiment. Never throws: null hides the panel's results. */
export async function campaignExperimentView(
  businessId: string,
  campaignId: string,
): Promise<CampaignExperimentView | null> {
  try {
    const report = await reactivationExperimentReport(businessId, campaignId);
    if (!report) return null;
    return {
      id: report.experiment.id,
      name: report.experiment.name,
      status: report.experiment.status,
      holdoutPercent: report.experiment.holdout_percent,
      metric: report.experiment.primary_metric,
      minSamplePerArm: Math.max(report.experiment.min_sample_per_arm, 100),
      rows: report.rows,
      verdict: report.result.verdict,
      winner: report.result.winner,
      explanation: report.result.explanation,
      promotion: await promotionView(businessId, report.experiment, armsFromRows(report.rows), report.result),
    };
  } catch (error) {
    console.error("[experiments] campaign view failed", { campaignId, error });
    return null;
  }
}

/* ------------------------------------------------ promote / rollback (0158) */

/** Reactivation rows -> the outcome counts the promotion decision reads. */
export function armsFromRows(rows: readonly ReactivationArmRow[]): ArmOutcomes[] {
  return rows.map((row) => ({
    arm: row.arm,
    leads: row.leads,
    wins: row.sales,
    bookings: row.meetings,
    positiveReplies: row.replies,
    optOuts: row.optOuts,
  }));
}

type PromotionRow = {
  action: "PROMOTE" | "ROLLBACK";
  arm: string;
  from_arm: string | null;
  version: number;
  p_value: number | string | null;
  sample_by_arm: Record<string, number> | null;
  conversion_by_arm: Record<string, number | null> | null;
  decided_by_kind: "HUMAN" | "AUTO";
  reason: string;
  created_at: string;
};

/** The promotion history, newest first. Empty before 0158. */
export async function promotionHistory(businessId: string, experimentId: string): Promise<ExperimentPromotionView["history"]> {
  const { data, error } = await db()
    .from("experiment_promotions")
    .select("action, arm, from_arm, version, p_value, sample_by_arm, conversion_by_arm, decided_by_kind, reason, created_at")
    .eq("business_id", businessId)
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (!isSchemaLag(error)) console.error("[experiments] promotion history read failed", { experimentId, message: error.message });
    return [];
  }
  return ((data ?? []) as PromotionRow[]).map((row) => ({
    action: row.action,
    arm: row.arm,
    fromArm: row.from_arm,
    version: row.version,
    pValue: row.p_value === null ? null : Number(row.p_value),
    sampleByArm: row.sample_by_arm ?? {},
    conversionByArm: row.conversion_by_arm ?? {},
    decidedBy: row.decided_by_kind,
    reason: row.reason,
    at: row.created_at,
  }));
}

/** The decision for this experiment right now (pure: promotion.ts). */
export function promotionDecisionFor(experiment: ExperimentRow, arms: readonly ArmOutcomes[], result: ExperimentResult) {
  return decidePromotion({
    kind: experiment.kind,
    status: experiment.status,
    promotedArm: experiment.promoted_arm ?? null,
    variants: experiment.variants,
    metric: experiment.primary_metric,
    minSamplePerArm: experiment.min_sample_per_arm,
    arms,
    result,
    autoPromote: Boolean(experiment.auto_promote),
    alpha: experiment.significance_alpha === undefined ? undefined : Number(experiment.significance_alpha),
  });
}

/** Null when the 0158 columns are not there (the panel then hides promotion). */
async function promotionView(
  businessId: string,
  experiment: ExperimentRow,
  arms: readonly ArmOutcomes[],
  result: ExperimentResult,
): Promise<ExperimentPromotionView | undefined> {
  if (experiment.version === undefined) return undefined;
  const decision = promotionDecisionFor(experiment, arms, result);
  return {
    promotedArm: experiment.promoted_arm ?? null,
    promotedAt: experiment.promoted_at ?? null,
    version: experiment.version,
    autoPromote: Boolean(experiment.auto_promote),
    advice: {
      action: decision.action,
      candidate: decision.candidate,
      pValue: decision.pValue,
      reasons: decision.reasons,
      sensitiveFields: decision.sensitiveFields,
    },
    history: await promotionHistory(businessId, experiment.id),
  };
}
