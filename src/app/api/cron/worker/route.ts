import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeJob, enqueue, failJob, type ClaimedJob } from "@/lib/jobs/queue";
import { claimJobBatch, releaseJobs } from "@/lib/jobs/claim";
import { jobClassOf, typesWithDuration } from "@/lib/jobs/lanes";
import { runWorkerLoop } from "@/lib/jobs/worker-loop";
import { isCronAuthorized } from "@/lib/security/cron-auth";
import { runOpsAlertChecks } from "@/lib/ops/alerts";
import { isOpsCheckTick, isProviderProbeTick } from "@/lib/ops/alert-model";
import { handleJob } from "@/lib/jobs/registry";
// Side-effect import: registers every job handler before the loop runs.
import "@/lib/jobs/register";
import { scheduleEmailPolls } from "@/lib/jobs/handlers/email-poll";
import { scheduleAgents } from "@/lib/agents/scheduler";
import { scheduleCrmPullSweep } from "@/lib/jobs/handlers/crm-pull";
import { scheduleIntentSweep } from "@/lib/jobs/handlers/intent-sweep";
import { scheduleReengageSweep } from "@/lib/jobs/handlers/reengage";
import { scheduleVoiceReconcile } from "@/lib/jobs/handlers/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Queues the outreach sequence sweep, at most once every five minutes.
 *
 * The worker ticks every thirty seconds, and sweeping that often would be
 * waste — but a follow-up due at 09:00 must not wait for the nightly job
 * either. The idempotency key is bucketed to a five-minute window, so however
 * often this runs, only one sweep is ever queued per window.
 */
async function scheduleOutreachTick() {
  const bucket = Math.floor(Date.now() / (5 * 60_000));
  await enqueue(
    "outreach.tick",
    {},
    { idempotencyKey: `outreach.tick:${bucket}` },
  );
}

/**
 * Queues the social outreach sweep, on the same five-minute bucket.
 *
 * This is what makes connect-then-message run unattended. Before it existed,
 * `social_connection_states` had a correct state machine that only ever
 * advanced when somebody opened the queue and clicked -- so an invite accepted
 * on Friday evening sat unmessaged until Monday, which is the whole value of
 * the channel lost to a missing cron line.
 *
 * Five minutes is far finer than the channel needs (its gaps are measured in
 * days) and is chosen to match the outreach sweep rather than for its own
 * sake: the sweep is a cheap indexed query that queues nothing when nothing is
 * due, so the cost of running it often is close to zero and the benefit is that
 * an acceptance is acted on while the person still remembers accepting.
 *
 * Kept separate from the outreach sweep rather than folded into it, because the
 * two answer different questions and fail independently: outreach asks "whose
 * next step is due", social asks "who has followed us back". A social provider
 * being down must not stop email follow-ups going out, and vice versa.
 */
async function scheduleSocialTick() {
  const bucket = Math.floor(Date.now() / (5 * 60_000));
  await enqueue("social.tick", {}, { idempotencyKey: `social.tick:${bucket}` });
}

/**
 * The schedulers that ride on every tick. Run concurrently, and each one's
 * failure is logged and contained: one scheduler throwing used to fail the
 * whole request before a single job was claimed.
 */
async function runSchedulers(): Promise<void> {
  const contained = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[cron/worker] scheduler ${name} failed`, error);
    }
  };
  await Promise.all([
    // Customer mailboxes cannot call us, so each tick re-queues a poll per
    // connected workspace. The per-workspace idempotency key means a poll
    // already pending or running is never queued twice.
    contained("email.poll", async () => { await scheduleEmailPolls(); }),
    contained("agents", async () => { await scheduleAgents(); }),
    contained("outreach.tick", async () => { await scheduleOutreachTick(); }),
    contained("social.tick", async () => { await scheduleSocialTick(); }),
    // Opt-in CRM pull (§29): one sweep per fifteen-minute bucket, which queues a
    // pull for each integration whose pull is switched on.
    contained("crm.pull", async () => { await scheduleCrmPullSweep(); }),
    // Qualification intelligence (design 08 §B.5): one intent sweep per six-hour
    // bucket re-assesses leads whose intent has decayed past a boundary, which
    // is how silence and an expired timeframe re-score a lead nobody touched.
    contained("intent.sweep", async () => { await scheduleIntentSweep(); }),
    // Intent-driven re-engagement: one sweep per hour bucket plans any NOT_NOW
    // resume, stated deadline, no-show or win-back that is due and has no
    // trigger job yet (the domain-event consumer plans most of them at once).
    contained("reengage.sweep", async () => { await scheduleReengageSweep(); }),
    // Voice: one sweep per fifteen-minute bucket closes calls stuck live (a
    // crashed dial, a lost CALL_ENDED), which otherwise block the lead for good.
    contained("voice.reconcile", async () => { await scheduleVoiceReconcile(); }),
  ]);
}

/** The ops alert check gets at most this long, and only with time to spare. */
const OPS_CHECK_TIMEOUT_MS = 8_000;
const OPS_CHECK_LATEST_START_MS = 45_000;

export async function GET(request: Request) {
  // The time box is measured from here: Vercel's maxDuration counts from the
  // start of the request, not from the first claim (worker-loop.ts).
  const startedAt = Date.now();
  const tickAt = new Date(startedAt);

  if (!isCronAuthorized(request, serverEnv.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  // Also dead-letters a job that has stalled on its last attempt (0164).
  const { error: reapError } = await supabase.rpc("reap_stalled_jobs", { stale_after: "5 minutes" });
  if (reapError) console.error("[cron/worker] reap_stalled_jobs failed", reapError.message);

  await runSchedulers();

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

  const result = await runWorkerLoop<ClaimedJob>(startedAt, {
    now: Date.now,
    claim: (limit, excludeTypes) => claimJobBatch(limit, workerId, excludeTypes),
    release: (jobs) => releaseJobs(jobs, workerId),
    durationOf: (type) => jobClassOf(type).duration,
    typesFor: typesWithDuration,
    run: async (job) => {
      try {
        await handleJob(job);
        await completeJob(job.id);
        return true;
      } catch (error) {
        const permanent =
          error instanceof Error && error.name === "PermanentJobError";
        await failJob(job, error, permanent);
        return false;
      }
    },
  });

  // Push alerts (lib/ops/alerts.ts): one tick in each five minutes, and only
  // when the jobs above left room inside the function limit.
  let ops: string[] | undefined;
  if (isOpsCheckTick(tickAt) && Date.now() - startedAt < OPS_CHECK_LATEST_START_MS) {
    const check = runOpsAlertChecks("worker", { now: tickAt, probeProviders: isProviderProbeTick(tickAt) });
    const outcome = await Promise.race([
      check,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), OPS_CHECK_TIMEOUT_MS)),
    ]);
    ops = outcome ? outcome.sent : ["timeout"];
  }

  return NextResponse.json({
    claimed: result.claimed,
    completed: result.completed,
    failed: result.failed,
    released: result.released,
    stoppedBy: result.stoppedBy,
    elapsedMs: Date.now() - startedAt,
    ...(ops ? { ops } : {}),
  });
}
