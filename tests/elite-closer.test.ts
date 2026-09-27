import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OBJECTIONS, matchObjection } from "../src/lib/sales-library/objections.ts";
import { OBJECTION_RESPONSES, pickResponsePattern, renderResponsePattern } from "../src/lib/sales-library/objection-responses.ts";
import { OBJECTION_KEYS, type ObjectionKey } from "../src/lib/sales-library/types.ts";
import {
  matchWorkspaceObjection,
  parseWorkspaceObjectionRows,
  renderWorkspaceObjection,
} from "../src/lib/sales-library/workspace-objections.ts";
import { buildNbaStrategyBlock, buildStrategyBlock, objectionRaisedBefore, type StrategyInput } from "../src/lib/agent/strategy.ts";
import { closeLine, detectBuyingSignal, isCallOnlyRequest, isCallRequest } from "../src/lib/agent/closing.ts";
import {
  CHANNEL_PREFERENCE_LINE,
  parseChannelPreference,
  shouldAskChannelPreference,
} from "../src/lib/agent/channel-preference.ts";
import { preferredStepChannel } from "../src/lib/follow-up/channel-strategy.ts";
import { ASK_CRAFT_LINE, askCraftLine, craftedAsk, WHY_ASK } from "../src/lib/agent/question-craft.ts";
import { fixHumanStyle, humanStyleFailures, instructionLeaks } from "../src/lib/agent/human-style.ts";
import { validateResponse } from "../src/lib/agent/validate.ts";
import { previewObjection } from "../src/lib/agent/objection-preview.ts";
import { gradeReply, REPLY_GRADE_WEIGHTS, type ReplyCriterion } from "../src/lib/agent/reply-grader.ts";
import { selectCallMeetingType, type MeetingType } from "../src/lib/bookings/meeting-types.ts";
import { pressureIn } from "../src/lib/agent/validate.ts";
import { policyOnMessage } from "../src/lib/agent/handover-policy.ts";
import { classifyDeterministic } from "../src/lib/agent/classification.ts";
import { TURN_FIXTURES } from "./fixtures/qi-turn-fixtures.ts";

/**
 * The elite-closer brief (2026-09-27): objection handling, workspace-provided
 * objections, closing by motion, qualification craft, the one-time channel
 * question, and the reply grader's held-out fixture. Every lever is a lawful
 * one: no invented deadline, scarcity or social proof anywhere in the plan.
 */

const base = (extra: Partial<StrategyInput> = {}): StrategyInput => ({
  mode: "OBJECTION_HANDLING",
  motion: "BOOK_MEETING_B2B",
  archetypeKey: null,
  channel: "sms",
  selection: { question: null, stopReason: null, known: [] },
  latestMessage: null,
  hasApprovedInsight: false,
  bookingAvailable: true,
  ...extra,
});

/* ======================================================= the taxonomy */

