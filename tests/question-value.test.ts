import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_AND_ASK_FLOOR,
  ASK_FLOOR,
  adjustedPrematurity,
  expectedInformationGain,
  questionValue,
  rankIntents,
  worthAsking,
  type ValueContext,
} from "../src/lib/qualification-intelligence/question-value.ts";
import { baseIntentFor, intentByKey, verifyIntentFor } from "../src/lib/qualification-intelligence/question-intents.ts";
import { QUESTION_VALUE_FLOORS, QV_VERSION, type QuestionIntent } from "../src/lib/qualification-intelligence/types.ts";
import { selectNextQuestion, type QuestionRecord } from "../src/lib/qualification/next-question.ts";

const ctx = (extra: Partial<ValueContext> = {}): ValueContext => ({
  stage: "QUALIFYING",
  intentState: "MEDIUM",
  channel: "email",
  known: new Set(),
  thresholdMissing: [],
  ...extra,
});

function recompute(t: ReturnType<typeof questionValue>): number {
  return (
    t.decisionRelevance + t.informationGain + t.salesProgression + t.intentRelevance - t.friction - t.repetitionRisk - t.prematurity - t.pKnown
  );
}

describe("question value: the formula (qv-1)", () => {
  test("version and floors come from the contract", () => {
    assert.equal(QV_VERSION, "qv-1");
    assert.equal(ASK_FLOOR, QUESTION_VALUE_FLOORS.ASK);
    assert.equal(ANSWER_AND_ASK_FLOOR, 0.4);
  });

  test("V = DR + IG(1-pK) + SP + IR - F - R - P - pK, every term 0..1", () => {
    for (const intent of [baseIntentFor("USE_CASE"), baseIntentFor("BUDGET"), baseIntentFor("AUTHORITY"), verifyIntentFor("COMPANY_SIZE", "40")]) {
      const t = questionValue(intent, ctx({ known: new Set(["PROBLEM"]), thresholdMissing: ["USE_CASE"] }));
      assert.ok(Math.abs(t.total - recompute(t)) < 1e-3, intent.key);
      for (const key of ["decisionRelevance", "informationGain", "salesProgression", "intentRelevance", "friction", "repetitionRisk", "prematurity", "pKnown"] as const) {
        assert.ok(t[key] >= 0 && t[key] <= 1, `${intent.key}.${key} = ${t[key]}`);
      }
    }
  });

  test("decision relevance: full weight in the threshold or required, half otherwise", () => {
    const intent = baseIntentFor("TIMING");
    const inThreshold = questionValue(intent, ctx({ thresholdMissing: ["TIMING"] }));
    const required = questionValue(intent, ctx({ requiredDimensions: ["TIMING"] }));
    const neither = questionValue(intent, ctx());
    assert.equal(inThreshold.decisionRelevance, intent.attrs.decisionRelevance);
    assert.equal(required.decisionRelevance, intent.attrs.decisionRelevance);
    assert.equal(neither.decisionRelevance, intent.attrs.decisionRelevance * 0.5);
  });

  test("sales progression: 1 when it unlocks the next step, 0.5 when it narrows the offer, else 0.2", () => {
    assert.equal(questionValue(baseIntentFor("TIMING"), ctx({ thresholdMissing: ["TIMING"] })).salesProgression, 1);
    assert.equal(questionValue(baseIntentFor("TIMING"), ctx({ gatingDimensions: ["TIMING"] })).salesProgression, 1);
    assert.equal(questionValue(baseIntentFor("SERVICE_NEEDED"), ctx()).salesProgression, 0.5);
    assert.equal(questionValue(baseIntentFor("VOLUME"), ctx()).salesProgression, 0.2);
    const target = baseIntentFor("DISSATISFACTION");
    assert.equal(questionValue(target, ctx({ branchTargets: new Set([target.key]) })).salesProgression, 1, "a branch target unlocks");
  });

  test("intent relevance: ready leads get only gating questions; low intent builds intent", () => {
    const high = ctx({ intentState: "BOOKING_READY", gatingDimensions: ["COMPANY_SIZE"] });
    assert.equal(questionValue(baseIntentFor("USE_CASE"), high).intentRelevance, 0);
    assert.ok(questionValue(baseIntentFor("COMPANY_SIZE"), high).intentRelevance > 0);
    const low = ctx({ intentState: "LOW" });
    assert.equal(questionValue(baseIntentFor("PROBLEM"), low).intentRelevance, 0.8);
    assert.equal(questionValue(baseIntentFor("OUTCOME"), low).intentRelevance, 0.8);
    assert.equal(questionValue(baseIntentFor("BUDGET"), low).intentRelevance, 0);
    assert.equal(questionValue(baseIntentFor("AUTHORITY"), low).intentRelevance, 0);
  });

  test("friction: open text on SMS / WhatsApp and a lead who has not replied cost more", () => {
    const intent = baseIntentFor("PROBLEM");
    const email = questionValue(intent, ctx({ channel: "email" })).friction;
    assert.equal(Math.round((questionValue(intent, ctx({ channel: "sms" })).friction - email) * 100) / 100, 0.15);
    assert.equal(Math.round((questionValue(intent, ctx({ channel: "whatsapp" })).friction - email) * 100) / 100, 0.15);
    assert.equal(Math.round((questionValue(intent, ctx({ leadHasReplied: false })).friction - email) * 100) / 100, 0.15);
    assert.equal(questionValue(baseIntentFor("COMPANY_SIZE"), ctx({ channel: "sms" })).friction, baseIntentFor("COMPANY_SIZE").attrs.friction, "a count is not open text");
  });

  test("repetition: 0.5 after one unanswered ask, 1 after two", () => {
    const intent = baseIntentFor("TIMING");
    assert.equal(questionValue(intent, ctx({ askHistory: [{ key: intent.key, asked: 1, answered: false }] })).repetitionRisk, 0.5);
    assert.equal(questionValue(intent, ctx({ askHistory: [{ key: intent.key, asked: 2, answered: false }] })).repetitionRisk, 1);
    assert.equal(questionValue(intent, ctx({ askHistory: [{ key: intent.key, asked: 2, answered: true }] })).repetitionRisk, 0);
  });

  test("pKnown: 0.6 when verifying an inference, 0.3 when enrichment could supply it", () => {
    assert.equal(questionValue(verifyIntentFor("COMPANY_SIZE", "40"), ctx()).pKnown, 0.6);
    const derivable = questionValue(baseIntentFor("COMPANY_SIZE"), ctx({ derivableDimensions: new Set(["COMPANY_SIZE"]) }));
    assert.equal(derivable.pKnown, 0.3);
    assert.equal(derivable.informationGain, Math.round(baseIntentFor("COMPANY_SIZE").attrs.informationGain * 0.7 * 10_000) / 10_000);
  });

  test("prematurity: budget before a problem, authority before engagement", () => {
    assert.ok(adjustedPrematurity("BUDGET", 0.8, "QUALIFYING", new Set()) >= 0.8);
    assert.ok(adjustedPrematurity("BUDGET", 0.8, "QUALIFYING", new Set(["PROBLEM"])) < 0.8);
    assert.ok(adjustedPrematurity("AUTHORITY", 0.6, "NEW", new Set()) >= 0.6);
    assert.ok(adjustedPrematurity("AUTHORITY", 0.6, "QUALIFYING", new Set()) < 0.6);
    const early = questionValue(baseIntentFor("BUDGET"), ctx({ stage: "ENGAGED" }));
    const later = questionValue(baseIntentFor("BUDGET"), ctx({ stage: "ENGAGED", known: new Set(["USE_CASE"]) }));
    assert.ok(later.total > early.total);
  });

  test("weights scale each term", () => {
    const intent = baseIntentFor("TIMING");
    const plain = questionValue(intent, ctx());
    const noFriction = questionValue(intent, ctx({ weights: { friction: 0 } }));
    assert.ok(Math.abs(noFriction.total - (plain.total + plain.friction)) < 1e-3);
  });
});

