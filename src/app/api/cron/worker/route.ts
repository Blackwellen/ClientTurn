import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimJobs, completeJob, failJob, type ClaimedJob } from "@/lib/jobs/queue";
import { handleJob } from "@/lib/jobs/registry";
// Side-effect import: registers every job handler before the loop runs.
import "@/lib/jobs/register";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 25;

export async function GET(request: Request) {
  const secret = serverEnv.cronSecret;
  const provided =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    new URL(request.url).searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  await supabase.rpc("reap_stalled_jobs", { stale_after: "5 minutes" });

  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
  const jobs = await claimJobs(BATCH_SIZE, workerId);

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
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

  return NextResponse.json({ claimed: jobs.length, completed, failed });
}
