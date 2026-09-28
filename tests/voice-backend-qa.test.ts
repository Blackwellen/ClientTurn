import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  cancelQueuedCall,
  dialCall,
  DIAL_STALE_AFTER_MS,
  ingestVoiceEvent,
  LIVE_STALE_AFTER_MS,
  postProcessCall,
  reconcileStaleCalls,
  requestCall,
} from "../src/lib/voice/runtime-core.ts";
import type { VoiceEvent } from "../src/lib/voice/providers/types.ts";
import { BIZ, LEAD, VoiceWorld } from "./voice-world.ts";

/**
 * Backend QA pass 2026-09-28: bugs where the voice paths meet each other
 * (a tool during a live call -> requestCall -> the dial job; the tools ->
 * post-call), reproduced with the in-memory world. No network, no spend.
 */

const QUAL = "QUALIFICATION" as const;

function ev(callId: string, pid: string, e: Partial<VoiceEvent> & { type: VoiceEvent["type"] }, key: string): VoiceEvent {
  return { provider: "retell", dedupeKey: key, occurredAt: null, providerCallId: pid, metadata: { voice_call_id: callId }, ...e } as VoiceEvent;
}

/** A call that was placed and answered, and is live now. */
async function liveCall(w: VoiceWorld): Promise<{ id: string; pid: string }> {
  const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { callId: string }).callId;
  assert.equal((await dialCall(w.deps(), id)).status, "DIALLED");
  const pid = w.calls.get(id)!.provider_call_id!;
  await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_STARTED" }, `${pid}:call_started`));
  return { id, pid };
}

async function endCall(w: VoiceWorld, id: string, pid: string, seconds = 90) {
  await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "COMPLETED", durationSec: seconds, disconnectionReason: "user_hangup" }, `${pid}:call_ended`));
}

describe("an AI call-back booked during a live call", () => {
  test("keeps the time the lead asked for (not 'as soon as the live call allows')", async () => {
    const w = new VoiceWorld();
    await liveCall(w);
    // "Call me tomorrow at ten": 10:00 London on Tuesday 29 September.
    const asked = new Date("2026-09-29T09:00:00.000Z");
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "CALLBACK", requestedBy: null, notBefore: asked });
    assert.equal(r.ok, true, JSON.stringify(r));
    // Before the fix the live call's CALL_ALREADY_ACTIVE / ATTEMPT_TOO_SOON
    // deferral replaced the lead's time: the AI rang back ~2 hours later.
    assert.equal(r.ok && r.scheduledFor, asked.toISOString());
    const dial = w.jobs.filter((j) => j.type === "voice.dial" && j.payload.callId === (r as { callId: string }).callId);
    assert.equal(dial.length, 1);
    assert.equal(dial[0].runAt?.toISOString(), asked.toISOString());
  });

  test("a time sooner than the gap between attempts is moved to the earliest lawful time, never earlier", async () => {
    const w = new VoiceWorld();
    await liveCall(w);
    const asked = new Date(w.now.getTime() + 10 * 60_000);
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "CALLBACK", requestedBy: null, notBefore: asked });
    assert.equal(r.ok, true);
    assert.ok(r.ok && Date.parse(r.scheduledFor) > asked.getTime());
    assert.ok(r.ok && r.deferredReason);
  });

  test("a corrected time supersedes the first call-back: the first is cancelled, not rung too", async () => {
    const w = new VoiceWorld();
    const { id } = await liveCall(w);
    const five = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "CALLBACK", requestedBy: null, notBefore: new Date("2026-09-29T16:00:00.000Z") });
    assert.ok(five.ok);
    const cancelled = await cancelQueuedCall(w.deps(), (five as { callId: string }).callId, "CALLBACK_SUPERSEDED");
    assert.equal(cancelled, true);
    assert.equal(w.calls.get((five as { callId: string }).callId)!.state, "CANCELLED");
    // A live or finished call is never cancelled this way.
    assert.equal(await cancelQueuedCall(w.deps(), id, "CALLBACK_SUPERSEDED"), false);
    assert.equal(w.calls.get(id)!.state, "IN_CONVERSATION");
  });
});

