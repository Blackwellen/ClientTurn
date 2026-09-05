import { z } from "zod";

/**
 * Structured-output contracts for every AI task. The model router parses
 * every Azure response through one of these — uncontrolled prose is never
 * accepted where a schema can be used (CLAUDE.md build brief §9).
 */

export const TASK_TYPES = [
  "intent_classification",
  "answer_extraction",
  "reply_generation",
  "conversation_summary",
  "handover_reasoning",
  "reactivation_copy",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** Nano: high-volume, low-cost, structured-only tasks. */
export const FAST_STRUCTURED_TASKS = new Set<TaskType>([
  "intent_classification",
  "answer_extraction",
]);

export const leadIntentSchema = z.object({
  intent: z.enum([
    "SERVICE_ENQUIRY",
    "QUESTION",
    "BOOKING",
    "HUMAN_REQUEST",
    "OPT_OUT",
    "UNKNOWN",
  ]),
  service_id: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  requires_human: z.boolean().default(false),
});
export type LeadIntentResult = z.infer<typeof leadIntentSchema>;

export const qualificationExtractionSchema = z.object({
  question_id: z.string(),
  normalized_value: z.string().nullable(),
  matched_option_id: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  requires_review: z.boolean().default(false),
});
export type QualificationExtraction = z.infer<typeof qualificationExtractionSchema>;

export const replyPlanSchema = z.object({
  response_type: z.enum([
    "ANSWER",
    "ASK_NEXT_QUESTION",
    "SEND_BOOKING_LINK",
    "HANDOVER",
    "NO_SEND",
  ]),
  message: z.string(),
  reason: z.string(),
  requires_human: z.boolean().default(false),
});
export type ReplyPlan = z.infer<typeof replyPlanSchema>;

export const conversationSummarySchema = z.object({
  summary: z.string(),
  key_points: z.array(z.string()).default([]),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const SCHEMAS: Record<TaskType, z.ZodType<unknown>> = {
  intent_classification: leadIntentSchema,
  answer_extraction: qualificationExtractionSchema,
  reply_generation: replyPlanSchema,
  conversation_summary: conversationSummarySchema,
  handover_reasoning: replyPlanSchema,
  reactivation_copy: z.object({ message: z.string() }),
};

/**
 * Confidence policy (§10). Confidence is operational metadata — it must never
 * be shown to a customer, only used to decide automatic-use vs review.
 */
export const CONFIDENCE = {
  AUTOMATIC: 0.9,
  ASSISTED_MIN: 0.7,
} as const;

export type ConfidenceBand = "automatic" | "assisted" | "review";

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE.AUTOMATIC) return "automatic";
  if (confidence >= CONFIDENCE.ASSISTED_MIN) return "assisted";
  return "review";
}
