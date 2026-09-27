import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { formAnswersToFacts, interpret, interpretedDimensions, withIntentDelta, type InterpretState } from "../src/lib/qualification-intelligence/interpret.ts";
import { extract, isDeflection, isQuestion } from "../src/lib/qualification-intelligence/extractors.ts";
import { factValues, intentByKey } from "../src/lib/qualification-intelligence/question-intents.ts";
import { interpretationSchema, qualificationFactWriteSchema } from "../src/lib/qualification-intelligence/types.ts";
import { inferDimension, type QuestionRecord } from "../src/lib/qualification/next-question.ts";
import { fact, NOW } from "./qualification-intel/matrix.ts";

const MESSAGE = "44444444-4444-4444-8444-444444444444";
const Q_SIZE = "55555555-5555-4555-8555-555555555555";
const Q_SERVICE = "66666666-6666-4666-8666-666666666666";
const LEAD = "11111111-1111-4111-8111-111111111111";

const state = (extra: Partial<InterpretState> = {}): InterpretState => ({
  messageId: MESSAGE,
  now: NOW,
  context: { incumbentTerms: ["it provider", "it support"] },
  ...extra,
});

const factFor = (i: ReturnType<typeof interpret>, dimension: string) => i.facts.find((f) => f.dimension === dimension);
const signalTypes = (i: ReturnType<typeof interpret>) => i.signals.map((s) => s.signal_type);

describe("the brief's example: one reply, six updates", () => {
  const reply = "We've got 45 staff and our IT provider's contract ends next month because support has been terrible";
  const i = interpret(reply, state());

  test("size: 45 staff, confirmed (self-stated)", () => {
    const size = factFor(i, "COMPANY_SIZE");
    assert.equal(size?.value_normalised, "45");
    assert.equal(size?.state, "CONFIRMED");
    assert.equal(size?.source, "REPLY");
  });

  test("existing provider: an external IT provider", () => {
    const provider = factFor(i, "CURRENT_SOLUTION");
    assert.equal(provider?.value_normalised, "EXTERNAL_PROVIDER");
    assert.match(provider!.value, /IT provider/i);
  });

  test("dissatisfaction: support has been terrible", () => {
    assert.match(factFor(i, "DISSATISFACTION")!.value, /support has been terrible/);
    assert.ok(signalTypes(i).includes("DISSATISFACTION_CURRENT"));
  });

  test("timing: next month, with a stated date", () => {
    const timing = factFor(i, "TIMING");
    assert.ok(timing);
    assert.ok(Number(timing!.value_normalised) <= 60, `timing ${timing!.value_normalised} days`);
    const frame = i.signals.find((s) => s.signal_type === "TIMEFRAME");
    assert.ok(frame?.stated_date, "TIMEFRAME carries the stated date");
    assert.ok(frame!.stated_date! > NOW.slice(0, 10));
  });

  test("replacement intent: the contract is ending", () => {
    assert.ok(signalTypes(i).includes("REPLACEMENT_SEARCH"));
    assert.equal(factFor(i, "PURCHASE_READINESS")?.value_normalised, "REPLACING");
  });

  test("urgency: a close deadline", () => {
    assert.ok(signalTypes(i).includes("URGENCY"));
  });

  test("the output is the contract's Interpretation, deterministic", () => {
    assert.doesNotThrow(() => interpretationSchema.parse(i));
    assert.deepEqual(interpret(reply, state()), i);
    assert.equal(i.ai_assist_used, false);
    assert.equal(i.intent_delta, 0);
    const { confirmed } = interpretedDimensions(i);
    for (const d of ["COMPANY_SIZE", "CURRENT_SOLUTION"]) assert.ok(confirmed.includes(d as never), d);
  });
});

