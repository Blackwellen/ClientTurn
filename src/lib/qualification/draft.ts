/**
 * The Qualification editor's draft model.
 *
 * The editor is explicitly draft-then-publish: nothing typed reaches live
 * intake until "Publish qualification" succeeds. The draft is a plain
 * client-side value, which is what lets the live preview run the real engine
 * over questions that have never touched the database.
 *
 * No `server-only` and no Supabase import — client components use this
 * directly, and the publish action re-derives every rule here on the server.
 */

import { z } from "zod";
import type { QualificationResult } from "./engine.ts";
import {
  OPERATORS,
  OPERATOR_META,
  RESPONSE_TYPES,
  RESPONSE_TYPE_META,
  RULE_RESULTS,
  operatorsFor,
  type Operator,
  type QuestionRecord,
  type ResponseType,
  type RuleRecord,
  type RuleResult,
  type ServiceRef,
} from "./types.ts";

export type DraftOption = {
  /** Stable across renders. Not a database id — a new option has none. */
  key: string;
  label: string;
  value: string;
};

export type DraftRule = {
  key: string;
  /** Present once the rule exists in the database. */
  id: string | null;
  operator: Operator;
  comparisonValue: string[];
  result: RuleResult;
  priority: number;
  active: boolean;
};

export type DraftQuestion = {
  key: string;
  id: string | null;
  questionText: string;
  helpText: string;
  responseType: ResponseType;
  required: boolean;
  active: boolean;
  /** null means "All services". */
  serviceId: string | null;
  options: DraftOption[];
  rules: DraftRule[];
};

export const MAX_QUALIFICATION_QUESTIONS = 20;
export const MAX_QUESTION_OPTIONS = 12;

export function usesOptions(responseType: ResponseType): boolean {
  return RESPONSE_TYPE_META[responseType].usesOptions;
}

let draftKeySeed = 0;

/**
 * React keys for rows that do not exist server-side yet. Deliberately not
 * derived from the row contents, so editing a question's text cannot remount
 * its inputs and steal focus mid-keystroke.
 */
