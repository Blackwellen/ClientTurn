/**
 * Qualification configuration shapes and pure helpers. No `server-only` and no
 * Supabase import, so client components can use these safely.
 */

import { z } from "zod";
import type {
  Evaluation,
  QualificationResult,
  Reason,
  Rule,
} from "./engine";

export const RESPONSE_TYPES = [
  "text",
  "yes_no",
  "single_choice",
  "number",
  "postcode",
  "timing",
] as const;

export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const RESPONSE_TYPE_META: Record<
  ResponseType,
  { label: string; hint: string; usesOptions: boolean }
> = {
  yes_no: {
    label: "Yes / No",
    hint: "A reply is matched against yes and no. Anything else goes to review.",
    usesOptions: false,
  },
  single_choice: {
    label: "Single choice",
    hint: "The reply must match one of the options you configure, exactly or simply.",
    usesOptions: true,
  },
  timing: {
    label: "Timing",
    hint: "A choice list for how soon the work is needed.",
    usesOptions: true,
  },
  number: {
    label: "Number",
    hint: "A numeric answer, comparable with at least / at most rules.",
    usesOptions: false,
  },
  postcode: {
    label: "Postcode",
    hint: "A UK postcode, comparable against prefix lists.",
    usesOptions: false,
  },
  text: {
    label: "Free text",
    hint: "Recorded for a person to read. Free text is never guessed at.",
    usesOptions: false,
  },
};

export const OPERATORS = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "gte",
  "lte",
  "prefix_in",
  "prefix_not_in",
  "is_present",
] as const;

export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_META: Record<
  Operator,
  { label: string; values: "none" | "one" | "many"; types: ResponseType[] }
> = {
  equals: {
    label: "is exactly",
    values: "one",
    types: ["text", "yes_no", "single_choice", "timing", "postcode", "number"],
  },
  not_equals: {
    label: "is not",
    values: "one",
    types: ["text", "yes_no", "single_choice", "timing", "postcode", "number"],
  },
  in: {
    label: "is one of",
    values: "many",
    types: ["yes_no", "single_choice", "timing", "text"],
  },
  not_in: {
    label: "is none of",
    values: "many",
    types: ["yes_no", "single_choice", "timing", "text"],
  },
  gte: { label: "is at least", values: "one", types: ["number"] },
  lte: { label: "is at most", values: "one", types: ["number"] },
  prefix_in: {
    label: "starts with one of",
    values: "many",
    types: ["postcode", "text"],
  },
  prefix_not_in: {
    label: "starts with none of",
    values: "many",
    types: ["postcode", "text"],
  },
  is_present: {
    label: "has been answered",
    values: "none",
    types: [...RESPONSE_TYPES],
  },
};

export const RULE_RESULTS = ["pass", "hard_fail", "review"] as const;
export type RuleResult = (typeof RULE_RESULTS)[number];

export const RULE_RESULT_META: Record<
  RuleResult,
  { label: string; tone: "success" | "danger" | "warning"; detail: string }
> = {
  pass: {
    label: "Pass",
    tone: "success",
    detail:
      "The condition must hold. If it does not, the lead simply carries on to the next rule.",
  },
  hard_fail: {
    label: "Fail",
    tone: "danger",
    detail:
      "If the condition does not hold, the lead is NOT_QUALIFIED immediately and no later rule is read.",
  },
  review: {
    label: "Review",
    tone: "warning",
    detail:
      "If the condition does not hold, the lead is sent for human review rather than being rejected.",
  },
};

export type QualificationOption = {
  id: string;
  label: string;
  value: string;
  position: number;
};

export type QuestionRecord = {
  id: string;
  questionText: string;
  helpText: string | null;
  responseType: ResponseType;
  required: boolean;
  position: number;
  active: boolean;
  serviceId: string | null;
  options: QualificationOption[];
};

export type RuleRecord = {
  id: string;
  questionId: string | null;
  ruleType: "answer" | "service_active" | "postcode_area";
  operator: Operator;
  comparisonValue: string[];
  result: RuleResult;
  priority: number;
  active: boolean;
};

export type ServiceRef = {
  id: string;
  name: string;
  active: boolean;
};

export type ServiceAreaSettings = {
  allowedPrefixes: string[];
  blockedPrefixes: string[];
};

export type QualificationConfig = {
  services: ServiceRef[];
  questions: QuestionRecord[];
  rules: RuleRecord[];
  serviceArea: ServiceAreaSettings;
};

export type PreviewOutcome = {
  result: QualificationResult;
  reasons: Reason[];
  answerEvaluations: Record<string, Evaluation>;
  firedRules: {
    ruleId: string;
    questionText: string;
    description: string;
    outcome: "held" | "did_not_hold" | "not_evaluable" | "no_answer";
    result: RuleResult;
  }[];
};

