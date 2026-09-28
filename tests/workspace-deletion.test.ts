import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  DAY_MS,
  decide,
  deletionDueAt,
  noticeCopy,
  runWorkspaceDeletion,
  tenantPrefixes,
  type DeletionSchedule,
  type WorkspaceDeletionDeps,
} from "../src/lib/billing/workspace-deletion.ts";

/**
 * Day-90 deletion after cancellation (docs/BILLING.md §3). Everything runs on
 * fakes: an in-memory schedule, a counting notifier, a fake data-rights
 * eraser and a fake R2. No database, no email, no bucket.
 */

const ENDED = "2026-06-01T00:00:00.000Z";
const at = (days: number) => new Date(new Date(ENDED).getTime() + days * DAY_MS + 3_600_000);
const BIZ = "11111111-2222-4333-8444-555555555555";

type World = {
  now: Date;
  subscriptionCancelled: boolean;
  schedule: Map<string, DeletionSchedule>;
  notices: { businessId: string; day: number; title: string }[];
  subjects: number;
  erasedTotal: number;
  tombstones: string[];
  purged: string[];
  closed: string[];
  audit: string[];
  holdOnReread: boolean;
};

function world(overrides: Partial<World> = {}): World {
  return {
    now: at(0),
    subscriptionCancelled: true,
    schedule: new Map(),
    notices: [],
    subjects: 3,
    erasedTotal: 0,
    tombstones: [],
    purged: [],
    closed: [],
    audit: [],
    holdOnReread: false,
    ...overrides,
  };
}

function deps(w: World): WorkspaceDeletionDeps {
  return {
    now: () => w.now,
    async endedSubscriptions() {
      return w.subscriptionCancelled ? [{ businessId: BIZ, endedAt: ENDED }] : [];
    },
    async schedules() {
      return [...w.schedule.values()].filter((row) => !row.deletedAt).map((row) => ({ ...row }));
    },
    async upsertSchedule(businessId, endedAt) {
      const old = w.schedule.get(businessId);
      w.schedule.set(businessId, {
        businessId, endedAt, noticeDay60At: null, noticeDay83At: null,
        hold: old?.hold ?? false, holdReason: old?.holdReason ?? null, deletionStartedAt: null, deletedAt: null,
      });
    },
    async dropSchedule(businessId) {
      w.schedule.delete(businessId);
    },
    async sendNotice(businessId, day, copy) {
      w.notices.push({ businessId, day, title: copy.title });
    },
    async markNotice(businessId, day, when) {
      const row = w.schedule.get(businessId)!;
      if (day === 60) row.noticeDay60At ??= when.toISOString();
      else row.noticeDay83At ??= when.toISOString();
    },
    async stillDue(businessId) {
      const row = w.schedule.get(businessId);
      return w.subscriptionCancelled && Boolean(row) && !row!.hold && !w.holdOnReread && !row!.deletedAt;
    },
    async markStarted(businessId, when) {
      w.schedule.get(businessId)!.deletionStartedAt = when.toISOString();
    },
    async eraseSubjects(_businessId, limit) {
      const erased = Math.min(limit, w.subjects);
      w.subjects -= erased;
      w.erasedTotal += erased;
      return { erased, remaining: w.subjects };
    },
    async tombstonePrefixes(_businessId, prefixes) {
      for (const prefix of prefixes) if (!w.tombstones.includes(prefix)) w.tombstones.push(prefix);
    },
    async purgeTombstones(businessId) {
      const pending = w.tombstones.filter((key) => !w.purged.includes(key) && (!businessId || key.includes(businessId)));
      w.purged.push(...pending);
      return { purged: pending.length, failures: 0 };
    },
    async closeWorkspace(businessId) {
      assert.equal(w.subjects, 0, "the workspace is only closed after every subject went through data_rights_delete");
      w.closed.push(businessId);
    },
    async markDeleted(businessId, when) {
      w.schedule.get(businessId)!.deletedAt = when.toISOString();
      w.audit.push("deleted");
    },
    async recordRun() {
      w.audit.push("progress");
    },
  };
}

