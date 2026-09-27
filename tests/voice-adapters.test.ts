// Run with `node --conditions=react-server --test` (the adapters import
// "server-only", which resolves to an empty module under that condition).
// No network: fetch is injected and records every request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetellVoiceProvider, retellConfigured } from "../src/lib/voice/providers/retell.ts";
import { createTwilioVoiceProvider, twilioVoiceConfigured } from "../src/lib/voice/providers/twilio-voice.ts";
import { signRetellBody } from "../src/lib/voice/providers/retell-protocol.ts";
import { computeTwilioSignature } from "../src/lib/voice/providers/twilio-protocol.ts";
import { ProviderNotConfigured, ProviderRequestError } from "../src/lib/voice/providers/types.ts";

type Req = { url: string; method: string; headers: Record<string, string>; body?: string };

function recorder(responses: ((r: Req) => { status: number; body: unknown }) | { status: number; body: unknown }[]) {
  const calls: Req[] = [];
  let i = 0;
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const req = { url, ...init };
    calls.push(req);
    const r = typeof responses === "function" ? responses(req) : responses[i++] ?? { status: 500, body: {} };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  };
  return { calls, fetch };
}

const AC = `AC${"1".repeat(32)}`;
const SUB = `AC${"2".repeat(32)}`;
const TW_ENV = { TWILIO_ACCOUNT_SID: AC, TWILIO_AUTH_TOKEN: "parent-token" };

test("Retell: missing key throws ProviderNotConfigured on use, not on import", async () => {
  const p = createRetellVoiceProvider({ env: {}, fetch: recorder([]).fetch });
  assert.equal(retellConfigured({}), false);
  await assert.rejects(() => p.getCall("c1"), (e: unknown) => e instanceof ProviderNotConfigured && e.missing[0] === "RETELL_API_KEY");
  assert.throws(() => p.verifyWebhook({ rawBody: "{}", headers: {}, now: new Date() }), ProviderNotConfigured);
});

test("Retell: create-phone-call and get-call request shapes", async () => {
  const rec = recorder([
    { status: 201, body: { call_id: "call_1", call_status: "registered" } },
    { status: 200, body: { call_id: "call_1", call_status: "ended", duration_ms: 90000, disconnection_reason: "user_hangup" } },
  ]);
  const p = createRetellVoiceProvider({ env: { RETELL_API_KEY: "key_x" }, fetch: rec.fetch });
  const started = await p.startOutboundCall({
    fromNumber: "+447700900001",
    toNumber: "+447700900123",
    agentId: "agent_1",
    callKey: "voice:call:b1:l1:QUALIFICATION:1",
    metadata: { business_id: "b1" },
    dynamicVariables: { locked_preamble: "This is an AI assistant..." },
  });
  assert.deepEqual(started, { providerCallId: "call_1", status: "REGISTERED" });
  assert.equal(rec.calls[0].url, "https://api.retellai.com/v2/create-phone-call");
  assert.equal(rec.calls[0].method, "POST");
  assert.equal(rec.calls[0].headers.Authorization, "Bearer key_x");
  const body = JSON.parse(rec.calls[0].body as string);
  assert.equal(body.override_agent_id, "agent_1");
  assert.equal(body.metadata.call_key, "voice:call:b1:l1:QUALIFICATION:1");
  const d = await p.getCall("call_1");
  assert.equal(rec.calls[1].url, "https://api.retellai.com/v2/get-call/call_1");
  assert.equal(d.durationSec, 90);
  assert.equal(d.outcome, "COMPLETED");
});

test("Retell: invalid requests are refused before any network call", async () => {
  const rec = recorder([]);
  const p = createRetellVoiceProvider({ env: { RETELL_API_KEY: "k" }, fetch: rec.fetch });
  await assert.rejects(() =>
    p.startOutboundCall({ fromNumber: "07700", toNumber: "+447700900123", agentId: "a", callKey: "k", metadata: {}, dynamicVariables: {} }),
  );
  assert.equal(rec.calls.length, 0);
});

