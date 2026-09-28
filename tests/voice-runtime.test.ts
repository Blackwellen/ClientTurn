import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  dialCall,
  ingestVoiceEvent,
  planCallRetry,
  postProcessCall,
  provisionStep,
  requestCall,
  startProvisioning,
  DIAL_STALE_AFTER_MS,
} from "../src/lib/voice/runtime-core.ts";
import type { VoiceEvent } from "../src/lib/voice/providers/types.ts";
import { ProviderRequestError } from "../src/lib/voice/providers/types.ts";
import { BIZ, LEAD, LEAD2, VoiceWorld, paidFacts, validDetails } from "./voice-world.ts";

/**
 * The voice runtime end to end with in-memory fakes: every path that can
 * place a call, the entitlement gate on each, idempotency (a double dial is
 * impossible; a crashed provisioning run recovers), webhook dedupe and
 * replay, and minute accounting. No network, no database, no spend.
 */

const QUAL = "QUALIFICATION" as const;

async function queued(w: VoiceWorld, leadId = LEAD) {
  const r = await requestCall(w.deps(), { businessId: BIZ, leadId, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { callId: string }).callId;
}

function ev(callId: string, providerCallId: string, e: Partial<VoiceEvent> & { type: VoiceEvent["type"] }, key: string): VoiceEvent {
  return {
    provider: "retell",
    dedupeKey: key,
    occurredAt: null,
    providerCallId,
    metadata: { voice_call_id: callId },
    ...e,
  } as VoiceEvent;
}

describe("manual request and dial", () => {
  test("a paid workspace queues a call, then the dial job places it exactly once", async () => {
    const w = new VoiceWorld();
    const callId = await queued(w);
    assert.equal(w.calls.get(callId)?.state, "QUEUED");
    assert.equal(w.eligibility.at(-1)?.decision, "ALLOWED");
    assert.ok(w.jobs.some((j) => j.type === "voice.dial" && j.payload.callId === callId));

    const r = await dialCall(w.deps(), callId);
    assert.equal(r.status, "DIALLED");
    assert.equal(w.providerCalls(), 1);
    const call = w.calls.get(callId)!;
    assert.equal(call.state, "DIALLING");
    assert.equal(call.reserved_sec, 420);
    // The locked OD-1 opener travels to the provider, never composed by a model.
    const req = w.voice!.log.find((l) => l.method === "startOutboundCall")!.arg as { dynamicVariables: Record<string, string> };
    assert.match(req.dynamicVariables.locked_preamble, /^This is an AI assistant calling from Acme Studio about the enquiry you sent us/);
    // Included minutes were drawn first.
    assert.equal(w.minutes.balanceOf(BIZ).includedRemainingSec, 200 * 60 - 420);
  });

  test("a double dial is impossible: a second (or concurrent) run never reaches the provider", async () => {
    const w = new VoiceWorld();
    const callId = await queued(w);
    const [a, b] = await Promise.all([dialCall(w.deps(), callId), dialCall(w.deps(), callId)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["DIALLED", "SKIPPED"]);
    assert.equal(await dialCall(w.deps(), callId).then((r) => r.status), "SKIPPED");
    assert.equal(w.providerCalls(), 1);
    // One hold, taken once.
    assert.equal(w.minutes.ledger.filter((l) => l.kind === "RESERVE").length, 1);
  });

  test("requesting the same call twice returns the queued one (idempotent)", async () => {
    const w = new VoiceWorld();
    const a = await queued(w);
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null, attemptNumber: 1 });
    assert.equal(r.ok && r.callId, a);
    assert.equal(r.ok && r.existing, true);
  });

  test("no two calls to the same lead at once, and no AI call while a person has taken over", async () => {
    const w = new VoiceWorld();
    const first = await queued(w);
    await dialCall(w.deps(), first);
    const second = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: "NURTURE", entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    // Deferred ("not now"), never placed alongside the live call.
    assert.equal(second.ok, true);
    assert.ok(second.ok && ["CALL_ALREADY_ACTIVE", "ATTEMPT_TOO_SOON"].includes(second.deferredReason ?? ""));

    const w2 = new VoiceWorld();
    const id = await queued(w2);
    w2.leads.get(LEAD)!.human_takeover = true;
    const r = await dialCall(w2.deps(), id);
    assert.equal(r.status, "DEFERRED");
    assert.equal(w2.providerCalls(), 0);
  });

  test("a full concurrency slot defers the dial rather than exceeding it", async () => {
    const w = new VoiceWorld();
    w.settings.workspace_concurrency = 1;
    const a = await queued(w, LEAD);
    const b = await queued(w, LEAD2);
    assert.equal((await dialCall(w.deps(), a)).status, "DIALLED");
    assert.equal((await dialCall(w.deps(), b)).status, "DEFERRED");
    assert.equal(w.providerCalls(), 1);
  });

  test("a provider failure closes the call as FAILED, never re-dials it, and returns the minutes", async () => {
    const w = new VoiceWorld();
    const id = await queued(w);
    w.voice!.failNext("startOutboundCall", new ProviderRequestError("retell", 503, "down"));
    assert.equal((await dialCall(w.deps(), id)).status, "FAILED");
    assert.equal(w.calls.get(id)!.state, "FAILED");
    assert.equal((await dialCall(w.deps(), id)).status, "SKIPPED");
    const post = await postProcessCall(w.deps(), { callId: id });
    assert.equal(post.status, "COMPLETE");
    assert.equal(w.minutes.balanceOf(BIZ).includedRemainingSec, 200 * 60);
  });

  test("a dial that crashed after winning DIALLING is closed once stale, not re-dialled", async () => {
    const w = new VoiceWorld();
    const id = await queued(w);
    const c = w.calls.get(id)!;
    w.calls.set(id, { ...c, state: "DIALLING", started_at: w.now.toISOString() });
    w.now = new Date(w.now.getTime() + DIAL_STALE_AFTER_MS + 1000);
    assert.equal((await dialCall(w.deps(), id)).status, "SKIPPED");
    assert.equal(w.calls.get(id)!.state, "FAILED");
    assert.equal(w.providerCalls(), 0);
  });

  test("keys absent: integration-required, never an unhandled throw", async () => {
    const w = new VoiceWorld();
    w.voice = null;
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.productState, "integration-required");
    w.numbersProvider = null;
    assert.equal((await provisionStep(w.deps(), BIZ)).outcome, "NOT_CONFIGURED");
  });
});

