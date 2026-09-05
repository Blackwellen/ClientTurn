/**
 * Deterministic qualification. No model, no score, no inference.
 *
 * Evaluation order (Bible §21.1):
 *   1. required questions complete?  2. service valid?  3. service area valid?
 *   4. explicit hard-fail rules?     5. required accepted values?
 *   6. any manual-review field?      7. result
 *
 * Every outcome carries a reason chain so the UI can explain itself.
 */

export type Evaluation = "not_evaluated" | "meets" | "does_not_meet" | "review";
export type QualificationResult =
  | "PENDING"
  | "QUALIFIED"
  | "NOT_QUALIFIED"
  | "REVIEW";

export type Question = {
  id: string;
  responseType: "text" | "yes_no" | "single_choice" | "number" | "postcode" | "timing";
  required: boolean;
  serviceId: string | null;
  options?: { value: string }[];
};

export type Answer = {
  questionId: string;
  answerValue: string | null;
  answerText: string | null;
};

export type Rule = {
  id: string;
  questionId: string | null;
  ruleType: "answer" | "service_active" | "postcode_area";
  operator:
    | "equals"
    | "not_equals"
    | "in"
    | "not_in"
    | "gte"
    | "lte"
    | "prefix_in"
    | "prefix_not_in"
    | "is_present";
  comparisonValue: unknown;
  result: "pass" | "hard_fail" | "review";
  priority: number;
};

export type Reason = {
  code: string;
  detail: string;
  questionId?: string;
};

export type EngineInput = {
  questions: Question[];
  answers: Answer[];
  rules: Rule[];
  serviceId: string | null;
  serviceIsActive: boolean;
  postcode: string | null;
  allowedPostcodePrefixes: string[];
  blockedPostcodePrefixes: string[];
};

export type EngineOutput = {
  result: QualificationResult;
  reasons: Reason[];
  answerEvaluations: Record<string, Evaluation>;
};

function normalisePostcodePrefix(postcode: string): string {
  return postcode.toUpperCase().replace(/\s+/g, "").slice(0, 4);
}

function matchesPrefix(postcode: string, prefixes: string[]): boolean {
  const normalised = normalisePostcodePrefix(postcode);
  return prefixes.some((prefix) =>
    normalised.startsWith(prefix.toUpperCase().replace(/\s+/g, "")),
  );
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return [String(value)];
}

function applyOperator(
  operator: Rule["operator"],
  actual: string | null,
  expected: unknown,
): boolean | null {
  if (operator === "is_present") return actual != null && actual !== "";
  if (actual == null || actual === "") return null;

  const expectedList = asArray(expected);
  const first = expectedList[0];

  switch (operator) {
    case "equals":
      return actual.toLowerCase() === String(first ?? "").toLowerCase();
    case "not_equals":
      return actual.toLowerCase() !== String(first ?? "").toLowerCase();
    case "in":
      return expectedList.some((v) => v.toLowerCase() === actual.toLowerCase());
    case "not_in":
      return !expectedList.some((v) => v.toLowerCase() === actual.toLowerCase());
    case "gte": {
      const a = Number(actual);
      const b = Number(first);
      return Number.isFinite(a) && Number.isFinite(b) ? a >= b : null;
    }
    case "lte": {
      const a = Number(actual);
      const b = Number(first);
      return Number.isFinite(a) && Number.isFinite(b) ? a <= b : null;
    }
    case "prefix_in":
      return matchesPrefix(actual, expectedList);
    case "prefix_not_in":
      return !matchesPrefix(actual, expectedList);
    default:
      return null;
  }
}

