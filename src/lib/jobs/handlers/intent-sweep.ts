import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { emitDomainEvent } from "@/lib/events/outbox";
import { loadEngineMode } from "@/lib/qualification-intelligence/service";
import { INTENT_SWEEP_BATCH_LIMIT } from "@/lib/qualification-intelligence/types";

/**
 * `intent.sweep` (design 08 §B.5): re-assess the leads whose intent has
 * decayed past a boundary.
 *
 * Intent decays with time, so a lead nobody touches still changes: a booking
 * request fades, a stated timeframe arrives, a NOT_NOW reaches its resume
 * date. Each assessment stores `valid_until`, the next such boundary. This
 * sweep finds current assessments whose boundary has passed and emits one
 * `intent.decay_due` domain event per lead; the outbox's re-score consumer
 * turns that into `lead.score` (RESCORE_ON), so silence and an expired
 * timeframe re-assess through the same path as every other trigger.
 *
 *   * Batch-limited: INTENT_SWEEP_BATCH_LIMIT per run, oldest boundary first,
 *     with a keyset cursor. A full batch queues its own continuation, capped
 *     per cron bucket, so a backlog drains without one run doing it all.
 *   * Retry-safe: the event's dedupe key is (lead, the boundary it is for),
 *     so a retried or overlapping sweep emits each once. lead.score is itself
 *     idempotent on the trigger.
 *   * Re-reads before acting (CLAUDE.md): each candidate is re-checked against
 *     the lead (still there, not anonymised) and the workspace's engine mode
 *     (OFF is skipped), at the moment of the sweep.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const SIX_HOURS_MS = 6 * 3_600_000;
/** A backlog drains over at most this many continuation runs per bucket. */
const MAX_PAGES_PER_BUCKET = 10;

export const intentSweepPayload = z.object({
  bucket: z.number().int().nonnegative().optional(),
  page: z.number().int().min(0).max(MAX_PAGES_PER_BUCKET).optional(),
  /** Keyset cursor: resume after (valid_until, id). */
  afterValidUntil: z.iso.datetime({ offset: true }).optional(),
  afterId: z.uuid().optional(),
});

/** Queued by the worker tick; the idempotency key makes it once per six-hour bucket. */
export async function scheduleIntentSweep(): Promise<void> {
  const bucket = Math.floor(Date.now() / SIX_HOURS_MS);
  await enqueue("intent.sweep", { bucket, page: 0 }, { idempotencyKey: `intent.sweep:${bucket}:0`, priority: 120 });
}

type DueRow = { id: string; business_id: string; lead_id: string; valid_until: string };

export async function handleIntentSweep(job: ClaimedJob): Promise<void> {
  const parsed = intentSweepPayload.safeParse(job.payload ?? {});
  if (!parsed.success) throw new PermanentJobError("intent.sweep: invalid payload");
  const { afterValidUntil, afterId } = parsed.data;
  const bucket = parsed.data.bucket ?? Math.floor(Date.now() / SIX_HOURS_MS);
  const page = parsed.data.page ?? 0;
  const client = db();
  const nowIso = new Date().toISOString();

  let query = client
    .from("lead_assessments")
    .select("id, business_id, lead_id, valid_until")
    .eq("is_current", true)
    .not("valid_until", "is", null)
    .lte("valid_until", nowIso)
    .order("valid_until", { ascending: true })
    .order("id", { ascending: true })
    .limit(INTENT_SWEEP_BATCH_LIMIT);
  if (afterValidUntil && afterId) {
    query = query.or(`valid_until.gt.${afterValidUntil},and(valid_until.eq.${afterValidUntil},id.gt.${afterId})`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`intent.sweep: read failed: ${error.message}`);
  const due = (data ?? []) as DueRow[];
  if (due.length === 0) return;

  // Re-read the leads now: a lead deleted or anonymised since its assessment
  // was written is skipped (the 0134 triggers would refuse its rows anyway).
  const leadIds = [...new Set(due.map((row) => row.lead_id))];
  const { data: leads, error: leadError } = await client
    .from("leads")
    .select("id, business_id, anonymised_at")
    .in("id", leadIds);
  if (leadError) throw new Error(`intent.sweep: lead read failed: ${leadError.message}`);
  const live = new Set(
    ((leads ?? []) as { id: string; business_id: string; anonymised_at: string | null }[])
      .filter((lead) => lead.anonymised_at === null)
      .map((lead) => `${lead.business_id}:${lead.id}`),
  );

  // The engine mode, once per workspace in the batch.
  const modes = new Map<string, string>();
  for (const businessId of new Set(due.map((row) => row.business_id))) {
    try {
      modes.set(businessId, await loadEngineMode(businessId));
    } catch (modeError) {
      console.error("[intent.sweep] engine mode read failed; workspace skipped this run", { businessId, error: modeError });
      modes.set(businessId, "OFF");
    }
  }

  let emitted = 0;
  for (const row of due) {
    if (!live.has(`${row.business_id}:${row.lead_id}`)) continue;
    if (modes.get(row.business_id) === "OFF") continue;
    const boundary = Date.parse(row.valid_until);
    const result = await emitDomainEvent({
      businessId: row.business_id,
      type: "intent.decay_due",
      subject: { type: "lead", id: row.lead_id },
      payload: { lead_id: row.lead_id, assessment_id: row.id, valid_until: row.valid_until },
      dedupeKey: `intent.decay_due:${row.lead_id}:${Number.isFinite(boundary) ? boundary : row.valid_until}`,
    });
    if (result.inserted) emitted += 1;
  }

  if (due.length === INTENT_SWEEP_BATCH_LIMIT && page + 1 < MAX_PAGES_PER_BUCKET) {
    const last = due[due.length - 1];
    await enqueue(
      "intent.sweep",
      { bucket, page: page + 1, afterValidUntil: new Date(Date.parse(last.valid_until)).toISOString(), afterId: last.id },
      { idempotencyKey: `intent.sweep:${bucket}:${page + 1}`, priority: 120 },
    );
  }

  if (emitted > 0) {
    console.info("[intent.sweep] decay boundaries passed", { bucket, page, due: due.length, emitted });
  }
}