describe("the entitlement gate on every initiation path", () => {
  const unpaid: [string, Partial<ReturnType<typeof paidFacts>>][] = [
    ["a trial", { plan: "trial", subscriptionStatus: "TRIALING" }],
    ["a trial of Pro with the voice item", { plan: "pro", subscriptionStatus: "TRIALING" }],
    ["a free account", { plan: "free", subscriptionStatus: null }],
    ["a demo workspace", { businessStatus: "DEMO" }],
    ["a paid plan with no voice package", { grants: { proVoiceItem: false, numberItem: false }, packsHeld: false }],
    ["an inactive subscription", { subscriptionStatus: "PAST_DUE" }],
    ["a workspace paused by ClientTurn", { settings: { ...paidFacts().settings!, admin_kill_switch: true } }],
  ];

  for (const [label, overrides] of unpaid) {
    test(`${label}: the manual operation refuses and nothing is dialled`, async () => {
      const w = new VoiceWorld();
      w.facts = paidFacts(overrides);
      const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
      assert.equal(r.ok, false);
      assert.equal(w.calls.size, 0);
      assert.equal(w.providerCalls(), 0);
      assert.equal(w.eligibility.at(-1)?.decision, "DENIED");
    });

    test(`${label}: the dial job re-checks and cancels a call queued earlier`, async () => {
      const w = new VoiceWorld();
      const id = await queued(w);
      w.facts = paidFacts(overrides);
      const r = await dialCall(w.deps(), id);
      assert.equal(r.status, "CANCELLED");
      assert.equal(w.calls.get(id)!.state, "CANCELLED");
      assert.equal(w.providerCalls(), 0);
    });

    test(`${label}: a webhook-triggered retry is refused`, async () => {
      const w = new VoiceWorld();
      const id = await queued(w);
      await dialCall(w.deps(), id);
      const pid = w.calls.get(id)!.provider_call_id!;
      await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "NO_ANSWER", durationSec: 0, disconnectionReason: "dial_no_answer" }, `${pid}:call_ended`));
      await postProcessCall(w.deps(), { callId: id });
      assert.ok(w.jobs.some((j) => j.type === "voice.retry" && j.payload.callId === id));
      w.facts = paidFacts(overrides);
      const before = w.calls.size;
      const r = await planCallRetry(w.deps(), id);
      assert.equal(r.status, "REFUSED");
      assert.equal(w.calls.size, before);
      assert.equal(w.providerCalls(), 1);
    });
  }

  test("a paid retry is queued as a new attempt (and itself passes the gate)", async () => {
    const w = new VoiceWorld();
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "BUSY", durationSec: 0, disconnectionReason: "dial_busy" }, `${pid}:call_ended`));
    await postProcessCall(w.deps(), { callId: id });
    const r = await planCallRetry(w.deps(), id);
    assert.equal(r.status, "RETRY_QUEUED");
    const next = [...w.calls.values()].find((c) => c.id !== id)!;
    assert.equal(next.attempt_number, 2);
    assert.equal(next.state, "QUEUED");
  });

  test("no consent to be called: an AI call is refused even on a paid workspace", async () => {
    const w = new VoiceWorld();
    w.permissions.set(LEAD, { ...w.permissions.get(LEAD)!, consent_scope: ["PHONE_NUMBER_PROVIDED"] });
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL");
  });

  test("outside the lead's calling hours the call is booked for when they open, not placed now", async () => {
    const w = new VoiceWorld();
    w.settings = { ...w.settings, calling_hours: null };
    w.now = new Date("2026-09-28T19:30:00.000Z"); // 20:30 in London: after the default 20:00 close
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(r.ok && r.deferredReason, "OUTSIDE_CALLING_HOURS");
    assert.ok(r.ok && Date.parse(r.scheduledFor) > w.now.getTime());
  });
});

