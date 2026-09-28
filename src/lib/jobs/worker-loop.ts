/**
 * The worker's claim loop, time-boxed inside the Vercel function limit.
 *
 * Pure: every side effect (claim, run, release, clock) is injected, so
 * `tests/queue-lanes.test.ts` drives it with a fake clock. The route
 * (`app/api/cron/worker/route.ts`) supplies the real ones.
 *
 * THE TIME BOX. The route has `maxDuration = 60`. The previous loop stopped
 * *starting* work 10 s after the request began, and the scheduler enqueues ran
 * inside those 10 s, so a tick processed 3-7 jobs (measured 2026-09-27: 720
 * ticks, mean 4.3, max 7). The budget is now per duration class, measured from
 * the start of the request (the platform limit counts from there too):
 *
 *   standard jobs may start until 40 s  (20 s of headroom)
 *   slow jobs     may start until 25 s  (35 s)
 *   long jobs     may start until 12 s  (48 s; sourcing.run self-limits to 45 s)
 *
 * Once a class's window has passed, its types are excluded from the claim
 * (`claim_jobs(..., exclude_types)`, migration 0163), so the loop keeps taking
 * short work instead of stopping at the first long job. Before 0163 is applied
 * the exclusion is unavailable: a claimed job that no longer fits is released
 * (put back as it was) and the loop ends, which is the old behaviour.
 */
import type { DurationClass } from "./lanes";

export const LATEST_START_MS: Record<DurationClass, number> = {
  long: 12_000,
  slow: 25_000,
  standard: 40_000,
};

/** Jobs claimed per round trip. Small, so little is left locked if time runs out. */
export const CLAIM_BATCH = 5;
/** Hard ceiling per invocation, whatever the clock says. */
export const MAX_JOBS_PER_TICK = 150;

export type LoopJob = { id: string; type: string; attempts: number };

export type WorkerLoopDeps<J extends LoopJob> = {
  now: () => number;
  /**
   * Claims up to `limit` due jobs, skipping `excludeTypes`. Returns `null`
   * when the database cannot exclude types (migration 0163 not applied);
   * the loop then retries the call with no exclusions.
   */
  claim: (limit: number, excludeTypes: string[]) => Promise<J[] | null>;
  /** Runs one job, recording completion or failure. Resolves true on success. */
  run: (job: J) => Promise<boolean>;
  /** Returns claimed-but-unstarted jobs to pending without using an attempt. */
  release: (jobs: J[]) => Promise<void>;
  durationOf: (type: string) => DurationClass;
  typesFor: (durations: DurationClass[]) => string[];
};

export type WorkerLoopResult = {
  claimed: number;
  completed: number;
  failed: number;
  released: number;
  stoppedBy: "empty" | "time" | "cap";
  exclusionSupported: boolean;
};

/** Duration classes whose start window has closed at `elapsed` ms. */
export function closedClasses(elapsed: number): DurationClass[] {
  return (Object.keys(LATEST_START_MS) as DurationClass[]).filter(
    (cls) => elapsed >= LATEST_START_MS[cls],
  );
}

export function canStart(duration: DurationClass, elapsed: number): boolean {
  return elapsed < LATEST_START_MS[duration];
}

export async function runWorkerLoop<J extends LoopJob>(
  startedAt: number,
  deps: WorkerLoopDeps<J>,
  options: { batch?: number; maxJobs?: number } = {},
): Promise<WorkerLoopResult> {
  const batch = options.batch ?? CLAIM_BATCH;
  const maxJobs = options.maxJobs ?? MAX_JOBS_PER_TICK;
  const result: WorkerLoopResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    released: 0,
    stoppedBy: "empty",
    exclusionSupported: true,
  };

  for (;;) {
    const elapsed = deps.now() - startedAt;
    if (!canStart("standard", elapsed)) {
      result.stoppedBy = "time";
      break;
    }
    if (result.claimed >= maxJobs) {
      result.stoppedBy = "cap";
      break;
    }

    const exclude = result.exclusionSupported ? deps.typesFor(closedClasses(elapsed)) : [];
    const limit = Math.min(batch, maxJobs - result.claimed);
    let jobs = await deps.claim(limit, exclude);
    if (jobs === null) {
      result.exclusionSupported = false;
      jobs = (await deps.claim(limit, [])) ?? [];
    }
    if (jobs.length === 0) {
      result.stoppedBy = "empty";
      break;
    }
    result.claimed += jobs.length;

    const unstarted: J[] = [];
    for (const job of jobs) {
      const now = deps.now() - startedAt;
      if (!canStart(deps.durationOf(job.type), now)) {
        unstarted.push(job);
        continue;
      }
      if (await deps.run(job)) result.completed += 1;
      else result.failed += 1;
    }

    if (unstarted.length > 0) {
      await deps.release(unstarted);
      result.released += unstarted.length;
      // Without exclusion the same job would be claimed straight back.
      if (!result.exclusionSupported) {
        result.stoppedBy = "time";
        break;
      }
    }
  }

  return result;
}
