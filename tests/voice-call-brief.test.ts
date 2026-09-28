/**
 * Voice P3: the call brief (src/lib/voice/call-brief.ts) and the closing line
 * (opener.ts). Pure: no network, no database, no spend.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceCallBrief,
  briefStyleProblems,
  speechSafe,
  voiceMove,
  CALL_BRIEF_MAX_TOKENS,
  CALL_BRIEF_VERSION,
  estimateTokens,
  type CallBriefInput,
  type BriefRoute,
} from "../src/lib/voice/call-brief.ts";
import {
  attributionSpoken,
  CLOSING_VERSION,
  renderClosingLine,
  WHITE_LABEL_CLOSING,
  houseStyleViolations,
} from "../src/lib/voice/opener.ts";
import { PROVIDER_MAX_DURATION_SEC } from "../src/lib/voice/time-governor.ts";
import type { NextBestAction } from "../src/lib/qualification-intelligence/types.ts";
import type { WorkspaceObjectionSet } from "../src/lib/sales-library/workspace-objections.ts";

const CLOSING = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;

function input(overrides: Partial<CallBriefInput> = {}): CallBriefInput {
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
    offerLines: [],
    workspaceObjections: null,
    booking: "SLOTS",
    permissions: { book: true, quote: false, sendQuote: false, checkout: false },
    transfer: { mode: "ON_REQUEST", available: true },
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: CLOSING,
    ...overrides,
  };
}

function nba(overrides: Partial<NextBestAction> = {}): NextBestAction {
  return {
    current_goal: "B_BOOK_MEETING",
    intent_state: "MEDIUM",
    intent_score: 55,
    known_dimensions: [],
    unknown_required_dimensions: [],
    next_action: "ASK",
    question_intent: {
      key: "TIMING.WHEN",
      dimension: "TIMING",
      purpose: "QUALIFY",
      question_id: null,
      wording_family: "timing",
      rendering: "When are you hoping to have this in place?",
    },
    reason: "Timing unknown",
    rule: "R9",
    expected_information_gain: 0.5,
    qualification_score: 40,
    qualification_completeness: 0.4,
    engine_verdict: "PENDING",
    confidence: 0.8,
    handover_reason: null,
    assist_reason: null,
    resume_at: null,
    suppress: false,
    model_call_required: true,
    ...overrides,
  } as unknown as NextBestAction;
}

const ROUTES: BriefRoute[] = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"];

describe("the call brief, per route", () => {
  for (const route of ROUTES) {
    test(`${route}: bounded, speakable, with the safety rules and the closing line`, () => {
      const b = buildVoiceCallBrief(input({ route, direction: route === "RETURN_CALL" ? "INBOUND" : "OUTBOUND", permissions: { book: true, quote: true, sendQuote: true, checkout: true } }));
      assert.equal(b.version, CALL_BRIEF_VERSION);
      assert.ok(estimateTokens(b.text) <= CALL_BRIEF_MAX_TOKENS, `${route} brief is ${estimateTokens(b.text)} tokens`);
      assert.deepEqual(briefStyleProblems(b), [], `${route} brief breaks house style`);
      assert.match(b.text, /YOUR ONE MOVE NOW:/);
      assert.match(b.text, /Never say a price, quote, discount, delivery date, availability or service area/);
      assert.match(b.text, /One question at most/);
      assert.match(b.text, /Read every number back/);
      assert.match(b.text, /Never ask the same thing twice/);
      assert.match(b.text, /No invented deadline, scarcity, discount or statistic/);
      assert.match(b.text, /log_objection/);
      assert.ok(b.text.includes(`say exactly: "${CLOSING}"`));
      assert.match(b.text, /opt_out at once/);
      assert.equal(b.dynamicVariables.closing_line, CLOSING);
      for (const value of Object.values(b.dynamicVariables)) assert.equal(typeof value, "string");
      if (route === "RETURN_CALL") assert.match(b.text, /They rang you/);
      else assert.match(b.text, /You asked if now is a good time/);
    });
  }

  test("the time plan names the route's amber and red points and the provider ceiling", () => {
    const b = buildVoiceCallBrief(input({ route: "BOOKING_CLOSE" }));
    assert.match(b.timePlan, /Aim for about 3 minutes/);
    assert.match(b.timePlan, /2 minutes 15 seconds \(TIME_AMBER\)/);
    assert.match(b.timePlan, /From 3 minutes \(TIME_RED\)/);
    assert.match(b.timePlan, /\{\{session_duration\}\}/);
    assert.match(b.timePlan, new RegExp(`cut at ${PROVIDER_MAX_DURATION_SEC / 60} minutes`));
  });
});

describe("the one move comes from the lead's next-best-action", () => {
  test("ASK: the NBA's question, and record_fact after", () => {
    const move = voiceMove(input({ nba: nba() }));
    assert.match(move, /When are you hoping to have this in place\?/);
    assert.match(move, /record_fact/);
  });
  test("CTA_BOOK: availability then booking at the exact time", () => {
    const move = voiceMove(input({ nba: nba({ next_action: "CTA_BOOK", question_intent: null }) }));
    assert.match(move, /check_availability/);
    assert.match(move, /book_meeting with that exact time/);
  });
  test("CTA_CHECKOUT with direct close allowed: the link tool; without, a colleague", () => {
    assert.match(voiceMove(input({ nba: nba({ next_action: "CTA_CHECKOUT", question_intent: null }), permissions: { book: true, quote: false, sendQuote: false, checkout: true } })), /send_checkout_link/);
    const refused = voiceMove(input({ nba: nba({ next_action: "CTA_CHECKOUT", question_intent: null }) }));
    assert.doesNotMatch(refused, /send_checkout_link/);
    assert.match(refused, /Never give a price yourself/);
  });
  test("ESCALATE and DISQUALIFY never sell", () => {
    assert.match(voiceMove(input({ nba: nba({ next_action: "ESCALATE", question_intent: null, handover_reason: "HUMAN_REQUESTED" }) })), /colleague will follow up/);
    assert.match(voiceMove(input({ nba: nba({ next_action: "DISQUALIFY", question_intent: null }) })), /Do not sell/);
  });
  test("no booking permission: no booking tool in the move", () => {
    const move = voiceMove(input({ route: "BOOKING_CLOSE", permissions: { book: false, quote: false, sendQuote: false, checkout: false } }));
    assert.doesNotMatch(move, /book_meeting|check_availability/);
    assert.match(move, /schedule_callback/);
  });
});

describe("known facts, objections, transfer and continuity", () => {
  test("what is known is listed as never to be asked again", () => {
    const b = buildVoiceCallBrief(input({ known: ["Team size: 12", "Timing: next month"] }));
    assert.match(b.text, /ALREADY KNOWN, NEVER ASK AGAIN: Team size: 12; Timing: next month\./);
    assert.equal(b.dynamicVariables.known_facts, "Team size: 12; Timing: next month");
  });

  test("the business's own objection answers are included, paraphrase only", () => {
    const set: WorkspaceObjectionSet = {
      objections: [
        { key: "custom:slow", label: "Too slow", enabled: true, phrases: ["too slow"], response: "We launch in four weeks on average.", reassuranceIds: [], libraryKey: null } as never,
      ],
      assets: [],
      invalid: [],
    };
    const b = buildVoiceCallBrief(input({ workspaceObjections: set }));
    assert.match(b.text, /THE BUSINESS'S OWN ANSWERS \(approved: paraphrase, add nothing\)/);
    assert.deepEqual(b.record.workspaceObjectionKeys, ["custom:slow"]);
  });

  test("transfer off: a call-back instead, as the last resort", () => {
    const b = buildVoiceCallBrief(input({ transfer: { mode: "NEVER", available: false } }));
    assert.match(b.text, /Live transfer is off/);
    assert.doesNotMatch(b.text, /Call transfer_to_human/);
  });

  test("the earlier text conversation is carried, and dropped first when space runs out", () => {
    const b = buildVoiceCallBrief(input({ conversationSummary: "They asked about a redesign." }));
    assert.match(b.text, /EARLIER CONVERSATION \(so you do not repeat it\): They asked about a redesign\./);
  });

  test("the worst case stays inside the pinned bound, dropping optional detail in order", () => {
    const long = "An approved line about the offer that is quite long and goes on for a while. ".repeat(6);
    const b = buildVoiceCallBrief(
      input({
        route: "DIRECT_CLOSE",
        nba: nba({ next_action: "ANSWER_AND_ASK" }),
        known: Array.from({ length: 30 }, (_, i) => `Dimension ${i}: a fairly long known value number ${i}`),
        offerLines: Array.from({ length: 20 }, () => long),
        openerSuffix: "x".repeat(400),
        conversationSummary: "y ".repeat(900),
        workspaceObjections: {
          objections: Array.from({ length: 10 }, (_, i) => ({ key: `custom:o${i}`, label: `O${i}`, enabled: true, phrases: [`phrase ${i}`], response: "z ".repeat(300), reassuranceIds: [], libraryKey: null })) as never,
          assets: [],
          invalid: [],
        },
        permissions: { book: true, quote: true, sendQuote: true, checkout: true },
      }),
    );
    assert.ok(estimateTokens(b.text) <= CALL_BRIEF_MAX_TOKENS, `worst case is ${estimateTokens(b.text)} tokens`);
    assert.equal(b.dropped[0], "history");
    // The move, the money rule and the stop rule are never cut.
    assert.match(b.text, /YOUR ONE MOVE NOW:/);
    assert.match(b.text, /MONEY, TIMES AND AREAS/);
    assert.match(b.text, /STOP\./);
    assert.deepEqual(briefStyleProblems(b), []);
  });

  test("speechSafe removes dashes, emoji, markdown and links", () => {
    const out = speechSafe("Great value — really 🚀 **bold** see https://example.com - now");
    assert.deepEqual(houseStyleViolations(out), []);
    assert.doesNotMatch(out, /https?:|\*\*/);
  });
});

