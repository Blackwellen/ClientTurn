import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  enforceVoiceRetention,
  isVoiceObjectKey,
  retentionCutoff,
  type RetentionRowKind,
  type VoiceRetentionDeps,
} from "../src/lib/data-rights/voice-retention.ts";

/**
 * Voice recording and transcript retention: rows past retention go, the
 * database trigger tombstones their objects, and a fake R2 proves the objects
 * are deleted exactly once -- including a deleted workspace's.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = new Date("2026-09-28T03:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

type Row = { id: string; businessId: string; kind: RetentionRowKind; objectKey: string | null; createdAt: string; retainUntil: string | null };

function world() {
  const settings = [
    { businessId: A, retentionDays: 30 },
    { businessId: B, retentionDays: 90 },
  ];
  const rows: Row[] = [
    // A, 30 days: 40 days old goes; 10 days old stays.
    { id: "r1", businessId: A, kind: "RECORDING", objectKey: `voice/recordings/${A}/11111111-1111-4111-8111-111111111111/a.mp3`, createdAt: days(40), retainUntil: days(-50) },
    { id: "r2", businessId: A, kind: "RECORDING", objectKey: `voice/recordings/${A}/22222222-2222-4222-8222-222222222222/a.mp3`, createdAt: days(10), retainUntil: days(-20) },
    { id: "t1", businessId: A, kind: "TRANSCRIPT", objectKey: null, createdAt: days(40), retainUntil: null },
    // B, 90 days: its own retain_until has passed even though it is only 20 days old.
    { id: "t2", businessId: B, kind: "TRANSCRIPT", objectKey: `voice/transcripts/${B}/33333333-3333-4333-8333-333333333333.json`, createdAt: days(20), retainUntil: days(1) },
    { id: "r3", businessId: B, kind: "RECORDING", objectKey: `voice/recordings/${B}/44444444-4444-4444-8444-444444444444/b.wav`, createdAt: days(20), retainUntil: days(-70) },
  ];
  // A workspace deleted earlier: its rows cascaded away, the trigger left tombstones.
  const tombstones = new Map<string, { businessId: string; kind: RetentionRowKind; purgedAt: string | null }>([
    [`voice/recordings/${GONE}/55555555-5555-4555-8555-555555555555/c.mp3`, { businessId: GONE, kind: "RECORDING", purgedAt: null }],
  ]);
  const r2 = new Set<string>([...rows.map((r) => r.objectKey).filter((k): k is string => Boolean(k)), ...tombstones.keys()]);
  const r2Deletes: string[] = [];
  let failKey: string | null = null;

  const deps: VoiceRetentionDeps = {
    now: () => NOW,
    async listRetention() {
      return settings;
    },
    async dueByRetainUntil(kind, now, limit) {
      return rows.filter((r) => r.kind === kind && r.retainUntil !== null && r.retainUntil <= now.toISOString()).slice(0, limit).map((r) => r.id);
    },
    async dueByAge(kind, businessId, cutoff, limit) {
      return rows.filter((r) => r.kind === kind && r.businessId === businessId && r.createdAt < cutoff.toISOString()).slice(0, limit).map((r) => r.id);
    },
    async deleteRows(kind, ids) {
      let n = 0;
      for (const id of ids) {
        const index = rows.findIndex((r) => r.id === id && r.kind === kind);
        if (index < 0) continue;
        const [row] = rows.splice(index, 1);
        n += 1;
        // The 0150 trigger: a tombstone per stored object, on conflict do nothing.
        if (row.objectKey && !tombstones.has(row.objectKey)) tombstones.set(row.objectKey, { businessId: row.businessId, kind: row.kind, purgedAt: null });
      }
      return n;
    },
    async pendingTombstones(limit) {
      return [...tombstones.entries()].filter(([, t]) => t.purgedAt === null).slice(0, limit).map(([objectKey, t]) => ({ objectKey, businessId: t.businessId, kind: t.kind }));
    },
    async markPurged(keys, at) {
      for (const key of keys) tombstones.get(key)!.purgedAt = at.toISOString();
    },
    async deleteObject(key) {
      if (key === failKey) throw new Error("R2 unavailable");
      r2Deletes.push(key);
      r2.delete(key); // S3/R2: deleting a missing key succeeds.
    },
  };
  return { deps, rows, tombstones, r2, r2Deletes, failNext: (key: string | null) => (failKey = key) };
}

describe("enforceVoiceRetention", () => {
  test("rows past retain_until or older than the workspace's retention are removed, and their objects purged", async () => {
    const w = world();
    const run = await enforceVoiceRetention(w.deps);
    assert.deepEqual(w.rows.map((r) => r.id).sort(), ["r2", "r3"]);
    assert.equal(run.recordingsDeleted, 1);
    assert.equal(run.transcriptsDeleted, 2);
    // r1 (age), t2 (retain_until) and the deleted workspace's tombstone. t1 had no object.
    assert.equal(run.objectsPurged, 3);
    assert.ok(![...w.r2].some((key) => key.includes(GONE)), "the deleted workspace's object is gone from R2");
    assert.ok(w.r2.has(`voice/recordings/${A}/22222222-2222-4222-8222-222222222222/a.mp3`), "a row inside retention keeps its object");
    assert.deepEqual(run.byWorkspace[A], { recordings: 1, transcripts: 1 });
  });

  test("idempotent: a second run deletes and purges nothing", async () => {
    const w = world();
    await enforceVoiceRetention(w.deps);
    const deletes = w.r2Deletes.length;
    const again = await enforceVoiceRetention(w.deps);
    assert.deepEqual(again, { recordingsDeleted: 0, transcriptsDeleted: 0, objectsPurged: 0, purgeFailures: 0, byWorkspace: {} });
    assert.equal(w.r2Deletes.length, deletes);
  });

  test("an R2 failure leaves the tombstone for the next run", async () => {
    const w = world();
    const key = `voice/recordings/${GONE}/55555555-5555-4555-8555-555555555555/c.mp3`;
    w.failNext(key);
    const first = await enforceVoiceRetention(w.deps);
    assert.equal(first.purgeFailures, 1);
    assert.equal(w.tombstones.get(key)!.purgedAt, null);
    w.failNext(null);
    const second = await enforceVoiceRetention(w.deps);
    assert.equal(second.objectsPurged, 1);
    assert.ok(w.tombstones.get(key)!.purgedAt);
  });

  test("a tombstone outside the voice prefixes is never deleted", async () => {
    const w = world();
    w.tombstones.set("quotes/x/y.pdf", { businessId: A, kind: "RECORDING", purgedAt: null });
    const run = await enforceVoiceRetention(w.deps);
    assert.ok(!w.r2Deletes.includes("quotes/x/y.pdf"));
    assert.equal(run.purgeFailures, 1);
  });

  test("runs are bounded", async () => {
    const w = world();
    const run = await enforceVoiceRetention(w.deps, { rowsPerKind: 1, tombstones: 1 });
    assert.ok(run.objectsPurged <= 1);
  });
});

describe("helpers", () => {
  test("the cutoff uses the workspace's days, clamped to 1-365, defaulting to 90", () => {
    assert.equal(retentionCutoff(NOW, 30).toISOString(), days(30));
    assert.equal(retentionCutoff(NOW, 0).toISOString(), days(90));
    assert.equal(retentionCutoff(NOW, 9999).toISOString(), days(365));
  });

  test("only the 0150 object key shapes count as voice objects", () => {
    assert.equal(isVoiceObjectKey(`voice/recordings/${A}/x/a.mp3`), true);
    assert.equal(isVoiceObjectKey(`voice/transcripts/${A}/x.json`), true);
    assert.equal(isVoiceObjectKey("logos/a.png"), false);
    assert.equal(isVoiceObjectKey("voice/recordings/../../etc"), false);
  });
});
