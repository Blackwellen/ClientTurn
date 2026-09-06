import { z } from "zod";
import { agentDecisionSchema } from "@/lib/agent/types";

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
  "agent_decision",
  "search_planning",
  "research_summary",
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

/**
 * The Search Agent's turn (V4 10.6). It proposes a *patch* to the structured
 * search plan and the sentence that explains it; it never returns a command,
 * a provider call or an authorisation to spend. The patch is merged into the
 * current plan and re-validated against `searchPlanSchema` before it is shown,
 * so a malformed suggestion becomes a clarifying question rather than a run.
 */
export const searchPlanningSchema = z.object({
  reply: z.string().min(1).max(2000),
  /** Partial plan fields. Validated again by searchPlanSchema after merging. */
  plan_patch: z.record(z.string(), z.unknown()).default({}),
  /** Set when the agent needs an answer before the plan can be completed. */
  clarifying_question: z.string().max(400).nullable().default(null),
  /** The inline plan summary rendered in the chat bubble. */
  summary_lines: z
    .array(z.object({ label: z.string().max(60), value: z.string().max(300) }))
    .max(12)
    .default([]),
  /** The agent's read on whether the target is realistic. */
  breadth: z.enum(["TOO_BROAD", "GOOD", "TOO_NARROW", "UNKNOWN"]).default("UNKNOWN"),
});
export type SearchPlanningResult = z.infer<typeof searchPlanningSchema>;

/**
 * The prospect research synthesis (V4 §13.3).
 *
 * Every sentence must be traceable. `claims` is the whole output: each one
 * carries the ids of the evidence rows it rests on, and the caller drops any
 * claim whose ids are not in the set it supplied. That is what stops the model
 * asserting something the evidence does not support — the guard is structural
 * rather than a plea in the prompt.
 *
 * There is deliberately no free-text `summary` field. A prose blob could not be
 * checked against evidence, and would be indistinguishable from a fabricated
 * one.
 */
export const researchSummarySchema = z.object({
  claims: z
    .array(
      z.object({
        /** One plain sentence about the prospect or their company. */
        text: z.string().min(1).max(400),
        /** Evidence ids from the supplied set. A claim with none is dropped. */
        evidence_ids: z.array(z.string()).min(1).max(8),
      }),
    )
    .max(6)
    .default([]),
  /** Set when the evidence genuinely does not support any claim. */
  insufficient_evidence: z.boolean().default(false),
});
export type ResearchSummaryResult = z.infer<typeof researchSummarySchema>;

export const SCHEMAS: Record<TaskType, z.ZodType<unknown>> = {
  intent_classification: leadIntentSchema,
  answer_extraction: qualificationExtractionSchema,
  reply_generation: replyPlanSchema,
  conversation_summary: conversationSummarySchema,
  handover_reasoning: replyPlanSchema,
  reactivation_copy: z.object({ message: z.string() }),
  // The conversation agent returns one proposal object per turn. It is a
  // Mini-tier task: the decision and the wording are produced together so the
  // model cannot pick an action it then cannot phrase.
  agent_decision: agentDecisionSchema,
  // Mini tier: interpreting a plain-English targeting request is exactly the
  // ambiguity-handling work nano is not for.
  search_planning: searchPlanningSchema,
  // Mini tier: synthesising evidence into readable claims is generation work,
  // and the citation requirement needs a model that can follow it.
  research_summary: researchSummarySchema,
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
