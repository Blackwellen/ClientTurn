import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AGED_FLOOR,
  JOB_CLASSES,
  LANE_PRIORITY,
  claimOrder,
  defaultPriorityFor,
  effectivePriority,
  jobClassOf,
  reapDecision,
  typesWithDuration,
} from "../src/lib/jobs/lanes.ts";
import { LATEST_START_MS, closedClasses, runWorkerLoop, type LoopJob } from "../src/lib/jobs/worker-loop.ts";

/**
 * Queue reliability (gap audit top-10 #6): the reaper dead-letters, lanes keep
 * time-critical work first without starving the rest, and the worker's claim
 * loop stays inside the 60 s function limit. The SQL (migration 0164) is
 * checked to carry the same rules as the TypeScript mirror.
 */

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/0164_job_reaper_max_attempts_and_lanes.sql"),
  "utf8",
);

describe("reaper dead-letter", () => {
  test("a stalled job on its last attempt is dead, earlier attempts go back to pending", () => {
    assert.equal(reapDecision(5, 5), "dead");
    assert.equal(reapDecision(6, 5), "dead");
    assert.equal(reapDecision(1, 5), "pending");
    assert.equal(reapDecision(4, 5), "pending");
    assert.equal(reapDecision(1, 1), "dead");
  });

  test("the migration's reap_stalled_jobs checks attempts >= max_attempts and sets dead", () => {
    const body = migration.slice(
      migration.indexOf("function public.reap_stalled_jobs"),
      migration.indexOf("drop function if exists public.claim_jobs"),
    );
    assert.match(body, /case when attempts >= max_attempts then 'dead' else 'pending' end/);
    assert.match(body, /where state = 'running'\s+and locked_at < now\(\) - stale_after/);
    assert.match(body, /Dead-lettered by reap_stalled_jobs/);
  });

  test("the reap loop terminates: a job always killed at the time limit dies after max_attempts claims", () => {
    // Claim (attempts + 1), killed mid-run, then reaped, as the database does.
    let job: { attempts: number; maxAttempts: number; state: string } = { attempts: 0, maxAttempts: 5, state: "pending" };
    let claims = 0;
    while (job.state !== "dead" && claims < 50) {
      job = { ...job, attempts: job.attempts + 1, state: "running" };
      claims += 1;
      job = { ...job, state: reapDecision(job.attempts, job.maxAttempts) };
    }
    assert.equal(job.state, "dead");
    assert.equal(claims, 5);
  });
});

describe("lanes and priority ordering", () => {
  test("critical types default to the critical lane; quotes and invoices standard; sourcing bulk", () => {
    for (const type of ["message.process_inbound", "agent.run", "lead.process", "voice.dial", "voice.webhook_ingest", "payment.confirm"]) {
      assert.equal(defaultPriorityFor(type), LANE_PRIORITY.CRITICAL, type);
    }
    assert.equal(defaultPriorityFor("message.send"), LANE_PRIORITY.INTERACTIVE);
    for (const type of ["quote.render_pdf", "quote.nudge", "invoice.issue", "invoice.remind"]) {
      assert.equal(defaultPriorityFor(type), LANE_PRIORITY.STANDARD, type);
    }
    assert.equal(defaultPriorityFor("sourcing.run"), LANE_PRIORITY.BULK);
    assert.equal(defaultPriorityFor("some.future_type"), LANE_PRIORITY.STANDARD);
  });

  test("critical never ages and is never overtaken, however long bulk has waited", () => {
    assert.equal(effectivePriority(10, 10_000), 10);
    assert.equal(effectivePriority(5, 10_000), 5);
    assert.equal(effectivePriority(200, 10_000), AGED_FLOOR);
    assert.ok(effectivePriority(200, 1e9) > effectivePriority(10, 0));
    const now = Date.parse("2026-09-28T12:00:00Z");
    const order = claimOrder(
      [
        { id: "bulk-3-days-old", priority: 200, runAt: now - 3 * 86_400_000 },
        { id: "quote-2h", priority: 100, runAt: now - 2 * 3_600_000 },
        { id: "voice-dial-now", priority: 10, runAt: now },
        { id: "inbound-now", priority: 10, runAt: now - 1_000 },
      ],
      now,
    ).map((job) => job.id);
    assert.deepEqual(order.slice(0, 2), ["inbound-now", "voice-dial-now"]);
  });

  test("a follow-up send is claimed before fresh voice post-processing, quote and invoice work", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    const order = claimOrder(
      [
        { id: "quote", priority: defaultPriorityFor("quote.render_pdf"), runAt: now - 60_000 },
        { id: "invoice", priority: defaultPriorityFor("invoice.remind"), runAt: now - 60_000 },
        { id: "recording", priority: defaultPriorityFor("voice.recording_fetch"), runAt: now - 60_000 },
        { id: "send", priority: defaultPriorityFor("message.send"), runAt: now },
      ],
      now,
    ).map((job) => job.id);
    assert.equal(order[0], "send");
  });

  test("aging prevents starvation: a quote waiting two hours overtakes a fresh send", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    const order = claimOrder(
      [
        { id: "send-fresh", priority: 30, runAt: now },
        { id: "quote-2h", priority: 100, runAt: now - 120 * 60_000 },
      ],
      now,
    ).map((job) => job.id);
    assert.deepEqual(order, ["quote-2h", "send-fresh"]);
  });

  test("the migration's claim_jobs orders by the same effective priority and accepts exclusions", () => {
    const body = migration.slice(migration.indexOf("create or replace function public.claim_jobs"));
    assert.match(body, /when j\.priority <= 10 then j\.priority/);
    assert.match(body, /greatest\(11, j\.priority - floor\(extract\(epoch from \(now\(\) - j\.run_at\)\) \/ 60\)::integer\)/);
    assert.match(body, /exclude_types text\[\] default '\{\}'::text\[\]/);
    assert.match(body, /job_claims_paused/, "keeps the 0137 per-workspace pause");
    assert.match(body, /for update of j skip locked/);
    assert.match(migration, /drop function if exists public\.claim_jobs\(integer, text\);/);
  });

  test("every JobType in queue.ts has a lane, a duration and a health queue", () => {
    const source = readFileSync(path.join(root, "src/lib/jobs/queue.ts"), "utf8");
    const union = source.slice(source.indexOf("export type JobType ="), source.indexOf("export type EnqueueOptions"));
    const types = [...union.matchAll(/\|\s*"([a-z_.]+)"/g)].map((match) => match[1]);
    assert.ok(types.length > 60, `parsed ${types.length} job types`);
    const missing = types.filter((type) => !(type in JOB_CLASSES));
    assert.deepEqual(missing, [], `Add these to JOB_CLASSES in src/lib/jobs/lanes.ts: ${missing.join(", ")}`);
  });
});