describe("objection taxonomy", () => {
  const REQUIRED: ObjectionKey[] = [
    "PRICE", "BUDGET", "TIMING", "AUTHORITY", "NO_NEED", "STATUS_QUO", "TRUST", "SEND_INFORMATION",
    "EXISTING_PROVIDER", "COMPETITOR", "TOO_BUSY", "NOT_NOW", "LOCK_IN", "SECURITY", "PROCUREMENT", "JUST_LOOKING",
  ];

  test("covers every category the brief names", () => {
    for (const key of REQUIRED) assert.ok(OBJECTIONS[key], key);
  });

  test("every objection has 2 or 3 response patterns in the proven shape", () => {
    for (const key of OBJECTION_KEYS) {
      const patterns = OBJECTION_RESPONSES[key];
      assert.ok(patterns.length >= 2 && patterns.length <= 3, key);
      for (const p of patterns) {
        assert.ok(p.acknowledge && p.nextStep && p.reframe, `${key}/${p.name}`);
        const line = renderResponsePattern(p);
        assert.match(line, /^Shape: acknowledge/);
        assert.deepEqual(pressureIn(line), [], `${key}/${p.name} pressures`);
        assert.doesNotMatch(line, /\b(discount|limited time|only \d+ left|deadline)\b/i);
      }
    }
  });

  test("the first objection clarifies when the concern is unclear; a repeat reframes", () => {
    assert.ok(pickResponsePattern("PRICE", { seenBefore: false }).clarify);
    assert.equal(pickResponsePattern("PRICE", { seenBefore: true }).clarify, undefined);
    assert.equal(objectionRaisedBefore("Still too expensive for us", ["That's a bit expensive"]), true);
    assert.equal(objectionRaisedBefore("Still too expensive for us", ["When can you start?"]), false);
  });

  const HARD: [string, ObjectionKey][] = [
    ["Honestly we've got no budget until April.", "BUDGET"],
    ["Maybe after the new year, it's our busy season.", "TIMING"],
    ["I'd need to run it past my MD first.", "AUTHORITY"],
    ["To be honest we don't need it.", "NO_NEED"],
    ["What we have works fine for now.", "STATUS_QUO"],
    ["Never heard of you, is this legit?", "TRUST"],
    ["Can you just email me some info?", "SEND_INFORMATION"],
    ["We already have an agency we're happy with.", "EXISTING_PROVIDER"],
    ["We're getting quotes from other agencies.", "COMPETITOR"],
    ["I'm flat out busy this month.", "TOO_BUSY"],
    ["Not right now thanks.", "NOT_NOW"],
    ["We're tied into a contract with them until March.", "LOCK_IN"],
    ["We'd need you to complete our security questionnaire.", "SECURITY"],
    ["It would need to go through procurement and a tender.", "PROCUREMENT"],
    ["Just browsing at the moment really.", "JUST_LOOKING"],
    ["That's a bit steep for us.", "PRICE"],
  ];
  for (const [text, key] of HARD) {
    test(`detects ${key}: "${text}"`, () => assert.equal(matchObjection(text)[0]?.key, key));
  }

  test("a contract lock-in is handled by the AI; a request to change contract terms still goes to a person", () => {
    const lockIn = matchObjection("We're in a contract with our IT company until March.");
    assert.equal(lockIn.some((m) => m.key === "CONTRACT"), false, JSON.stringify(lockIn));
    assert.equal(lockIn.some((m) => m.key === "LOCK_IN"), true);
    const locked = policyOnMessage({ text: "We're tied into a contract until March", objectionKeys: lockIn.map((m) => m.key) } as never);
    assert.notEqual(locked.kind, "HANDOVER");
    assert.equal(matchObjection("Can we see your contract terms and liability cap?").some((m) => m.key === "CONTRACT"), true);
  });

  test("security and procurement stay an assist: the AI keeps the conversation", () => {
    const block = buildStrategyBlock(base({ latestMessage: "We'd need you to complete our security questionnaire." }));
    assert.equal(block.objection?.assistRequired, true);
    assert.equal(block.objection?.handoverRequired, false);
  });
});

/* ================================================= the business's own */