describe("interpretation: the current question", () => {
  const sizeQuestion: QuestionRecord = { id: Q_SIZE, questionText: "How many staff do you have?", position: 1, responseType: "number", required: true, serviceId: null, options: [] };

  test("a configured question matched deterministically is a CONFIRMED ANSWER fact", () => {
    const i = interpret("about 30", state({ currentQuestion: sizeQuestion, currentQuestionDimension: "COMPANY_SIZE" }));
    assert.equal(i.answered_question_id, Q_SIZE);
    assert.equal(i.completeness, "FULL");
    const f = factFor(i, "COMPANY_SIZE")!;
    assert.equal(f.state, "CONFIRMED");
    assert.equal(f.source, "ANSWER");
    assert.equal(f.question_id, Q_SIZE);
    assert.equal(f.question_intent_key, `custom:${Q_SIZE}`);
  });

  test("an unmatched reply leaves the question unanswered: PARTIAL, DEFLECTED or NONE", () => {
    const service: QuestionRecord = {
      id: Q_SERVICE,
      questionText: "Which service?",
      position: 1,
      responseType: "single_choice",
      required: true,
      serviceId: null,
      options: [{ value: "support", label: "IT support" }],
    };
    assert.equal(interpret("rather not say", state({ currentQuestion: service, currentQuestionDimension: "SERVICE_NEEDED" })).completeness, "DEFLECTED");
    assert.equal(interpret("lovely weather", state({ currentQuestion: service, currentQuestionDimension: "SERVICE_NEEDED" })).completeness, "NONE");
    assert.equal(interpret("lovely weather", state({ currentQuestion: service })).answered_question_id, null);
  });

  test("a planned library intent is answered by its extractor", () => {
    const i = interpret("We're a team of 12", state({ currentIntent: intentByKey("COMPANY_SIZE.STAFF")! }));
    assert.equal(i.answered_intent_key, "COMPANY_SIZE.STAFF");
    assert.equal(factFor(i, "COMPANY_SIZE")?.value_normalised, "12");
    assert.equal(factFor(i, "COMPANY_SIZE")?.source, "ANSWER");
  });

  test("a CONFIRMED dimension is not re-extracted incidentally", () => {
    const i = interpret("We've got 45 staff", state({ dimensions: [{ dimension: "COMPANY_SIZE", status: "CONFIRMED", fact_ids: [], material: false, required: false, stale: false }] }));
    assert.equal(factFor(i, "COMPANY_SIZE"), undefined);
  });
});

describe("interpretation: signals, objections and what was asked for", () => {
  test("a binding opt-out stops interpretation: one UNSUBSCRIBE signal, no facts", () => {
    const i = interpret("Please take me off your list, we've got 45 staff", state());
    assert.deepEqual(signalTypes(i), ["UNSUBSCRIBE"]);
    assert.equal(i.facts.length, 0);
    assert.equal(i.requested_action, "STOP");
  });

  test("a booking request closes instead of qualifying", () => {
    const i = interpret("Can we book a call for Thursday?", state());
    assert.ok(signalTypes(i).includes("BOOKING_REQUEST"));
    assert.equal(i.requested_action, "BOOK");
    assert.equal(i.close_instead, true);
    assert.equal(i.lead_asked_question, true);
  });

  test("not now: a NOT_NOW signal with resume_at, no urgency", () => {
    const i = interpret("Not right now, maybe get back to me in 3 months", state());
    const notNow = i.signals.find((s) => s.signal_type === "NOT_NOW");
    assert.ok(notNow?.resume_at);
    const days = (Date.parse(notNow!.resume_at!) - Date.parse(NOW)) / 86_400_000;
    assert.ok(days >= 85 && days <= 95, `${days} days`);
    assert.equal(i.requested_action, "LATER");
    assert.ok(!signalTypes(i).includes("URGENCY"));
  });

  test("a refusal is a hard negative and never requests an action", () => {
    const i = interpret("Not interested, too expensive anyway", state());
    assert.ok(signalTypes(i).includes("NOT_INTERESTED"));
    assert.equal(i.requested_action, null);
    assert.ok(i.objections.includes("NOT_INTERESTED"));
    assert.ok(!signalTypes(i).includes("PRICING_CONCERN_ENGAGED"));
  });

  test("pricing questions, price objections and competitor comparisons", () => {
    assert.equal(interpret("How much does it cost?", state()).requested_action, "PRICE");
    const objection = interpret("It seems a bit expensive compared to the other quotes", state());
    assert.ok(objection.objections.includes("PRICE"));
    assert.ok(signalTypes(objection).includes("PRICING_CONCERN_ENGAGED"));
    assert.ok(signalTypes(objection).includes("COMPETITOR_COMPARISON"));
  });

  test("withIntentDelta records the reassessed change", () => {
    const i = interpret("ok", state());
    assert.equal(withIntentDelta(i, 40, 62).intent_delta, 22);
    assert.equal(withIntentDelta(i, 90, -50).intent_delta, -100);
  });
});

