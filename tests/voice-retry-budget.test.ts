import { test } from "node:test";
import assert from "node:assert/strict";
import { lawfulFallbacks, planRetry, voicemailAllowed, VOICEMAIL_SCRIPT_VERSION, type RetryInput } from "../src/lib/voice/retry-policy.ts";
import {
  availableSec,
  billableSeconds,
  checkConcurrency,
  checkRouteAllocation,
  compareQueueItems,
  crossedThresholds,
  DEFAULT_RESERVATION_SEC,
  orderQueue,
  release,
  reserve,
  settle,
  thresholdLevel,
  validateAllocations,
  type MinuteAccount,
  type QueueItem,
} from "../src/lib/voice/budget.ts";

// ------------------------------------------------------------ retry policy

const NOW = new Date("2026-09-28T10:00:00Z"); // Mon 11:00 BST

function retry(over: Partial<RetryInput> = {}): RetryInput {
  return {
    now: NOW,
    outcome: "NO_ANSWER",
    attemptNumber: 1,
    consentBasis: "CALL_REQUESTED",
    voicemail: { enabled: true, alreadyLeftForThisRequest: false },
    callingAsName: "Acme Studio",
    enquiryAt: new Date("2026-09-28T08:00:00Z"),
    recipient: { timezone: "Europe/London", region: "ENGLAND_AND_WALES", isMobile: true, isUk: true },
    channels: { SMS: { lawful: true }, WHATSAPP: { lawful: true }, EMAIL: { lawful: true } },
    ...over,
  };
}

test("retry spacing: busy 20 min, no answer 2 h, later attempts next day, inside hours", () => {
  const busy = planRetry(retry({ outcome: "BUSY" }));
  assert.deepEqual(busy.next, { action: "RETRY_CALL", at: new Date("2026-09-28T10:20:00Z"), attemptNumber: 2 });
  const na = planRetry(retry());
  assert.deepEqual(na.next, { action: "RETRY_CALL", at: new Date("2026-09-28T12:00:00Z"), attemptNumber: 2 });
  const second = planRetry(retry({ attemptNumber: 2, outcome: "BUSY" }));
  assert.deepEqual(second.next, { action: "RETRY_CALL", at: new Date("2026-09-29T10:00:00Z"), attemptNumber: 3 });
  // 19:30 BST + 2 h lands after hours: moved to the next morning.
  const late = planRetry(retry({ now: new Date("2026-09-28T18:30:00Z") }));
  assert.deepEqual(late.next, { action: "RETRY_CALL", at: new Date("2026-09-29T08:00:00Z"), attemptNumber: 2 });
  const transient = planRetry(retry({ outcome: "FAILED_TRANSIENT" }));
  assert.deepEqual(transient.next, { action: "RETRY_CALL", at: new Date("2026-09-28T10:30:00Z"), attemptNumber: 2 });
});

test("max attempts and permanent failure fall back to the first lawful channel", () => {
  const max = planRetry(retry({ attemptNumber: 3 }));
  assert.deepEqual(max.next, { action: "FALLBACK", channel: "SMS", reason: "MAX_ATTEMPTS" });
  const perm = planRetry(retry({ outcome: "FAILED_PERMANENT" }));
  assert.deepEqual(perm.next, { action: "FALLBACK", channel: "SMS", reason: "PERMANENT_FAILURE" });
  const noSmsLandline = planRetry(retry({ attemptNumber: 3, recipient: { timezone: "Europe/London", isMobile: false, isUk: true } }));
  assert.deepEqual(noSmsLandline.next, { action: "FALLBACK", channel: "WHATSAPP", reason: "MAX_ATTEMPTS" });
  const emailOnly = planRetry(retry({ attemptNumber: 3, channels: { SMS: { lawful: false }, WHATSAPP: { lawful: false, reason: "NO_OPT_IN" }, EMAIL: { lawful: true } } }));
  assert.deepEqual(emailOnly.next, { action: "FALLBACK", channel: "EMAIL", reason: "MAX_ATTEMPTS" });
  const none = planRetry(retry({ attemptNumber: 3, channels: {} }));
  assert.deepEqual(none.next, { action: "STOP", reason: "NO_LAWFUL_FALLBACK" });
  assert.deepEqual(lawfulFallbacks({ SMS: { lawful: true }, EMAIL: { lawful: true } }, true, ["EMAIL", "SMS"]), ["EMAIL", "SMS"]);
});

