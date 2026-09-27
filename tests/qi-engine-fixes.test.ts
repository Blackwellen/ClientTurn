import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { extract, extractCounts, extractProjectScope, parseNumberToken } from "../src/lib/qualification-intelligence/extractors.ts";
import { formAnswersToFacts, formValueCorroborates, interpret, type InterpretState } from "../src/lib/qualification-intelligence/interpret.ts";
import { intentByKey } from "../src/lib/qualification-intelligence/question-intents.ts";
import { leadFieldFactWrite, leadFieldsFromLeadForm } from "../src/lib/qualification-intelligence/facts.ts";
import { disqualifyFollowThrough, engineBookingReadiness, planFor, templateQuestionFeatures } from "../src/lib/agent/qi-turn.ts";
import { evaluateRunGate, evaluateToolGate, ENGINE_BOOKABLE_LIFECYCLES } from "../src/lib/agent/policy.ts";
import { LIFECYCLE_STATES, type LifecycleState } from "../src/lib/agent/types.ts";
import { nextBestActionSchema, type NextBestAction } from "../src/lib/qualification-intelligence/types.ts";
import { runConversation, type GoldenConversation } from "./golden-conversations/harness.ts";

/**
 * The engine fixes that closed the ten golden and grader TODOs, and the
 * runtime agent's open items (design 08 §C.5, release gates). Every case is
 * a behaviour, not an exact string: each gap is covered by its generalisation
 * and by a negative control.
 */

const NOW = "2026-09-24T09:00:00.000Z";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const state = (extra: Partial<InterpretState> = {}): InterpretState => ({ messageId: MESSAGE, now: NOW, ...extra });
const factFor = (i: ReturnType<typeof interpret>, dimension: string) => i.facts.find((f) => f.dimension === dimension);
const signals = (i: ReturnType<typeof interpret>) => i.signals.map((s) => s.signal_type);
const planned = (key: string) => intentByKey(key)!;

/* ============================================================ extractors */

describe("extractors: numbers with thousands separators are VOLUME", () => {
  for (const [reply, n] of [
    ["We ship about 2,000 orders a month and need a better courier deal.", "2000"],
    ["Roughly 12,500 transactions a month go through the tills.", "12500"],
    ["We sell 1,200,000 units a year", "1200000"],
  ] as const) {
    test(reply, () => {
      const v = factFor(interpret(reply, state()), "VOLUME");
      assert.equal(v?.value_normalised, n);
    });
  }
  test("a headcount is not a volume", () => {
    const i = interpret("We've got 1,200 staff.", state());
    assert.equal(factFor(i, "VOLUME"), undefined);
    assert.equal(factFor(i, "COMPANY_SIZE")?.value_normalised, "1200");
  });
});

describe("extractors: spelled and hedged numbers are TIMING", () => {
  for (const [reply, days] of [
    ["We'd want to launch in about three months.", "90"],
    ["within roughly six weeks", "42"],
    ["Hoping to start in two years", "730"],
    ["over the next twelve months", "360"],
    ["in 3 months", "90"],
  ] as const) {
    test(reply, () => {
      const t = extract("TIMELINE", reply, { now: NOW });
      assert.equal(t?.normalised, days);
      assert.equal(factFor(interpret(reply, state()), "TIMING")?.value_normalised, days);
    });
  }
  test("compound spelled numbers are read whole, never as their last word", () => {
    assert.equal(parseNumberToken("two hundred"), 200);
    assert.equal(parseNumberToken("two hundred and fifty"), 250);
    assert.equal(parseNumberToken("three thousand"), 3000);
    assert.equal(parseNumberToken("forty-five"), 45);
    assert.equal(parseNumberToken("twenty twenty"), null);
    assert.equal(parseNumberToken("five four"), null);
    assert.equal(extract("COUNT", "we have two hundred staff")?.normalised, "200");
    assert.equal(factFor(interpret("We ship two hundred and fifty orders a month", state()), "VOLUME")?.value_normalised, "250");
    assert.equal(extract("TIMELINE", "in eighteen months", { now: NOW })?.normalised, "540");
  });
  test("a number that is not a duration is not a timing", () => {
    assert.equal(extract("TIMELINE", "We have three offices", { now: NOW }), null);
  });
});

