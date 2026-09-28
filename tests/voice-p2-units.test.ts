import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  creditPackMinutes,
  grantIncludedPeriod,
  InMemoryMinuteStore,
  releaseMinutes,
  reserveMinutes,
  settleMinutes,
} from "../src/lib/voice/minutes-core.ts";
import { computeTwilioSignature, formToRecord, verifyTwilioSignature } from "../src/lib/twilio/signature.ts";
import * as protocol from "../src/lib/voice/providers/twilio-protocol.ts";
import { parseRetellWebhook, signRetellBody, verifyRetellSignature } from "../src/lib/voice/providers/retell-protocol.ts";
import { smsSendTarget } from "../src/lib/messaging/sms-sender.ts";
import { canCallVoice, isWithinQuietHoursAt } from "../src/lib/policy/channel-policy.ts";
import { assertVoiceAllowed } from "../src/lib/voice/entitlement.ts";
import { buildEntitlementSnapshot, callConsentFrom, phoneSourceOf } from "../src/lib/voice/snapshot.ts";
import { reduceVoiceEvent } from "../src/lib/voice/ingest.ts";
import { analyseCall } from "../src/lib/voice/post-call.ts";
import { callCostLines, estimateCallCost } from "../src/lib/voice/cost.ts";
import { messageChannelFor } from "../src/lib/agent/types.ts";
import { paidFacts } from "./voice-world.ts";

const B = "biz-1";

function store(includedMin: number, packMin: number) {
  const s = new InMemoryMinuteStore();
  const b = s.balanceOf(B);
  b.includedRemainingSec = includedMin * 60;
  b.packRemainingSec = packMin * 60;
  b.periodIncludedSec = includedMin * 60;
  return s;
}