test("voicemail only with consent to automated calls, once, when switched on", () => {
  const vm = planRetry(retry({ outcome: "VOICEMAIL" }));
  assert.equal(vm.leaveVoicemail, true);
  assert.equal(vm.voicemailScriptVersion, VOICEMAIL_SCRIPT_VERSION);
  assert.equal(
    vm.voicemailScript,
    "Hello, this is an AI assistant calling from Acme Studio about the enquiry you sent us earlier today. Sorry we missed you. We will try you again at another time. Thank you, and goodbye.",
  );
  const last = planRetry(retry({ outcome: "VOICEMAIL", attemptNumber: 3 }));
  assert.match(last.voicemailScript ?? "", /We will send you a message/);
  assert.equal(planRetry(retry({ outcome: "VOICEMAIL", voicemail: { enabled: false, alreadyLeftForThisRequest: false } })).leaveVoicemail, false);
  assert.equal(planRetry(retry({ outcome: "VOICEMAIL", voicemail: { enabled: true, alreadyLeftForThisRequest: true } })).leaveVoicemail, false);
  assert.equal(planRetry(retry({ outcome: "VOICEMAIL", consentBasis: "PHONE_NUMBER_PROVIDED" })).leaveVoicemail, false);
  assert.equal(planRetry(retry({ outcome: "NO_ANSWER" })).leaveVoicemail, false);
  assert.equal(voicemailAllowed({ enabled: true, alreadyLeftForThisRequest: false, consentBasis: "FORM_CONSENT_TO_CALL" }), true);
  const script = planRetry(retry({ outcome: "VOICEMAIL" })).voicemailScript ?? "";
  assert.doesNotMatch(script, /£|\$|\d+%|today only|last chance/i);
});

// ------------------------------------------------------------------ budget

const acct = (inc: number, pack: number): MinuteAccount => ({ includedRemainingSec: inc, packRemainingSec: pack, periodIncludedSec: 12000, reservations: {} });

test("billable seconds: per started minute (default) or per second", () => {
  const rows: [number, number][] = [
    [0, 0],
    [1, 60],
    [59, 60],
    [60, 60],
    [61, 120],
    [299.2, 300],
    [300, 300],
  ];
  for (const [s, b] of rows) assert.equal(billableSeconds(s), b, String(s));
  assert.equal(billableSeconds(61, { mode: "PER_SECOND" }), 61);
  assert.equal(billableSeconds(4, { mode: "PER_SECOND", minimumSec: 10 }), 10);
  assert.equal(billableSeconds(0, { mode: "PER_SECOND", minimumSec: 10 }), 0);
});

test("reserve draws included first, then packs; refuses without overage", () => {
  assert.equal(DEFAULT_RESERVATION_SEC, 420);
  const r = reserve(acct(300, 600), "c1");
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual([r.reservation.fromIncludedSec, r.reservation.fromPackSec], [300, 120]);
    assert.deepEqual([r.account.includedRemainingSec, r.account.packRemainingSec], [0, 480]);
    assert.deepEqual(r.ledger, [{ kind: "RESERVE", callId: "c1", includedDeltaSec: -300, packDeltaSec: -120, idempotencyKey: "voice:reserve:c1" }]);
  }
  assert.deepEqual(reserve(acct(100, 100), "c2"), { ok: false, reason: "INSUFFICIENT_BALANCE", availableSec: 200 });
  assert.deepEqual(reserve(acct(1000, 0), "c3", 0), { ok: false, reason: "INVALID_AMOUNT", availableSec: 1000 });
  assert.deepEqual(reserve(acct(1000, 0), "c3", 1.5), { ok: false, reason: "INVALID_AMOUNT", availableSec: 1000 });
});

