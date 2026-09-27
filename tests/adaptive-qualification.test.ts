import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_FACT_CONFIDENCE,
  adjustedPrematurity,
  inferDimension,
  matchAnswer,
  nextQuestion,
  selectNextQuestion,
  type QuestionRecord,
} from "../src/lib/qualification/next-question.ts";
import { evaluateQualification } from "../src/lib/qualification/engine.ts";

function q(
  id: string,
  questionText: string,
  position: number,
  extra: Partial<QuestionRecord> = {},
): QuestionRecord {
  return {
    id,
    questionText,
    position,
    responseType: "text",
    required: false,
    serviceId: null,
    options: [],
    ...extra,
  };
}

const USE_CASE = q("q-use", "What would you mainly want it to do for you?", 1, { required: true });
const TEAM = q("q-team", "How many people would be using it?", 2, { responseType: "number" });
const CURRENT = q("q-current", "What are you currently using for this?", 3);
const TIMING = q("q-timing", "When are you hoping to start?", 4, {
  responseType: "timing",
  options: [
    { value: "asap", label: "As soon as possible" },
    { value: "quarter", label: "This quarter" },
  ],
});
const BUDGET = q("q-budget", "Do you have a budget range in mind?", 0);
const AUTHORITY = q("q-auth", "Is anyone else involved in deciding on this?", 5);
const POSTCODE = q("q-postcode", "What's your postcode?", 6, { responseType: "postcode", required: true });
const SERVICE = q("q-service", "Which service are you looking for?", 7, {
  responseType: "single_choice",
  required: true,
  options: [
    { value: "web", label: "Website design" },
    { value: "seo", label: "SEO" },
  ],
});

const B2B = [BUDGET, USE_CASE, TEAM, CURRENT, TIMING, AUTHORITY];

describe("adaptive qualification: known questions are never asked", () => {
  test("an answered question is never returned", () => {
    const result = selectNextQuestion({
      questions: [USE_CASE, TEAM],
      answers: [{ questionId: "q-use", answerValue: "lead follow-up" }],
      serviceId: null,
    });
    assert.equal(result.question?.id, "q-team");
    assert.ok(result.known.some((entry) => entry.questionId === "q-use" && entry.source === "ANSWER"));
  });

  test("a postcode on the lead answers a postcode question, labelled inferred", () => {
    const result = selectNextQuestion({
      questions: [POSTCODE, USE_CASE],
      answers: [],
      serviceId: null,
      leadFields: { LOCATION: "sw1a 1aa" },
    });
    assert.notEqual(result.question?.id, "q-postcode");
    const inferred = result.inferred.find((entry) => entry.questionId === "q-postcode");
    assert.ok(inferred);
    assert.equal(inferred!.inferred, true);
    assert.equal(inferred!.source, "LEAD_FIELD");
    assert.equal(inferred!.value, "SW1A 1AA");
  });

  test("the lead's chosen service answers a service question only when it matches an option", () => {
    const matched = selectNextQuestion({
      questions: [SERVICE],
      answers: [],
      serviceId: null,
      leadFields: { SERVICE_NEEDED: "SEO" },
    });
    assert.equal(matched.question, null);
    assert.equal(matched.inferred[0]?.value, "seo");

    // A value the question cannot accept is not "known": it is asked.
    const unmatched = selectNextQuestion({
      questions: [SERVICE],
      answers: [],
      serviceId: null,
      leadFields: { SERVICE_NEEDED: "Plumbing" },
    });
    assert.equal(unmatched.question?.id, "q-service");
    assert.equal(unmatched.inferred.length, 0);
  });

  test("a memory fact answers only at confidence >= 0.8", () => {
    const low = selectNextQuestion({
      questions: [TEAM],
      answers: [],
      serviceId: null,
      facts: [{ dimension: "TEAM_SIZE", value: "12", confidence: MIN_FACT_CONFIDENCE - 0.01, source: "enrichment" }],
    });
    assert.equal(low.question?.id, "q-team");

    const high = selectNextQuestion({
      questions: [TEAM],
      answers: [],
      serviceId: null,
      facts: [{ dimension: "TEAM_SIZE", value: "12", confidence: 0.9, source: "enrichment" }],
    });
    assert.equal(high.question, null);
    assert.equal(high.inferred[0]?.source, "FACT");
    assert.equal(high.inferred[0]?.value, "12");
  });

  test("never infers over a reply the lead actually gave, even an unmatched one", () => {
    const result = selectNextQuestion({
      questions: [POSTCODE],
      answers: [{ questionId: "q-postcode", answerValue: null }],
      serviceId: null,
      leadFields: { LOCATION: "SW1A 1AA" },
    });
    assert.equal(result.inferred.length, 0);
    assert.equal(result.question?.id, "q-postcode");
  });

  test("service-scoped questions for another service never apply", () => {
    const other = q("q-other", "Which pages do you need?", 0, { serviceId: "svc-2" });
    const result = selectNextQuestion({ questions: [other, TEAM], answers: [], serviceId: "svc-1" });
    assert.equal(result.question?.id, "q-team");
  });

  test("over many random answer states, no known question is ever returned", () => {
    const all = [...B2B, POSTCODE, SERVICE];
    for (let mask = 0; mask < 1 << all.length; mask += 7) {
      const answers = all
        .filter((_, i) => mask & (1 << i))
        .map((question) => ({ questionId: question.id, answerValue: "x" }));
      const result = selectNextQuestion({
        questions: all,
        answers,
        serviceId: null,
        leadFields: { LOCATION: "SW1A 1AA", SERVICE_NEEDED: "SEO" },
        motion: "BOOK_MEETING_B2B",
        stage: "QUALIFYING",
      });
      const knownIds = new Set(result.known.map((entry) => entry.questionId));
      if (result.question) assert.ok(!knownIds.has(result.question.id));
      assert.notEqual(result.question?.id, "q-postcode");
      assert.notEqual(result.question?.id, "q-service");
    }
  });
});

