import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { answerRetellInbound, answerTwilioInbound, type InboundLookups } from "../src/lib/voice/inbound-core.ts";
import { decideInbound, inboundGreeting, INBOUND_GREETING_VERSION } from "../src/lib/voice/inbound.ts";
import { RECORDING_NOTICE } from "../src/lib/voice/opener.ts";
import { BIZ, LEAD, VoiceWorld, paidFacts } from "./voice-world.ts";

/**
 * Inbound return calls (§25) with fakes: a known lead reaches the AI on the
 * RETURN_CALL route with context; an unknown caller hears a short message and
 * gets a text back, or is transferred when allowed; entitlement, the recording
 * notice and opt-outs apply; a released number is not in service.
 */

const NUMBER = "+447700900111";
const LEAD_PHONE = "+447700900123";
const STRANGER = "+447700900777";

type Opts = { suspended?: boolean; transferMode?: "ON_REQUEST" | "ON_REQUEST_OR_ESCALATION" | "NEVER"; transferNumber?: string | null; recording?: boolean; optedOut?: boolean; suppressed?: boolean; numberState?: string };

function lookups(opts: Opts = {}): InboundLookups {
  return {
    async numbersFor(e164) {
      return e164 === NUMBER ? [{ businessId: BIZ, state: (opts.numberState ?? "ACTIVE") as never, e164: NUMBER, messagingServiceSid: "MG1" }] : [];
    },
    async leadsByPhone(businessId, e164) {
      return e164 === LEAD_PHONE ? [{ leadId: LEAD, businessId, phone: LEAD_PHONE, lastActivityAt: "2026-09-28T09:00:00Z" }] : [];
    },
    async settingsFor() {
      return {
        callingAsName: "Acme Studio",
        legalEntityName: "Acme Studio Ltd",
        identificationContact: "1 High Street, London, EC1A 1AA",
        personaName: "Sam",
        recordingEnabled: opts.recording ?? true,
        transferMode: opts.transferMode ?? "NEVER",
        transferNumber: opts.transferNumber ?? null,
        agentId: "agent_1",
      };
    },
    async adminControls() {
      return { outboundPaused: false, numberSuspended: Boolean(opts.suspended), spendLimitGbpMonth: null, spentGbpThisMonth: 0 };
    },
    async leadFlags() {
      return { optedOut: Boolean(opts.optedOut), suppressed: Boolean(opts.suppressed), anonymised: false, firstName: "Priya" };
    },
  };
}

describe("a known lead calling back", () => {
  test("Twilio hands the call to the AI over SIP; nothing is written on that request", async () => {
    const w = new VoiceWorld();
    const r = await answerTwilioInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE, callSid: "CA1", retellSipDomain: "sip.example" });
    assert.equal(r.decision.kind, "AI_AGENT");
    assert.match(r.twiml, /<Dial><Sip>sip:\+447700900111@sip\.example<\/Sip><\/Dial>/);
    assert.equal(w.calls.size, 0);
    assert.equal(w.jobs.length, 0);
  });

  test("Retell gets the agent, the locked greeting with the recording notice, and the lead's context", async () => {
    const w = new VoiceWorld();
    const r = await answerRetellInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE });
    assert.equal(r.decision.kind, "AI_AGENT");
    const vars = r.response.call_inbound.dynamic_variables!;
    assert.equal(vars.route, "RETURN_CALL");
    assert.equal(vars.lead_first_name, "Priya");
    assert.ok(vars.locked_preamble.startsWith("Thanks for calling Acme Studio. You are speaking with an AI assistant."));
    assert.ok(vars.locked_preamble.includes(RECORDING_NOTICE));
    assert.equal(vars.opener_version, INBOUND_GREETING_VERSION);
    assert.equal(r.response.call_inbound.override_agent_id, "agent_1");
    const call = w.calls.get(r.callId!)!;
    assert.equal(call.direction, "INBOUND");
    assert.equal(call.route, "RETURN_CALL");
    assert.equal(r.response.call_inbound.metadata!.voice_call_id, call.id);
    assert.equal(w.minutes.ledger.filter((l) => l.kind === "RESERVE").length, 1);
    // A redelivered webhook in the same minute gets the same call and hold.
    const again = await answerRetellInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE });
    assert.equal(again.callId, r.callId);
    assert.equal(w.minutes.ledger.filter((l) => l.kind === "RESERVE").length, 1);
  });

  test("no recording notice when recording is off", () => {
    assert.ok(!inboundGreeting({ callingAsName: "Acme", recordingEnabled: false }).includes(RECORDING_NOTICE));
  });
});