describe("workspace-provided objections", () => {
  const rows = [
    {
      key: "custom:mid-rebrand",
      payload: {
        label: "Mid-rebrand",
        phrases: ["mid-rebrand", "rebranding"],
        response: "We often start during a rebrand, so the new site launches with the new look.",
        reassuranceIds: ["case-rebrand"],
        enabled: true,
      },
    },
    {
      key: "PRICE",
      payload: {
        label: "Price",
        phrases: [],
        response: "Our fixed quotes include hosting for the first year, so there's no surprise bill later.",
        reassuranceIds: [],
        enabled: true,
      },
    },
    { key: "BUDGET", payload: { label: "Budget", phrases: [], response: "Off one.", reassuranceIds: [], enabled: false } },
    { key: "*", payload: { assets: [{ id: "case-rebrand", kind: "CASE_STUDY", text: "We rebuilt Northwind's site alongside their 2025 rebrand" }] } },
    { key: "custom:no-phrases", payload: { label: "Nothing", phrases: [], response: "x", enabled: true } },
    { key: "NOT_A_KEY", payload: { label: "x", response: "y" } },
  ];
  const set = parseWorkspaceObjectionRows(rows);

  test("rows are validated: invalid ones are reported and never half-used", () => {
    assert.deepEqual(set.invalid.sort(), ["NOT_A_KEY", "custom:no-phrases"]);
    assert.equal(set.objections.length, 3);
    assert.equal(set.assets.length, 1);
  });

  test("the business's own phrase wins, with its reassurance", () => {
    const match = matchWorkspaceObjection("We're mid-rebrand so it's early.", set);
    assert.equal(match?.objection.key, "custom:mid-rebrand");
    assert.equal(match?.via, "PHRASE");
    assert.equal(match?.assets[0]?.id, "case-rebrand");
    const lines = renderWorkspaceObjection(match!).join("\n");
    assert.match(lines, /add nothing/);
    assert.match(lines, /word for word or not at all/);
  });

  test("a library objection is refined by the business's answer; a disabled one is ignored", () => {
    assert.equal(matchWorkspaceObjection("too expensive", set, ["PRICE"])?.objection.key, "PRICE");
    assert.equal(matchWorkspaceObjection("no budget", set, ["BUDGET"]), null);
  });

  test("the strategy prefers the business's answer, in objection handling and in any mode for its phrases", () => {
    const priced = buildStrategyBlock(base({ latestMessage: "Honestly it's a bit expensive", workspaceObjections: set }));
    assert.match(priced.text, /Our fixed quotes include hosting/);
    assert.equal(priced.record.workspaceObjectionKey, "PRICE");
    const rebrand = buildStrategyBlock(base({ mode: "QUALIFICATION", latestMessage: "We're rebranding right now", workspaceObjections: set }));
    assert.match(rebrand.text, /We often start during a rebrand/);
  });

  test("a refusal or a person's matter never gets the business's sales answer", () => {
    const refusal = buildStrategyBlock(base({ latestMessage: "Not interested, too expensive anyway", workspaceObjections: set }));
    assert.doesNotMatch(refusal.text, /Our fixed quotes/);
  });

  test("the engine-planned turn carries the same objection lines", () => {
    const fixture = TURN_FIXTURES[0];
    const nba = buildNbaStrategyBlock({ ...fixture.legacy, mode: "OBJECTION_HANDLING", latestMessage: "a bit expensive", workspaceObjections: set }, fixture.nba, { booking: "SLOTS" });
    assert.match(nba.text, /Objection: Price\. Shape: acknowledge/);
    assert.match(nba.text, /Our fixed quotes include hosting/);
  });

  test("try it runs offline: the business's answer, the library, a hand-over, and a refused price", () => {
    const own = previewObjection({ message: "We're mid-rebrand", workspace: set });
    assert.equal(own.source, "WORKSPACE");
    assert.match(own.exampleReply, /We often start during a rebrand/);
    assert.deepEqual(own.problems, []);
    assert.ok(own.grade > 0);

    const library = previewObjection({ message: "Not right now thanks", workspace: set });
    assert.equal(library.source, "LIBRARY");
    assert.equal(library.libraryKey, "NOT_NOW");

    const person = previewObjection({ message: "Can we negotiate the contract terms and liability?", workspace: set });
    assert.equal(person.handsOver, true);

    const priced = parseWorkspaceObjectionRows([
      { key: "PRICE", payload: { label: "Price", phrases: [], response: "It's only £99 a month.", reassuranceIds: [], enabled: true } },
    ]);
    const warned = previewObjection({ message: "too expensive", workspace: priced });
    assert.ok(warned.problems.some((p) => p.code === "UNSUPPORTED_PRICE_CLAIM"), "an unpublished price in the business's answer is flagged");
  });

  test("the settings editor and its operations exist and are wired", () => {
    const section = readFileSync("src/app/(app)/app/settings/_sections/ai-selling-section.tsx", "utf8");
    assert.match(section, /<ObjectionsCard/);
    const registry = readFileSync("src/lib/services/registry.ts", "utf8");
    for (const name of ["sales_objections.list", "sales_objections.save", "sales_objections.remove", "sales_objections.save_reassurance", "sales_objections.preview"]) {
      assert.ok(registry.includes(`"${name}"`), name);
    }
    const migration = readFileSync("supabase/migrations/0147_elite_closer.sql", "utf8");
    assert.match(migration, /preferred_contact_channel/);
    assert.match(migration, /kind OBJECTION/);
  });
});

/* ============================================================ closing */