describe("minute balance: reserve, settle, release", () => {
  test("reserve draws included minutes first, then packs; the ledger is keyed per call", async () => {
    const s = store(5, 10);
    const r = await reserveMinutes(s, { businessId: B, callId: "c1", route: "QUALIFICATION", seconds: 420 });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.reservation.fromIncludedSec, 300);
    assert.equal(r.ok && r.reservation.fromPackSec, 120);
    assert.equal(s.balanceOf(B).includedRemainingSec, 0);
    assert.equal(s.balanceOf(B).packRemainingSec, 480);
    const again = await reserveMinutes(s, { businessId: B, callId: "c1", route: "QUALIFICATION", seconds: 420 });
    assert.equal(again.ok && again.replay, true);
    assert.equal(s.ledger.filter((l) => l.kind === "RESERVE").length, 1);
    assert.equal(s.ledger[0].idempotencyKey, "voice:reserve:c1");
  });

  test("no overage: a reservation the balance cannot cover is refused", async () => {
    const s = store(1, 0);
    const r = await reserveMinutes(s, { businessId: B, callId: "c1", route: null, seconds: 420 });
    assert.deepEqual(r.ok ? null : r.reason, "INSUFFICIENT_BALANCE");
    assert.equal(s.ledger.length, 0);
  });

  test("settle charges to the second and returns the rest of the hold, packs first", async () => {
    const s = store(5, 10);
    await reserveMinutes(s, { businessId: B, callId: "c1", route: null, seconds: 420 });
    const r = await settleMinutes(s, { businessId: B, callId: "c1", route: null, actualSec: 61.2 });
    assert.equal(r.ok && r.billedSec, 62);
    // 420 held, 62 used: 120 back to packs, 238 back to included.
    assert.equal(s.balanceOf(B).packRemainingSec, 600);
    assert.equal(s.balanceOf(B).includedRemainingSec, 238);
    const replay = await settleMinutes(s, { businessId: B, callId: "c1", route: null, actualSec: 61 });
    assert.equal(replay.ok && replay.replay, true);
    assert.equal(s.ledger.filter((l) => l.kind === "SETTLE").length, 1);
  });

  test("release returns the whole hold once; settling after a release is refused", async () => {
    const s = store(10, 0);
    await reserveMinutes(s, { businessId: B, callId: "c1", route: null, seconds: 420 });
    assert.deepEqual(await releaseMinutes(s, { businessId: B, callId: "c1", route: null }), { ok: true, replay: false });
    assert.deepEqual(await releaseMinutes(s, { businessId: B, callId: "c1", route: null }), { ok: true, replay: true });
    assert.equal(s.balanceOf(B).includedRemainingSec, 600);
    const r = await settleMinutes(s, { businessId: B, callId: "c1", route: null, actualSec: 30 });
    assert.equal(r.ok ? null : r.reason, "ALREADY_RELEASED");
  });

  test("a concurrent writer is detected (compare-and-swap) and the step re-reads", async () => {
    const s = store(10, 0);
    s.beforeApply = () => {
      s.balanceOf(B).includedRemainingSec -= 60; // another call settled meanwhile
    };
    const r = await reserveMinutes(s, { businessId: B, callId: "c1", route: null, seconds: 420 });
    assert.equal(r.ok, true);
    assert.equal(s.balanceOf(B).includedRemainingSec, 600 - 60 - 420);
  });

  test("75, 90 and 100 percent alerts fire once as they are crossed", async () => {
    const s = store(10, 0);
    await reserveMinutes(s, { businessId: B, callId: "a", route: null, seconds: 420 });
    const a = await settleMinutes(s, { businessId: B, callId: "a", route: null, actualSec: 420 }); // 70%
    assert.equal(a.ok && a.alert, null);
    await reserveMinutes(s, { businessId: B, callId: "b", route: null, seconds: 180 });
    const b = await settleMinutes(s, { businessId: B, callId: "b", route: null, actualSec: 60 }); // 80%
    assert.equal(b.ok && b.alert, 75);
    await reserveMinutes(s, { businessId: B, callId: "c", route: null, seconds: 120 });
    const c = await settleMinutes(s, { businessId: B, callId: "c", route: null, actualSec: 120 }); // 100%
    assert.equal(c.ok && c.alert, 100);
  });

  test("a pack credits once per Stripe reference; the period grant sets included minutes (no roll-over)", async () => {
    const s = store(50, 0);
    assert.equal(await creditPackMinutes(s, { businessId: B, minutes: 100, idempotencyKey: "voice:pack:cs_1", stripeRef: "cs_1" }), "APPLIED");
    assert.equal(await creditPackMinutes(s, { businessId: B, minutes: 100, idempotencyKey: "voice:pack:cs_1", stripeRef: "cs_1" }), "REPLAY");
    assert.equal(s.balanceOf(B).packRemainingSec, 6000);
    assert.equal(await grantIncludedPeriod(s, { businessId: B, includedMinutes: 200, periodStart: "2026-10-01T00:00:00Z", periodEnd: null }), "APPLIED");
    assert.equal(s.balanceOf(B).includedRemainingSec, 12000);
    assert.equal(s.ledger.at(-1)?.includedDeltaSec, 12000 - 3000);
  });
});