describe("extractors: a named team is TEAM_SIZE, not COMPANY_SIZE", () => {
  test("'a sales team of 12 people'", () => {
    const i = interpret("It's for a sales team of 12 people.", state());
    assert.equal(factFor(i, "TEAM_SIZE")?.value_normalised, "12");
    assert.equal(factFor(i, "COMPANY_SIZE"), undefined);
  });
  for (const reply of ["8 people on our support team", "a 15-person engineering team", "our marketing team is about 6"]) {
    test(reply, () => {
      const i = interpret(reply, state());
      assert.ok(factFor(i, "TEAM_SIZE"), JSON.stringify(i.facts));
      assert.equal(factFor(i, "COMPANY_SIZE"), undefined);
    });
  }
  test("a company headcount and a team size in one reply are both read", () => {
    const counts = extractCounts("We've got 45 staff and a sales team of 12 people");
    assert.deepEqual(
      counts.map((c) => [c.unit, c.normalised]),
      [
        ["staff", "45"],
        ["users", "12"],
      ],
    );
  });
  test("an unnamed team is still the company ('we're a team of 12')", () => {
    const i = interpret("We're a team of 12", state());
    assert.equal(factFor(i, "COMPANY_SIZE")?.value_normalised, "12");
    assert.equal(factFor(i, "TEAM_SIZE"), undefined);
  });
});

describe("extractors: what the lead wants made is PROJECT_SCOPE, not PROBLEM", () => {
  test("'We need a new website for our architecture practice.'", () => {
    const i = interpret("We need a new website for our architecture practice.", state());
    assert.ok(factFor(i, "PROJECT_SCOPE"));
    assert.equal(factFor(i, "PROBLEM"), undefined, "a deliverable is not a problem statement");
  });
  for (const reply of ["Looking for a redesign of our online shop.", "We want to rebuild our booking system", "we'd like a new logo and brand identity"]) {
    test(reply, () => assert.ok(extractProjectScope(reply), reply));
  }
  test("a real problem is still a PROBLEM", () => {
    const i = interpret("We're struggling with slow response times on enquiries.", state());
    assert.ok(factFor(i, "PROBLEM") ?? factFor(i, "DISSATISFACTION"));
    assert.equal(factFor(i, "PROJECT_SCOPE"), undefined);
  });
  test("a site visit is not a website", () => {
    assert.equal(extractProjectScope("We need a site visit next week"), null);
  });
});

describe("extractors: service failures are DISSATISFACTION", () => {
  for (const reply of [
    "Our current accountant never replies and we keep missing deadlines.",
    "They rarely answer the phone",
    "the agency doesn't get back to us",
    "They missed the filing deadline again",
    "our developer is always late with everything",
    "they're impossible to get hold of",
    "no response from them for weeks",
  ]) {
    test(reply, () => {
      const i = interpret(reply, state());
      assert.equal(factFor(i, "DISSATISFACTION")?.value_normalised, "DISSATISFIED", JSON.stringify(i.facts));
      assert.ok(signals(i).includes("DISSATISFACTION_CURRENT"));
    });
  }
  for (const reply of ["We reply to every enquiry within an hour", "We never miss a deadline", "Happy with our current provider"]) {
    test(`not dissatisfied: ${reply}`, () => {
      assert.equal(extract("DISSATISFACTION", reply), null);
    });
  }
});

describe("signals: asking for someone to come out is a BOOKING_REQUEST", () => {
  for (const reply of [
    "Can you book someone to come and look at my roof this week?",
    "Could you send someone round to have a look?",
    "When can someone come out?",
    "Can we arrange a survey?",
    "Could an engineer pop round and take a look at the boiler?",
  ]) {
    test(reply, () => {
      const i = interpret(reply, state());
      assert.ok(signals(i).includes("BOOKING_REQUEST"), signals(i).join(","));
      assert.equal(i.requested_action, "BOOK");
    });
  }
  test("looking at prices is not a booking", () => {
    assert.ok(!signals(interpret("I'd like to look at your pricing", state())).includes("BOOKING_REQUEST"));
  });
});

/* ======================================================= planned question */