describe("webhook ingest: state, dedupe and replay", () => {
  test("events move the call; a duplicate delivery and a later replay change nothing", async () => {
    const w = new VoiceWorld();
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    const started = ev(id, pid, { type: "CALL_STARTED" }, `${pid}:call_started`);
    assert.equal((await ingestVoiceEvent(w.deps(), started)).status, "APPLIED");
    assert.equal(w.calls.get(id)!.state, "IN_CONVERSATION");
    assert.ok(w.calls.get(id)!.answered_at);
    assert.equal((await ingestVoiceEvent(w.deps(), started)).status, "DUPLICATE");

    const ended = ev(id, pid, { type: "CALL_ENDED", outcome: "COMPLETED", durationSec: 95, disconnectionReason: "user_hangup" }, `${pid}:call_ended`);
    await ingestVoiceEvent(w.deps(), ended);
    assert.equal(w.calls.get(id)!.state, "ENDED");
    assert.equal(w.calls.get(id)!.duration_sec, 95);
    assert.ok(w.jobs.some((j) => j.type === "voice.post_call"));
    assert.ok(w.jobs.some((j) => j.type === "voice.recording_fetch"));
    // Replayed later (a provider retry or an operator replay): recorded once only.
    assert.equal((await ingestVoiceEvent(w.deps(), ended)).status, "DUPLICATE");
    assert.equal(w.events.length, 2);
  });

  test("an out-of-order event never regresses a call", async () => {
    const w = new VoiceWorld();
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "COMPLETED", durationSec: 30, disconnectionReason: "user_hangup" }, `${pid}:call_ended`));
    const late = await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_STARTED" }, `${pid}:call_started`));
    assert.equal(late.status, "RECORDED");
    assert.equal(w.calls.get(id)!.state, "ENDED");
  });

  test("an event for no known call is unmatched, not an error", async () => {
    const w = new VoiceWorld();
    const r = await ingestVoiceEvent(w.deps(), { provider: "retell", type: "CALL_STARTED", dedupeKey: "x:call_started", occurredAt: null, providerCallId: "nope" });
    assert.equal(r.status, "UNMATCHED");
  });
});