describe("interpretation: the AI assist is a candidate, never a decision (CD-8)", () => {
  const reply = "We're growing fast and the budget is roughly twenty grand for the year";

  test("accepted only when allowed, verbatim, validated and >= 0.85: INFERRED, AI_ASSIST", () => {
    const i = interpret(reply, state({ aiAssistAllowed: true }), [
      { dimension: "OUTCOME", value: "Support growth", evidence_span: "We're growing fast", confidence: 0.9 },
    ]);
    const f = factFor(i, "OUTCOME")!;
    assert.equal(f.state, "INFERRED");
    assert.equal(f.source, "AI_ASSIST");
    assert.equal(f.evidence_span, "We're growing fast");
    assert.equal(f.question_id, null, "an AI fact never answers a configured question");
    assert.equal(i.ai_assist_used, true);
  });

  test("rejected: not allowed, low confidence, a span not in the reply, an unknown dimension, a span its validator refuses", () => {
    const candidates = [
      { dimension: "OUTCOME", value: "growth", evidence_span: "We're growing fast", confidence: 0.84 },
      { dimension: "TEAM_SIZE", value: "50", evidence_span: "50 people", confidence: 0.99 },
      { dimension: "NOT_A_DIMENSION", value: "x", evidence_span: "We're", confidence: 0.99 },
      { dimension: "LOCATION", value: "London", evidence_span: "growing fast", confidence: 0.99 },
    ];
    const allowed = interpret(reply, state({ aiAssistAllowed: true }), candidates);
    assert.ok(!allowed.facts.some((f) => f.source === "AI_ASSIST"), JSON.stringify(allowed.facts));
    const notAllowed = interpret(reply, state({ aiAssistAllowed: false }), [
      { dimension: "OUTCOME", value: "growth", evidence_span: "We're growing fast", confidence: 0.95 },
    ]);
    assert.ok(!notAllowed.facts.some((f) => f.source === "AI_ASSIST"));
    assert.equal(notAllowed.ai_assist_used, false);
  });

  test("the deterministic reading wins over an AI candidate for the same dimension", () => {
    const i = interpret("We've got 45 staff", state({ aiAssistAllowed: true }), [
      { dimension: "COMPANY_SIZE", value: "50", evidence_span: "45 staff", confidence: 0.99 },
    ]);
    const facts = i.facts.filter((f) => f.dimension === "COMPANY_SIZE");
    assert.equal(facts.length, 1);
    assert.equal(facts[0].source, "REPLY");
    assert.equal(facts[0].value_normalised, "45");
  });

  test("the fact write schema refuses a confirmed or low-confidence AI fact at the storage boundary", () => {
    const base = { lead_id: LEAD, dimension: "OUTCOME", value: "growth", source: "AI_ASSIST", observed_at: NOW };
    assert.equal(qualificationFactWriteSchema.safeParse({ ...base, state: "CONFIRMED", confidence: 0.99 }).success, false);
    assert.equal(qualificationFactWriteSchema.safeParse({ ...base, state: "INFERRED", confidence: 0.8 }).success, false);
    assert.equal(qualificationFactWriteSchema.safeParse({ ...base, state: "INFERRED", confidence: 0.9 }).success, true);
  });

  test("the engine-facing value read drops AI facts", () => {
    const facts = [fact("OUTCOME", "growth", "INFERRED", { source: "AI_ASSIST", confidence: 0.9 }), fact("TIMING", "30", "CONFIRMED")];
    const engine = factValues(facts, NOW, { includeAi: false });
    assert.equal(engine.has("OUTCOME"), false);
    assert.equal(engine.has("TIMING"), true);
  });
});