describe("entitlement applies to inbound answering", () => {
  for (const [label, facts] of [
    ["a trial", paidFacts({ plan: "trial", subscriptionStatus: "TRIALING" })],
    ["a workspace out of minutes", paidFacts()],
  ] as const) {
    test(`${label}: the AI never answers; a message and a text back`, async () => {
      const w = new VoiceWorld();
      w.facts = facts;
      if (label.includes("out of minutes")) {
        w.minutes.balanceOf(BIZ).includedRemainingSec = 0;
      }
      const t = await answerTwilioInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE, callSid: "CA2", retellSipDomain: "sip.example" });
      assert.equal(t.decision.kind, "MESSAGE");
      assert.match(t.twiml, /<Say language="en-GB">Thanks for calling Acme Studio/);
      assert.ok(w.jobs.some((j) => j.type === "voice.text_back"));
      const r = await answerRetellInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE });
      assert.deepEqual(r.response, { call_inbound: {} });
      assert.equal(w.calls.size, 0);
    });
  }

  test("a workspace paused by ClientTurn (kill switch): the number is not used at all, message only", async () => {
    const w = new VoiceWorld();
    w.facts = paidFacts({ settings: { ...paidFacts().settings!, admin_kill_switch: true } });
    const t = await answerTwilioInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE, callSid: "CA2k", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "MESSAGE");
    assert.equal(t.decision.kind === "MESSAGE" && t.decision.textBack, false);
    assert.equal(w.jobs.length, 0);
  });

  test("the AI not connected (no SIP hand-off configured): message and text back", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups(), { to: NUMBER, from: LEAD_PHONE, callSid: "CA3", retellSipDomain: null });
    assert.equal(t.decision.kind, "MESSAGE");
  });
});

describe("an unknown caller", () => {
  test("hears a short polite message and gets a text back", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups(), { to: NUMBER, from: STRANGER, callSid: "CA4", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "MESSAGE");
    assert.match(t.twiml, /send you a text message/);
    assert.match(t.twiml, /<Hangup\/>/);
    const job = w.jobs.find((j) => j.type === "voice.text_back")!;
    assert.equal(job.payload.to, STRANGER);
    assert.match(String(job.payload.body), /Reply STOP to opt out\./);
    assert.equal(job.key, "voice.text_back:twilio:CA4");
  });

  test("is put through to a person when the transfer setting allows", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups({ transferMode: "ON_REQUEST", transferNumber: "+442071234567" }), { to: NUMBER, from: STRANGER, callSid: "CA5", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "TRANSFER");
    assert.match(t.twiml, /<Dial callerId="\+447700900111">\+442071234567<\/Dial>/);
    assert.equal(w.jobs.length, 0);
  });

  test("with transfers set to never, no transfer even with a number", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups({ transferMode: "NEVER", transferNumber: "+442071234567" }), { to: NUMBER, from: STRANGER, callSid: "CA6", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "MESSAGE");
  });

  test("a withheld or landline caller gets the message without a text back", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups(), { to: NUMBER, from: "+442071234567", callSid: "CA7", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind === "MESSAGE" && t.decision.textBack, false);
    assert.equal(w.jobs.length, 0);
  });
});

describe("opt-outs and routing", () => {
  test("a lead who opted out of all contact: never the AI, never a text", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups({ optedOut: true }), { to: NUMBER, from: LEAD_PHONE, callSid: "CA8", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "MESSAGE");
    assert.equal(t.decision.kind === "MESSAGE" && t.decision.textBack, false);
    assert.equal(w.jobs.length, 0);
    const suppressed = await answerRetellInbound(w.deps(), lookups({ suppressed: true }), { to: NUMBER, from: LEAD_PHONE });
    assert.deepEqual(suppressed.response, { call_inbound: {} });
  });

  test("a released or quarantined number is not in service; the old tenant is never reached", async () => {
    const w = new VoiceWorld();
    const t = await answerTwilioInbound(w.deps(), lookups({ numberState: "QUARANTINED" }), { to: NUMBER, from: LEAD_PHONE, callSid: "CA9", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "REJECT");
    assert.match(t.twiml, /not in service/);
    assert.equal(w.audits.length, 0);
  });

  test("the pure decision is consistent: a known lead on an entitled workspace, AI ready", () => {
    const d = decideInbound({
      resolution: { kind: "WORKSPACE", businessId: BIZ, leadId: LEAD, ambiguous: false, callerE164: LEAD_PHONE },
      entitlement: { allowed: true, source: "PRO_VOICE_ITEM", availableSec: 1000 },
      lead: { optedOut: false, suppressed: false, anonymised: false },
      settings: { callingAsName: "Acme", recordingEnabled: false, transferMode: "NEVER", transferNumber: null },
      aiReady: true,
      callerCanReceiveSms: true,
    });
    assert.equal(d.kind, "AI_AGENT");
  });
});

describe("the operator's controls on inbound", () => {
  test("a suspended number: never the AI, no text back, no transfer; only the short message", async () => {
    const w = new VoiceWorld();
    const opts = { suspended: true, transferMode: "ON_REQUEST" as const, transferNumber: "+442071234567" };
    const t = await answerTwilioInbound(w.deps(), lookups(opts), { to: NUMBER, from: LEAD_PHONE, callSid: "CA10", retellSipDomain: "sip.example" });
    assert.equal(t.decision.kind, "MESSAGE");
    assert.equal(t.decision.kind === "MESSAGE" && t.decision.reason, "ADMIN_BLOCKED");
    assert.equal(w.jobs.length, 0);
    const r = await answerRetellInbound(w.deps(), lookups(opts), { to: NUMBER, from: LEAD_PHONE });
    assert.deepEqual(r.response, { call_inbound: {} });
  });
});
