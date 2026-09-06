import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimJobs, completeJob, enqueue, failJob, type ClaimedJob } from "@/lib/jobs/queue";
import { handleJob } from "@/lib/jobs/registry";
// Side-effect import: registers every job handler before the loop runs.
import "@/lib/jobs/register";
import { scheduleEmailPolls } from "@/lib/jobs/handlers/email-poll";
import { scheduleAgents } from "@/lib/agents/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 25;

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

export async function GET(request: Request) {
  const startedAt = Date.now();
  const secret = serverEnv.cronSecret;
  const provided =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    new URL(request.url).searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  await supabase.rpc("reap_stalled_jobs", { stale_after: "5 minutes" });

  // Customer mailboxes cannot call us, so each tick re-queues a poll per
  // connected workspace. The per-workspace idempotency key means a poll
  // already pending or running is never queued twice.
  await scheduleEmailPolls();
  await scheduleAgents();
  await scheduleOutreachTick();

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  // Claim one at a time. A sourcing handler can use 45s; claiming a batch of
  // 25 upfront leaves unstarted work locked when Vercel ends the invocation.
  // Stop starting work after 10s, leaving 50s for the last bounded handler.
  while (claimed < BATCH_SIZE && Date.now() - startedAt < 10_000) {
    const [job] = await claimJobs(1, workerId);
    if (!job) break;
    claimed += 1;
    try {
      await handleJob(job as ClaimedJob);
      await completeJob(job.id);
      completed += 1;
    } catch (error) {
      const permanent =
        error instanceof Error && error.name === "PermanentJobError";
      await failJob(job as ClaimedJob, error, permanent);
      failed += 1;
    }
  }

  return NextResponse.json({ claimed, completed, failed });
}