describe("the closing attribution line (owner decision 2026-09-28)", () => {
  test("fixed wording, versioned, with the business's calling name", () => {
    const c = renderClosingLine({ callingAsName: "  Acme   Studio ", whiteLabel: false });
    assert.equal(c.text, "Thanks for your time. You've been speaking with Acme Studio's AI assistant, powered by ClientTurn.");
    assert.equal(c.version, CLOSING_VERSION);
    assert.equal(c.attribution, true);
    assert.deepEqual(houseStyleViolations(c.text), []);
  });

  test("white label removes the attribution only", () => {
    const c = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: true });
    assert.equal(c.text, WHITE_LABEL_CLOSING);
    assert.equal(c.attribution, false);
    const b = buildVoiceCallBrief(input({ closingLine: c.text }));
    assert.doesNotMatch(b.text, /ClientTurn\./);
  });

  test("attribution_spoken is read from what the agent said, never assumed", () => {
    const c = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false });
    assert.equal(attributionSpoken(["Great, you are booked.", `Lovely. ${c.text.replace("You've", "You’ve")}`], c), true);
    assert.equal(attributionSpoken(["Understood. We will not call you again."], c), false);
    assert.equal(attributionSpoken([c.text], { ...c, attribution: false }), false);
  });

  test("an opted-out call ends without the closing line", () => {
    const b = buildVoiceCallBrief(input());
    assert.match(b.text, /end without the closing line/);
  });
});

