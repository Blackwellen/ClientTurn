import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  buildCreatePhoneCallBody,
  mapRetellDisconnection,
  parseRetellWebhook,
  signRetellBody,
  toCallDetails,
  verifyRetellSignature,
} from "../src/lib/voice/providers/retell-protocol.ts";
import { computeTwilioSignature, isAccountSid, parseTwilioWebhook, verifyTwilioSignature } from "../src/lib/voice/providers/twilio-protocol.ts";
import { FakeNumberProvider, FakeTelephonyProvider, FakeVoiceProvider, signFake } from "../src/lib/voice/providers/fake.ts";
import { ProviderNotConfigured, ProviderRequestError, voiceEventSchema } from "../src/lib/voice/providers/types.ts";

const NOW = new Date("2026-09-28T10:00:00Z");
const KEY = "key_test_webhook";

test("Retell signature: v=timestamp,d=hmac(body+timestamp), 5-minute window, constant-time", () => {
  const body = JSON.stringify({ event: "call_started", call: { call_id: "c1" } });
  const header = signRetellBody(body, NOW.getTime(), KEY);
  const ok = (h: string | undefined, now = NOW, raw = body) =>
    verifyRetellSignature({ rawBody: raw, headers: { "x-retell-signature": h }, now, apiKey: KEY });
  assert.equal(ok(header), true);
  assert.equal(ok(header, new Date(NOW.getTime() + 4 * 60000)), true);
  assert.equal(ok(header, new Date(NOW.getTime() + 6 * 60000)), false); // replay
  assert.equal(ok(header, NOW, body + " "), false); // re-serialised body
  assert.equal(ok(undefined), false);
  assert.equal(ok("garbage"), false);
  assert.equal(ok(header.replace(/d=./, "d=0")), false);
  assert.equal(verifyRetellSignature({ rawBody: body, headers: { "x-retell-signature": header }, now: NOW, apiKey: "other" }), false);
});

test("Retell events normalise into VoiceEvents with dedupe keys", () => {
  const ended = parseRetellWebhook(
    JSON.stringify({
      event: "call_ended",
      call: { call_id: "c1", disconnection_reason: "dial_no_answer", duration_ms: 1500, end_timestamp: NOW.getTime(), metadata: { call_key: "k", n: 3 } },
    }),
  );
  assert.equal(ended.length, 1);
  const e = ended[0];
  assert.ok(e.type === "CALL_ENDED");
  if (e.type === "CALL_ENDED") {
    assert.equal(e.outcome, "NO_ANSWER");
    assert.equal(e.durationSec, 2);
    assert.equal(e.dedupeKey, "c1:call_ended");
    assert.deepEqual(e.metadata, { call_key: "k" });
  }
  for (const ev of [
    "call_started",
    "call_analyzed",
    "transcript_updated",
    "transfer_started",
    "transfer_bridged",
    "transfer_cancelled",
    "transfer_ended",
    "something_new",
  ]) {
    const [x] = parseRetellWebhook(JSON.stringify({ event: ev, call: { call_id: "c1" } }));
    assert.ok(voiceEventSchema.safeParse(x).success, ev);
  }
  assert.deepEqual(parseRetellWebhook("not json"), []);
  assert.equal(parseRetellWebhook(JSON.stringify({ event: "call_ended", call: {} }))[0].type, "UNKNOWN");
});

test("Retell disconnection reasons map to outcomes", () => {
  const rows: [string, string][] = [
    ["user_hangup", "COMPLETED"],
    ["agent_hangup", "COMPLETED"],
    ["max_duration_reached", "COMPLETED"],
    ["voicemail_reached", "VOICEMAIL"],
    ["ivr_reached", "VOICEMAIL"],
    ["dial_no_answer", "NO_ANSWER"],
    ["user_declined", "NO_ANSWER"],
    ["dial_busy", "BUSY"],
    ["call_transfer", "TRANSFERRED"],
    ["manual_stopped", "CANCELLED"],
    ["dial_failed", "FAILED"],
    ["invalid_destination", "FAILED"],
    ["marked_as_spam", "FAILED"],
    ["error_asr", "FAILED"],
  ];
  for (const [r, o] of rows) assert.equal(mapRetellDisconnection(r), o, r);
  assert.equal(mapRetellDisconnection(undefined), "FAILED");
});