describe("webhook signatures", () => {
  test("one shared Twilio signature: SMS and voice modules re-export the same functions", () => {
    assert.equal(protocol.computeTwilioSignature, computeTwilioSignature);
    assert.equal(protocol.verifyTwilioSignature, verifyTwilioSignature);
    const url = "https://app.example.com/api/webhooks/twilio/voice";
    const params = formToRecord("CallSid=CA1&CallStatus=completed&AccountSid=AC1");
    const sig = computeTwilioSignature("tok", url, params);
    assert.equal(verifyTwilioSignature("tok", url, params, sig), true);
    assert.equal(verifyTwilioSignature("tok", url, { ...params, CallStatus: "busy" }, sig), false);
    assert.equal(verifyTwilioSignature("", url, params, sig), false);
    assert.equal(verifyTwilioSignature("tok", url, params, null), false);
  });

  test("Retell: verified HMAC, a stale timestamp and a tampered body are refused", () => {
    const now = new Date("2026-09-28T11:00:00Z");
    const body = JSON.stringify({ event: "call_started", call: { call_id: "c1", metadata: { voice_call_id: "v1" } } });
    const header = signRetellBody(body, now.getTime(), "key");
    assert.equal(verifyRetellSignature({ rawBody: body, headers: { "x-retell-signature": header }, now, apiKey: "key" }), true);
    assert.equal(verifyRetellSignature({ rawBody: body + " ", headers: { "x-retell-signature": header }, now, apiKey: "key" }), false);
    assert.equal(verifyRetellSignature({ rawBody: body, headers: { "x-retell-signature": header }, now: new Date(now.getTime() + 6 * 60_000), apiKey: "key" }), false);
    const events = parseRetellWebhook(body);
    assert.equal(events[0].dedupeKey, "c1:call_started");
  });
});

describe("SMS sender resolution", () => {
  const platform = { from: "+447700900999", messagingServiceSid: null };
  const active = { businessId: B, state: "ACTIVE" as const, e164: "+447700900111", messagingServiceSid: "MG111" };

  test("an ACTIVE dedicated number sends from the workspace's own Messaging Service, under its subaccount", () => {
    const t = smsSendTarget({ number: active, subaccountSid: "ACsub", platform, platformAccountSid: "ACparent" });
    assert.deepEqual(t, { kind: "DEDICATED", accountSid: "ACsub", from: null, messagingServiceSid: "MG111" });
  });

  test("no dedicated number: the platform sender, exactly as today", () => {
    assert.deepEqual(smsSendTarget({ number: null, subaccountSid: null, platform, platformAccountSid: "ACparent" }), {
      kind: "PLATFORM_SHARED",
      accountSid: "ACparent",
      from: "+447700900999",
      messagingServiceSid: null,
    });
    assert.deepEqual(
      smsSendTarget({ number: null, subaccountSid: null, platform: { from: null, messagingServiceSid: "MGplat" }, platformAccountSid: "ACparent" }),
      { kind: "PLATFORM_SHARED", accountSid: "ACparent", from: null, messagingServiceSid: "MGplat" },
    );
  });

  test("a number still in review, or an active one with no known subaccount, falls back to the platform", () => {
    const review = { ...active, state: "BUNDLE_IN_REVIEW" as const };
    assert.equal(smsSendTarget({ number: review, subaccountSid: "ACsub", platform, platformAccountSid: "ACparent" }).kind, "PLATFORM_SHARED");
    assert.equal(smsSendTarget({ number: active, subaccountSid: null, platform, platformAccountSid: "ACparent" }).kind, "PLATFORM_SHARED");
  });
});

describe("the VOICE channel policy and the agent channel", () => {
  test("quiet hours are judged in the recipient's time zone", () => {
    const at = new Date("2026-09-28T20:30:00Z"); // 21:30 London, 16:30 New York
    const rule = { start: "21:00", end: "08:00" };
    assert.equal(isWithinQuietHoursAt(at, "Europe/London", rule), true);
    assert.equal(isWithinQuietHoursAt(at, "America/New_York", rule), false);
  });

  test("canCallVoice delegates to canCallLead and adds quiet hours in the recipient's zone", () => {
    const ent = assertVoiceAllowed(buildEntitlementSnapshot(paidFacts()));
    const base = {
      now: new Date("2026-09-28T11:00:00Z"),
      callKind: "AI_AUTOMATED" as const,
      lead: { phone: "+447700900123", phoneSource: phoneSourceOf("LEAD_FORM"), anonymised: false, suppressed: false, optedOut: false, voiceOptedOut: false, subscriberType: "CORPORATE" as const, tpsListed: null, ctpsListed: null },
      consent: callConsentFrom({ consent_scope: ["CALL_REQUESTED"], consent_status: "GRANTED", consent_captured_at: "2026-09-28T09:00:00Z", call_consent_wording: "call me", subscriber_type: "CORPORATE", tps_listed: null, ctps_listed: null }),
      attempts: { total: 0, last24h: 0 },
      entitlement: ent,
      workspace: { timezone: "Europe/London" },
      activeCall: false,
    };
    assert.equal(canCallVoice(base).outcome, "ALLOWED");
    assert.equal(canCallVoice({ ...base, quietHours: { start: "11:00", end: "13:00" } }).outcome, "NOT_NOW");
    assert.equal(canCallVoice({ ...base, lead: { ...base.lead, voiceOptedOut: true } }).outcome, "BLOCKED");
    assert.equal(canCallVoice({ ...base, activeCall: true }).outcome, "NOT_NOW");
  });

  test("a call's written follow-up goes by SMS", () => {
    assert.equal(messageChannelFor("voice"), "sms");
    assert.equal(messageChannelFor("email"), "email");
  });
});