describe("question value: ranking and asking nothing", () => {
  test("ranking is deterministic: value, then required, then purpose, then key", () => {
    const candidates: QuestionIntent[] = [baseIntentFor("BUDGET"), baseIntentFor("USE_CASE"), baseIntentFor("TIMING"), baseIntentFor("AUTHORITY")];
    const c = ctx({ thresholdMissing: ["USE_CASE"], known: new Set() });
    const a = rankIntents(candidates, c).map((r) => r.intent.key);
    const b = rankIntents([...candidates].reverse(), c).map((r) => r.intent.key);
    assert.deepEqual(a, b);
    assert.equal(a[0], "USE_CASE.MAIN_JOB");
    assert.equal(a.at(-1), "BUDGET.RANGE", "budget before a problem is last");
  });

  test("worthAsking applies the 0.25 floor", () => {
    const low = { ...questionValue(baseIntentFor("BUDGET"), ctx()), total: 0.2 };
    assert.equal(worthAsking(low), false);
    assert.equal(worthAsking({ ...low, total: 0.25 }), true);
    assert.equal(expectedInformationGain(null), 0);
  });

  test("an archetype wording carries the archetype's tuned attributes", () => {
    const msp = intentByKey("COMPANY_SIZE.MSP");
    assert.ok(msp);
    assert.equal(msp!.renderings.default, "How many staff and devices would we be looking after?");
  });
});

describe("question value: next-question.ts delegates and keeps its API", () => {
  const q = (id: string, questionText: string, position: number, extra: Partial<QuestionRecord> = {}): QuestionRecord => ({
    id,
    questionText,
    position,
    responseType: "text",
    required: false,
    serviceId: null,
    options: [],
    ...extra,
  });

  test("ranked values are qv-1 totals, with the terms exposed", () => {
    const result = selectNextQuestion({
      questions: [q("q-use", "What would you mainly want it to do for you?", 1), q("q-budget", "Do you have a budget range in mind?", 2)],
      answers: [],
      serviceId: null,
      motion: "BOOK_MEETING_B2B",
      stage: "ENGAGED",
    });
    const top = result.ranked[0];
    assert.equal(top.questionId, "q-use");
    assert.equal(top.components.bonus, 0);
    assert.ok(top.components.salesProgression === 1, "the threshold dimension unlocks the next step");
    assert.ok(Math.abs(top.value - (top.components.decisionRelevance + top.components.informationGain + top.components.salesProgression + top.components.intentRelevance - top.components.friction - top.components.repetitionRisk - top.components.prematurity - top.components.pKnown)) < 1e-3);
  });

  test("the sticky re-ask is limited to one: a question asked twice unanswered is dropped", () => {
    const questions = [q("q-use", "What would you mainly want it to do for you?", 1), q("q-team", "How many people would be using it?", 2, { responseType: "number" })];
    const once = selectNextQuestion({ questions, answers: [], serviceId: null, currentQuestionId: "q-team", askHistory: [{ questionId: "q-team", asked: 1 }] });
    assert.equal(once.question?.id, "q-team", "one re-ask is allowed");
    const twice = selectNextQuestion({ questions, answers: [], serviceId: null, currentQuestionId: "q-team", askHistory: [{ questionId: "q-team", asked: 2 }] });
    assert.equal(twice.question?.id, "q-use");
    assert.ok(!twice.ranked.some((r) => r.questionId === "q-team"));
  });
});