test("Retell request body and call details shapes", () => {
  assert.deepEqual(
    buildCreatePhoneCallBody({ fromNumber: "+447700900001", toNumber: "+447700900123", agentId: "a1", callKey: "k1", metadata: { b: "1" }, dynamicVariables: { opener: "x" } }),
    {
      from_number: "+447700900001",
      to_number: "+447700900123",
      override_agent_id: "a1",
      metadata: { b: "1", call_key: "k1" },
      retell_llm_dynamic_variables: { opener: "x" },
    },
  );
  const d = toCallDetails({
    call_id: "c1",
    call_status: "ended",
    duration_ms: 61000,
    disconnection_reason: "user_hangup",
    transcript_object: [{ role: "agent", content: "Hello", words: [{ start: 0.1, end: 0.5 }] }],
  });
  assert.equal(d.durationSec, 61);
  assert.equal(d.outcome, "COMPLETED");
  assert.deepEqual(d.transcript, [{ role: "agent", content: "Hello", startMs: 100, endMs: 500 }]);
  assert.equal(toCallDetails({ call_id: "c2", call_status: "ongoing" }).outcome, null);
});

test("Twilio signature: same canonical algorithm, auth token only", () => {
  const url = "https://app.example.com/api/webhooks/twilio/voice";
  const params = { CallSid: "CA1", CallStatus: "ringing", AccountSid: "AC1" };
  const sig = computeTwilioSignature("tok", url, params);
  assert.equal(verifyTwilioSignature("tok", url, params, sig), true);
  assert.equal(verifyTwilioSignature("other", url, params, sig), false);
  assert.equal(verifyTwilioSignature("tok", `${url}?x=1`, params, sig), false);
  assert.equal(verifyTwilioSignature("tok", url, params, null), false);
  assert.equal(verifyTwilioSignature("", url, params, sig), false);
  // Matches the messaging implementation byte for byte (same algorithm).
  const src = readFileSync("src/lib/twilio/signature.ts", "utf8");
  assert.match(src, /createHmac\("sha1", authToken\)/);
});

test("Twilio call status and bundle callbacks normalise", () => {
  const rows: [string, string][] = [
    ["queued", "CALL_QUEUED"],
    ["initiated", "CALL_DIALLING"],
    ["ringing", "CALL_RINGING"],
    ["in-progress", "CALL_ANSWERED"],
    ["completed", "CALL_ENDED"],
    ["busy", "CALL_ENDED"],
    ["no-answer", "CALL_ENDED"],
    ["canceled", "CALL_ENDED"],
    ["failed", "CALL_ENDED"],
    ["weird", "UNKNOWN"],
  ];
  for (const [status, type] of rows) {
    const [e] = parseTwilioWebhook(`CallSid=CA1&CallStatus=${status}&CallDuration=42`);
    assert.equal(e.type, type, status);
    assert.ok(voiceEventSchema.safeParse(e).success, status);
  }
  const [busy] = parseTwilioWebhook("CallSid=CA1&CallStatus=busy");
  assert.ok(busy.type === "CALL_ENDED" && busy.outcome === "BUSY" && busy.dedupeKey === "CA1:busy");
  const [vm] = parseTwilioWebhook("CallSid=CA1&CallStatus=completed&AnsweredBy=machine_end_beep&CallDuration=20");
  assert.ok(vm.type === "CALL_ENDED" && vm.outcome === "VOICEMAIL" && vm.durationSec === 20);
  const [ans] = parseTwilioWebhook("CallSid=CA1&CallStatus=in-progress&AnsweredBy=human");
  assert.ok(ans.type === "CALL_ANSWERED" && ans.answeredBy === "HUMAN");
  const [bundle] = parseTwilioWebhook("AccountSid=AC1&BundleSid=BU1&Status=twilio-rejected&FailureReason=Address+mismatch");
  assert.ok(bundle.type === "BUNDLE_STATUS_CHANGED" && bundle.status === "REJECTED" && bundle.failureReason === "Address mismatch");
  const [approved] = parseTwilioWebhook("BundleSid=BU1&Status=twilio-approved");
  assert.ok(approved.type === "BUNDLE_STATUS_CHANGED" && approved.status === "APPROVED" && approved.dedupeKey === "BU1:twilio-approved");
});

test("account SID guard refuses an API key SID (gap map F7)", () => {
  assert.equal(isAccountSid(`AC${"a".repeat(32)}`), true);
  assert.equal(isAccountSid(`SK${"a".repeat(32)}`), false);
  assert.equal(isAccountSid(undefined), false);
});