describe("interpret: a direct answer to the planned question is CONFIRMED (TODO a)", () => {
  test("free text answering the planned USE_CASE is the lead's own answer", () => {
    const i = interpret("Mostly lead routing for our sales team", state({ currentIntent: planned("USE_CASE.MAIN_JOB") }));
    const f = factFor(i, "USE_CASE");
    assert.equal(f?.state, "CONFIRMED");
    assert.equal(f?.source, "ANSWER");
    assert.equal(i.answered_intent_key, "USE_CASE.MAIN_JOB");
    assert.equal(i.completeness, "FULL");
  });
  test("free text answering the planned PROBLEM", () => {
    const i = interpret("The problem is every site reports differently and the board can't compare them.", state({ currentIntent: planned("PROBLEM.PROMPT") }));
    assert.equal(factFor(i, "PROBLEM")?.state, "CONFIRMED");
  });
  test("a one-word answer is still an answer", () => {
    assert.equal(factFor(interpret("Payroll.", state({ currentIntent: planned("USE_CASE.MAIN_JOB") })), "USE_CASE")?.state, "CONFIRMED");
  });
  test("a bare number answers a planned count", () => {
    const f = factFor(interpret("about 12", state({ currentIntent: planned("TEAM_SIZE.USERS") })), "TEAM_SIZE");
    assert.equal(f?.state, "CONFIRMED");
    assert.equal(f?.value_normalised, "12");
  });
  test("an AI-only candidate stays INFERRED (CD-8)", () => {
    const reply = "It's for a sales team of 12 people.";
    const i = interpret(reply, state({ currentIntent: planned("USE_CASE.MAIN_JOB"), aiAssistAllowed: true }), [
      { dimension: "USE_CASE", value: "sales team", evidence_span: "sales team", confidence: 0.95 },
    ]);
    const f = factFor(i, "USE_CASE");
    assert.equal(f?.source, "AI_ASSIST");
    assert.equal(f?.state, "INFERRED");
  });
});

describe("interpret: a reply about something else is not the planned answer (TODO b)", () => {
  test("a team size in reply to USE_CASE", () => {
    const i = interpret("It's for a sales team of 12 people.", state({ currentIntent: planned("USE_CASE.MAIN_JOB") }));
    assert.equal(factFor(i, "USE_CASE"), undefined);
    assert.equal(i.answered_intent_key, null);
    assert.ok(factFor(i, "TEAM_SIZE"));
  });
  test("a question back is not an answer", () => {
    const i = interpret("What do you mean by that?", state({ currentIntent: planned("PROBLEM.PROMPT") }));
    assert.equal(factFor(i, "PROBLEM"), undefined);
  });
  test("an acknowledgement is not an answer", () => {
    assert.equal(factFor(interpret("ok thanks", state({ currentIntent: planned("USE_CASE.MAIN_JOB") })), "USE_CASE"), undefined);
  });
  test("a booking request is not a USE_CASE answer", () => {
    const i = interpret("Can we arrange a call next week?", state({ currentIntent: planned("USE_CASE.MAIN_JOB") }));
    assert.equal(factFor(i, "USE_CASE"), undefined);
    assert.equal(i.requested_action, "BOOK");
  });
  test("a volume is not a team size", () => {
    const i = interpret("We ship 2,000 orders a month", state({ currentIntent: planned("TEAM_SIZE.USERS") }));
    assert.equal(factFor(i, "TEAM_SIZE"), undefined);
    assert.equal(factFor(i, "VOLUME")?.value_normalised, "2000");
  });
  test("an answer that also mentions another dimension still answers", () => {
    const i = interpret("We'd use it to route leads for our 12-person sales team", state({ currentIntent: planned("USE_CASE.MAIN_JOB") }));
    assert.equal(factFor(i, "USE_CASE")?.state, "CONFIRMED");
    assert.ok(factFor(i, "TEAM_SIZE"));
  });
});

/* ================================================== follow-up ask history */