describe("form answers (defect F3)", () => {
  const questions = [
    { id: Q_SIZE, questionText: "How many staff do you have?", position: 1, responseType: "number" as const, required: true, serviceId: null, options: [] },
    {
      id: Q_SERVICE,
      questionText: "Which service are you looking for?",
      position: 2,
      responseType: "single_choice" as const,
      required: true,
      serviceId: null,
      options: [{ value: "support", label: "IT support" }, { value: "project", label: "A project" }],
    },
  ];
  const inferLabel = (label: string) =>
    inferDimension({ id: "x", questionText: label, position: 0, responseType: "text", required: false, serviceId: null, options: [] });

  test("an exact label answers its question (CONFIRMED); a same-dimension label infers it", () => {
    const facts = formAnswersToFacts(
      [{ answers: { "How many staff do you have?": "25", "Which services are you interested in?": "IT support" } }],
      questions,
      inferLabel,
    );
    const size = facts.find((f) => f.questionId === Q_SIZE)!;
    assert.equal(size.state, "CONFIRMED");
    assert.equal(size.value, "25");
    assert.equal(size.confidence, 1);
    const service = facts.find((f) => f.questionId === Q_SERVICE)!;
    assert.equal(service.state, "INFERRED");
    assert.equal(service.value, "support");
  });

  test("a form value the question cannot accept is not an answer; a label with no question still gives a dimension fact", () => {
    const facts = formAnswersToFacts(
      [{ answers: { "How many staff do you have?": "lots", "When do you want to start?": "next month" } }],
      questions,
      inferLabel,
    );
    assert.ok(!facts.some((f) => f.questionId === Q_SIZE));
    const timing = facts.find((f) => f.dimension === "TIMING");
    assert.equal(timing?.questionId, null);
    assert.equal(timing?.value, "next month");
  });

  test("the newest touch wins", () => {
    const facts = formAnswersToFacts(
      [{ answers: { "How many staff do you have?": "40" } }, { answers: { "How many staff do you have?": "10" } }],
      questions,
      inferLabel,
    );
    assert.equal(facts.filter((f) => f.questionId === Q_SIZE).length, 1);
    assert.equal(facts.find((f) => f.questionId === Q_SIZE)?.value, "40");
  });
});

describe("extractors", () => {
  test("counts, money, timelines, dates, postcodes, roles, providers, urgency, readiness", () => {
    assert.equal(extract("COUNT", "we're about forty-five people")?.normalised, "45");
    assert.equal(extract("COUNT", "10-20 staff")?.normalised, "15");
    assert.equal(extract("COUNT", "just me really")?.normalised, "1");
    assert.equal(extract("COUNT", "20 laptops")?.unit, "devices");
    assert.equal(extract("MONEY", "budget is £2.5k a month")?.normalised, "2500");
    assert.equal(extract("MONEY", "about 20 grand")?.normalised, "20000");
    assert.equal(extract("TIMELINE", "in 3 weeks", { now: NOW })?.normalised, "21");
    assert.equal(extract("DATE", "by the 1st of March", { now: NOW })?.normalised, "2027-03-01");
    assert.equal(extract("POSTCODE", "we're at bh1 1aa")?.normalised, "BH1 1AA");
    assert.equal(extract("ROLE_MENTION", "I'm the MD")?.normalised, "DECISION_MAKER");
    assert.equal(extract("ROLE_MENTION", "I need to check with my director")?.normalised, "NOT_DECISION_MAKER");
    assert.equal(extract("PROVIDER_MENTION", "we do it in-house")?.normalised, "IN_HOUSE");
    assert.equal(extract("PROVIDER_MENTION", "nobody at the moment")?.normalised, "NONE");
    assert.equal(extract("URGENCY", "it's urgent")?.normalised, "HIGH");
    assert.equal(extract("READINESS", "we're ready to go ahead")?.normalised, "READY_TO_BUY");
    // A negated readiness is not readiness (integration finding 2026-09-27).
    assert.equal(extract("READINESS", "Not ready to go ahead yet"), null);
    assert.equal(extract("READINESS", "we don't want to sign up right now"), null);
    assert.equal(extract("READINESS", "we're not really up for a call"), null);
    assert.equal(extract("READINESS", "not ready to go ahead yet, but happy to chat")?.normalised, "READY_TO_MEET");
    assert.equal(extract("READINESS", "honestly not sure yet")?.normalised, "EXPLORING");
    assert.equal(extract("SERVICE_NAME", "we need IT support please", { serviceNames: ["IT support", "Cloud migration"] })?.normalised, "it support");
    assert.equal(extract("YES_NO", "yes we do")?.normalised, "yes");
    assert.equal(extract("CHOICE", "2", { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] })?.normalised, "b");
  });

  test("nothing is guessed", () => {
    assert.equal(extract("COUNT", "quite a few"), null);
    assert.equal(extract("MONEY", "not sure yet"), null);
    assert.equal(extract("POSTCODE", "near the station"), null);
    assert.equal(extract("FREE_TEXT", "not sure"), null);
    assert.equal(extract("TIMELINE", ""), null);
  });

  test("question and deflection shape", () => {
    assert.equal(isQuestion("Do you cover Leeds"), true);
    assert.equal(isQuestion("We cover Leeds."), false);
    assert.equal(isDeflection("why do you need to know"), true);
  });
});