test("typed errors", () => {
  const e = new ProviderNotConfigured("retell", ["RETELL_API_KEY"]);
  assert.equal(e.name, "ProviderNotConfigured");
  assert.deepEqual(e.missing, ["RETELL_API_KEY"]);
  assert.equal(new ProviderRequestError("x", 400, "bad").permanent, true);
  assert.equal(new ProviderRequestError("x", 429, "slow").permanent, false);
  assert.equal(new ProviderRequestError("x", 503, "down").permanent, false);
});

test("fake voice provider: idempotent start by call key, failure injection, signed webhooks", async () => {
  const v = new FakeVoiceProvider("s3cret");
  const { agentId } = await v.upsertAgent({
    agentId: null,
    name: "Acme",
    webhookUrl: "https://x.example/api/webhooks/retell",
    llmWebsocketUrl: null,
    voiceId: "v1",
    language: "en-GB",
    maxCallDurationSec: 420,
    endAfterSilenceSec: 20,
    voicemailDetection: true,
  });
  const req = { fromNumber: "+447700900001", toNumber: "+447700900123", agentId, callKey: "k1", metadata: {}, dynamicVariables: {} };
  const a = await v.startOutboundCall(req);
  const b = await v.startOutboundCall(req);
  assert.equal(a.providerCallId, b.providerCallId);
  v.failNext("startOutboundCall");
  await assert.rejects(() => v.startOutboundCall({ ...req, callKey: "k2" }), ProviderRequestError);
  await v.endCall(a.providerCallId);
  assert.equal((await v.getCall(a.providerCallId)).status, "ENDED");
  const body = JSON.stringify([{ type: "CALL_RINGING", provider: "fake", providerCallId: "c", dedupeKey: "c:r", occurredAt: null }, { type: "BOGUS" }]);
  assert.equal(v.verifyWebhook({ rawBody: body, headers: { "x-fake-signature": signFake("s3cret", body) }, now: NOW }), true);
  assert.equal(v.verifyWebhook({ rawBody: body, headers: { "x-fake-signature": "nope" }, now: NOW }), false);
  assert.equal(v.parseWebhook({ rawBody: body, headers: {}, now: NOW }).length, 1);
});

test("fake telephony and numbers behave like the interfaces promise", async () => {
  const t = new FakeTelephonyProvider();
  t.rates.set("+447700900123", 0.32);
  assert.equal(await t.lookupRatePerMinuteUsd("+447700900123"), 0.32);
  assert.equal(await t.lookupRatePerMinuteUsd("+447700900999"), null);
  await t.endCall({ accountSid: "AC", callSid: "CA1" });
  assert.equal((await t.getCallStatus({ accountSid: "AC", callSid: "CA1" })).status, "completed");
  const n = new FakeNumberProvider();
  const s1 = await n.createSubaccount({ friendlyName: "ct-b1" });
  const s2 = await n.createSubaccount({ friendlyName: "ct-b1" });
  assert.equal(s1.accountSid, s2.accountSid);
  assert.equal(s2.created, false);
  const found = await n.searchAvailable({ accountSid: s1.accountSid, isoCountry: "GB", type: "mobile", smsEnabled: true, voiceEnabled: true, limit: 10 });
  assert.deepEqual(found.map((x) => x.e164), ["+447700900001", "+447700900003"]);
});

test("server-only boundary: adapters import server-only, pure modules do not", () => {
  const dir = "src/lib/voice/providers";
  for (const f of readdirSync(dir)) {
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const serverOnly = /^import "server-only";/m.test(src);
    if (f === "retell.ts" || f === "twilio-voice.ts" || f === "registry.ts") assert.ok(serverOnly, f);
    else assert.ok(!serverOnly, f);
  }
  for (const f of readdirSync("src/lib/voice").filter((x) => x.endsWith(".ts"))) {
    if (["minutes.ts", "server-deps.ts", "webhook-inbox.ts", "sender-context.ts", "ui-queries.ts", "server-p3.ts", "text-to-call.ts"].includes(f)) {
      assert.match(readFileSync(`src/lib/voice/${f}`, "utf8"), /^import "server-only";/m, f);
      continue;
    }
    // Server actions: a "use server" module, never imported for values by a client.
    if (f === "actions.ts") {
      assert.match(readFileSync(`src/lib/voice/${f}`, "utf8"), /^"use server";/m, f);
      continue;
    }
    assert.doesNotMatch(readFileSync(`src/lib/voice/${f}`, "utf8"), /^import "server-only"|from "[^"]*supabase/m, f);
  }
});