describe("post-call: minutes, outcome, cost", () => {
  async function answered(w: VoiceWorld, durationSec: number, transcript: { role: "agent" | "user"; content: string }[]) {
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    const fake = w.voice!.calls.get(pid)!;
    fake.transcript = transcript.map((t) => ({ ...t, startMs: null, endMs: null }));
    fake.durationSec = durationSec;
    fake.status = "ENDED";
    await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_STARTED" }, `${pid}:call_started`));
    await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "COMPLETED", durationSec, disconnectionReason: "user_hangup" }, `${pid}:call_ended`));
    return id;
  }

  test("an answered call is settled to the second and the rest of the hold returned", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, 95, [{ role: "agent", content: "Hello" }, { role: "user", content: "Yes, go ahead, we need it before Christmas." }]);
    const r = await postProcessCall(w.deps(), { callId: id });
    assert.equal(r.status, "COMPLETE");
    assert.equal(r.status === "COMPLETE" && r.billedSec, 95);
    assert.equal(w.minutes.balanceOf(BIZ).includedRemainingSec, 200 * 60 - 95);
    assert.equal(w.calls.get(id)!.state, "COMPLETE");
    assert.ok(w.costs.length > 0 && w.costs.every((c) => c.estimated));
    assert.deepEqual(w.signals, [id]);
    // Running it again moves nothing (idempotent).
    await postProcessCall(w.deps(), { callId: id });
    assert.equal(w.minutes.balanceOf(BIZ).includedRemainingSec, 200 * 60 - 95);
    assert.equal(w.minutes.ledger.filter((l) => l.kind === "SETTLE").length, 1);
  });

  test("the provider's own cost wins over the estimate", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, 60, [{ role: "user", content: "Sounds good" }]);
    await postProcessCall(w.deps(), { callId: id, providerCostCents: 12.5 });
    assert.equal(w.costs.length, 1);
    assert.equal(w.costs[0].estimated, false);
    assert.equal(w.costs[0].totalUsd, 0.125);
  });

  test("an opt-out on the call suppresses calls to the number and plans no retry", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, 20, [{ role: "user", content: "Please stop calling me." }]);
    await postProcessCall(w.deps(), { callId: id });
    assert.equal(w.outcomes.get(id)?.disposition, "OPTED_OUT");
    assert.deepEqual(w.optOuts, ["+447700900123"]);
    assert.ok(!w.jobs.some((j) => j.type === "voice.retry"));
  });

  test("objections are recorded once per key, from the lead's words", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, 120, [{ role: "user", content: "Honestly it's too expensive for us right now." }]);
    await postProcessCall(w.deps(), { callId: id });
    await postProcessCall(w.deps(), { callId: id });
    const keys = w.objections.filter((o) => o.callId === id).map((o) => o.key);
    assert.ok(keys.length >= 1);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("number provisioning recovers from a crash mid-provision", () => {
  test("a crash after buying a number adopts it on the next run: never two purchases", async () => {
    const w = new VoiceWorld();
    w.details = validDetails();
    await startProvisioning(w.deps(), BIZ);
    const numbers = w.numbersProvider!;
    let guard = 0;
    let crashed = false;
    while (guard++ < 12) {
      const rec = w.numbers.get(BIZ)!.record;
      if (rec.state === "BUNDLE_SUBMITTED" || rec.state === "BUNDLE_IN_REVIEW") {
        numbers.setBundleStatus(rec.bundleSid!, "APPROVED");
      }
      if (rec.state === "NUMBER_SEARCHING" && !crashed) {
        crashed = true;
        w.dropNextNumberSave = true; // crash after the purchase, before the record is saved
      }
      const r = await provisionStep(w.deps(), BIZ).catch(() => ({ outcome: "CRASHED" as const }));
      if (w.numbers.get(BIZ)!.record.state === "ACTIVE") break;
      void r;
    }
    const rec = w.numbers.get(BIZ)!.record;
    assert.equal(crashed, true);
    assert.equal(rec.state, "ACTIVE");
    assert.equal(numbers.log.filter((l) => l.method === "purchase").length, 1);
    assert.equal(numbers.owned.size, 1);
    assert.ok(w.notifications.includes("Your calling number is ready"));
    assert.equal(w.telephonyAccounts.length, 1);
  });

  test("a bundle callback advances the record and queues the next step", async () => {
    const w = new VoiceWorld();
    w.details = validDetails();
    await startProvisioning(w.deps(), BIZ);
    await provisionStep(w.deps(), BIZ); // subaccount
    await provisionStep(w.deps(), BIZ); // bundle submitted
    const rec = w.numbers.get(BIZ)!.record;
    const r = await ingestVoiceEvent(w.deps(), {
      provider: "twilio",
      type: "BUNDLE_STATUS_CHANGED",
      dedupeKey: `${rec.bundleSid}:twilio-approved`,
      occurredAt: null,
      accountSid: rec.subaccountSid,
      bundleSid: rec.bundleSid!,
      status: "APPROVED",
      failureReason: null,
    });
    assert.equal(r.status, "PROVISIONING");
    assert.equal(w.numbers.get(BIZ)!.record.state, "BUNDLE_APPROVED");
    assert.ok(w.jobs.some((j) => j.type === "voice.number_provision"));
  });
});

