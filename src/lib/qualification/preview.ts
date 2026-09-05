/**
 * Draft preview evaluation.
 *
 * The "Preview for leads" panel must answer one question honestly: what would
 * actually happen to this enquiry? So it runs `evaluateQualification` — the
 * same deterministic engine the worker and the intake pipeline run — over the
 * unsaved draft. There is no second copy of the routing logic anywhere; this
 * module only shapes the draft into the engine's input.
 *
 * Client-safe: the engine is pure, so an unpublished question can be evaluated
 * without a server round-trip on every keystroke.
 */

import {
  evaluateQualification,
  type Answer,
  type EngineOutput,
  type Question,
} from "./engine.ts";
import { usesOptions, type DraftQuestion } from "./draft.ts";
import type { ResponseType, ServiceAreaSettings, ServiceRef } from "./types.ts";

/**
 * Mirrors how an inbound reply is matched server-side (see
 * `matchesConfiguredValue` in ./actions): exact or simple match against a
 * configured option only. Anything else stays unmatched so the engine sends it
 * to REVIEW rather than guessing.
 */
export function matchConfiguredValue(
  responseType: ResponseType,
  optionValues: string[],
  raw: string,
): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (responseType === "yes_no") {
    const lower = value.toLowerCase();
    if (["yes", "y", "yeah", "yep"].includes(lower)) return "yes";
    if (["no", "n", "nope"].includes(lower)) return "no";
    return null;
  }

  if (usesOptions(responseType)) {
    return (
      optionValues.find((option) => option.toLowerCase() === value.toLowerCase()) ??
      null
    );
  }

  return value;
}

/** Which draft questions a given service would actually be asked. */
export function applicableQuestions(
  questions: DraftQuestion[],
  serviceId: string | null,
): DraftQuestion[] {
  return questions.filter(
    (question) =>
      question.active &&
      question.questionText.trim() !== "" &&
      (question.serviceId === null || question.serviceId === serviceId),
  );
}

export type PreviewEvaluation = EngineOutput & {
  /** The postcode taken from a postcode answer, used for the area check. */
  postcode: string | null;
};

export function evaluateDraft(input: {
  questions: DraftQuestion[];
  answers: Record<string, string>;
  serviceId: string | null;
  services: ServiceRef[];
  serviceArea: ServiceAreaSettings;
}): PreviewEvaluation {
  const service =
    input.services.find((row) => row.id === input.serviceId) ?? null;

  const applicable = applicableQuestions(input.questions, input.serviceId);

  // Draft rows have no database id yet, so the engine is keyed on the stable
  // draft key instead. The engine never interprets the id, only matches on it.
  const engineQuestions: Question[] = applicable.map((question) => ({
    id: question.key,
    responseType: question.responseType,
    required: question.required,
    serviceId: question.serviceId,
    options: question.options.map((option) => ({ value: option.value })),
  }));

  const engineAnswers: Answer[] = applicable
    .map((question): Answer | null => {
      const raw = input.answers[question.key] ?? "";
      if (raw.trim() === "") return null;
      return {
        questionId: question.key,
        answerValue: matchConfiguredValue(
          question.responseType,
          question.options.map((option) => option.value),
          raw,
        ),
        answerText: raw,
      };
    })
    .filter((answer): answer is Answer => answer !== null);

  const rules = applicable.flatMap((question) =>
    question.rules
      .filter((rule) => rule.active)
      .map((rule) => ({
        id: rule.key,
        questionId: question.key,
        ruleType: "answer" as const,
        operator: rule.operator,
        comparisonValue: rule.comparisonValue,
        result: rule.result,
        priority: rule.priority,
      })),
  );

  // The service area check reads whichever postcode answer was given.
  const postcodeQuestion = applicable.find(
    (question) => question.responseType === "postcode",
  );
  const postcode = postcodeQuestion
    ? (input.answers[postcodeQuestion.key] ?? "").trim() || null
    : null;

  const outcome = evaluateQualification({
    questions: engineQuestions,
    answers: engineAnswers,
    rules,
    serviceId: input.serviceId,
    serviceIsActive: service?.active ?? false,
    postcode,
    allowedPostcodePrefixes: input.serviceArea.allowedPrefixes,
    blockedPostcodePrefixes: input.serviceArea.blockedPrefixes,
  });

  return { ...outcome, postcode };
}

export const PREVIEW_RESULT_COPY: Record<
  EngineOutput["result"],
  { label: string; detail: string }
> = {
  QUALIFIED: {
    label: "Result: QUALIFIED",
    detail:
      "Based on the answers above, this enquiry would be marked as qualified and sent to booking or handover.",
  },
  REVIEW: {
    label: "Result: REVIEW",
    detail:
      "Based on the answers above, this enquiry would be sent to a person to look at rather than routed automatically.",
  },
  NOT_QUALIFIED: {
    label: "Result: NOT QUALIFIED",
    detail:
      "Based on the answers above, this enquiry would be marked as not qualified and would not go through to booking.",
  },
  PENDING: {
    label: "Result: PENDING",
    detail:
      "A required question has not been answered yet, so this enquiry would wait rather than being routed.",
  },
};
