/**
 * The owner's first two REAL calls (2026-09-28), turned into pure tests: the
 * question plan, the booking-off and no-claims rules, one-sentence tool
 * refusals, the honest summary, the call-back that had already gone, the
 * assistant-off gate and the post-call quality flags. No Retell, no model,
 * no database, no spend. docs/VOICE.md §16.16.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildQuestionPlan, boundPlan, defaultPlanQuestions, MAX_REQUIRED_QUESTIONS, type ConfiguredQuestionLite } from "../src/lib/voice/question-plan.ts";
import { buildVoiceCallBrief, CALL_BRIEF_MAX_TOKENS, estimateTokens, briefStyleProblems, type CallBriefInput } from "../src/lib/voice/call-brief.ts";
import { renderClosingLine } from "../src/lib/voice/opener.ts";
import { availabilityOffers, checkingAvailabilityLines, lintCall, unapprovedClaimSentences } from "../src/lib/voice/call-lint.ts";
import { guardCallSummary, stripQualifiedLabel } from "../src/lib/voice/summary-guard.ts";
import { pastTimeReprompt, spokenNow, spokenWhen } from "../src/lib/voice/spoken-time.ts";
import { runVoiceTool, voiceToolGate, type PortOutcome, type PriorToolResult, type ToolCallRow, type ToolPermissions, type VoiceToolPorts, type VoiceToolResponse } from "../src/lib/voice/tools/core.ts";
import { assertVoiceAllowed, type VoiceEntitlementSnapshot } from "../src/lib/voice/entitlement.ts";
import { buildEntitlementSnapshot } from "../src/lib/voice/snapshot.ts";
import { ENTITLEMENT_MESSAGES } from "../src/lib/voice/dial-decision.ts";
import { analyseCall } from "../src/lib/voice/post-call.ts";

const CLOSING = renderClosingLine({ callingAsName: "Blackwellen", whiteLabel: false }).text;
const ROOF_REPLACEMENT = "aaaaaaaa-0000-4000-8000-000000000001";
const FLAT_ROOF = "aaaaaaaa-0000-4000-8000-000000000002";

function brief(overrides: Partial<CallBriefInput> = {}) {
  return buildVoiceCallBrief({
    route: "QUALIFICATION",
    direction: "OUTBOUND",
    callingAsName: "Blackwellen",
    personaName: null,
    leadFirstName: "Jamahl",
    identityAnswer: "This is Blackwellen Ltd. You can reach us at 1 High Street, London, EC1A 1AA.",
    openerSuffix: null,
    motion: "BOOK_MEETING_B2B",
    goal: null,
    nba: null,
    known: [],
    offerLines: [],
    workspaceObjections: null,
    booking: "TEAM_FOLLOW_UP",
    permissions: { book: false, quote: false, sendQuote: false, checkout: false },
    transfer: { mode: "ON_REQUEST", available: false },
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: CLOSING,
    serviceName: "Roof replacement",
    ...overrides,
  });
}

/* ----------------------------------------------------------- question plan */

