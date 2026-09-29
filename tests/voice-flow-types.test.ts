/**
 * Voice QA pass, part B: every call route, checked end to end in the pure
 * layer. For QUALIFICATION, BOOKING_CLOSE, DIRECT_CLOSE, NURTURE,
 * REACTIVATION and RETURN_CALL: the brief, the target duration, the "is now
 * OK" handling, the move, the closing motion per goal (two slots for a
 * meeting, the checkout link by text for a sale, the sign-up link for a
 * trial, a quote through the tools), the fallback when a tool fails, and the
 * continuity after the call. No Retell, no model, no spend.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceCallBrief,
  briefGoal,
  voiceGoalStep,
  sendDetailsLine,
  estimateTokens,
  CALL_BRIEF_MAX_TOKENS,
  type BriefRoute,
  type CallBriefInput,
} from "../src/lib/voice/call-brief.ts";
import { ROUTE_TARGETS } from "../src/lib/voice/time-governor.ts";
import { renderClosingLine } from "../src/lib/voice/opener.ts";
import { runVoiceTool, type VoiceToolPorts, type ToolCallRow, type ToolPermissions, type VoiceToolResponse, type ToolObservation } from "../src/lib/voice/tools/core.ts";
import { RETELL_GENERAL_PROMPT } from "../src/lib/voice/tools/definitions.ts";
import { analyseCall } from "../src/lib/voice/post-call.ts";
import { buildCallMemoryNote, mergeCallIntoMemory } from "../src/lib/voice/continuity.ts";
import type { NextBestAction } from "../src/lib/qualification-intelligence/types.ts";

const CLOSING = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;

function input(o: Partial<CallBriefInput> = {}): CallBriefInput {
  return {
    route: "QUALIFICATION",
    direction: "OUTBOUND",
    callingAsName: "Acme Studio",
    personaName: "Sam",
    leadFirstName: "Priya",
    identityAnswer: "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.",
    openerSuffix: null,
    motion: "BOOK_MEETING_B2B",
    goal: null,
    nba: null,
    known: [],
    offerLines: ["Every site comes with a year of support"],
    workspaceObjections: null,
    booking: "SLOTS",
    permissions: { book: true, quote: true, sendQuote: true, checkout: true, bookingLink: true },
    transfer: { mode: "ON_REQUEST", available: true },
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: CLOSING,
    ...o,
  };
}

const ROUTES: BriefRoute[] = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"];

describe("part B: every route", () => {
  for (const route of ROUTES) {
    test(`${route}: bounded brief, its time target, the permission step, a move, a send-me-something line`, () => {
      const inbound = route === "RETURN_CALL";
      const b = buildVoiceCallBrief(input({ route, direction: inbound ? "INBOUND" : "OUTBOUND" }));
      assert.ok(estimateTokens(b.text) <= CALL_BRIEF_MAX_TOKENS);
      const timeRoute = route === "RETURN_CALL" ? "QUALIFICATION" : route;
      const target = ROUTE_TARGETS[timeRoute].targetSec;
      assert.match(b.timePlan, new RegExp(`Aim for about ${Math.floor(target / 60)} minute`));
      if (inbound) assert.match(b.text, /They rang you\. Ask how you can help/);
      else {
        assert.match(b.text, /If they say no or sound rushed, ask when suits, call schedule_callback/);
        // The first ten seconds after the locked opener: straight to why, then the move.
        assert.match(b.text, /If yes, go straight in: one sentence on why you are calling/);
      }
      assert.match(b.text, /YOUR ONE MOVE NOW: \S/);
      assert.match(b.text, /SEND ME SOMETHING\./);
      assert.match(b.text, /One or two short sentences a turn, under 25 words\. One question at most/);
      assert.match(b.text, /Spell an email address back letter by letter/);
      assert.match(b.text, /No invented deadline, scarcity, discount or statistic/);
      assert.match(b.text, /Never claim to be human/);
    });
  }

  test("the moves: book on BOOKING_CLOSE, sell on DIRECT_CLOSE, check in on NURTURE, re-open on REACTIVATION, help on RETURN_CALL", () => {
    assert.match(buildVoiceCallBrief(input({ route: "BOOKING_CLOSE" })).move, /check_availability/);
    assert.match(buildVoiceCallBrief(input({ route: "DIRECT_CLOSE", motion: "ECOMMERCE_DIRECT" })).move, /send_checkout_link/);
    assert.match(buildVoiceCallBrief(input({ route: "NURTURE" })).move, /Check in/);
    assert.match(buildVoiceCallBrief(input({ route: "REACTIVATION" })).move, /still something they are looking at/);
    assert.match(buildVoiceCallBrief(input({ route: "RETURN_CALL", direction: "INBOUND" })).move, /They rang back/);
    // Live call 2026-09-28: a qualification call works through its question plan.
    assert.match(buildVoiceCallBrief(input({ route: "QUALIFICATION" })).move, /QUESTION PLAN/);
  });
});

describe("part B: the closing motion per goal", () => {
  test("a meeting: assumptive, two times from check_availability, read back, then book_meeting at that exact time", () => {
    const b = buildVoiceCallBrief(input({ route: "BOOKING_CLOSE" }));
    assert.match(b.move, /offer two of its times as a choice \("I can do X or Y, which is better\?"\)/);
    assert.match(b.move, /read it back and call book_meeting with that exact time/);
    assert.match(b.text, /one light trial close first/);
    assert.equal(briefGoal(input({ route: "BOOKING_CLOSE" })), "MEETING");
  });

  test("a direct sale: the checkout link by text, the price only as the tool says it", () => {
    const i = input({ route: "DIRECT_CLOSE", motion: "ECOMMERCE_DIRECT" });
    assert.equal(briefGoal(i), "DIRECT_SALE");
    assert.match(buildVoiceCallBrief(i).move, /send_checkout_link\. Say the price only as the tool returns it/);
    assert.match(voiceGoalStep(i), /checkout link \(send_checkout_link\)/);
    assert.match(sendDetailsLine(i), /send_checkout_link/);
  });

  test("a trial: the sign-up link", () => {
    const i = input({ route: "QUALIFICATION", motion: "SAAS_SELF_SERVE", goal: "D_SIGNUP_TRIAL" });
    assert.equal(briefGoal(i), "TRIAL");
    assert.match(voiceGoalStep(i), /sign-up link/);
  });

  test("a quote: priced by calculate_quote and sent by send_quote", () => {
    const i = input({ route: "QUALIFICATION", motion: "LOCAL_SERVICE" });
    assert.equal(briefGoal(i), "QUOTE");
    assert.match(voiceGoalStep(i), /calculate_quote/);
    assert.match(sendDetailsLine(i), /calculate_quote and send it with send_quote/);
  });

  test("without the permission, a colleague takes the step: never a tool the owner did not allow", () => {
    const none = { book: false, quote: false, sendQuote: false, checkout: false, bookingLink: false };
    for (const motion of ["BOOK_MEETING_B2B", "ECOMMERCE_DIRECT", "SAAS_SELF_SERVE", "LOCAL_SERVICE"] as const) {
      const i = input({ motion, permissions: none });
      assert.match(voiceGoalStep(i), /colleague/, motion);
      assert.doesNotMatch(voiceGoalStep(i), /send_checkout_link|calculate_quote|check_availability/, motion);
      // No "today": a send time is a promise only a person can keep (live dry run 2026-09-29).
      assert.match(sendDetailsLine(i), /a colleague will send the details \(schedule_callback by PERSON/, motion);
      assert.doesNotMatch(sendDetailsLine(i), /today/, motion);
    }
  });

  test("'just email me' on a meeting goal: the booking link now, then a short follow-up at two times", () => {
    const line = sendDetailsLine(input({ route: "BOOKING_CLOSE" }));
    assert.match(line, /send the booking link now with send_booking_link/);
    assert.match(line, /short follow-up call at two times from check_availability/);
  });
});

describe("part B: when a tool fails", () => {
  const row: ToolCallRow = {
    id: "00000000-0000-4000-8000-00000000b001",
    business_id: "11111111-1111-4111-8111-111111111111",
    lead_id: "22222222-2222-4222-8222-222222222222",
    route: "BOOKING_CLOSE",
    state: "IN_CONVERSATION",
    direction: "OUTBOUND",
    consent_basis: "CALL_REQUESTED",
    answered_at: "2026-09-29T10:00:00.000Z",
    started_at: "2026-09-29T10:00:00.000Z",
    created_at: "2026-09-29T10:00:00.000Z",
  };
  const perms: ToolPermissions = { aiEnabled: true, book: true, quote: true, sendQuote: true, checkout: true, transferMode: "ON_REQUEST", transferNumberSet: false, transferHuman: false, aiCall: true, hasEmail: true, smsLawful: true, bookingLink: true };

  function ports(execute: VoiceToolPorts["execute"], seen: ToolObservation[] = [], completed: string[] = []): VoiceToolPorts {
    const stored = new Map<string, VoiceToolResponse>();
    return {
      now: () => new Date("2026-09-29T10:01:00.000Z"),
      loadCall: async () => row,
      claim: async ({ toolCallId }) => (stored.has(toolCallId) ? { kind: "DONE", response: stored.get(toolCallId)! } : { kind: "NEW" }),
      complete: async ({ toolCallId, response, status }) => {
        stored.set(toolCallId, response);
        completed.push(status);
      },
      priorResults: async () => [],
      permissions: async () => perms,
      execute,
      observe: (e) => seen.push(e),
    };
  }

  test("a timeout or outage: an apology and a text follow-up, never a guessed answer; recorded and observed", async () => {
    const seen: ToolObservation[] = [];
    const completed: string[] = [];
    const r = await runVoiceTool(ports(async () => { throw new Error("calendar timeout"); }, seen, completed), { name: "check_availability", toolCallId: "tc1", callId: row.id, providerCallId: "p", args: {} });
    const body = r.body as VoiceToolResponse;
    assert.equal(r.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.code, "UNAVAILABLE");
    assert.match(body.say ?? "", /^Sorry, I cannot do that just now\. I will get the details sent to you by text or email/);
    assert.deepEqual(completed, ["FAILED"]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].status, "FAILED");
    assert.equal(seen[0].tool, "check_availability");
    // The operator event carries no arguments and no words.
    assert.deepEqual(Object.keys(seen[0]).sort(), ["businessId", "callId", "code", "latencyMs", "operation", "status", "tool"]);
    assert.match(RETELL_GENERAL_PROMPT, /IF A TOOL FAILS OR TIMES OUT\. Say sorry once/);
  });

  test("send_booking_link: sent only with a link, by a lawful channel", async () => {
    const ok = await runVoiceTool(ports(async () => ({ ok: true, say: "I have sent the link by text.", data: {}, operation: "booking.link" })), { name: "send_booking_link", toolCallId: "tc2", callId: row.id, providerCallId: "p", args: { channel: "sms" } });
    assert.equal((ok.body as VoiceToolResponse).ok, true);
    perms.bookingLink = false;
    const none = await runVoiceTool(ports(async () => ({ ok: true, say: null, data: {}, operation: null })), { name: "send_booking_link", toolCallId: "tc3", callId: row.id, providerCallId: "p", args: { channel: "sms" } });
    assert.equal((none.body as VoiceToolResponse).code, "NO_BOOKING_LINK");
    perms.bookingLink = true;
    perms.smsLawful = false;
    const sms = await runVoiceTool(ports(async () => ({ ok: true, say: null, data: {}, operation: null })), { name: "send_booking_link", toolCallId: "tc4", callId: row.id, providerCallId: "p", args: { channel: "sms" } });
    assert.match((sms.body as VoiceToolResponse).say ?? "", /email it to you instead/);
    perms.smsLawful = true;
  });
});

describe("part B: continuity after the call", () => {
  test("the call becomes one more turn: its next step and objections join the lead's memory, and the next call carries the history", () => {
    const analysis = analyseCall({
      outcome: "COMPLETED",
      durationSec: 95,
      transcript: [
        { role: "agent", content: "Is now an OK time?", startMs: null, endMs: null },
        { role: "user", content: "yeah go on, it's a bit pricey honestly", startMs: null, endMs: null },
      ],
      providerSummary: "Price concern; agreed a follow-up.",
      endedAt: new Date("2026-09-29T10:02:00Z"),
    });
    assert.ok(analysis.objections.some((o) => o.key === "PRICE"));
    const note = buildCallMemoryNote({ endedAt: "2026-09-29T10:02:00Z", route: "QUALIFICATION", disposition: analysis.disposition, summary: analysis.summary, nextStep: "Call Wednesday 2pm", objectionKeys: analysis.objections.map((o) => o.key) });
    const memory = mergeCallIntoMemory(null, note, new Date("2026-09-29T10:03:00Z"));
    assert.ok(JSON.stringify(memory).includes("Call Wednesday 2pm"));
    const next = buildVoiceCallBrief(input({ conversationSummary: "Price concern raised on the last call; a follow-up was agreed." }));
    assert.match(next.text, /EARLIER CONVERSATION \(so you do not repeat it\): Price concern/);
  });

  test("a WAIT next-best-action on a call-back asks lightly and never pitches", () => {
    const nba = { next_action: "WAIT", current_goal: "B_BOOK_MEETING", question_intent: null, handover_reason: null } as unknown as NextBestAction;
    const b = buildVoiceCallBrief(input({ nba }));
    assert.match(b.move, /not the right time before\. Ask lightly whether anything has changed/);
  });
});