export function newDraftKey(prefix = "q"): string {
  draftKeySeed += 1;
  return `${prefix}-${draftKeySeed}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toDraftQuestions(
  questions: QuestionRecord[],
  rules: RuleRecord[],
): DraftQuestion[] {
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((question) => ({
      key: question.id,
      id: question.id,
      questionText: question.questionText,
      helpText: question.helpText ?? "",
      responseType: question.responseType,
      required: question.required,
      active: question.active,
      serviceId: question.serviceId,
      options: question.options
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((option) => ({
          key: option.id,
          label: option.label,
          value: option.value,
        })),
      rules: rules
        .filter(
          (rule) => rule.ruleType === "answer" && rule.questionId === question.id,
        )
        .sort((a, b) => a.priority - b.priority)
        .map((rule) => ({
          key: rule.id,
          id: rule.id,
          operator: rule.operator,
          comparisonValue: rule.comparisonValue,
          result: rule.result,
          priority: rule.priority,
          active: rule.active,
        })),
    }));
}

/** Default options a type needs so a new question is immediately usable. */
export function defaultOptionsFor(responseType: ResponseType): DraftOption[] {
  if (responseType === "timing") {
    return [
      { key: newDraftKey("o"), label: "ASAP", value: "asap" },
      { key: newDraftKey("o"), label: "Within 30 days", value: "within_30_days" },
      { key: newDraftKey("o"), label: "Researching only", value: "researching" },
    ];
  }
  if (responseType === "single_choice") {
    return [
      { key: newDraftKey("o"), label: "Option one", value: "option_one" },
      { key: newDraftKey("o"), label: "Option two", value: "option_two" },
    ];
  }
  return [];
}

export function blankQuestion(): DraftQuestion {
  return {
    key: newDraftKey(),
    id: null,
    questionText: "",
    helpText: "",
    responseType: "yes_no",
    required: false,
    active: true,
    serviceId: null,
    options: [],
    rules: [],
  };
}

/** A label-derived, stable machine value, so routing rules keep matching. */
export function slugifyOptionValue(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "option"
  );
}

/* ------------------------------------------------------------ validation */

export type DraftIssue = { key: string; message: string };

/**
 * The single source of truth for whether "Your qualification looks good!" may
 * appear and whether Publish is allowed. Pure, so the editor and the tests
 * agree; the server re-runs the same rules independently before writing.
 */
export function validateDraft(
  questions: DraftQuestion[],
  services: ServiceRef[],
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const serviceIds = new Set(services.map((service) => service.id));

  if (questions.length > MAX_QUALIFICATION_QUESTIONS) {
    issues.push({
      key: "count",
      message: `Qualification is limited to ${MAX_QUALIFICATION_QUESTIONS} questions.`,
    });
  }

  questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;

    if (question.questionText.trim().length < 3) {
      issues.push({
        key: `${question.key}-text`,
        message: `${label} needs a question to ask.`,
      });
    }

    if (question.serviceId && !serviceIds.has(question.serviceId)) {
      issues.push({
        key: `${question.key}-service`,
        message: `${label} is scoped to a service that no longer exists.`,
      });
    }

    if (usesOptions(question.responseType)) {
      if (question.options.length < 2) {
        issues.push({
          key: `${question.key}-options`,
          message: `${label} needs at least two options.`,
        });
      }
      if (question.options.length > MAX_QUESTION_OPTIONS) {
        issues.push({
          key: `${question.key}-options-max`,
          message: `${label} has more than ${MAX_QUESTION_OPTIONS} options.`,
        });
      }
      if (question.options.some((option) => option.label.trim() === "")) {
        issues.push({
          key: `${question.key}-option-label`,
          message: `${label} has an option with no label.`,
        });
      }
      const values = question.options.map((option) =>
        option.value.trim().toLowerCase(),
      );
      if (new Set(values).size !== values.length) {
        issues.push({
          key: `${question.key}-option-dupe`,
          message: `${label} has two options with the same value.`,
        });
      }
    }

    const allowed = operatorsFor(question.responseType);
    question.rules.forEach((rule, ruleIndex) => {
      const ruleLabel = `${label}, rule ${ruleIndex + 1}`;
      if (!allowed.includes(rule.operator)) {
        issues.push({
          key: `${rule.key}-operator`,
          message: `${ruleLabel} uses a condition that does not apply to this answer type.`,
        });
      }
      if (
        OPERATOR_META[rule.operator].values !== "none" &&
        rule.comparisonValue.filter((value) => value.trim() !== "").length === 0
      ) {
        issues.push({
          key: `${rule.key}-value`,
          message: `${ruleLabel} needs a value to compare against.`,
        });
      }
    });
  });

  return issues;
}

/** Which services have qualification coverage, for the scope summary card. */
export function serviceScopeSummary(
  questions: DraftQuestion[],
  services: ServiceRef[],
): { id: string | null; name: string; count: number; percent: number }[] {
  const live = questions.filter(
    (question) => question.active && question.questionText.trim() !== "",
  );
  const shared = live.filter((question) => question.serviceId === null).length;
  const total = live.length;

  const rows = [
    { id: null as string | null, name: "All services", count: shared },
    ...services.map((service) => ({
      id: service.id as string | null,
      name: service.name,
      count:
        shared +
        live.filter((question) => question.serviceId === service.id).length,
    })),
  ];

  return rows.map((row) => ({
    ...row,
    percent: total === 0 ? 0 : Math.round((row.count / total) * 100),
  }));
}

/* --------------------------------------------------------- publish schema */

const trimmed = z.string().trim();

export const draftRuleSchema = z.object({
  id: z.uuid().nullish(),
  operator: z.enum(OPERATORS),
  comparisonValue: z.array(trimmed.max(80)).max(20).default([]),
  result: z.enum(RULE_RESULTS),
  priority: z.coerce.number().int().min(0).max(999),
  active: z.boolean(),
});

export const draftQuestionSchema = z.object({
  id: z.uuid().nullish(),
  questionText: trimmed.min(3).max(300),
  helpText: trimmed.max(300).default(""),
  responseType: z.enum(RESPONSE_TYPES),
  required: z.boolean(),
  active: z.boolean(),
  serviceId: z.union([z.uuid(), z.literal("")]).nullish(),
  options: z
    .array(
      z.object({
        label: trimmed.min(1).max(80),
        value: trimmed.min(1).max(80),
      }),
    )
    .max(MAX_QUESTION_OPTIONS)
    .default([]),
  rules: z.array(draftRuleSchema).max(20).default([]),
});

export const publishDraftSchema = z.object({
  questions: z.array(draftQuestionSchema).max(MAX_QUALIFICATION_QUESTIONS),
  /**
   * Optimistic concurrency token: the newest `updated_at` the editor loaded.
   * The publish is refused if the stored configuration has moved on since,
   * rather than letting a stale editor silently overwrite someone else.
   */
  baseline: z.string().nullable(),
});

export type PublishDraftInput = z.input<typeof publishDraftSchema>;

/** The wire shape the editor sends. Strips React keys, keeps order. */
export function toPublishPayload(
  questions: DraftQuestion[],
  baseline: string | null,
): PublishDraftInput {
  return {
    baseline,
    questions: questions.map((question) => ({
      id: question.id,
      questionText: question.questionText,
      helpText: question.helpText,
      responseType: question.responseType,
      required: question.required,
      active: question.active,
      serviceId: question.serviceId,
      options: usesOptions(question.responseType)
        ? question.options.map((option) => ({
            label: option.label,
            value: option.value,
          }))
        : [],
      rules: question.rules.map((rule) => ({
        id: rule.id,
        operator: rule.operator,
        comparisonValue: rule.comparisonValue.filter(
          (value) => value.trim() !== "",
        ),
        result: rule.result,
        priority: rule.priority,
        active: rule.active,
      })),
    })),
  };
}

/* -------------------------------------------------------------- statistics */

export type QualificationStats = Record<QualificationResult, number>;

export const QUALIFICATION_STAT_ORDER = [
  "PENDING",
  "QUALIFIED",
  "NOT_QUALIFIED",
  "REVIEW",
] as const;

export const QUALIFICATION_STAT_META: Record<
  QualificationResult,
  { label: string; dot: string }
> = {
  PENDING: { label: "Pending", dot: "bg-content-subtle" },
  QUALIFIED: { label: "Qualified", dot: "bg-success-500" },
  NOT_QUALIFIED: { label: "Not qualified", dot: "bg-danger-500" },
  REVIEW: { label: "Review", dot: "bg-warning-500" },
};

/** Who last changed the live configuration, for the sticky action bar. */
export type QualificationMeta = {
  savedAt: string | null;
  savedByInitials: string | null;
  savedByName: string | null;
};

export const ROUTING_EXPLANATION = [
  { status: "QUALIFIED", detail: "booking or handover" },
  { status: "REVIEW", detail: "needs attention" },
  { status: "NOT_QUALIFIED", detail: "stop normal qualification flow" },
] as const;