describe("adaptive qualification: stopping at the decision threshold", () => {
  test("BOOK_MEETING_B2B stops once use case + timing are known, dropping optional questions", () => {
    const result = selectNextQuestion({
      questions: [USE_CASE, TEAM, CURRENT, TIMING, AUTHORITY],
      answers: [
        { questionId: "q-use", answerValue: "lead follow-up" },
        { questionId: "q-timing", answerValue: "asap" },
      ],
      serviceId: null,
      motion: "BOOK_MEETING_B2B",
      stage: "QUALIFYING",
    });
    assert.equal(result.thresholdMet, true);
    assert.equal(result.question, null);
    assert.equal(result.stopReason, "THRESHOLD_MET");
    assert.equal(result.ranked.length, 0);
  });

  test("a required question is still asked after the threshold: the engine needs it", () => {
    const requiredCurrent = { ...CURRENT, required: true };
    const result = selectNextQuestion({
      questions: [USE_CASE, TEAM, requiredCurrent, TIMING],
      answers: [
        { questionId: "q-use", answerValue: "lead follow-up" },
        { questionId: "q-timing", answerValue: "asap" },
      ],
      serviceId: null,
      motion: "BOOK_MEETING_B2B",
    });
    assert.equal(result.thresholdMet, true);
    assert.equal(result.question?.id, "q-current");
  });

  test("without a motion there is no threshold stop: configured questions remain the plan", () => {
    const result = selectNextQuestion({
      questions: [USE_CASE, TEAM, TIMING],
      answers: [
        { questionId: "q-use", answerValue: "x" },
        { questionId: "q-timing", answerValue: "asap" },
      ],
      serviceId: null,
    });
    assert.equal(result.thresholdMet, false);
    assert.equal(result.question?.id, "q-team");
  });

  test("known dimensions count toward the threshold even with no matching question", () => {
    const result = selectNextQuestion({
      questions: [q("q-anything", "Anything else we should know?", 1)],
      answers: [],
      serviceId: null,
      motion: "LOCAL_SERVICE",
      leadFields: { SERVICE_NEEDED: "Boiler repair", LOCATION: "BH1 1AA", TIMING: "this week" },
    });
    assert.equal(result.thresholdMet, true);
    assert.equal(result.stopReason, "THRESHOLD_MET");
  });

  test("the engine still judges: stopping never marks a lead qualified", () => {
    const questions = [USE_CASE, TEAM];
    const selection = selectNextQuestion({
      questions,
      answers: [],
      serviceId: "svc",
      motion: "BOOK_MEETING_B2B",
    });
    assert.equal(selection.question?.id, "q-use");
    const engine = evaluateQualification({
      questions: questions.map((question) => ({
        id: question.id,
        responseType: question.responseType,
        required: question.required,
        serviceId: question.serviceId,
      })),
      answers: [],
      rules: [],
      serviceId: "svc",
      serviceIsActive: true,
      postcode: null,
      allowedPostcodePrefixes: [],
      blockedPostcodePrefixes: [],
    });
    assert.equal(engine.result, "PENDING");
  });
});