async function runAt(w: World, days: number, options: { dryRun?: boolean; subjectsPerRun?: number } = {}) {
  w.now = at(days);
  return runWorkspaceDeletion(deps(w), options);
}

describe("the day-90 timeline", () => {
  test("read-only until day 60, one notice at 60, one at 83, deletion at 90", async () => {
    const w = world();
    await runAt(w, 1);
    assert.equal(w.schedule.size, 1, "scheduled the day after it ended");
    await runAt(w, 59);
    assert.equal(w.notices.length, 0);

    await runAt(w, 60);
    assert.deepEqual(w.notices.map((n) => n.day), [60]);
    await runAt(w, 60);
    await runAt(w, 61);
    assert.equal(w.notices.length, 1, "the day-60 notice is idempotent");

    await runAt(w, 83);
    assert.deepEqual(w.notices.map((n) => n.day), [60, 83]);
    await runAt(w, 84);
    assert.equal(w.notices.length, 2);

    await runAt(w, 89);
    assert.equal(w.closed.length, 0, "still read-only on day 89");

    const report = await runAt(w, 90);
    assert.equal(report.deleted, 1);
    assert.deepEqual(w.closed, [BIZ]);
    assert.equal(w.erasedTotal, 3);
    assert.deepEqual(w.tombstones, tenantPrefixes(BIZ));
    assert.deepEqual(w.purged, tenantPrefixes(BIZ));
    assert.ok(w.schedule.get(BIZ)!.deletedAt);

    const after = await runAt(w, 91);
    assert.equal(after.deleted, 0, "a deleted workspace is never processed again");
  });

  test("a late final notice pushes deletion 7 days after it, and the stale day-60 notice is not sent", async () => {
    const w = world();
    await runAt(w, 95);
    assert.deepEqual(w.notices.map((n) => n.day), [83]);
    assert.ok(w.schedule.get(BIZ)!.noticeDay60At, "day-60 marked superseded");
    await runAt(w, 100);
    assert.equal(w.closed.length, 0, "not deleted within 7 days of the only warning");
    await runAt(w, 102);
    assert.deepEqual(w.closed, [BIZ]);
  });

  test("a held workspace gets no notice and is never deleted; releasing resumes", async () => {
    const w = world();
    await runAt(w, 1);
    w.schedule.get(BIZ)!.hold = true;
    w.schedule.get(BIZ)!.holdReason = "Payment dispute";
    const report = await runAt(w, 120);
    assert.equal(report.held, 1);
    assert.equal(w.notices.length, 0);
    assert.equal(w.closed.length, 0);

    w.schedule.get(BIZ)!.hold = false;
    await runAt(w, 121);
    assert.deepEqual(w.notices.map((n) => n.day), [83], "released: the final notice first");
    await runAt(w, 124);
    assert.equal(w.closed.length, 0);
    await runAt(w, 128);
    assert.deepEqual(w.closed, [BIZ]);
  });

  test("a hold set between planning and erasing is honoured (re-read before acting)", async () => {
    const w = world();
    await runAt(w, 83);
    w.holdOnReread = true;
    await runAt(w, 95);
    assert.equal(w.erasedTotal, 0);
    assert.equal(w.closed.length, 0);
  });

  test("resubscribing clears the schedule and its notices", async () => {
    const w = world();
    await runAt(w, 60);
    assert.equal(w.notices.length, 1);
    w.subscriptionCancelled = false;
    const report = await runAt(w, 70);
    assert.equal(report.cleared, 1);
    assert.equal(w.schedule.size, 0);
  });

  test("a large workspace is erased over several runs, then closed", async () => {
    const w = world({ subjects: 5 });
    await runAt(w, 83);
    const first = await runAt(w, 90, { subjectsPerRun: 2 });
    assert.equal(first.inProgress, 1);
    assert.equal(w.closed.length, 0);
    await runAt(w, 91, { subjectsPerRun: 2 });
    await runAt(w, 92, { subjectsPerRun: 2 });
    assert.deepEqual(w.closed, [BIZ]);
    assert.equal(w.erasedTotal, 5);
  });
});