describe("the question plan", () => {
  const configured: ConfiguredQuestionLite[] = [
    { id: "q-3", questionText: "Is the property a house or a flat", required: true, serviceId: null, position: 3, dimensionKey: "PROPERTY_TYPE" },
    { id: "q-1", questionText: "How big is the roof, roughly?", required: true, serviceId: ROOF_REPLACEMENT, position: 1, dimensionKey: "PROJECT_SCOPE" },
    { id: "q-2", questionText: "When would you like the work done?", required: false, serviceId: ROOF_REPLACEMENT, position: 2, dimensionKey: "TIMING" },
    { id: "q-9", questionText: "Is it a GRP or felt roof now?", required: true, serviceId: FLAT_ROOF, position: 0, dimensionKey: null },
  ];

  test("a lead whose service has configured questions gets them, in the owner's order, in the brief", () => {
    const plan = buildQuestionPlan({ configured, leadServiceId: ROOF_REPLACEMENT, serviceName: "Roof replacement", knownQuestionIds: [], knownDimensions: [], usesServiceAreas: false });
    assert.deepEqual(plan.map((q) => q.text), ["How big is the roof, roughly?", "When would you like the work done?", "Is the property a house or a flat?"]);
    assert.ok(plan.every((q) => q.source === "CONFIGURED"));
    const b = brief({ questionPlan: plan });
    const section = /QUESTION PLAN\.[^\n]*/.exec(b.text)?.[0] ?? "";
    assert.ok(section.indexOf("How big is the roof") < section.indexOf("When would you like") && section.indexOf("When would you like") < section.indexOf("house or a flat"), section);
    assert.deepEqual(b.record.questionPlanKeys, ["PROJECT_SCOPE", "TIMING", "PROPERTY_TYPE"]);
  });

  test("another service's questions never appear; a question with no dimension is keyed by its id", () => {
    const plan = buildQuestionPlan({ configured, leadServiceId: FLAT_ROOF, serviceName: "Flat roof", knownQuestionIds: [], knownDimensions: [], usesServiceAreas: false });
    assert.deepEqual(plan.map((q) => q.key), ["Q.q-9", "PROPERTY_TYPE"]);
  });

  test("what is known is skipped, never asked again", () => {
    const plan = buildQuestionPlan({ configured, leadServiceId: ROOF_REPLACEMENT, serviceName: null, knownQuestionIds: ["q-1"], knownDimensions: ["TIMING"], usesServiceAreas: false });
    assert.deepEqual(plan.map((q) => q.key), ["PROPERTY_TYPE"]);
  });

  test("none configured: the catalogue default for the named service, the postcode only with service areas", () => {
    assert.deepEqual(defaultPlanQuestions("Roof replacement", false).map((q) => q.key), ["PROJECT_SCOPE", "TIMING", "BUDGET", "AUTHORITY"]);
    assert.equal(defaultPlanQuestions("Roof replacement", false)[0].text, "What does the roof replacement involve, roughly?");
    assert.deepEqual(defaultPlanQuestions(null, true).map((q) => q.key), ["PROBLEM", "TIMING", "BUDGET", "AUTHORITY", "LOCATION"]);
    const known = buildQuestionPlan({ configured: [], leadServiceId: null, serviceName: "Roof replacement", knownQuestionIds: [], knownDimensions: ["LOCATION", "BUDGET"], usesServiceAreas: true });
    assert.deepEqual(known.map((q) => q.key), ["PROJECT_SCOPE", "TIMING", "AUTHORITY"]);
  });

  test("bounded: five questions at most, a floor of three required, a ceiling of four", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `K${i}`, text: `Question ${i}?`, required: false, source: "CONFIGURED" as const }));
    const b = boundPlan(many);
    assert.equal(b.length, 5);
    assert.equal(b.filter((q) => q.required).length, 3);
    const all = boundPlan(many.map((q) => ({ ...q, required: true })));
    assert.equal(all.filter((q) => q.required).length, MAX_REQUIRED_QUESTIONS);
  });

  test("the NBA's own question goes first, and the plan is never on a route that is not qualification", () => {
    const nba = { next_action: "ASK", question_intent: { key: "TEAM_SIZE.COUNT", dimension: "TEAM_SIZE", rendering: "How many people would use it?" } } as never;
    assert.deepEqual(brief({ nba }).record.questionPlanKeys.slice(0, 2), ["TEAM_SIZE", "PROJECT_SCOPE"]);
    assert.deepEqual(brief({ route: "BOOKING_CLOSE" }).record.questionPlanKeys, []);
  });
});

/* ------------------------------------------------------------------- brief */

describe("the brief for the live lead", () => {
  test("carries the plan, booking off, no approved claims, their enquiry and the clock, inside the bound", () => {
    const b = brief({
      nba: { next_action: "INFORM", question_intent: null } as never,
      enquirySummary: "Flat roof over the kitchen extension, about 18 m2, old felt has blistered. Usually free weekday mornings.",
      known: ["Location: BR1 4HZ"],
      now: new Date("2026-09-28T16:32:00.000Z"),
      timezone: "Europe/London",
    });
    assert.ok(estimateTokens(b.text) <= CALL_BRIEF_MAX_TOKENS, `${estimateTokens(b.text)} tokens`);
    assert.deepEqual(briefStyleProblems(b), []);
    assert.deepEqual(b.dropped, []);
    assert.match(b.text, /They enquired about: Roof replacement\./);
    assert.match(b.text, /YOUR ONE MOVE NOW: Ask question 1 of the QUESTION PLAN/);
    assert.match(b.text, /BOOKING IS OFF\./);
    assert.match(b.text, /NO APPROVED CLAIMS\./);
    assert.match(b.text, /THEIR ENQUIRY \(their words, do not read out\): Flat roof over the kitchen extension/);
    assert.match(b.text, /Never ask what prompted the enquiry/);
    assert.doesNotMatch(b.text, /Share one useful point|one light trial close|check_availability and offer/);
    assert.match(b.text, /CLOSE\. Only after the QUESTION PLAN: Ask which day and time of day suits a colleague to call them/);
    assert.match(b.timePlan, /NOW: at the start of the call it is Monday 28 September, 5:32pm their time\. A call-back time must be later than now; if they correct a time, the latest one wins/);
  });

  test("with approved lines there is no no-claims line, and the lines are the only facts", () => {
    const b = brief({ offerLines: ["Every roof comes with a ten year guarantee"] });
    assert.doesNotMatch(b.text, /NO APPROVED CLAIMS/);
    assert.match(b.text, /APPROVED OFFER LINES/);
  });
});