export const RESULT_META: Record<
  QualificationResult,
  { label: string; tone: "success" | "danger" | "warning" | "neutral"; detail: string }
> = {
  QUALIFIED: {
    label: "Qualified",
    tone: "success",
    detail: "Every required question is answered and every rule held.",
  },
  NOT_QUALIFIED: {
    label: "Not qualified",
    tone: "danger",
    detail: "An explicit fail rule, an inactive service, or a blocked area.",
  },
  REVIEW: {
    label: "Review",
    tone: "warning",
    detail:
      "Something could not be decided on the rules alone. A person picks it up.",
  },
  PENDING: {
    label: "Pending",
    tone: "neutral",
    detail: "A required question has not been answered yet.",
  },
};

export const REVIEW_NOTE =
  "Qualification is entirely deterministic: configured questions, configured rules, and nothing else. There is no score, no model and no confidence threshold. An answer that cannot be matched to a configured option, or a rule that cannot be evaluated, always produces REVIEW and a human handover — never a guess.";

export const ORDER_NOTE =
  "Rules are read in priority order, lowest number first. A fail rule ends the evaluation immediately; a review rule is remembered and applied at the end.";

export const SERVICE_AREA_NOTE =
  "Service validity and the postcode service area are checked before any rule below, from the values set in Settings. An inactive service or a blocked postcode is NOT_QUALIFIED on its own.";

// ------------------------------------------------------------------ helpers

export function operatorsFor(responseType: ResponseType): Operator[] {
  return OPERATORS.filter((operator) =>
    OPERATOR_META[operator].types.includes(responseType),
  );
}

export function describeRule(
  rule: Pick<RuleRecord, "operator" | "comparisonValue" | "result">,
  questionText: string,
): string {
  const meta = OPERATOR_META[rule.operator];
  if (meta.values === "none") return `${questionText} ${meta.label}`;
  return `${questionText} ${meta.label} ${rule.comparisonValue.join(", ")}`;
}

export function toEngineRule(rule: RuleRecord): Rule {
  return {
    id: rule.id,
    questionId: rule.questionId,
    ruleType: rule.ruleType,
    operator: rule.operator,
    comparisonValue: rule.comparisonValue,
    result: rule.result,
    priority: rule.priority,
  };
}

/** A candidate answer value for a question, used by the preview panel. */
export function optionValues(question: QuestionRecord): string[] {
  if (question.responseType === "yes_no") return ["yes", "no"];
  return question.options.map((option) => option.value);
}

// ------------------------------------------------------------------ schemas

const trimmed = z.string().trim();

export const questionInputSchema = z.object({
  id: z.uuid().optional(),
  questionText: trimmed.min(3).max(300),
  helpText: trimmed.max(300).optional().or(z.literal("")),
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
    .max(12)
    .default([]),
});

export type QuestionInput = z.input<typeof questionInputSchema>;

export const ruleInputSchema = z.object({
  id: z.uuid().optional(),
  questionId: z.uuid(),
  operator: z.enum(OPERATORS),
  comparisonValue: z.array(trimmed.min(1).max(80)).max(20).default([]),
  result: z.enum(RULE_RESULTS),
  priority: z.coerce.number().int().min(0).max(999),
  active: z.boolean(),
});

export type RuleInput = z.input<typeof ruleInputSchema>;

export const previewInputSchema = z.object({
  serviceId: z.union([z.uuid(), z.literal("")]).nullish(),
  postcode: trimmed.max(12).optional(),
  answers: z
    .array(
      z.object({
        questionId: z.uuid(),
        value: trimmed.max(200),
      }),
    )
    .max(50)
    .default([]),
});

export type PreviewInput = z.input<typeof previewInputSchema>;

// ------------------------------------------------------------------- filters

export const QUALIFICATION_TABS = [
  { value: "questions", label: "Questions" },
  { value: "rules", label: "Rules" },
  { value: "preview", label: "Preview" },
] as const;

export type QualificationTab = (typeof QUALIFICATION_TABS)[number]["value"];

export const qualificationFilterSchema = z.object({
  tab: z.enum(["questions", "rules", "preview"]).default("questions").catch("questions"),
  service: z.string().trim().max(64).optional().catch(undefined),
});

export type QualificationFilters = z.infer<typeof qualificationFilterSchema>;

export function parseQualificationFilters(
  params: Record<string, string | string[] | undefined>,
): QualificationFilters {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return qualificationFilterSchema.parse({
    tab: first(params.tab),
    service: first(params.service),
  });
}