describe("adaptive qualification: ranking and prematurity", () => {
  test("budget is never first before the problem is stated, whatever its position", () => {
    const result = selectNextQuestion({
      questions: B2B,
      answers: [],
      serviceId: null,
      motion: "BOOK_MEETING_B2B",
      stage: "NEW",
    });
    assert.notEqual(result.question?.id, "q-budget");
    assert.equal(result.question?.id, "q-use", "the threshold dimension comes first");
    assert.equal(result.ranked.at(-1)?.questionId, "q-budget");
  });

  test("budget prematurity drops once the problem is known", () => {
    const before = adjustedPrematurity("BUDGET", 0.8, "QUALIFYING", new Set());
    const after = adjustedPrematurity("BUDGET", 0.8, "QUALIFYING", new Set(["USE_CASE"]));
    assert.ok(before >= 0.8);
    assert.ok(after < before);
  });

  test("authority is premature before engagement and less so after", () => {
    const early = adjustedPrematurity("AUTHORITY", 0.6, "NEW", new Set());
    const later = adjustedPrematurity("AUTHORITY", 0.6, "QUALIFYING", new Set());
    assert.ok(early >= 0.6);
    assert.ok(later < early);

    const rankOf = (stage: "NEW" | "QUALIFYING") =>
      selectNextQuestion({
        questions: [AUTHORITY, CURRENT],
        answers: [],
        serviceId: null,
        stage,
      }).ranked.find((entry) => entry.questionId === "q-auth")!.value;
    assert.ok(rankOf("QUALIFYING") > rankOf("NEW"));
  });

  test("a still-unanswered current question is asked again, not reshuffled", () => {
    const result = selectNextQuestion({
      questions: B2B,
      answers: [],
      serviceId: null,
      motion: "BOOK_MEETING_B2B",
      currentQuestionId: "q-team",
    });
    assert.equal(result.question?.id, "q-team");
  });

  test("deterministic: same input, same ranking", () => {
    const input = { questions: B2B, answers: [], serviceId: null, motion: "DIRECT_B2B" as const, stage: "ENGAGED" as const };
    assert.deepEqual(selectNextQuestion(input).ranked, selectNextQuestion(input).ranked);
  });

  test("dimension inference from response type and wording", () => {
    assert.equal(inferDimension(POSTCODE), "LOCATION");
    assert.equal(inferDimension(BUDGET), "BUDGET");
    assert.equal(inferDimension(AUTHORITY), "AUTHORITY");
    assert.equal(inferDimension(TEAM), "TEAM_SIZE");
    assert.equal(inferDimension(q("x", "Tell us a bit more", 1)), null);
  });

  test("an explicit dimension map wins over inference", () => {
    const result = selectNextQuestion({
      questions: [q("q-x", "Tell us a bit more", 1)],
      answers: [],
      serviceId: null,
      dimensionMap: { "q-x": "BUDGET" },
    });
    assert.equal(result.ranked[0]?.dimension, "BUDGET");
  });
});