/* ------------------------------------------------------------ the call lint */

describe("the call lint (post-call and the QA harness)", () => {
  test("the live call's pitch, invented times and holding line are flagged", () => {
    assert.deepEqual(unapprovedClaimSentences("One useful point: we offer tailored solutions to fit your specific needs.", []), ["One useful point: we offer tailored solutions to fit your specific needs."]);
    assert.deepEqual(availabilityOffers("When would be good? I can offer times this afternoon or tomorrow morning."), ["I can offer times this afternoon or tomorrow morning."]);
    assert.deepEqual(checkingAvailabilityLines("One moment while I check availability for tomorrow morning."), ["One moment while I check availability for tomorrow morning."]);
  });

  test("an approved line said back is not a claim; ordinary questions are not flagged", () => {
    assert.deepEqual(unapprovedClaimSentences("Every roof comes with a ten year guarantee.", ["Every roof comes with a ten year guarantee"]), []);
    assert.deepEqual(unapprovedClaimSentences("What does the roof replacement involve, roughly?", []), []);
    assert.deepEqual(availabilityOffers("What day and time of day suits a colleague to call you?"), []);
    assert.deepEqual(availabilityOffers("I have Wednesday 30 September at 10am or 2pm. Does either work?"), []);
  });

  test("lintCall: availability is allowed after a real check, a holding line only with booking on", () => {
    const turns = ["I can offer times this afternoon or tomorrow morning.", "One moment while I check the diary."];
    assert.equal(lintCall({ agentTurns: turns, approvedLines: [], availabilityChecked: true, bookingAllowed: true }).length, 0);
    assert.equal(lintCall({ agentTurns: turns, approvedLines: [], availabilityChecked: false, bookingAllowed: false }).length, 2);
  });
});

/* ---------------------------------------------------------------- summary */

describe("the end-of-call summary is the engine's verdict, not the model's", () => {
  test("'Qualified lead' with a PENDING verdict and nothing recorded", () => {
    const g = guardCallSummary({ summary: "Qualified lead interested in tailored solutions; colleague to send details.", verdict: "PENDING", facts: [] });
    assert.doesNotMatch(g.summary, /\bQualified lead\b/);
    assert.match(g.summary, /^Lead \(qualification pending\) interested/);
    assert.match(g.summary, /No qualifying answers were recorded on the call; qualification stays pending\./);
    assert.deepEqual(g.reasons, ["QUALIFIED_LABEL_WITHOUT_VERDICT", "NO_FACTS_RECORDED"]);
  });

  test("a QUALIFIED verdict keeps the word; what was recorded is stated", () => {
    const g = guardCallSummary({ summary: "Qualified lead.", verdict: "QUALIFIED", facts: [{ dimension: "TIMING", value: "next month" }] });
    assert.match(g.summary, /^Qualified lead\. Learned on the call: timing: next month\.$/);
  });

  test("'not qualified', 'unqualified' and 'disqualified' are left alone", () => {
    for (const s of ["Not qualified yet.", "An unqualified enquiry.", "Disqualified: out of area."]) assert.equal(stripQualifiedLabel(s, null).changed, false, s);
  });

  test("end_call_summary through the tool core is guarded before it is stored", async () => {
    const ports = fakePorts(perms({ qualificationVerdict: "PENDING" }));
    await runVoiceTool(ports, { name: "end_call_summary", toolCallId: "t1", callId: "c", providerCallId: null, args: { summary: "Qualified lead, keen.", disposition: "CONVERSATION" } });
    const stored = ports.executed.find((e) => e.name === "end_call_summary")?.args as { summary: string };
    assert.match(stored.summary, /^Lead \(qualification pending\), keen\. No qualifying answers were recorded/);
  });
});