describe("the call key never lands on an old, finished call", () => {
  test("after five cancelled requests a sixth is a fresh queued call, not the cancelled fifth", async () => {
    const w = new VoiceWorld();
    for (let i = 0; i < 5; i++) {
      const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
      assert.ok(r.ok && !r.existing, `request ${i + 1}: ${JSON.stringify(r)}`);
      assert.equal(await cancelQueuedCall(w.deps(), (r as { callId: string }).callId, "CANCELLED_BY_USER"), true);
    }
    const sixth = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(sixth.ok, true);
    // Before the fix: attempt min(5, 6) re-used key ":5" and returned the
    // CANCELLED row as "queued"; nothing was ever dialled.
    assert.equal(sixth.ok && sixth.existing, false);
    const row = w.calls.get((sixth as { callId: string }).callId)!;
    assert.equal(row.state, "QUEUED");
    assert.ok(row.attempt_number <= 5, "the attempt number stays inside the 1..5 CHECK");
    assert.equal((await dialCall(w.deps(), row.id)).status, "DIALLED");
  });

  test("an explicit attempt that collides with a finished call gets a new key (a retry is never swallowed)", async () => {
    const w = new VoiceWorld();
    const first = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null, attemptNumber: 2 });
    assert.ok(first.ok);
    await cancelQueuedCall(w.deps(), (first as { callId: string }).callId, "CANCELLED_BY_USER");
    const retry = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null, attemptNumber: 2 });
    assert.ok(retry.ok && !retry.existing);
    assert.notEqual((retry as { callId: string }).callId, (first as { callId: string }).callId);
    // Still idempotent while the call is pending.
    const again = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null, attemptNumber: 2 });
    assert.ok(again.ok && again.existing);
    assert.equal((again as { callId: string }).callId, (retry as { callId: string }).callId);
  });
});

describe("post-call reflects what the tools did on the call", () => {
  test("a call-back booked with schedule_callback is the outcome, with its time, and the next action says so", async () => {
    const w = new VoiceWorld();
    const { id, pid } = await liveCall(w);
    w.toolOutcomes.set(id, [{ tool: "schedule_callback", data: { by: "PERSON", at_iso: "2026-09-29T17:00:00.000Z", when: "2026-09-29 17:00" } }]);
    await endCall(w, id, pid);
    const r = await postProcessCall(w.deps(), { callId: id });
    assert.equal(r.status, "COMPLETE");
    const o = w.outcomes.get(id)!;
    assert.equal(o.disposition, "CALLBACK_REQUESTED");
    assert.equal(o.callbackRequestedFor, "2026-09-29T17:00:00.000Z");
    // Before the fix the note the tool wrote on the lead was overwritten with
    // "Continue the conversation by text or email."
    assert.doesNotMatch(w.nextActions.at(-1) ?? "", /Continue the conversation/);
    assert.match(w.nextActions.at(-1) ?? "", /call back/i);
  });

  test("the latest call-back wins when the lead corrected the time", async () => {
    const w = new VoiceWorld();
    const { id, pid } = await liveCall(w);
    w.toolOutcomes.set(id, [
      { tool: "schedule_callback", data: { callback_call_id: "x", scheduled_for: "2026-09-29T16:00:00.000Z" } },
      { tool: "schedule_callback", data: { callback_call_id: "y", scheduled_for: "2026-09-29T17:00:00.000Z" } },
    ]);
    await endCall(w, id, pid);
    await postProcessCall(w.deps(), { callId: id });
    assert.equal(w.outcomes.get(id)!.callbackRequestedFor, "2026-09-29T17:00:00.000Z");
  });

  test("an opt-out taken by the opt_out tool is the outcome even when the words were not recognised", async () => {
    const w = new VoiceWorld();
    const { id, pid } = await liveCall(w);
    w.toolOutcomes.set(id, [{ tool: "opt_out", data: { scope: "ALL" } }]);
    await endCall(w, id, pid);
    await postProcessCall(w.deps(), { callId: id });
    assert.equal(w.outcomes.get(id)!.disposition, "OPTED_OUT");
    // Nothing tells a person to "continue the conversation" with someone who opted out.
    assert.equal(w.nextActions.length, 0);
  });
});