test("Retell: create vs update agent, and errors are typed", async () => {
  const rec = recorder([
    { status: 201, body: { agent_id: "agent_9" } },
    { status: 200, body: { agent_id: "agent_9" } },
    { status: 402, body: { message: "no credit" } },
  ]);
  const p = createRetellVoiceProvider({ env: { RETELL_API_KEY: "k" }, fetch: rec.fetch });
  const cfg = {
    agentId: null,
    name: "Acme",
    webhookUrl: "https://app.example/api/webhooks/retell",
    llmWebsocketUrl: "wss://app.example/llm",
    voiceId: "retell-Cimo",
    language: "en-GB",
    maxCallDurationSec: 420,
    endAfterSilenceSec: 20,
    voicemailDetection: true,
  };
  assert.deepEqual(await p.upsertAgent(cfg), { agentId: "agent_9" });
  assert.equal(rec.calls[0].url, "https://api.retellai.com/create-agent");
  const b = JSON.parse(rec.calls[0].body as string);
  assert.deepEqual(b.response_engine, { type: "custom-llm", llm_websocket_url: "wss://app.example/llm" });
  assert.equal(b.max_call_duration_ms, 420000);
  await p.upsertAgent({ ...cfg, agentId: "agent_9" });
  assert.equal(rec.calls[1].method, "PATCH");
  await assert.rejects(() => p.getCall("x"), (e: unknown) => e instanceof ProviderRequestError && e.status === 402 && e.permanent);
  await assert.rejects(() => p.endCall("x"), (e: unknown) => e instanceof ProviderRequestError && e.code === "UNVERIFIED_ENDPOINT");
});

test("Retell: webhook verification uses the configured key", () => {
  const p = createRetellVoiceProvider({ env: { RETELL_API_KEY: "k" }, fetch: recorder([]).fetch });
  const now = new Date("2026-09-28T10:00:00Z");
  const body = JSON.stringify({ event: "call_started", call: { call_id: "c1" } });
  assert.equal(p.verifyWebhook({ rawBody: body, headers: { "x-retell-signature": signRetellBody(body, now.getTime(), "k") }, now }), true);
  assert.equal(p.parseWebhook({ rawBody: body, headers: {}, now })[0].type, "CALL_STARTED");
});

test("Twilio: refuses an SK value as the account SID and a missing token", async () => {
  assert.equal(twilioVoiceConfigured({ TWILIO_ACCOUNT_SID: `SK${"1".repeat(32)}`, TWILIO_AUTH_TOKEN: "x" }), false);
  assert.equal(twilioVoiceConfigured(TW_ENV), true);
  const p = createTwilioVoiceProvider({ env: { TWILIO_ACCOUNT_SID: `SK${"1".repeat(32)}` }, fetch: recorder([]).fetch });
  await assert.rejects(
    () => p.list({ accountSid: SUB }),
    (e: unknown) => e instanceof ProviderNotConfigured && e.missing.length === 2,
  );
});

test("Twilio: subaccount is found by name before one is created", async () => {
  const rec = recorder([{ status: 200, body: { accounts: [{ sid: SUB }] } }]);
  const p = createTwilioVoiceProvider({ env: TW_ENV, fetch: rec.fetch });
  assert.deepEqual(await p.createSubaccount({ friendlyName: "ct-b1" }), { accountSid: SUB, created: false });
  assert.equal(rec.calls.length, 1);
  assert.match(rec.calls[0].url, /\/Accounts\.json\?FriendlyName=ct-b1&Status=active$/);
  assert.equal(rec.calls[0].headers.Authorization, `Basic ${Buffer.from(`${AC}:parent-token`).toString("base64")}`);
  const rec2 = recorder([
    { status: 200, body: { accounts: [] } },
    { status: 201, body: { sid: SUB } },
  ]);
  const p2 = createTwilioVoiceProvider({ env: TW_ENV, fetch: rec2.fetch });
  assert.deepEqual(await p2.createSubaccount({ friendlyName: "ct-b1" }), { accountSid: SUB, created: true });
  assert.equal(rec2.calls[1].body, "FriendlyName=ct-b1");
});