test("reserve is idempotent per call", () => {
  const r1 = reserve(acct(1000, 0), "c1");
  assert.ok(r1.ok);
  if (!r1.ok) return;
  const r2 = reserve(r1.account, "c1");
  assert.ok(r2.ok && r2.replay && r2.ledger.length === 0 && r2.account === r1.account);
});

test("settle charges the rounded actual and returns the rest, packs first", () => {
  const r = reserve(acct(300, 600), "c1"); // 300 included + 120 pack held
  assert.ok(r.ok);
  if (!r.ok) return;
  const s = settle(r.account, "c1", 125); // billed 180
  assert.ok(s.ok);
  if (s.ok) {
    assert.equal(s.billedSec, 180);
    assert.equal(s.shortfallSec, 0);
    // Refund 240: 120 back to packs, 120 back to included.
    assert.deepEqual([s.account.includedRemainingSec, s.account.packRemainingSec], [120, 600]);
    assert.deepEqual(s.ledger[0], { kind: "SETTLE", callId: "c1", includedDeltaSec: 120, packDeltaSec: 120, idempotencyKey: "voice:settle:c1" });
    // Conservation: start 900 = remaining 720 + billed 180.
    assert.equal(availableSec(s.account) + s.billedSec, 900);
    // Replay is a no-op.
    const again = settle(s.account, "c1", 125);
    assert.ok(again.ok && again.replay && again.billedSec === 180 && again.account === s.account);
    assert.deepEqual(release(s.account, "c1"), { ok: false, reason: "ALREADY_SETTLED" });
  }
});

test("settle arithmetic table (per started minute)", () => {
  const rows: [number, number, number, number][] = [
    // [included, pack, actualSec, expected available after]
    [1000, 0, 0, 1000],
    [1000, 0, 1, 940],
    [1000, 0, 60, 940],
    [1000, 0, 61, 880],
    [1000, 0, 420, 580],
    [0, 1000, 90, 880],
    [200, 300, 300, 200],
  ];
  for (const [inc, pack, actual, after] of rows) {
    const r = reserve(acct(inc, pack), "x");
    assert.ok(r.ok);
    if (!r.ok) continue;
    const s = settle(r.account, "x", actual);
    assert.ok(s.ok);
    if (s.ok) assert.equal(availableSec(s.account), after, `${inc}/${pack}/${actual}`);
  }
});

test("an overrun beyond the hold draws what is left and reports the shortfall", () => {
  const r = reserve(acct(420, 30), "c1");
  assert.ok(r.ok);
  if (!r.ok) return;
  const s = settle(r.account, "c1", 500); // billed 540, held 420, 30 left
  assert.ok(s.ok);
  if (s.ok) {
    assert.equal(s.billedSec, 540);
    assert.equal(s.shortfallSec, 90);
    assert.equal(availableSec(s.account), 0);
  }
});

test("release returns the whole hold, idempotently; settle after release is refused", () => {
  const r = reserve(acct(300, 600), "c1");
  assert.ok(r.ok);
  if (!r.ok) return;
  const rel = release(r.account, "c1");
  assert.ok(rel.ok);
  if (rel.ok) {
    assert.deepEqual([rel.account.includedRemainingSec, rel.account.packRemainingSec], [300, 600]);
    const again = release(rel.account, "c1");
    assert.ok(again.ok && again.replay);
    assert.deepEqual(settle(rel.account, "c1", 30), { ok: false, reason: "ALREADY_RELEASED" });
    assert.equal(reserve(rel.account, "c1").ok, false);
  }
  assert.deepEqual(release(acct(1, 1), "nope"), { ok: false, reason: "NO_RESERVATION" });
  assert.deepEqual(settle(acct(1, 1), "nope", 10), { ok: false, reason: "NO_RESERVATION" });
});