describe("follow-up templates record the question they ask (runtime item 1)", () => {
  test("a qualifying question maps to its dimension's base intent", () => {
    const f = templateQuestionFeatures("Hi Sam, just checking in. When are you hoping to get started?");
    assert.equal(f?.dimension, "TIMING");
    assert.ok(f && intentByKey(f.questionIntent)?.dimension === "TIMING");
  });
  test("a non-qualifying question records nothing", () => {
    assert.equal(templateQuestionFeatures("Are you still interested?"), null);
    assert.equal(templateQuestionFeatures("Thanks for your enquiry. We'll be in touch."), null);
  });
  test("automation-advance writes it on every follow-up but booking reminders", () => {
    const source = readFileSync(new URL("../src/lib/jobs/handlers/automation-advance.ts", import.meta.url), "utf8");
    assert.match(source, /question:\s*bookingReminder \? null : templateQuestionFeatures\(body\)/);
  });
});

/* ======================================================= booking readiness */

const convo = (extra: Partial<GoldenConversation>): GoldenConversation => ({
  id: "fixture",
  archetype: "ROOFER",
  motion: "LOCAL_SERVICE",
  channel: "sms",
  story: "",
  leadFields: { SERVICE_NEEDED: "Roof repair", LOCATION: "LS6 2AB" },
  turns: [{ lead: "Can you book someone to come and look at the roof this week?", expect: { actionIn: [] } }],
  ...extra,
});
const GATE = { gateDimensions: ["LOCATION", "SERVICE_NEEDED"] as NextBestAction["unknown_required_dimensions"], requiredDimensions: [] as NextBestAction["unknown_required_dimensions"] };

describe("form-submitted fields count as CONFIRMED for gating (runtime item 4)", () => {
  test("typed on a form: FORM, CONFIRMED; entered by anyone else: LEAD_FIELD, INFERRED", () => {
    const own = leadFieldFactWrite({ leadId: "11111111-1111-4111-8111-111111111111", serviceId: null, dimension: "LOCATION", value: "LS6 2AB", observedAt: NOW, submittedByLead: true })!;
    assert.equal(own.source, "FORM");
    assert.equal(own.state, "CONFIRMED");
    const staff = leadFieldFactWrite({ leadId: "11111111-1111-4111-8111-111111111111", serviceId: null, dimension: "LOCATION", value: "LS6 2AB", observedAt: NOW })!;
    assert.equal(staff.source, "LEAD_FIELD");
    assert.equal(staff.state, "INFERRED");
  });
  test("only an inbound lead with a form touch has form-submitted fields", () => {
    assert.equal(leadFieldsFromLeadForm({ created_via: "INBOUND" }, [{ source_type: "AD_FORM" }]), true);
    assert.equal(leadFieldsFromLeadForm({ created_via: "INBOUND" }, [{ source_type: "WEB_FORM" }]), true);
    assert.equal(leadFieldsFromLeadForm({ created_via: "INBOUND" }, [{ source_type: "SOCIAL_DM" }]), false);
    assert.equal(leadFieldsFromLeadForm({ created_via: "IMPORT" }, [{ source_type: "AD_FORM" }]), false);
    assert.equal(leadFieldsFromLeadForm({ created_via: "API" }, []), false);
  });
  test("a form value that parses for its label's dimension is CONFIRMED", () => {
    assert.equal(formValueCorroborates("LOCATION", "LS6 2AB"), true);
    assert.equal(formValueCorroborates("LOCATION", "near the park"), false);
    assert.equal(formValueCorroborates("PROBLEM", "the roof leaks"), false, "free text cannot corroborate");
    const facts = formAnswersToFacts([{ answers: { "What's your postcode?": "LS6 2AB" } }], [], () => "LOCATION");
    assert.equal(facts[0]?.state, "CONFIRMED");
  });
  test("a booking-ready form lead books with no VERIFY turn; the same fields entered by staff are verified first", () => {
    const [form] = runConversation(convo({ leadFieldsFrom: "FORM" }));
    assert.equal(form.action, "CTA_BOOK");
    assert.equal(form.nba.question_intent, null);
    const [staff] = runConversation(convo({ leadFieldsFrom: "STAFF" }));
    assert.equal(staff.action, "CTA_BOOK");
    assert.equal(staff.nba.question_intent?.purpose, "VERIFY", "control: staff-entered material facts are verified");
  });
});