/* ---------------------------------------------------------------- tool core */

const NOW = new Date("2026-09-28T16:32:00.000Z"); // 17:32 in London

function row(): ToolCallRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_id: "11111111-1111-4111-8111-111111111111",
    lead_id: "22222222-2222-4222-8222-222222222222",
    route: "QUALIFICATION",
    state: "IN_CONVERSATION",
    direction: "OUTBOUND",
    consent_basis: "FORM_CONSENT_TO_CALL",
    answered_at: new Date(NOW.getTime() - 60_000).toISOString(),
    started_at: new Date(NOW.getTime() - 70_000).toISOString(),
    created_at: new Date(NOW.getTime() - 90_000).toISOString(),
  };
}

function perms(overrides: Partial<ToolPermissions> = {}): ToolPermissions {
  return { aiEnabled: true, book: false, quote: false, sendQuote: false, checkout: false, transferMode: "ON_REQUEST", transferNumberSet: false, transferHuman: false, aiCall: true, hasEmail: true, smsLawful: true, timezone: "Europe/London", ...overrides };
}

function fakePorts(p: ToolPermissions): VoiceToolPorts & { executed: { name: string; args: unknown }[] } {
  const rows = new Map<string, { status: string; response: VoiceToolResponse | null; tool: string }>();
  const executed: { name: string; args: unknown }[] = [];
  return {
    executed,
    now: () => NOW,
    loadCall: async () => row(),
    claim: async ({ toolCallId, tool }) => {
      if (rows.has(toolCallId)) return { kind: "IN_PROGRESS" };
      rows.set(toolCallId, { status: "IN_PROGRESS", response: null, tool });
      return { kind: "NEW" };
    },
    complete: async ({ toolCallId, status, response }) => {
      const r = rows.get(toolCallId)!;
      r.status = status;
      r.response = response;
    },
    priorResults: async (): Promise<PriorToolResult[]> => [...rows.values()].filter((r) => r.response).map((r) => ({ tool: r.tool as never, status: r.status, result: r.response!.data })),
    permissions: async () => p,
    execute: async (name, _call, args): Promise<PortOutcome> => {
      executed.push({ name, args });
      return { ok: true, say: null, data: {}, operation: null };
    },
  };
}

describe("tool refusals and gates (live calls 2026-09-28)", () => {
  test("a calendar tool with booking off: ONE sentence, and what to do instead", async () => {
    const r = await runVoiceTool(fakePorts(perms()), { name: "check_availability", toolCallId: "t1", callId: "c", providerCallId: null, args: { day_part: "morning" } });
    const body = r.body as VoiceToolResponse;
    assert.equal(body.ok, false);
    assert.equal(body.code, "NOT_PERMITTED");
    assert.equal(body.say, "A colleague will arrange a time with you.");
    assert.equal((body.say ?? "").split(/(?<=[.!?])\s+/).length, 1);
    assert.match(String(body.data.next), /Never offer times/);
  });

  test("a call-back time that has gone is refused with one natural reprompt", async () => {
    const past = new Date("2026-09-28T16:00:00.000Z"); // 5pm London, said at 5:32pm
    const r = await runVoiceTool(fakePorts(perms()), { name: "schedule_callback", toolCallId: "t2", callId: "c", providerCallId: null, args: { at_iso: past.toISOString(), by: "PERSON" } });
    const body = r.body as VoiceToolResponse;
    assert.equal(body.code, "PAST_TIME");
    assert.equal(body.say, "5pm has already gone today. Did you mean 6pm today, or 5pm tomorrow?");
    const later = new Date("2026-09-28T17:00:00.000Z");
    const ok = await runVoiceTool(fakePorts(perms()), { name: "schedule_callback", toolCallId: "t3", callId: "c", providerCallId: null, args: { at_iso: later.toISOString(), by: "PERSON" } });
    assert.equal((ok.body as VoiceToolResponse).ok, true);
  });

  test("the exact time is read back in words; the clock line says the local time", () => {
    assert.equal(spokenWhen(new Date("2026-09-28T17:00:00.000Z"), NOW, "Europe/London"), "6pm today");
    assert.equal(spokenWhen(new Date("2026-09-29T08:30:00.000Z"), NOW, "Europe/London"), "9:30am tomorrow");
    assert.equal(spokenNow(NOW, "Europe/London"), "Monday 28 September, 5:32pm");
    assert.equal(pastTimeReprompt(new Date("2026-09-28T20:00:00.000Z"), new Date("2026-09-28T20:30:00.000Z"), "Europe/London"), "9pm has already gone today. Did you mean 9pm tomorrow?");
  });

  test("the text assistant off: record_fact and a person's call-back still work; selling, booking and an AI call-back do not", () => {
    const off = perms({ aiEnabled: false, book: true });
    const gate = (name: string, args: unknown = {}) => voiceToolGate({ name: name as never, args: args as never, call: row(), permissions: off, prior: [], now: NOW });
    assert.equal(gate("record_fact", { dimension: "TIMING", value: "soon" }).allowed, true);
    assert.equal(gate("schedule_callback", { by: "PERSON" }).allowed, true);
    assert.equal(gate("schedule_callback", { by: "AI" }).allowed, false);
    assert.equal(gate("check_availability").allowed, false);
    assert.equal(gate("send_booking_link", { channel: "sms" }).allowed, false);
  });
});