test("route allocations", () => {
  assert.deepEqual(validateAllocations({ QUALIFICATION: 50, REACTIVATION: 30 }), { ok: true });
  assert.deepEqual(validateAllocations({ QUALIFICATION: 70, REACTIVATION: 40 }), { ok: false, reason: "SUM_OVER_100" });
  assert.deepEqual(validateAllocations({ NURTURE: -1 }), { ok: false, reason: "OUT_OF_RANGE" });
  const base = { allocations: { REACTIVATION: 20 }, periodTotalSec: 12000, requestSec: 420 };
  assert.deepEqual(checkRouteAllocation({ ...base, route: "REACTIVATION", usedByRouteSec: 1800 }), { allowed: true, capSec: 2400 });
  assert.deepEqual(checkRouteAllocation({ ...base, route: "REACTIVATION", usedByRouteSec: 2000 }), { allowed: false, reason: "ROUTE_ALLOCATION_EXHAUSTED", capSec: 2400 });
  assert.deepEqual(checkRouteAllocation({ ...base, route: "QUALIFICATION", usedByRouteSec: 99999 }), { allowed: true, capSec: null });
});

test("concurrency slots: platform then workspace", () => {
  assert.deepEqual(checkConcurrency({ workspaceActive: 1, platformActive: 5 }), { allowed: true });
  assert.deepEqual(checkConcurrency({ workspaceActive: 2, platformActive: 5 }), { allowed: false, reason: "WORKSPACE_CONCURRENCY_FULL" });
  assert.deepEqual(checkConcurrency({ workspaceActive: 0, platformActive: 20 }), { allowed: false, reason: "PLATFORM_CONCURRENCY_FULL" });
  assert.deepEqual(checkConcurrency({ workspaceActive: 4, platformActive: 0, workspaceLimit: 5 }), { allowed: true });
});

test("dial order: callback > fresh request > booking > direct close > qualification > nurture > reactivation", () => {
  const t = (m: number) => new Date(NOW.getTime() + m * 60000);
  const items: QueueItem[] = [
    { id: "r", priority: "REACTIVATION", notBefore: t(-60), createdAt: t(-60) },
    { id: "n", priority: "NURTURE", notBefore: t(-60), createdAt: t(-60) },
    { id: "q", priority: "QUALIFICATION", notBefore: t(-60), createdAt: t(-60) },
    { id: "d", priority: "DIRECT_CLOSE", notBefore: t(-60), createdAt: t(-60) },
    { id: "b", priority: "BOOKING_CLOSE", notBefore: t(-60), createdAt: t(-60) },
    { id: "f", priority: "CALL_REQUESTED_FRESH", notBefore: t(-1), createdAt: t(-1) },
    { id: "c", priority: "INBOUND_CALLBACK", notBefore: t(0), createdAt: t(0) },
    { id: "future", priority: "INBOUND_CALLBACK", notBefore: t(5), createdAt: t(-100) },
    { id: "q0", priority: "QUALIFICATION", notBefore: t(-90), createdAt: t(-90) },
  ];
  assert.deepEqual(orderQueue(items, NOW).map((i) => i.id), ["c", "f", "b", "d", "q0", "q", "n", "r"]);
  const a = { id: "a", priority: "NURTURE" as const, notBefore: t(0), createdAt: t(0) };
  assert.equal(compareQueueItems(a, { ...a, id: "b" }), -1);
});

test("balance thresholds at 75, 90 and 100 percent, each alerted once", () => {
  assert.equal(thresholdLevel(0, 12000), "NONE");
  assert.equal(thresholdLevel(8999, 12000), "NONE");
  assert.equal(thresholdLevel(9000, 12000), "T75");
  assert.equal(thresholdLevel(10800, 12000), "T90");
  assert.equal(thresholdLevel(12000, 12000), "T100");
  assert.equal(thresholdLevel(5, 0), "T100");
  assert.deepEqual(crossedThresholds(8000, 11000, 12000), ["T75", "T90"]);
  assert.deepEqual(crossedThresholds(11000, 11500, 12000), []);
  assert.deepEqual(crossedThresholds(11500, 12000, 12000), ["T100"]);
  assert.deepEqual(crossedThresholds(0, 100, 0), []);
});