describe("the moved helpers keep their behaviour", () => {
  test("matchAnswer is unchanged", () => {
    assert.deepEqual(matchAnswer(TIMING, "2"), { value: "quarter", text: "2" });
    assert.equal(matchAnswer(POSTCODE, "it's sw1a1aa").value, "SW1A1AA");
    assert.equal(matchAnswer(q("y", "ok?", 1, { responseType: "yes_no" }), "maybe").value, null);
  });

  test("legacy nextQuestion() still returns an unanswered question", () => {
    const next = nextQuestion([USE_CASE, TEAM], new Set(["q-use"]), null);
    assert.equal(next?.id, "q-team");
    assert.equal(nextQuestion([USE_CASE], new Set(["q-use"]), null), null);
  });
});

// ---------------------------------------------------------------------------
// Qualification Intelligence (08 §B.8, A2): deliberate updates. The selector
// now ranks with the additive qv-1 value function; these pin what changed.
// ---------------------------------------------------------------------------

describe("adaptive qualification: qv-1 value function (deliberate update)", () => {
  test("components carry the qv-1 terms; the old threshold/required bonus is folded in", () => {
    const result = selectNextQuestion({ questions: B2B, answers: [], serviceId: null, motion: "BOOK_MEETING_B2B", stage: "ENGAGED" });
    for (const entry of result.ranked) {
      assert.equal(entry.components.bonus, 0);
      const c = entry.components;
      const total = c.decisionRelevance + c.informationGain + c.salesProgression + c.intentRelevance - c.friction - c.repetitionRisk - c.prematurity - c.pKnown;
      assert.ok(Math.abs(entry.value - total) < 1e-3, entry.questionId);
    }
    const use = result.ranked.find((entry) => entry.questionId === "q-use")!;
    assert.equal(use.components.salesProgression, 1, "a threshold dimension unlocks the next step");
  });

  test("a low-intent lead is not asked commercial questions ahead of the problem", () => {
    const low = selectNextQuestion({ questions: [BUDGET, USE_CASE, AUTHORITY], answers: [], serviceId: null, stage: "QUALIFYING", intentState: "LOW" });
    assert.equal(low.ranked[0].questionId, "q-use");
    assert.equal(low.ranked.find((entry) => entry.questionId === "q-budget")!.components.intentRelevance, 0);
  });

  test("the sticky re-ask is limited to one (MAX_ASKS_PER_INTENT)", () => {
    const again = selectNextQuestion({ questions: B2B, answers: [], serviceId: null, motion: "BOOK_MEETING_B2B", currentQuestionId: "q-team", askHistory: [{ questionId: "q-team", asked: 1 }] });
    assert.equal(again.question?.id, "q-team");
    const stop = selectNextQuestion({ questions: B2B, answers: [], serviceId: null, motion: "BOOK_MEETING_B2B", currentQuestionId: "q-team", askHistory: [{ questionId: "q-team", asked: 2 }] });
    assert.notEqual(stop.question?.id, "q-team");
    const answered = selectNextQuestion({ questions: [TEAM], answers: [], serviceId: null, askHistory: [{ questionId: "q-team", asked: 3, answered: true }] });
    assert.equal(answered.question?.id, "q-team", "an answered history never blocks (the answer row decides)");
  });

  test("a remembered fact keeps its provenance (form answers are recorded as form)", () => {
    const result = selectNextQuestion({
      questions: [TEAM],
      answers: [],
      serviceId: null,
      facts: [{ dimension: "TEAM_SIZE", questionId: "q-team", value: "12", confidence: 1, source: "FORM" }],
    });
    assert.equal(result.inferred[0]?.factSource, "FORM");
  });

  test("the six added dimensions are inferred from wording", () => {
    assert.equal(inferDimension(q("a", "What would a good result look like for you?", 1)), "OUTCOME");
    assert.equal(inferDimension(q("b", "Does it need to integrate with Xero?", 1)), "TECHNICAL_REQUIREMENTS");
    assert.equal(inferDimension(q("c", "What days usually suit you for a call?", 1)), "AVAILABILITY");
    assert.equal(inferDimension(q("d", "Is anything frustrating you about the current setup?", 1)), "DISSATISFACTION");
    assert.equal(inferDimension(q("e", "How soon could you get started?", 1)), "TIMING", "timing wording still wins");
    assert.equal(inferDimension(q("f", "Are you ready to go ahead if it fits?", 1)), "PURCHASE_READINESS");
  });
});
