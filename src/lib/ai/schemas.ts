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
  // Social outreach. Split in two deliberately: classifying a reply is a
  // structured nano task, while composing the message a stranger reads under
  // the customer's own name is generation and goes to mini.
  "social_reply_classification",
  "social_message",
  // Extracting people from a company's own published pages. Structured-only,
  // so it goes to nano: the model is a parser here, not an author.
  "website_contacts",
  // Cold email variants. Mini tier: it is generation work under a hard set of
  // prohibitions, and the whole point is that the three proposals differ in
  // angle rather than in wording, which nano does not do reliably.
  "variant_generation",
  // Copilot's tool-calling turn. Unlike every other task here it has no fixed
  // response schema: a turn either asks for a tool or answers in prose, and the
  // loop in `copilot/loop.ts` — not a schema — decides which happened.
  "copilot_turn",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** Nano: high-volume, low-cost, structured-only tasks. */
export const FAST_STRUCTURED_TASKS = new Set<TaskType>([
  "intent_classification",
  "answer_extraction",
  "social_reply_classification",
  "website_contacts",
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

/**
 * How a reply on a social channel is read.
 *
 * A separate vocabulary from `leadIntentSchema` because the decisions it feeds
 * are different ones. A cold LinkedIn reply is most often "not now" or "wrong
 * person" -- neither of which exists in the lead intent set, and both of which
 * must stop the sequence without suppressing the contact forever.
 *
 * `OPT_OUT` is the only classification with an irreversible consequence, so it
 * is never trusted on its own: `classification.ts` runs its deterministic
 * phrase check first and that check wins, in both directions.
 */
export const socialReplyClassificationSchema = z.object({
  classification: z.enum([
    "INTERESTED",
    "QUESTION",
    "OBJECTION",
    "NOT_NOW",
    "WRONG_PERSON",
    "OPT_OUT",
    "UNCLEAR",
  ]),
  confidence: z.number().min(0).max(1),
  /** One short sentence, shown to the customer beside the reply. */
  rationale: z.string().max(240),
});
export type SocialReplyClassification = z.infer<typeof socialReplyClassificationSchema>;

/**
 * A composed social message.
 *
 * `used_facts` is the citation guard from `research-policy.ts` applied to
 * outbound copy: the composer is given a short list of facts it may reference
 * and must say which it used. A message citing a fact that was never supplied
 * is discarded rather than repaired -- exactly as an uncited research claim is
 * -- because a personalised opener that invents a detail about someone'''s
 * company is worse than a generic one.
 */
export const socialMessageSchema = z.object({
  body: z.string().min(1).max(1900),
  used_facts: z.array(z.string()).default([]),
});
export type SocialMessageResult = z.infer<typeof socialMessageSchema>;

/**
 * Cold email variants.
 *
 * Deliberately permissive about content and strict about shape. Every field is
 * re-checked downstream against the merge-field allow-list and the prohibited
 * claims list, and a proposal that fails either is dropped rather than
 * repaired -- so this schema's job is only to guarantee the loop has three
 * objects with three strings to examine, not to decide whether they are usable.
 */
export const variantGenerationSchema = z.object({
  variants: z
    .array(
      z.object({
        label: z.string().max(40).optional(),
        subject: z.string(),
        body: z.string(),
      }),
    )
    .max(10),
});

/**
 * People named on a company's own website.
 *
 * `email` is nullable and must be **verbatim from the page**. The prompt says
 * so and `website-contacts.ts` enforces it by dropping anything that is not a
 * well-formed address on the company's own domain -- because the failure this
 * guards against is not a malformed string, it is a *plausible* one: a model
 * that helpfully constructs `first.last@domain` produces a datum with no
 * source, which cannot be disclosed under Article 14 and bounces against a
 * catch-all domain.
 */
export const websiteContactsSchema = z.object({
  people: z
    .array(
      z.object({
        first_name: z.string().nullable().default(null),
        last_name: z.string().nullable().default(null),
        role_title: z.string().nullable().default(null),
        /** Only if printed on the page. Never constructed. */
        email: z.string().nullable().default(null),
      }),
    )
    .max(25)
    .default([]),
});
export type WebsiteContactsResult = z.infer<typeof websiteContactsSchema>;

export type VariantGenerationResult = z.infer<typeof variantGenerationSchema>;

export const SCHEMAS: Record<TaskType, z.ZodType<unknown>> = {
  // Present so the map stays exhaustive. `copilot_turn` never reaches
  // `runTask`, which is the only thing that reads this — the tool loop calls
  // the transport directly because its output is not one JSON object.
  copilot_turn: z.unknown(),
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
  social_reply_classification: socialReplyClassificationSchema,
  social_message: socialMessageSchema,
  variant_generation: variantGenerationSchema,
  website_contacts: websiteContactsSchema,
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