/* -------------------------------------------------- the dial-time gate */

describe("AI calls need the AI assistant on (second live call 2026-09-28)", () => {
  const ready: VoiceEntitlementSnapshot = buildEntitlementSnapshot({
    plan: "pro",
    subscriptionStatus: "ACTIVE",
    businessStatus: "ACTIVE",
    voiceCapability: true,
    grants: { proVoiceItem: true, numberItem: false },
    packsHeld: false,
    balance: { includedRemainingSec: 6000, packRemainingSec: 0 },
    platformKill: false,
    settings: { voice_enabled: true, admin_kill_switch: false, calling_as_name: "Blackwellen", legal_entity_name: "Blackwellen Ltd", identification_contact: "1 High Street, London, EC1A 1AA", assistant_persona_name: null },
    number: { provisioning_state: "ACTIVE", e164: "+447700900000" },
  });

  test("off: the dial is refused with a reason that says where to fix it", () => {
    const d = assertVoiceAllowed({ ...ready, settings: { ...ready.settings, aiAssistantOn: false } });
    assert.equal(d.allowed, false);
    if (!d.allowed) {
      assert.equal(d.reason, "AI_ASSISTANT_OFF");
      assert.equal(d.productState, "integration-required");
      assert.match(ENTITLEMENT_MESSAGES[d.reason], /Switch on the AI assistant in Settings, Workspace before AI calls/);
    }
  });

  test("on, or not read: allowed as before", () => {
    const withSource = (ready.identity.identificationContact ? ready : ready) as VoiceEntitlementSnapshot;
    assert.equal(assertVoiceAllowed({ ...withSource, settings: { ...withSource.settings, aiAssistantOn: true } }).allowed, assertVoiceAllowed(withSource).allowed);
  });
});

/* ------------------------------------------------------------- post-call */

describe("post-call analysis keeps the verdict and flags what should not have been said", () => {
  test("the live call's words", () => {
    const a = analyseCall({
      outcome: "COMPLETED" as never,
      durationSec: 60,
      transcript: [
        { role: "agent", content: "One useful point: we offer tailored solutions to fit your specific needs. Does that sound like it would help?", startMs: 0, endMs: 1 },
        { role: "user", content: "Yes.", startMs: 2, endMs: 3 },
        { role: "agent", content: "I can offer times this afternoon or tomorrow morning.", startMs: 4, endMs: 5 },
        { role: "user", content: "Tomorrow.", startMs: 6, endMs: 7 },
        { role: "agent", content: "One moment while I check availability for tomorrow morning.", startMs: 8, endMs: 9 },
      ],
      providerSummary: "Qualified lead interested in tailored solutions.",
      endedAt: new Date("2026-09-28T16:40:00.000Z"),
      qualificationVerdict: "PENDING",
      bookingAllowed: false,
    });
    assert.match(a.summary ?? "", /^Lead \(qualification pending\) interested/);
    assert.equal(a.qualityFlags.length, 3);
    assert.match(a.facts.quality_flags ?? "", /UNAPPROVED_CLAIM/);
    assert.match(a.facts.quality_flags ?? "", /AVAILABILITY_WITHOUT_TOOL/);
    assert.match(a.facts.quality_flags ?? "", /CHECKING_WHEN_BOOKING_OFF/);
  });
});

/* ------------------------------ the live dry run (2026-09-28): workspace data */

