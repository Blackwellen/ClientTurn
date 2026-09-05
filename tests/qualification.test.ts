import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateQualification,
  isBookingReady,
  type EngineInput,
} from "../src/lib/qualification/engine.ts";

function base(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    questions: [],
    answers: [],
    rules: [],
    serviceId: "svc-1",
    serviceIsActive: true,
    postcode: null,
    allowedPostcodePrefixes: [],
    blockedPostcodePrefixes: [],
    ...overrides,
  };
}

describe("qualification engine", () => {
  test("inactive service hard-fails", () => {
    const out = evaluateQualification(base({ serviceIsActive: false }));
    assert.equal(out.result, "NOT_QUALIFIED");
    assert.ok(out.reasons.some((r) => r.code === "service_inactive"));
  });

  test("blocked postcode hard-fails", () => {
    const out = evaluateQualification(
      base({ postcode: "BH14 9XY", blockedPostcodePrefixes: ["BH14"] }),
    );
    assert.equal(out.result, "NOT_QUALIFIED");
  });

  test("postcode outside the allowed area hard-fails", () => {
    const out = evaluateQualification(
      base({ postcode: "M1 1AA", allowedPostcodePrefixes: ["BH", "SO"] }),
    );
    assert.equal(out.result, "NOT_QUALIFIED");
  });

  test("postcode inside the allowed area does not fail", () => {
    const out = evaluateQualification(
      base({ postcode: "BH14 9XY", allowedPostcodePrefixes: ["BH14"] }),
    );
    assert.equal(out.result, "QUALIFIED");
  });

  test("unanswered required question is PENDING, not a failure", () => {
    const out = evaluateQualification(
      base({
        questions: [
          {
            id: "q1",
            responseType: "yes_no",
            required: true,
            serviceId: null,
          },
        ],
      }),
    );
    assert.equal(out.result, "PENDING");
  });

  test("question scoped to another service is ignored", () => {
    const out = evaluateQualification(
      base({
        serviceId: "svc-1",
        questions: [
          {
            id: "q1",
            responseType: "yes_no",
            required: true,
            serviceId: "svc-2",
          },
        ],
      }),
    );
    assert.equal(out.result, "QUALIFIED");
  });

  test("hard-fail rule produces NOT_QUALIFIED", () => {
    const out = evaluateQualification(
      base({
        questions: [
          { id: "q1", responseType: "yes_no", required: true, serviceId: null },
        ],
        answers: [{ questionId: "q1", answerValue: "no", answerText: "no" }],
        rules: [
          {
            id: "r1",
            questionId: "q1",
            ruleType: "answer",
            operator: "equals",
            comparisonValue: ["yes"],
            result: "hard_fail",
            priority: 0,
          },
        ],
      }),
    );
    assert.equal(out.result, "NOT_QUALIFIED");
    assert.equal(out.answerEvaluations.q1, "does_not_meet");
  });

  test("free text that matches no option goes to REVIEW, never QUALIFIED", () => {
    const out = evaluateQualification(
      base({
        questions: [
          {
            id: "q1",
            responseType: "single_choice",
            required: true,
            serviceId: null,
            options: [{ value: "asap" }, { value: "30_days" }],
          },
        ],
        answers: [
          {
            questionId: "q1",
            answerValue: null,
            answerText: "whenever you can fit me in mate",
          },
        ],
      }),
    );
    assert.equal(out.result, "PENDING");
  });

  test("answered-but-unmatched choice is REVIEW once a value exists", () => {
    const out = evaluateQualification(
      base({
        questions: [
          {
            id: "q1",
            responseType: "single_choice",
            required: false,
            serviceId: null,
            options: [{ value: "asap" }],
          },
        ],
        answers: [
          { questionId: "q1", answerValue: null, answerText: "not sure yet" },
        ],
      }),
    );
    assert.equal(out.result, "REVIEW");
  });

  test("an unevaluable rule never silently passes", () => {
    const out = evaluateQualification(
      base({
        questions: [
          { id: "q1", responseType: "number", required: false, serviceId: null },
        ],
        answers: [
          { questionId: "q1", answerValue: "about ten", answerText: "about ten" },
        ],
        rules: [
          {
            id: "r1",
            questionId: "q1",
            ruleType: "answer",
            operator: "gte",
            comparisonValue: [5],
            result: "hard_fail",
            priority: 0,
          },
        ],
      }),
    );
    assert.equal(out.result, "REVIEW");
  });

  test("all criteria met yields QUALIFIED with a reason chain", () => {
    const out = evaluateQualification(
      base({
        questions: [
          { id: "q1", responseType: "yes_no", required: true, serviceId: null },
        ],
        answers: [{ questionId: "q1", answerValue: "yes", answerText: "yes" }],
        rules: [
          {
            id: "r1",
            questionId: "q1",
            ruleType: "answer",
            operator: "equals",
            comparisonValue: ["yes"],
            result: "hard_fail",
            priority: 0,
          },
        ],
      }),
    );
    assert.equal(out.result, "QUALIFIED");
    assert.equal(out.answerEvaluations.q1, "meets");
    assert.ok(out.reasons.length > 0);
  });

  test("missing service cannot reach QUALIFIED", () => {
    const out = evaluateQualification(base({ serviceId: null }));
    assert.equal(out.result, "REVIEW");
  });
});

describe("booking readiness", () => {
  const ready = {
    qualification: "QUALIFIED" as const,
    optedOut: false,
    humanTakeover: false,
    hasBookingDestination: true,
  };

  test("permits a clean qualified lead", () => {
    assert.equal(isBookingReady(ready), true);
  });

  test("blocks an opted-out lead", () => {
    assert.equal(isBookingReady({ ...ready, optedOut: true }), false);
  });

  test("blocks during human takeover", () => {
    assert.equal(isBookingReady({ ...ready, humanTakeover: true }), false);
  });

  test("blocks when there is nowhere to book", () => {
    assert.equal(
      isBookingReady({ ...ready, hasBookingDestination: false }),
      false,
    );
  });

  test("blocks a REVIEW lead", () => {
    assert.equal(
      isBookingReady({ ...ready, qualification: "REVIEW" }),
      false,
    );
  });
});
