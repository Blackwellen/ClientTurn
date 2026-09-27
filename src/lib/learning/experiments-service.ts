import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import {
  assignArm,
  computeExperimentResult,
  reactivationArmReport,
  type CampaignExperimentView,
  type ReactivationArmCounts,
  type ReactivationArmRow,
  type ArmOutcomes,
  type ExperimentKind,
  type ExperimentResult,
  type ExperimentVariant,
  type PrimaryMetric,
} from "./experiments";

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
};

export const EXPERIMENT_FIELDS =
  "id, business_id, kind, target_id, name, status, holdout_percent, variants, primary_metric, min_sample_per_arm, created_at, started_at, stopped_at";

function db(): Untyped {
  return createAdminClient() as unknown as Untyped;
}

export async function runningExperiment(
  businessId: string,
  kind: ExperimentKind,
  targetId: string,
): Promise<ExperimentRow | null> {
  try {
    const { data, error } = await db()
      .from("experiments")
      .select(EXPERIMENT_FIELDS)
      .eq("business_id", businessId)
      .eq("kind", kind)
      .eq("target_id", targetId)
      .eq("status", "RUNNING")
      .maybeSingle();
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
  return [...first.entries()].map(([leadId, at]) => ({ lead_id: leadId, arm: armForLead(experiment, leadId), assigned_at: at }));
}

/**
 * Outcomes per arm, from the workspace's own data. A booking or a win counts
 * only after the lead was exposed; a positive reply or an opt-out likewise.
 */
export async function experimentResults(
  businessId: string,
  experiment: ExperimentRow,
): Promise<ExperimentResult> {
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

  return computeExperimentResult({
    metric: experiment.primary_metric,
    minSamplePerArm: experiment.min_sample_per_arm,
    arms: [...byArm.values()],
  });
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
  const { data, error } = await db()
    .from("experiments")
    .select(EXPERIMENT_FIELDS)
    .eq("business_id", businessId)
    .eq("kind", "REACTIVATION")
    .eq("target_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(5);
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
    };
  } catch (error) {
    console.error("[experiments] campaign view failed", { campaignId, error });
    return null;
  }
}