describe("the time-boxed worker loop", () => {
  type Job = LoopJob & { cost: number };

  function harness(jobs: Job[], opts: { exclusion?: boolean } = {}) {
    let clock = 0;
    const queue = [...jobs];
    const ran: string[] = [];
    const released: string[] = [];
    const deps = {
      now: () => clock,
      claim: async (limit: number, exclude: string[]) => {
        if (exclude.length > 0 && opts.exclusion === false) return null;
        clock += 50; // one round trip
        const picked: Job[] = [];
        let i = 0;
        while (i < queue.length && picked.length < limit) {
          if (exclude.includes(queue[i].type)) i += 1;
          else picked.push(queue.splice(i, 1)[0]);
        }
        return picked;
      },
      run: async (job: Job) => {
        ran.push(job.id);
        clock += job.cost;
        return true;
      },
      release: async (list: Job[]) => {
        released.push(...list.map((job) => job.id));
        queue.unshift(...list);
      },
      durationOf: (type: string) => jobClassOf(type).duration,
      typesFor: typesWithDuration,
    };
    return { deps, ran, released, queue, clock: () => clock };
  }

  test("keeps claiming short jobs well past the old 10 s cut-off, and starts none after 40 s", async () => {
    const jobs = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, type: "notification.send", attempts: 1, cost: 1_000 }));
    const h = harness(jobs);
    const result = await runWorkerLoop(0, h.deps);
    assert.ok(result.completed > 30, `completed ${result.completed}`);
    assert.equal(result.stoppedBy, "time");
    assert.ok(h.clock() <= LATEST_START_MS.standard + 1_000 + 50, `finished at ${h.clock()} ms`);
  });

  test("a long job is not started late: it is skipped and short work behind it continues", async () => {
    const jobs: Job[] = [
      ...Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, type: "notification.send", attempts: 1, cost: 1_000 })),
      { id: "sourcing", type: "sourcing.run", attempts: 1, cost: 45_000 },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, type: "notification.send", attempts: 1, cost: 1_000 })),
    ];
    const h = harness(jobs);
    const result = await runWorkerLoop(0, h.deps);
    assert.ok(!h.ran.includes("sourcing"), "sourcing.run must not start after 12 s");
    assert.ok(h.ran.includes("t0"), "short jobs behind it still ran");
    assert.ok(h.queue.some((job) => job.id === "sourcing"), "left pending for the next tick");
    assert.equal(result.failed, 0);
  });

  test("a long job at the head of the queue runs while the tick is young", async () => {
    const h = harness([{ id: "sourcing", type: "sourcing.run", attempts: 1, cost: 40_000 }]);
    await runWorkerLoop(0, h.deps);
    assert.deepEqual(h.ran, ["sourcing"]);
  });

  test("before migration 0164 (no exclusion) an unstartable job is released and the loop ends", async () => {
    const jobs: Job[] = [
      ...Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, type: "notification.send", attempts: 1, cost: 1_000 })),
      { id: "sourcing", type: "sourcing.run", attempts: 2, cost: 45_000 },
      { id: "after", type: "notification.send", attempts: 1, cost: 1_000 },
    ];
    const h = harness(jobs, { exclusion: false });
    const result = await runWorkerLoop(0, h.deps);
    assert.equal(result.exclusionSupported, false);
    assert.ok(h.released.includes("sourcing"));
    assert.ok(!h.ran.includes("sourcing"));
    assert.equal(result.stoppedBy, "time");
  });

  test("closed duration classes widen with elapsed time", () => {
    assert.deepEqual(closedClasses(0), []);
    assert.deepEqual(closedClasses(12_000), ["long"]);
    assert.deepEqual(closedClasses(30_000).sort(), ["long", "slow"]);
  });

  test("an empty queue ends the loop at once", async () => {
    const h = harness([]);
    const result = await runWorkerLoop(0, h.deps);
    assert.equal(result.stoppedBy, "empty");
    assert.equal(result.claimed, 0);
  });
});