export function evaluateQualification(input: EngineInput): EngineOutput {
  const reasons: Reason[] = [];
  const answerEvaluations: Record<string, Evaluation> = {};

  const answerByQuestion = new Map(
    input.answers.map((answer) => [answer.questionId, answer]),
  );

  // Questions scoped to a different service do not apply to this lead.
  const applicable = input.questions.filter(
    (question) =>
      question.serviceId === null || question.serviceId === input.serviceId,
  );

  // --- 2. service validity ------------------------------------------------
  if (!input.serviceId) {
    reasons.push({
      code: "service_missing",
      detail: "No service has been identified for this lead.",
    });
  } else if (!input.serviceIsActive) {
    reasons.push({
      code: "service_inactive",
      detail: "The requested service is not active for this business.",
    });
    return { result: "NOT_QUALIFIED", reasons, answerEvaluations };
  }

  // --- 3. service area ----------------------------------------------------
  if (input.postcode) {
    if (
      input.blockedPostcodePrefixes.length &&
      matchesPrefix(input.postcode, input.blockedPostcodePrefixes)
    ) {
      reasons.push({
        code: "postcode_blocked",
        detail: `${input.postcode} is in a blocked area.`,
      });
      return { result: "NOT_QUALIFIED", reasons, answerEvaluations };
    }
    if (
      input.allowedPostcodePrefixes.length &&
      !matchesPrefix(input.postcode, input.allowedPostcodePrefixes)
    ) {
      reasons.push({
        code: "postcode_outside_area",
        detail: `${input.postcode} is outside the configured service area.`,
      });
      return { result: "NOT_QUALIFIED", reasons, answerEvaluations };
    }
  }

  // --- 4 & 5. rules -------------------------------------------------------
  let sawReview = false;
  const sortedRules = [...input.rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (rule.ruleType !== "answer" || !rule.questionId) continue;

    const answer = answerByQuestion.get(rule.questionId);
    const outcome = applyOperator(
      rule.operator,
      answer?.answerValue ?? null,
      rule.comparisonValue,
    );

    // Unevaluable rules never silently pass — they defer to a human.
    if (outcome === null) {
      if (answer) {
        answerEvaluations[rule.questionId] = "review";
        sawReview = true;
        reasons.push({
          code: "rule_unevaluable",
          detail: "An answer could not be evaluated automatically.",
          questionId: rule.questionId,
        });
      }
      continue;
    }

    if (!outcome && rule.result === "hard_fail") {
      answerEvaluations[rule.questionId] = "does_not_meet";
      reasons.push({
        code: "rule_hard_fail",
        detail: "An answer does not meet the required criteria.",
        questionId: rule.questionId,
      });
      return { result: "NOT_QUALIFIED", reasons, answerEvaluations };
    }

    if (!outcome && rule.result === "review") {
      answerEvaluations[rule.questionId] = "review";
      sawReview = true;
      reasons.push({
        code: "rule_review",
        detail: "An answer needs manual review.",
        questionId: rule.questionId,
      });
      continue;
    }

    answerEvaluations[rule.questionId] = outcome ? "meets" : "does_not_meet";
  }

  // --- 1. required completeness ------------------------------------------
  const unanswered = applicable.filter((question) => {
    if (!question.required) return false;
    const answer = answerByQuestion.get(question.id);
    return !answer || !answer.answerValue;
  });

  if (unanswered.length) {
    for (const question of unanswered) {
      answerEvaluations[question.id] ??= "not_evaluated";
    }
    reasons.push({
      code: "awaiting_answers",
      detail: `${unanswered.length} required question${unanswered.length === 1 ? "" : "s"} still unanswered.`,
    });
    return { result: "PENDING", reasons, answerEvaluations };
  }

  // --- 6. free text that could not be matched -----------------------------
  for (const question of applicable) {
    const answer = answerByQuestion.get(question.id);
    if (!answer) continue;

    const needsMatch =
      question.responseType === "single_choice" ||
      question.responseType === "yes_no" ||
      question.responseType === "timing";

    if (needsMatch && !answer.answerValue && answer.answerText) {
      answerEvaluations[question.id] = "review";
      sawReview = true;
      reasons.push({
        code: "answer_unmatched",
        detail: "A reply could not be matched to a configured option.",
        questionId: question.id,
      });
    }
  }

  if (sawReview) {
    return { result: "REVIEW", reasons, answerEvaluations };
  }

  if (!input.serviceId) {
    return { result: "REVIEW", reasons, answerEvaluations };
  }

  reasons.push({
    code: "all_criteria_met",
    detail: "All required questions answered and every rule passed.",
  });
  return { result: "QUALIFIED", reasons, answerEvaluations };
}

/** Booking is permitted only on a clean qualification (Bible §21.3). */
export function isBookingReady(input: {
  qualification: QualificationResult;
  optedOut: boolean;
  humanTakeover: boolean;
  hasBookingDestination: boolean;
}): boolean {
  return (
    input.qualification === "QUALIFIED" &&
    !input.optedOut &&
    !input.humanTakeover &&
    input.hasBookingDestination
  );
}