describe("the live workspace's data reaches the brief", () => {
  test("service questions first, then the workspace-wide ones (service_id null) in position order, one per dimension or intent", () => {
    const configured: ConfiguredQuestionLite[] = [
      { id: "w0", questionText: "Are you the homeowner?", required: true, serviceId: null, position: 0, dimensionKey: null },
      { id: "w1", questionText: "What is the property postcode?", required: true, serviceId: null, position: 1, dimensionKey: "LOCATION" },
      { id: "w2", questionText: "How soon do you need the work done?", required: true, serviceId: null, position: 2, dimensionKey: "TIMING", intentKey: "TIMING.WHEN" },
      { id: "w3", questionText: "Roughly what budget do you have in mind?", required: false, serviceId: null, position: 3, dimensionKey: "BUDGET" },
      { id: "s1", questionText: "When would you want the roof done?", required: true, serviceId: ROOF_REPLACEMENT, position: 5, dimensionKey: "TIMING" },
      { id: "s0", questionText: "Is it the whole roof or part of it?", required: true, serviceId: ROOF_REPLACEMENT, position: 4, dimensionKey: "PROJECT_SCOPE" },
    ];
    const plan = buildQuestionPlan({ configured, leadServiceId: ROOF_REPLACEMENT, serviceName: "Roof replacement", knownQuestionIds: [], knownDimensions: ["LOCATION"], usesServiceAreas: true });
    assert.deepEqual(plan.map((q) => q.key), ["PROJECT_SCOPE", "TIMING", "Q.w0", "BUDGET"]);
    assert.equal(plan[1].text, "When would you want the roof done?", "the service's own timing question wins; the workspace-wide one is not asked twice");
    // A lead on a service with no questions of its own gets the workspace-wide ones, never the default.
    const other = buildQuestionPlan({ configured, leadServiceId: null, serviceName: "Chimney works", knownQuestionIds: ["w1"], knownDimensions: [], usesServiceAreas: true });
    assert.deepEqual(other.map((q) => q.text), ["Are you the homeowner?", "How soon do you need the work done?", "Roughly what budget do you have in mind?"]);
    assert.ok(other.every((q) => q.source === "CONFIGURED"));
  });

  test("the offer card: approved sections only; NEVER CLAIM items are forbidden, not approved", async () => {
    const { voiceOfferLines, dedupeApproved } = await import("../src/lib/voice/call-brief.ts");
    const card = [
      "OFFER CARD AND VOICE",
      "Business: Blackwellen Roofing",
      "Use only what is written here. Anything not listed is unknown: do not state it.",
      "",
      "NEVER CLAIM",
      "- cheapest",
      "- best in London",
      "",
      "VOICE",
      "- Tone: professional. Reply length: short.",
      "",
      "WHAT THEY SELL",
      "- Roof replacement: Full strip and re-roof",
      "",
      "APPROVED CLAIMS",
      "- 10-year workmanship guarantee",
      "",
      "PUBLISHED PRICES",
      "- None. Do not state any price, in digits or words.",
    ].join("\n");
    const o = voiceOfferLines(card);
    assert.deepEqual(o.approved, ["10-year workmanship guarantee", "Roof replacement: Full strip and re-roof"]);
    assert.deepEqual(o.never, ["cheapest", "best in London"]);
    assert.deepEqual(
      dedupeApproved(["DEMO: 10-year guarantee. Fully insured. Over 15 years trading.", "DEMO: 10-year guarantee", "DEMO: Fully insured", "DEMO: Over 15 years trading"]),
      ["DEMO: 10-year guarantee", "DEMO: Fully insured", "DEMO: Over 15 years trading"],
    );
    const b = brief({ offerLines: o.approved, neverSay: o.never });
    assert.match(b.text, /APPROVED OFFER LINES[^\n]*10-year workmanship guarantee/);
    assert.doesNotMatch(b.text, /APPROVED OFFER LINES[^\n]*cheapest/);
    assert.match(b.text, /NEVER SAY OR CLAIM: cheapest; best in London\./);
    assert.doesNotMatch(b.text, /NO APPROVED CLAIMS/);
  });

  test("booking allowed but no calendar: never book_meeting on a guessed time, never check times", () => {
    const b = brief({ permissions: { book: true, quote: false, sendQuote: false, checkout: false }, booking: "ASK_PREFERRED_TIME" });
    assert.match(b.text, /NO CALENDAR ON THIS CALL\./);
    assert.match(b.text, /call schedule_callback by PERSON with it in the note/);
    assert.doesNotMatch(b.text, /call book_meeting with it/);
    assert.doesNotMatch(b.text, /two times from check_availability/);
  });
});
