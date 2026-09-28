import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { logWriteError } from "@/lib/supabase/write-result";
import type { ClaimedJob } from "./queue";

/**
 * The worker's side of claiming (worker-loop.ts). Kept apart from queue.ts,
 * which several workstreams edit, so the time-boxed loop does not collide
 * with them.
 */

/**
 * Claims up to `limit` due jobs, skipping `excludeTypes`.
 *
 * Returns `null` when exclusions were asked for and the database does not
 * know the three-argument `claim_jobs` yet (migration 0164 not applied): the
 * loop then claims without exclusions, which is the old behaviour. A claim
 * with no exclusions always uses the two-argument call, which both the old
 * and the new function accept.
 */
export async function claimJobBatch(
  limit: number,
  workerId: string,
  excludeTypes: string[],
): Promise<ClaimedJob[] | null> {
  const supabase = createAdminClient();
  const args: Record<string, unknown> = { batch_size: limit, worker: workerId };
  if (excludeTypes.length > 0) args.exclude_types = excludeTypes;

  const { data, error } = await supabase.rpc("claim_jobs", args as never);
  if (error) {
    if (excludeTypes.length > 0 && isSchemaLag(error)) return null;
    throw error;
  }
  return (data ?? []) as ClaimedJob[];
}

/**
 * Puts claimed-but-unstarted jobs back exactly as they were: pending, unlocked,
 * and with the attempt the claim added given back. Scoped to this worker's
 * lock, so a job the reaper already moved is left alone.
 */
export async function releaseJobs(jobs: ClaimedJob[], workerId: string): Promise<void> {
  const supabase = createAdminClient();
  await Promise.all(
    jobs.map(async (job) =>
      logWriteError(
        await supabase
          .from("jobs")
          .update({
            state: "pending",
            locked_at: null,
            locked_by: null,
            attempts: Math.max(0, job.attempts - 1),
          })
          .eq("id", job.id)
          .eq("locked_by", workerId)
          .eq("state", "running"),
        "queue: release unstarted job",
        { jobId: job.id, jobType: job.type },
      ),
    ),
  );
}