describe("adversarial QA pass (2026-09-28)", () => {
  test("the recording answer is locked, and honest when recording is off", async () => {
    const { RECORDING_ANSWER_ON, RECORDING_ANSWER_OFF } = await import("../src/lib/voice/opener.ts");
    assert.ok(buildVoiceCallBrief(input({ recordingEnabled: true })).text.includes(`say exactly: "${RECORDING_ANSWER_ON}"`));
    assert.ok(buildVoiceCallBrief(input({ recordingEnabled: false })).text.includes(`say exactly: "${RECORDING_ANSWER_OFF}"`));
    assert.match(buildVoiceCallBrief(input()).text, /RECORDING\. If asked, say it is recorded only if your opening line said so/);
    assert.doesNotMatch(buildVoiceCallBrief(input({ recordingEnabled: true })).text, /may be recorded/);
  });

  test("every route leaves a next step, and the default question is one question", () => {
    assert.match(voiceMove(input({ route: "NURTURE", nba: null })), /next step.*schedule_callback/);
    assert.match(voiceMove(input({ route: "REACTIVATION", nba: null })), /close on the goal's step.*schedule_callback/);
    assert.doesNotMatch(voiceMove(input({ route: "QUALIFICATION", nba: null, permissions: { book: false, quote: false, sendQuote: false, checkout: false } })), / and what /);
  });

  test("slot labels are spoken, not read off a screen", async () => {
    const { spokenSlotChoice, spokenSlotLabel } = await import("../src/lib/voice/spoken-time.ts");
    assert.equal(spokenSlotLabel("Wed 30 Sep, 10:00am"), "Wednesday 30 September at 10am");
    assert.equal(spokenSlotLabel("Tue 9 Sep, 1:30pm"), "Tuesday 9 September at 1:30pm");
    assert.equal(spokenSlotChoice("Wed 30 Sep, 10:00am", "Wed 30 Sep, 2:00pm"), "Wednesday 30 September at 10am or 2pm");
    assert.equal(spokenSlotChoice("Wed 30 Sep, 10:00am", "Thu 1 Oct, 2:00pm"), "Wednesday 30 September at 10am or Thursday 1 October at 2pm");
    assert.equal(spokenSlotLabel("tomorrow morning"), "tomorrow morning");
  });
});