test("Twilio: search GB mobiles, purchase with bundle and address, configure, release", async () => {
  const rec = recorder((r) => {
    if (r.url.includes("AvailablePhoneNumbers/GB/Mobile.json")) {
      return { status: 200, body: { available_phone_numbers: [{ phone_number: "+447700900001", capabilities: { voice: true, SMS: true, MMS: false } }] } };
    }
    if (r.url.endsWith("/IncomingPhoneNumbers.json") && r.method === "POST") {
      return { status: 201, body: { sid: "PN1", phone_number: "+447700900001", capabilities: { voice: true, sms: true } } };
    }
    if (r.url.endsWith(`/Accounts/${SUB}.json`)) return { status: 200, body: { auth_token: "sub-token" } };
    if (r.url.includes("/IncomingPhoneNumbers/PN1.json") && r.method === "POST") {
      return { status: 200, body: { sid: "PN1", phone_number: "+447700900001", voice_url: "https://v", capabilities: { voice: true, sms: true } } };
    }
    if (r.url.includes("/Services/MG1/PhoneNumbers")) return { status: 400, body: { code: 21712, message: "already in service" } };
    if (r.method === "DELETE") return { status: 404, body: { code: 20404 } };
    return { status: 500, body: {} };
  });
  const p = createTwilioVoiceProvider({ env: TW_ENV, fetch: rec.fetch });
  const found = await p.searchAvailable({ accountSid: SUB, isoCountry: "GB", type: "mobile", smsEnabled: true, voiceEnabled: true, limit: 5 });
  assert.deepEqual(found, [{ e164: "+447700900001", locality: null, capabilities: { voice: true, sms: true, mms: false } }]);
  assert.match(rec.calls[0].url, /SmsEnabled=true&VoiceEnabled=true&PageSize=5/);
  const bought = await p.purchase({ accountSid: SUB, e164: "+447700900001", bundleSid: "BU1", addressSid: "AD1" });
  assert.equal(bought.phoneNumberSid, "PN1");
  assert.equal(rec.calls[1].body, "PhoneNumber=%2B447700900001&BundleSid=BU1&AddressSid=AD1");
  const cfg = await p.configure({ accountSid: SUB, phoneNumberSid: "PN1", voiceUrl: "https://v", statusCallbackUrl: "https://s", messagingServiceSid: "MG1" });
  assert.equal(cfg.messagingServiceSid, "MG1"); // "already in service" is idempotent
  const msg = rec.calls.find((c) => c.url.includes("/Services/MG1/PhoneNumbers"));
  assert.equal(msg?.headers.Authorization, `Basic ${Buffer.from(`${SUB}:sub-token`).toString("base64")}`);
  await p.release({ accountSid: SUB, phoneNumberSid: "PN1" }); // 404 = already released
});

test("Twilio: webhook verification with the owning account's token", () => {
  const p = createTwilioVoiceProvider({ env: TW_ENV, fetch: recorder([]).fetch });
  const url = "https://app.example/api/webhooks/twilio/voice/status";
  const raw = "CallSid=CA1&CallStatus=completed&CallDuration=61";
  const sig = computeTwilioSignature("sub-token", url, { CallSid: "CA1", CallStatus: "completed", CallDuration: "61" });
  const now = new Date();
  assert.equal(p.verifyWebhook({ rawBody: raw, url, headers: { "x-twilio-signature": sig }, now, authToken: "sub-token" }), true);
  assert.equal(p.verifyWebhook({ rawBody: raw, url, headers: { "x-twilio-signature": sig }, now, authToken: "parent-token" }), false);
  assert.equal(p.verifyWebhook({ rawBody: raw, headers: { "x-twilio-signature": sig }, now, authToken: "sub-token" }), false);
  const [e] = p.parseWebhook({ rawBody: raw, headers: {}, now });
  assert.ok(e.type === "CALL_ENDED" && e.durationSec === 61);
});