describe("the platform operator's controls stop dialling (0158)", () => {
  const cases = [
    ["outbound paused", { outboundPaused: true, numberSuspended: false, spendLimitGbpMonth: null, spentGbpThisMonth: 0 }, "ADMIN_OUTBOUND_PAUSED"],
    ["the monthly spend limit reached", { outboundPaused: false, numberSuspended: false, spendLimitGbpMonth: 50, spentGbpThisMonth: 50 }, "ADMIN_SPEND_LIMIT_REACHED"],
    ["a suspended number", { outboundPaused: false, numberSuspended: true, spendLimitGbpMonth: null, spentGbpThisMonth: 0 }, "ADMIN_NUMBER_SUSPENDED"],
  ] as const;

  for (const [label, controls, reason] of cases) {
    test(`${label}: the manual request is refused with a typed denial`, async () => {
      const w = new VoiceWorld();
      w.adminControls = { ...controls };
      const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.reason, reason);
      assert.equal(w.calls.size, 0);
    });

    test(`${label}: a queued call is cancelled by the dial job, never dialled`, async () => {
      const w = new VoiceWorld();
      const id = await queued(w);
      w.adminControls = { ...controls };
      const r = await dialCall(w.deps(), id);
      assert.equal(r.status, "CANCELLED");
      assert.equal(r.status === "CANCELLED" && r.reason, reason);
      assert.equal(w.providerCalls(), 0);
    });

    test(`${label}: a retry is refused`, async () => {
      const w = new VoiceWorld();
      const id = await queued(w);
      await dialCall(w.deps(), id);
      const pid = w.calls.get(id)!.provider_call_id!;
      await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "NO_ANSWER", durationSec: 0, disconnectionReason: "dial_no_answer" }, `${pid}:call_ended`));
      await postProcessCall(w.deps(), { callId: id });
      w.adminControls = { ...controls };
      const r = await planCallRetry(w.deps(), id);
      assert.equal(r.status, "REFUSED");
      assert.equal(r.status === "REFUSED" && r.reason, reason);
    });
  }

  test("under the spend limit, calls go ahead", async () => {
    const w = new VoiceWorld();
    w.adminControls = { outboundPaused: false, numberSuspended: false, spendLimitGbpMonth: 50, spentGbpThisMonth: 49.99 };
    const id = await queued(w);
    assert.equal((await dialCall(w.deps(), id)).status, "DIALLED");
  });
});