describe("ingest, post-call and cost (pure)", () => {
  const call = { id: "v1", business_id: B, state: "DIALLING" as const, answered_at: null, ended_at: null, duration_sec: null, outcome: null };

  test("a machine answer is a voicemail; completed after dialling passes through ANSWERED", () => {
    const vm = reduceVoiceEvent({ ...call, state: "RINGING" }, { provider: "twilio", type: "CALL_ANSWERED", answeredBy: "MACHINE", dedupeKey: "k", occurredAt: null, providerCallId: "CA1" }, new Date());
    assert.equal(vm.state, "VOICEMAIL");
    const done = reduceVoiceEvent(call, { provider: "twilio", type: "CALL_ENDED", outcome: "COMPLETED", durationSec: 40, disconnectionReason: "completed", dedupeKey: "k2", occurredAt: null, providerCallId: "CA1" }, new Date());
    assert.equal(done.state, "ENDED");
    assert.ok(done.patch.answered_at);
    assert.deepEqual(done.followUps, ["POST_CALL", "RECORDING_FETCH"]);
  });

  test("post-call dispositions come from the lead's words only", () => {
    const at = new Date("2026-09-28T11:00:00Z");
    const agentOnly = analyseCall({ outcome: "COMPLETED", durationSec: 30, transcript: [{ role: "agent", content: "Stop calling me is what some people say" , startMs: null, endMs: null }], providerSummary: null, endedAt: at });
    assert.equal(agentOnly.disposition, "NO_CONVERSATION");
    const quote = analyseCall({ outcome: "COMPLETED", durationSec: 90, transcript: [{ role: "user", content: "Could you send me a quote for that?", startMs: null, endMs: null }], providerSummary: null, endedAt: at });
    assert.equal(quote.disposition, "QUOTE_REQUESTED");
    const missed = analyseCall({ outcome: "NO_ANSWER", durationSec: 0, transcript: [], providerSummary: null, endedAt: at });
    assert.equal(missed.disposition, "NO_CONVERSATION");
    assert.equal(missed.summary, "No conversation took place.");
  });

  test("cost: the provider figure when known, else a rate-table estimate", () => {
    const est = estimateCallCost({ callId: "v1", durationSec: 60, toE164: "+447700900123", recording: true });
    assert.equal(est.length, 3);
    assert.ok(est.every((l) => l.estimated));
    const tel = est.find((l) => l.metric === "TELEPHONY_MINUTE")!;
    assert.equal(tel.unitCostUsd, 0.0265); // UK mobile, Elastic SIP
    const provider = callCostLines({ callId: "v1", durationSec: 60, toE164: null, recording: false, providerCostCents: 9 });
    assert.deepEqual(provider.map((l) => [l.estimated, l.totalUsd]), [[false, 0.09]]);
    assert.equal(callCostLines({ callId: "v1", durationSec: 0, toE164: null, recording: false, providerCostCents: null }).length, 0);
  });
});
