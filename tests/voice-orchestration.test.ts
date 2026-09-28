/**
 * Voice P3, brief §71: channel orchestration golden cases
 * (src/lib/voice/channel-orchestration.ts). Pure and deterministic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decideNextChannel,
  missedCallText,
  textChannelFor,
  CALL_NOW_WINDOW_MS,
  type ChannelDecisionInput,
  type ChannelMove,
  type ChannelRule,
} from "../src/lib/voice/channel-orchestration.ts";
import { houseStyleViolations } from "../src/lib/voice/opener.ts";

const NOW = new Date("2026-09-28T11:00:00.000Z");
const IN = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

type Overrides = {
  [K in keyof ChannelDecisionInput]?: ChannelDecisionInput[K] extends object ? Partial<ChannelDecisionInput[K]> : ChannelDecisionInput[K];
};

function input(o: Overrides = {}): ChannelDecisionInput {
  return {
    now: NOW,
    point: o.point ?? "FOLLOW_UP_DUE",
    lead: {
      consentBasis: null,
      askedForCallNow: false,
      replyChannel: null,
      preferredChannel: null,
      intentState: "MEDIUM",
      buyingSignal: false,
      urgent: false,
      ...(o.lead ?? {}),
    },
    voice: { usable: true, aiMayCall: true, nextCallableAt: NOW, attemptsUsed: 0, maxAttempts: 3, ...(o.voice ?? {}) },
    channels: { SMS: true, WHATSAPP: false, EMAIL: true, ...(o.channels ?? {}) },
    sentSinceLastCall: (o.sentSinceLastCall as ChannelDecisionInput["sentSinceLastCall"]) ?? [],
    frequency: (o.frequency as ChannelDecisionInput["frequency"]) ?? { action: "allow" },
    retryCallAt: (o.retryCallAt as Date | null | undefined) ?? null,
  };
}

type Golden = { name: string; input: ChannelDecisionInput; move: ChannelMove; rule: ChannelRule; route?: string | null; then?: "CALL" | null };

const GOLDEN: Golden[] = [
  {
    name: "CALL_REQUESTED on the form + HIGH intent: call now, within hours",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "CALL_REQUESTED", intentState: "HIGH" } }),
    move: "CALL",
    rule: "V3",
    route: "QUALIFICATION",
  },
  {
    name: "CALL_REQUESTED + BOOKING_READY: the call is a booking close",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "CALL_REQUESTED", intentState: "BOOKING_READY" } }),
    move: "CALL",
    rule: "V3",
    route: "BOOKING_CLOSE",
  },
  {
    name: "FORM_CONSENT_TO_CALL + PURCHASE_READY: a direct close call",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "FORM_CONSENT_TO_CALL", intentState: "PURCHASE_READY" } }),
    move: "CALL",
    rule: "V3",
    route: "DIRECT_CLOSE",
  },
  {
    name: "CALL_REQUESTED + HIGH, but calling hours open tomorrow: text now instead",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "CALL_REQUESTED", intentState: "HIGH" }, voice: { nextCallableAt: new Date(NOW.getTime() + CALL_NOW_WINDOW_MS + 60_000) } }),
    move: "SMS",
    rule: "V3_TEXT",
  },
  {
    name: "phone number only (no call consent), HIGH intent: never an AI call; the fastest text",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "PHONE_NUMBER_PROVIDED", intentState: "HIGH", preferredChannel: "phone" } }),
    move: "SMS",
    rule: "V6",
  },
  {
    name: "the owner has not allowed 'Phone leads': no AI-initiated call",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "CALL_REQUESTED", intentState: "HIGH" }, voice: { aiMayCall: false } }),
    move: "SMS",
    rule: "V6",
  },
  {
    name: "no voice entitlement: no call",
    input: input({ point: "LEAD_CREATED", lead: { consentBasis: "CALL_REQUESTED", intentState: "HIGH" }, voice: { usable: false } }),
    move: "SMS",
    rule: "V6",
  },
  {
    name: "prefers the phone, consented, MEDIUM intent: call",
    input: input({ lead: { consentBasis: "FORM_CONSENT_TO_CALL", preferredChannel: "phone", intentState: "MEDIUM" }, voice: { attemptsUsed: 1 } }),
    move: "CALL",
    rule: "V4",
  },
  {
    name: "prefers the phone but LOW intent: the cheapest text (a call is never spent on a cold lead)",
    input: input({ lead: { consentBasis: "FORM_CONSENT_TO_CALL", preferredChannel: "phone", intentState: "LOW" }, voice: { attemptsUsed: 1 } }),
    move: "EMAIL",
    rule: "V6",
  },
  {
    name: "WhatsApp conversation, strong buying signal, asks for a call: call now",
    input: input({ point: "TEXT_REPLY", lead: { askedForCallNow: true, buyingSignal: true, replyChannel: "WHATSAPP", intentState: "HIGH" }, channels: { WHATSAPP: true } }),
    move: "CALL",
    rule: "V1",
    route: "BOOKING_CLOSE",
  },
  {
    name: "asks for a call with no buying signal and LOW intent: the WhatsApp conversation offers call times",
    input: input({ point: "TEXT_REPLY", lead: { askedForCallNow: true, replyChannel: "WHATSAPP", intentState: "LOW" }, channels: { WHATSAPP: true } }),
    move: "WHATSAPP",
    rule: "V1_TEXT",
  },
  {
    name: "asks for a call at 11pm: the conversation offers times (no call outside hours)",
    input: input({ point: "TEXT_REPLY", lead: { askedForCallNow: true, buyingSignal: true, replyChannel: "SMS" }, voice: { nextCallableAt: IN(10 * 60) } }),
    move: "SMS",
    rule: "V1_TEXT",
  },
  {
    name: "the lead's own request is a response: the frequency guard does not block it",
    input: input({ point: "TEXT_REPLY", lead: { askedForCallNow: true, buyingSignal: true, replyChannel: "SMS" }, frequency: { action: "skip" } }),
    move: "CALL",
    rule: "V1",
  },
  {
    name: "no answer: SMS now, the retry call stays scheduled",
    input: input({ point: "CALL_MISSED", lead: { consentBasis: "CALL_REQUESTED" }, voice: { attemptsUsed: 1 }, retryCallAt: IN(120) }),
    move: "SMS",
    rule: "V5",
    then: "CALL",
  },
  {
    name: "second miss: WhatsApp (window open) now, then the call",
    input: input({ point: "CALL_MISSED", lead: { consentBasis: "CALL_REQUESTED" }, voice: { attemptsUsed: 2 }, channels: { WHATSAPP: true }, sentSinceLastCall: ["SMS"], retryCallAt: IN(24 * 60) }),
    move: "WHATSAPP",
    rule: "V5",
    then: "CALL",
  },
  {
    name: "second miss with WhatsApp not lawful: wait for the retry call (no second SMS)",
    input: input({ point: "CALL_MISSED", lead: { consentBasis: "CALL_REQUESTED" }, voice: { attemptsUsed: 2 }, sentSinceLastCall: ["SMS"], retryCallAt: IN(24 * 60) }),
    move: "WAIT",
    rule: "V5",
    then: "CALL",
  },
  {
    name: "last attempt missed, texts used: an email closes the loop",
    input: input({ point: "CALL_MISSED", lead: { consentBasis: "CALL_REQUESTED" }, voice: { attemptsUsed: 3 }, sentSinceLastCall: ["SMS"] }),
    move: "EMAIL",
    rule: "V5",
    then: null,
  },
  {
    name: "a landline: no SMS after a missed call; email instead once attempts are used",
    input: input({ point: "CALL_MISSED", lead: { consentBasis: "CALL_REQUESTED" }, voice: { attemptsUsed: 3 }, channels: { SMS: false } }),
    move: "EMAIL",
    rule: "V5",
  },
  {
    name: "frequency guard: an automated touch is deferred",
    input: input({ point: "CALL_MISSED", lead: { consentBasis: "CALL_REQUESTED" }, frequency: { action: "defer", at: IN(600) } }),
    move: "WAIT",
    rule: "V2",
  },
  {
    name: "frequency guard: a dead lead gets nothing",
    input: input({ lead: { consentBasis: "CALL_REQUESTED", intentState: "HIGH" }, frequency: { action: "skip" } }),
    move: "NONE",
    rule: "V2",
  },
  {
    name: "NEGATIVE intent: nothing at all",
    input: input({ point: "TEXT_REPLY", lead: { askedForCallNow: true, intentState: "NEGATIVE", consentBasis: "CALL_REQUESTED" } }),
    move: "NONE",
    rule: "V0",
  },
  {
    name: "preference honoured among lawful text channels",
    input: input({ lead: { preferredChannel: "email" } }),
    move: "EMAIL",
    rule: "V6",
  },
];

describe("§71 golden cases", () => {
  for (const g of GOLDEN) {
    test(g.name, () => {
      const d = decideNextChannel(g.input);
      assert.equal(d.move, g.move, d.reason);
      assert.equal(d.rule, g.rule, d.reason);
      if (g.route !== undefined) assert.equal(d.route, g.route);
      if (g.then !== undefined) assert.equal(d.then?.move ?? null, g.then);
      // ONE move per decision point.
      assert.ok(["CALL", "SMS", "WHATSAPP", "EMAIL", "WAIT", "NONE"].includes(d.move));
    });
  }

  test("never a call to a lead who did not request or consent, whatever else is true", () => {
    for (const basis of [null, "PHONE_NUMBER_PROVIDED"] as const) {
      for (const point of ["LEAD_CREATED", "FOLLOW_UP_DUE", "CALL_MISSED"] as const) {
        for (const intent of ["MEDIUM", "HIGH", "BOOKING_READY", "PURCHASE_READY"]) {
          const d = decideNextChannel(input({ point, lead: { consentBasis: basis, intentState: intent, preferredChannel: "phone", urgent: true } }));
          assert.notEqual(d.move, "CALL", `${basis} ${point} ${intent}`);
        }
      }
    }
  });

  test("the cheapest lawful channel when nothing else decides; the fastest for a hot lead", () => {
    assert.equal(textChannelFor(input({ channels: { SMS: true, WHATSAPP: true, EMAIL: false } })), "WHATSAPP");
    assert.equal(textChannelFor(input({ lead: { intentState: "HIGH" }, channels: { SMS: true, WHATSAPP: true, EMAIL: true } })), "SMS");
    assert.equal(textChannelFor(input({ channels: { SMS: false, WHATSAPP: false, EMAIL: false } })), null);
  });

  test("the missed-call text is fixed, polite and speakable", () => {
    const t = missedCallText({ callingAsName: "Acme Studio", firstName: "Priya", channel: "SMS" });
    assert.equal(t, "Hi Priya, this is Acme Studio. We tried to call you about your enquiry but missed you. Just reply here whenever it suits, or tell us a good time to call.");
    assert.deepEqual(houseStyleViolations(t), []);
    assert.match(missedCallText({ callingAsName: "Acme", firstName: null, channel: "EMAIL" }), /^Hello, .*reply to this email/);
  });
});