describe("closing by motion", () => {
  test("a meeting: two specific slots, then does either work", () => {
    const line = closeLine("BOOK_MEETING", "SLOTS");
    assert.match(line, /two of the confirmed times/);
    assert.match(line, /Does either work\?/);
  });
  test("a direct sale: the link plus the one line of value", () => assert.match(closeLine("CHECKOUT", "SLOTS"), /checkout link with the one line of value/));
  test("a trial: remove friction", () => assert.match(closeLine("TRIAL_OR_SIGNUP", "SLOTS"), /make starting easy/));
  test("enterprise: a meeting with a brief", () => assert.match(closeLine("BUSINESS_CASE", "SLOTS"), /brief of what they've told you/));
  test("no close line pressures", () => {
    for (const target of ["BOOK_MEETING", "CHECKOUT", "TRIAL_OR_SIGNUP", "BUSINESS_CASE", "CONSULTATION"] as const) {
      for (const route of ["SLOTS", "LINK", "ASK_PREFERRED_TIME", "TEAM_FOLLOW_UP"] as const) {
        assert.deepEqual(pressureIn(closeLine(target, route)), []);
      }
    }
  });

  test("buying signals are read deterministically", () => {
    for (const yes of ["Sounds good, what's the next step?", "How do we get started?", "Let's do it", "Ready to go ahead", "When can you start?"]) {
      assert.equal(detectBuyingSignal(yes), true, yes);
    }
    for (const no of ["Not ready to go ahead yet", "How much is it?", "We need a new website", "Sounds expensive"]) {
      assert.equal(detectBuyingSignal(no), false, no);
    }
  });

  test("a ready buyer is trial-closed instead of over-qualified; a required question is still asked", () => {
    const question = { id: "q1", questionText: "How many pages?", position: 1, options: [], required: false } as never;
    const optional = buildStrategyBlock(base({ mode: "QUALIFICATION", latestMessage: "Sounds good, what's the next step?", selection: { question, stopReason: null, known: [] } }));
    assert.equal(optional.record.trialClose, true);
    assert.equal(optional.record.nextQuestionId, null);
    assert.match(optional.text, /They sound ready/);
    const required = buildStrategyBlock(base({
      mode: "QUALIFICATION",
      latestMessage: "Sounds good, what's the next step?",
      selection: { question: { ...(question as object), required: true } as never, stopReason: null, known: [] },
    }));
    assert.equal(required.record.trialClose, false);
    assert.equal(required.record.nextQuestionId, "q1");
  });

  test("a call request is a warm close: bookable call times, not a hand-over", () => {
    assert.equal(isCallRequest("Can you give me a call?"), true);
    assert.equal(isCallOnlyRequest("Can someone ring me tomorrow?"), true);
    assert.equal(isCallOnlyRequest("I want to speak to a human, call me"), false);
    assert.equal(isCallRequest("Please don't call me"), false);
    // The classifier still says HUMAN_REQUEST, so a workspace with the agent off still hears about it.
    assert.equal(classifyDeterministic("give me a call")?.intent, "HUMAN_REQUEST");
    const legacy = buildStrategyBlock(base({ mode: "BOOKING_ASSISTANCE", latestMessage: "Can you give me a call?", callRequested: true, bookingRoute: "SLOTS" }));
    assert.match(legacy.text, /a phone call at two of the confirmed times/);
    assert.equal(legacy.record.callClose, true);
    const fixture = TURN_FIXTURES[0];
    const nba = buildNbaStrategyBlock({ ...fixture.legacy, callRequested: true }, fixture.nba, { booking: "SLOTS" });
    // The move still names the booking tool, so the fetched slots are offered
    // (regression: live stories Q1/S3 "can we book a call" never reached SLOTS).
    assert.match(nba.text, /Move: stop qualifying and propose a meeting: offer the confirmed slots \(SEND_BOOKING_OPTIONS\)\./);
    assert.match(nba.text, /Close: offer a phone call at two of the confirmed times/);
    assert.match(legacy.text, /SEND_BOOKING_OPTIONS/);
    for (const [route, how] of [["LINK", /share the booking link/], ["ASK_PREFERRED_TIME", /ask which day and time suits them/]] as const) {
      const other = buildNbaStrategyBlock({ ...fixture.legacy, callRequested: true }, fixture.nba, { booking: route });
      assert.match(other.text, how, route);
    }
    // With nothing to book, it stays a hand-over (the orchestrator's rule): no call close.
    const none = buildStrategyBlock(base({ mode: "BOOKING_ASSISTANCE", callRequested: true, bookingRoute: "TEAM_FOLLOW_UP" }));
    assert.equal(none.record.callClose, false);
  });

  test("a phone-call meeting type is chosen when the workspace has one", () => {
    const type = (id: string, name: string, extra: Partial<MeetingType> = {}): MeetingType => ({
      id, name, durationMinutes: 30, bufferMinutes: 0, assigneeRule: "ROUND_ROBIN", eligibleUserIds: [], serviceIds: [],
      specialisms: {}, calendarIntegrationId: null, isDefault: false, active: true, ...extra,
    });
    const types = [type("a", "Discovery meeting", { isDefault: true }), type("b", "Phone call")];
    assert.equal(selectCallMeetingType(types, null)?.id, "b");
    assert.equal(selectCallMeetingType([types[0]], null)?.id, "a", "no call type: the ordinary choice");
  });

  test("the orchestrator wires the call close, the repair path and the channel question", () => {
    const orchestrator = readFileSync("src/lib/agent/orchestrator.ts", "utf8");
    assert.match(orchestrator, /isCallOnlyRequest\(latestMessage\) && nbaBookingRoute\(context\) !== "TEAM_FOLLOW_UP"/);
    assert.match(orchestrator, /nextComposeStep\(/);
    assert.match(orchestrator, /fixHumanStyle\(/);
    assert.match(orchestrator, /markChannelPreferenceAsked\(/);
  });
});

/* ============================================= qualification craft */

describe("qualification craft", () => {
  test("the ask builds on the last answer and gives a reason where one helps, on its own line", () => {
    assert.equal(craftedAsk("Is there a budget range in mind?"), "ask only this, in natural wording: Is there a budget range in mind?");
    const craft = askCraftLine("BUDGET.RANGE");
    assert.match(craft, /^How to ask it: tie it to their last answer/);
    assert.match(craft, new RegExp(WHY_ASK.BUDGET));
    assert.doesNotMatch(askCraftLine("PROBLEM.PROMPT"), /why:/);
  });

  test("the legacy question line asks for framing, one question only", () => {
    const question = { id: "q1", questionText: "How many people would be using it?", position: 1, options: [], required: false } as never;
    const block = buildStrategyBlock(base({ mode: "QUALIFICATION", latestMessage: "We need a CRM", selection: { question, stopReason: null, known: [] } }));
    assert.ok(block.text.includes(ASK_CRAFT_LINE));
    assert.match(block.text, /One question at most/);
  });
});

/* ====================== no strategy instruction ever reaches a lead */

describe("strategy instructions never leak into a message", () => {
  // The same extraction the story harness's scripted model uses
  // (tests/stories/harness.ts, story-q-engine-live.ts): the question is the
  // end of its line. Nothing may follow it there.
  const legacyQuestion = (text: string) =>
    text.match(/Next best question\. Ask only this, in natural wording: (.+?)(?: \(acceptable answers: .*\))?$/m)?.[1] ?? null;
  const nbaQuestion = (text: string) => text.match(/ask only this, in natural wording: (.+)$/m)?.[1]?.trim() ?? null;

  test("the legacy question line ends with the question itself", () => {
    for (const questionText of ["How many people would be using it?", "Is there a budget range in mind?"]) {
      const question = { id: "q1", questionText, position: 1, options: [], required: false } as never;
      const block = buildStrategyBlock(base({ mode: "QUALIFICATION", latestMessage: "Hi", selection: { question, stopReason: null, known: [] } }));
      assert.equal(legacyQuestion(block.text), questionText, block.text);
    }
    const withOptions = { id: "q2", questionText: "Which service?", position: 1, options: [{ value: "a", label: "Web" }], required: false } as never;
    const block = buildStrategyBlock(base({ mode: "QUALIFICATION", latestMessage: "Hi", selection: { question: withOptions, stopReason: null, known: [] } }));
    assert.equal(legacyQuestion(block.text), "Which service?");
  });

  test("every engine-planned ask ends with the rendering itself", () => {
    for (const fixture of TURN_FIXTURES) {
      const block = buildNbaStrategyBlock(fixture.legacy, fixture.nba, { booking: "SLOTS" });
      const rendering = fixture.nba.question_intent?.rendering ?? null;
      if (rendering && /ask only this/.test(block.text)) assert.equal(nbaQuestion(block.text), rendering.trim(), fixture.id);
    }
  });

  test("the validator rejects any strategy wording in a draft, and the repair removes it", () => {
    const leaked = [
      "How many people would be using it? Build on their last answer, and give a short reason for asking if it isn't obvious.",
      "Is there a budget range in mind? Tie it to their last answer (why: so you can point them to the option that fits).",
      "How to ask it: build on their last answer. What's the postcode?",
      "Close: offer a call at two of the confirmed times. Does either work?",
      "Shape: acknowledge (fair question), then reframe. Is it the price?",
      "STRATEGY FOR THIS TURN (internal plan; never mention it) What's the postcode?",
    ];
    for (const draft of leaked) {
      assert.ok(instructionLeaks(draft).length > 0, draft);
      const result = validateResponse(draft, {
        channel: "sms", businessName: "Acme", publishedPriceText: [], confirmedSlots: [], bookingConfirmed: false, allowedUrls: [], serviceAreaConfirmed: false,
      });
      assert.equal(result.ok, false, draft);
      const fixed = fixHumanStyle(draft, { channel: "sms" });
      assert.deepEqual(instructionLeaks(fixed), [], fixed);
      assert.ok(!humanStyleFailures(fixed, { channel: "sms" }).some((f) => f.code === "STYLE_INSTRUCTION_LEAK"), fixed);
    }
    assert.deepEqual(instructionLeaks("I can do Tue 6 Oct, 10:00am or Wed 7 Oct, 2:00pm. Does either work?"), []);
  });

  test("no craft, close or response-shape line would pass as a message", () => {
    const lines = [
      ASK_CRAFT_LINE,
      askCraftLine("BUDGET.RANGE"),
      closeLine("BOOK_MEETING", "SLOTS"),
      closeLine("CHECKOUT", "SLOTS"),
      closeLine("TRIAL_OR_SIGNUP", "LINK"),
      renderResponsePattern(OBJECTION_RESPONSES.PRICE[0]),
    ];
    for (const line of lines) assert.ok(instructionLeaks(line).length > 0, line);
  });
});

/* ================================================ channel preference */

describe("contact-channel preference", () => {
  const ok = { mode: "QUALIFICATION", inboundCount: 3, alreadyAsked: false, preference: null, turnHasQuestion: false, channel: "sms" };
  test("asked once, lightly, never first, never twice, never over another question", () => {
    assert.equal(shouldAskChannelPreference(ok), true);
    assert.equal(shouldAskChannelPreference({ ...ok, inboundCount: 1 }), false, "never the first question");
    assert.equal(shouldAskChannelPreference({ ...ok, alreadyAsked: true }), false, "never twice");
    assert.equal(shouldAskChannelPreference({ ...ok, preference: "email" }), false);
    assert.equal(shouldAskChannelPreference({ ...ok, turnHasQuestion: true }), false);
    assert.equal(shouldAskChannelPreference({ ...ok, mode: "OBJECTION_HANDLING" }), false, "never in the way of a sale");
    assert.equal(shouldAskChannelPreference({ ...ok, mode: "BOOKING_ASSISTANCE" }), false);
  });

  test("the strategy adds it only on a turn that asks nothing else", () => {
    const noQuestion = buildStrategyBlock(base({ mode: "GENERAL_ENQUIRY", latestMessage: "Thanks", askChannelPreference: true, selection: { question: null, stopReason: "THRESHOLD_MET", known: [] } }));
    assert.ok(noQuestion.text.includes(CHANNEL_PREFERENCE_LINE));
    assert.equal(noQuestion.record.channelPreferenceAsked, true);
    const question = { id: "q1", questionText: "How many people?", position: 1, options: [], required: false } as never;
    const withQuestion = buildStrategyBlock(base({ mode: "QUALIFICATION", latestMessage: "Thanks", askChannelPreference: true, selection: { question, stopReason: null, known: [] } }));
    assert.ok(!withQuestion.text.includes(CHANNEL_PREFERENCE_LINE));
  });

  test("the answer is parsed deterministically", () => {
    assert.equal(parseChannelPreference("Email is better for me", "sms"), "email");
    assert.equal(parseChannelPreference("WhatsApp please", "sms"), "whatsapp");
    assert.equal(parseChannelPreference("Yes this is fine", "whatsapp"), "whatsapp");
    assert.equal(parseChannelPreference("email rather than text", "sms"), "email");
    assert.equal(parseChannelPreference("not text, email please", "sms"), "email");
    assert.equal(parseChannelPreference("call me", "sms"), "phone");
    assert.equal(parseChannelPreference("We need 20 pages", "sms"), null);
  });

  test("the follow-up channel strategy respects it; a call preference never re-routes a message", () => {
    const usable = (c: string) => (c === "email" ? { channel: c } : null);
    assert.deepEqual(preferredStepChannel("email", usable), { channel: "email" });
    assert.equal(preferredStepChannel("sms", usable), null, "unusable: the ordinary resolution applies");
    assert.equal(preferredStepChannel("phone", usable), null);
    assert.match(readFileSync("src/lib/jobs/handlers/automation-advance.ts", "utf8"), /preferredStepChannel\(/);
  });
});

/* ======================================================= reply grader */

describe("the reply grader (held-out labels, tests/fixtures/reply-grades-heldout.json)", () => {
  type Held = { id: string; channel: string; inbound: string; leadFirstName?: string; approvedClaims: string[]; objection: boolean; reply: string; pass: boolean };
  const fixture = JSON.parse(readFileSync("tests/fixtures/reply-grades-heldout.json", "utf8")) as { cases: Held[] };

  test("agrees with the hand labels written before the grader", () => {
    let agree = 0;
    for (const c of fixture.cases) {
      const grade = gradeReply(c.reply, c);
      if (grade.pass === c.pass) agree += 1;
      else console.log(`[reply-grader] disagrees on ${c.id}: graded ${grade.total}, labelled ${c.pass ? "pass" : "fail"}`);
    }
    console.log(`[reply-grader] held-out agreement ${agree}/${fixture.cases.length}`);
    assert.ok(agree / fixture.cases.length >= 0.9, `${agree}/${fixture.cases.length}`);
  });

  for (const c of fixture.cases) {
    test(`${c.id}: ${c.pass ? "passes" : "fails"}`, () => assert.equal(gradeReply(c.reply, c).pass, c.pass));
  }

  test("a critical failure grades 0 whatever else is good", () => {
    const g = gradeReply("Fair question — is it the overall price?", { channel: "sms", inbound: "too expensive" });
    assert.equal(g.total, 0);
    assert.deepEqual(g.critical, ["AI_PUNCTUATION"]);
  });

  test("each criterion can fail on its own (mutation)", () => {
    const input = { channel: "sms", inbound: "Do you integrate with HubSpot?", approvedClaims: ["Native two-way HubSpot sync"], objection: true, leadFirstName: "Sam" };
    const good = "Yes, there's a native two-way HubSpot sync, so nothing changes for your team. What would you want it to push first?";
    assert.equal(gradeReply(good, input).pass, true);
    const mutations: Record<ReplyCriterion, string> = {
      NO_AI_TELLS: "Certainly! Yes, there's a native two-way HubSpot sync. What would you want it to push first?",
      LENGTH_FIT: `Yes, there's a native two-way HubSpot sync. ${"It keeps everything in one place for the whole team every day. ".repeat(4)}What would you want it to push first?`,
      NATURAL_VOICE: "Yes Sam, there's a native two-way HubSpot sync, Sam. What would you want it to push first, Sam?",
      UK_SPELLING: "Yes, there's a native two-way HubSpot sync, so we optimize nothing by hand. What would you want it to push first?",
      CHAT_FORMAT: "Yes, there's a native two-way HubSpot sync. What would you want it to push first? Kind regards",
      ANSWERS_FIRST: "What would you want HubSpot to push first?",
      SPECIFIC: "Yes, there's a sync, so nothing changes for your team. What would you want it to push first?",
      ONE_CTA: "Yes, there's a native two-way HubSpot sync, so nothing changes for your team.",
      GROUNDED: "Yes, it works well with the tools you use. What would you want HubSpot to push first?",
    };
    for (const [criterion, text] of Object.entries(mutations) as [ReplyCriterion, string][]) {
      const grade = gradeReply(text, input);
      assert.ok(grade.scores[criterion] < REPLY_GRADE_WEIGHTS[criterion], `${criterion} did not drop: ${JSON.stringify(grade.scores)}`);
    }
  });
});