describe("calls stuck live are closed (voice.reconcile)", () => {
  test("a dial that crashed after winning DIALLING is failed once stale, freeing the lead and the minutes", async () => {
    const w = new VoiceWorld();
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    const id = (r as { callId: string }).callId;
    const c = w.calls.get(id)!;
    // The dial won DIALLING and died before the provider answered; its job then
    // completed (a retry within 10 minutes only SKIPPED), so nothing came back.
    w.calls.set(id, { ...c, state: "DIALLING", started_at: w.now.toISOString() });
    assert.equal((await reconcileStaleCalls(w.deps())).closed, 0, "not yet stale");
    w.now = new Date(w.now.getTime() + DIAL_STALE_AFTER_MS + 60_000);
    const out = await reconcileStaleCalls(w.deps());
    assert.equal(out.closed, 1);
    assert.equal(w.calls.get(id)!.state, "FAILED");
    assert.ok(w.jobs.some((j) => j.type === "voice.post_call" && j.payload.callId === id));
    assert.equal(w.providerCalls(), 0, "never re-dialled");
  });

  test("a call-back queued long ago but dialling right now is left alone", async () => {
    const w = new VoiceWorld();
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    const id = (r as { callId: string }).callId;
    w.now = new Date(w.now.getTime() + 24 * 3600_000);
    w.calls.set(id, { ...w.calls.get(id)!, state: "DIALLING", started_at: new Date(w.now.getTime() - 30_000).toISOString() });
    await reconcileStaleCalls(w.deps());
    assert.equal(w.calls.get(id)!.state, "DIALLING");
  });

  test("a lost CALL_ENDED: the provider's own end is applied (and a late real webhook is a duplicate)", async () => {
    const w = new VoiceWorld();
    const { id, pid } = await liveCall(w);
    Object.assign(w.voice!.calls.get(pid)!, { status: "ENDED", outcome: "COMPLETED", durationSec: 120, endedAt: w.now.toISOString(), disconnectionReason: "user_hangup" });
    w.now = new Date(w.now.getTime() + LIVE_STALE_AFTER_MS + 60_000);
    const out = await reconcileStaleCalls(w.deps());
    assert.equal(out.ended, 1);
    assert.equal(w.calls.get(id)!.state, "ENDED");
    assert.equal(w.calls.get(id)!.duration_sec, 120);
    const late = await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "COMPLETED", durationSec: 120, disconnectionReason: "user_hangup" }, `${pid}:call_ended`));
    assert.equal(late.status, "DUPLICATE");
  });

  test("the provider can't say: an answered call is ENDED (never FAILED, so it is not retried)", async () => {
    const w = new VoiceWorld();
    const { id, pid } = await liveCall(w);
    w.voice!.calls.delete(pid); // getCall -> 404
    w.now = new Date(w.now.getTime() + LIVE_STALE_AFTER_MS + 60_000);
    assert.equal((await reconcileStaleCalls(w.deps())).closed, 1);
    assert.equal(w.calls.get(id)!.state, "ENDED");
    await postProcessCall(w.deps(), { callId: id });
    assert.ok(!w.jobs.some((j) => j.type === "voice.retry" && j.payload.callId === id));
    // The lead is callable again.
    const next = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(next.ok, true);
  });
});

describe("one pending call per lead", () => {
  test("pressing Call with AI twice (or an agent run retried) queues one call, not two", async () => {
    const w = new VoiceWorld();
    const a = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: "user-1" });
    const b = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: "user-1" });
    assert.ok(a.ok && b.ok);
    assert.equal((b as { callId: string }).callId, (a as { callId: string }).callId);
    assert.equal(b.ok && b.existing, true);
    assert.equal([...w.calls.values()].filter((c) => c.state === "QUEUED").length, 1);
  });

  test("a retry planned while another call is queued does not add a second", async () => {
    const w = new VoiceWorld();
    const a = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    const retry = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null, attemptNumber: 2 });
    assert.equal(retry.ok && retry.callId, (a as { callId: string }).callId);
    assert.equal(w.calls.size, 1);
  });

  test("a call-back the lead asked for replaces the queued retry (they are rung once, at their time)", async () => {
    const w = new VoiceWorld();
    const queuedRetry = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    const asked = new Date("2026-09-29T09:00:00.000Z");
    const cb = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: QUAL, entryPoint: "CALLBACK", requestedBy: null, notBefore: asked });
    assert.ok(cb.ok && !cb.existing);
    assert.equal(w.calls.get((queuedRetry as { callId: string }).callId)!.state, "CANCELLED");
    assert.equal([...w.calls.values()].filter((c) => c.state === "QUEUED").length, 1);
    assert.equal(cb.ok && cb.scheduledFor, asked.toISOString());
  });
});