describe("booking-readiness from the engine is enough for a pending booking (runtime item 2)", () => {
  const [row] = runConversation(convo({ leadFieldsFrom: "FORM" }));
  const ready = row.nba;
  const variant = (patch: Partial<NextBestAction>) => nextBestActionSchema.parse({ ...ready, ...patch });

  test("CTA_BOOK, gate known, goal B, nothing disqualifying: ready", () => {
    assert.equal(ready.current_goal, "B_BOOK_MEETING");
    assert.deepEqual(engineBookingReadiness(ready, GATE).ready, true);
  });
  test("manual booking mode asks the preferred time without a model call", () => {
    assert.equal(planFor(ready, { manual: true }).kind, "ASK_PREFERRED_TIME");
  });
  test("not ready: a gating dimension unknown, a gating question pending, another goal, a no/review verdict, suppress, negative", () => {
    assert.equal(engineBookingReadiness(ready, { ...GATE, gateDimensions: ["LOCATION", "PROPERTY_TYPE"] }).ready, false);
    assert.equal(engineBookingReadiness(ready, { ...GATE, requiredDimensions: ["PROPERTY_TYPE"] }).ready, true, "required but known-or-not-listed as unknown");
    assert.equal(engineBookingReadiness(variant({ unknown_required_dimensions: ["PROPERTY_TYPE"] }), { ...GATE, requiredDimensions: ["PROPERTY_TYPE"] }).ready, false);
    assert.equal(engineBookingReadiness(variant({ next_action: "INFORM" }), GATE).ready, false);
    // Owner decision 2026-09-27: goal E closes with a booked meeting (the
    // meeting is the hand-off), so it is booking-ready like goal B (was: not
    // ready, E escalated). Another goal is still not ready.
    assert.equal(engineBookingReadiness(variant({ current_goal: "E_HUMAN_CLOSER" }), GATE).ready, true);
    assert.equal(engineBookingReadiness(variant({ current_goal: "A_QUALIFY_ONLY" }), GATE).ready, false);
    assert.equal(engineBookingReadiness(variant({ engine_verdict: "NOT_QUALIFIED" }), GATE).ready, false);
    assert.equal(engineBookingReadiness(variant({ engine_verdict: "REVIEW" }), GATE).ready, false);
    // The contract forbids suppress on a CTA; the check is defensive.
    assert.equal(engineBookingReadiness({ ...ready, suppress: true }, GATE).ready, false);
    assert.equal(engineBookingReadiness(variant({ intent_state: "NOT_NOW" }), GATE).ready, false);
    assert.equal(engineBookingReadiness(null, GATE).ready, false);
    assert.equal(engineBookingReadiness(ready, null).ready, false);
  });
  test("a staff-entered lead with a VERIFY pending is not yet ready", () => {
    const [staff] = runConversation(convo({ leadFieldsFrom: "STAFF" }));
    assert.equal(engineBookingReadiness(staff.nba, GATE).ready, false);
  });

  const gate = (lifecycle: LifecycleState, engineBookingReady: boolean) =>
    evaluateToolGate({
      riskLevel: "HIGH",
      confidence: 1,
      lifecycle,
      requirements: { requiresConfirmedAvailability: true, requiresQualifiedState: true },
      facts: { contactable: true, availabilityConfirmed: true, optOutRecognised: false, bookingEnabled: false, engineBookingReady },
    });
  test("create_booking: an ENGAGED lead is refused without readiness and allowed with it", () => {
    assert.equal(gate("ENGAGED", false).allowed, false);
    assert.equal(gate("ENGAGED", true).allowed, true);
    assert.equal(gate("QUALIFIED", false).allowed, true, "QUALIFIED is unchanged");
  });
  test("create_booking: readiness never overrides REVIEW, NOT_QUALIFIED, HANDED_OVER, SUPPRESSED, WON or LOST", () => {
    for (const lifecycle of LIFECYCLE_STATES) {
      if ((ENGINE_BOOKABLE_LIFECYCLES as readonly string[]).includes(lifecycle)) continue;
      if (["QUALIFIED", "BOOKING_PENDING", "BOOKED"].includes(lifecycle)) continue;
      assert.equal(gate(lifecycle, true).allowed, false, lifecycle);
    }
  });
  test("create_booking: readiness does not waive confirmed availability", () => {
    const refused = evaluateToolGate({
      riskLevel: "HIGH",
      confidence: 1,
      lifecycle: "ENGAGED",
      requirements: { requiresConfirmedAvailability: true, requiresQualifiedState: true },
      facts: { contactable: true, availabilityConfirmed: false, optOutRecognised: false, bookingEnabled: false, engineBookingReady: true },
    });
    assert.equal(refused.allowed, false);
  });
  test("the orchestrator records readiness when it asks the preferred time and reads it back when the lead answers", () => {
    const source = readFileSync(new URL("../src/lib/agent/orchestrator.ts", import.meta.url), "utf8");
    assert.match(source, /askPreferredTime\(input, 1, engineBookingReadiness\(qi\.nba, qi\.bookingGate\)\.ready\)/);
    assert.match(source, /preferredTimeAsked: attempt, offeredSlots: \[\], engineBookingReady/);
    assert.match(source, /confirmBooking\(input, \{ confidence: 1 \}, parsed\.slot, \{ engineBookingReady \}\)/);
    assert.match(source, /engineBookingReady: offer\.engineBookingReady === true/);
  });
});