describe("dry run", () => {
  test("reports the plan and writes nothing", async () => {
    const w = world();
    const report = await runAt(w, 95, { dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(report.scheduled, 1);
    assert.equal(report.notices, 1);
    assert.equal(report.plans[0].decision, "notice");
    assert.equal(w.schedule.size, 0, "no schedule row written");
    assert.equal(w.notices.length, 0);
    assert.equal(w.erasedTotal, 0);
    assert.equal(w.closed.length, 0);
  });
});

describe("pure rules", () => {
  test("decide and the due date", () => {
    const base: DeletionSchedule = {
      businessId: BIZ, endedAt: ENDED, noticeDay60At: null, noticeDay83At: null,
      hold: false, holdReason: null, deletionStartedAt: null, deletedAt: null,
    };
    assert.deepEqual(decide(base, at(10)), { kind: "skip", reason: "read_only" });
    assert.equal(decide(base, at(60)).kind, "notice");
    assert.equal(deletionDueAt(base).toISOString(), new Date(new Date(ENDED).getTime() + 90 * DAY_MS).toISOString());
    const lateNotice = { ...base, noticeDay83At: at(95).toISOString() };
    assert.equal(deletionDueAt(lateNotice).getTime(), at(95).getTime() + 7 * DAY_MS);
  });

  test("the notice states the date, what goes, what stays and how to keep it", () => {
    const copy = noticeCopy(83, new Date("2026-08-30T00:00:00Z"));
    assert.match(copy.title, /30 August 2026/);
    assert.match(copy.body, /in 7 days/);
    assert.match(copy.body, /Export/);
    assert.match(copy.body, /resubscribe/);
    assert.match(copy.body, /Billing and tax records/);
  });

  test("R2 prefixes are scoped to one workspace", () => {
    for (const prefix of tenantPrefixes(BIZ)) assert.match(prefix, new RegExp(`^(logo|import|support|quotes)/${BIZ}/$`));
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("the daily cron enqueues the job and the worker registers it", () => {
    assert.match(read("src/app/api/cron/daily/route.ts"), /enqueue\("billing\.workspace_deletion"/);
    assert.match(read("src/lib/jobs/register.ts"), /registerHandler\("billing\.workspace_deletion", handleWorkspaceDeletion\)/);
    assert.match(read("src/lib/jobs/queue.ts"), /"billing\.workspace_deletion"/);
    assert.match(read("docs/CRON.md"), /billing\.workspace_deletion/);
  });

  test("deletion is a dry run until explicitly enabled", () => {
    const handler = read("src/lib/jobs/handlers/workspace-deletion.ts");
    assert.match(handler, /const dryRun = input\.dryRun === true \|\| !workspaceDeletionEnabled\(\)/);
    assert.match(handler, /WORKSPACE_DELETION_ENABLED === "true"/);
  });

  test("erasure goes through the data-rights path; objects through tombstones", () => {
    const live = read("src/lib/billing/workspace-deletion-live.ts");
    assert.match(live, /deleteSubject\("LEAD"/);
    assert.match(live, /deleteSubject\("PROSPECT"/);
    assert.match(live, /from\("r2_object_tombstones"\)/);
    assert.match(live, /rpc\("workspace_close_after_retention"/);
  });

  test("migration 0170: schedule with hold, scoped tombstones, and a close that refuses while subjects remain", () => {
    const sql = read("supabase/migrations/0170_workspace_day90_deletion.sql");
    assert.match(sql, /create table if not exists public\.workspace_deletion_schedule/);
    assert.match(sql, /hold boolean not null default false/);
    assert.match(sql, /check \(not hold or hold_reason is not null\)/);
    assert.match(sql, /r2_tombstone_prefix_scoped/);
    assert.match(sql, /still has % leads and % prospects/);
    assert.match(sql, /revoke all on public\.workspace_deletion_schedule from anon, authenticated/);
  });

  test("the admin view lists deletions and the hold is guarded", () => {
    assert.ok(existsSync(new URL("../src/app/admin/(ops)/billing/deletions/page.tsx", import.meta.url)));
    const actions = read("src/lib/admin/workspace-deletion-actions.ts");
    assert.match(actions, /return guarded\(/);
    assert.match(actions, /recordAudit\(/);
  });
});