/* =============================================== disqualify with suppress */

describe("DISQUALIFY with suppress: no AI spend, no outreach, a person confirms (runtime item 3)", () => {
  const [row] = runConversation(convo({ leadFieldsFrom: "FORM" }));
  const disqualify = nextBestActionSchema.parse({ ...row.nba, next_action: "DISQUALIFY", question_intent: null, suppress: true, model_call_required: false, rule: "R3_DISQUALIFIED" });

  test("the plan sends nothing and needs no model", () => {
    const plan = planFor(disqualify, { manual: false });
    assert.equal(plan.kind, "SILENT");
    assert.equal(plan.kind === "SILENT" && plan.stopFollowUp, true);
  });
  test("a person is asked to confirm the suppression; the lead is told nothing", () => {
    assert.deepEqual(disqualifyFollowThrough(disqualify), { stopFollowUp: true, askPersonToSuppress: true, sendAcknowledgement: false });
    assert.equal(disqualifyFollowThrough({ ...disqualify, suppress: false }).askPersonToSuppress, false);
    assert.equal(disqualifyFollowThrough(row.nba).stopFollowUp, false);
  });
  test("the agent still may not suppress on its own: apply_suppression needs a recognised opt-out", () => {
    const refused = evaluateToolGate({
      riskLevel: "HIGH",
      confidence: 1,
      lifecycle: "ENGAGED",
      requirements: { requiresRecognisedOptOut: true },
      facts: { contactable: true, availabilityConfirmed: false, optOutRecognised: false, bookingEnabled: false },
    });
    assert.equal(refused.allowed, false);
  });
  test("after the handover the run gate refuses every further turn (no AI spend)", () => {
    const refused = evaluateRunGate({
      agentMode: "AUTO_REPLY",
      aiAssistEnabled: true,
      subscriptionActive: true,
      businessStatus: "active",
      channel: "sms",
      allowedChannels: ["sms"],
      conversationOwner: "HANDED_OVER",
      lifecycle: "HANDED_OVER",
      leadOptedOut: false,
      humanTakeover: true,
      isTestLead: false,
    });
    assert.equal(refused.allowed, false);
    assert.equal(refused.allowed === false && refused.code, "HUMAN_OWNS_CONVERSATION");
  });
  test("the orchestrator hands over without an acknowledgement", () => {
    const source = readFileSync(new URL("../src/lib/agent/orchestrator.ts", import.meta.url), "utf8");
    assert.match(source, /if \(disqualifyFollowThrough\(qi\.nba\)\.askPersonToSuppress\) \{\s*await askPersonToConfirmSuppression\(input, qi\.nba\);/);
    const fn = source.slice(source.indexOf("async function askPersonToConfirmSuppression"), source.indexOf("function acknowledgementFor"));
    assert.match(fn, /requestHumanHandover\(tools/);
    assert.doesNotMatch(fn, /sendMessage|deliverFixed/);
  });
});
