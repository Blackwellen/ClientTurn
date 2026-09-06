/**
 * ClientTurn agent runtime -- shared vocabulary.
 *
 * Pure types, enums, labels and Zod schemas. No `server-only`, no Supabase
 * import, no I/O, so a client component rendering agent state in the Leads UI
 * can import from here without dragging the runtime into the browser bundle.
 * Everything that touches the database lives in a sibling module.
 */

import { z } from "zod";

// ---------------------------------------------------------------- events

/**
 * Every trigger the runtime understands. A provider-specific payload is
 * normalised into an AgentEvent before anything else happens, so the
 * orchestrator never branches on "was this Twilio or Meta".
 */
export const AGENT_EVENT_TYPES = [
  "LEAD_CREATED",
  "INBOUND_SMS",
  "INBOUND_WHATSAPP",
  "INBOUND_EMAIL",
  "FORM_SUBMISSION",
  "QUALIFICATION_ANSWER",
  "BOOKING_CREATED",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
  "FOLLOW_UP_DUE",
  "REACTIVATION_REPLY",
  "HUMAN_HANDOVER_RESOLVED",
  "MANUAL_AGENT_REQUEST",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentChannel = "sms" | "whatsapp" | "email";

export type AgentEvent = {
  /** Stable id of the originating fact -- a message id, a webhook event id. */
  eventId: string;
  eventType: AgentEventType;
  businessId: string;
  leadId: string;
  conversationId: string | null;
  channel: AgentChannel | null;
  provider: string | null;
  occurredAt: string;
  /** The lead's own words, when the event carries any. Always untrusted. */
  text: string | null;
  /** Normalised extras (booking id, campaign id, ...). Never raw provider JSON. */
  payload: Record<string, unknown>;
  /**
   * Deduplication key for the whole turn. Two deliveries of the same provider
   * event produce the same key and therefore exactly one agent run.
   */
  idempotencyKey: string;
};

// ------------------------------------------------------------- lifecycle

/**
 * The agent's read-only view of where a lead is. These map onto the existing
 * `leads.status` / `leads.qualification_state` columns rather than adding a
 * parallel lifecycle -- see `resolveLifecycle` in ./lifecycle.ts.
 */
export const LIFECYCLE_STATES = [
  "NEW",
  "CONTACTED",
  "ENGAGED",
  "QUALIFYING",
  "QUALIFIED",
  "REVIEW",
  "NOT_QUALIFIED",
  "BOOKING_PENDING",
  "BOOKED",
  "HANDED_OVER",
  "WON",
  "LOST",
  "SUPPRESSED",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Which playbook the turn is running. Derived, never remembered in a prompt. */
export const AGENT_MODES = [
  "NEW_LEAD_RESPONSE",
  "QUALIFICATION",
  "GENERAL_ENQUIRY",
  "BOOKING_ASSISTANCE",
  "FOLLOW_UP",
  "REACTIVATION",
  "OBJECTION_HANDLING",
  "HUMAN_HANDOVER",
  "POST_BOOKING",
  "NO_RESPONSE",
  "CLOSED",
] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** Who is allowed to speak next on a conversation. */
export const CONVERSATION_OWNERS = [
  "AI_ACTIVE",
  "HUMAN_ACTIVE",
  "HANDED_OVER",
  "CLOSED",
] as const;
export type ConversationOwner = (typeof CONVERSATION_OWNERS)[number];

/** Workspace-level switch. OFF is the default for every workspace. */
export const AGENT_OPERATING_MODES = ["OFF", "SUGGEST_ONLY", "AUTO_REPLY"] as const;
export type AgentOperatingMode = (typeof AGENT_OPERATING_MODES)[number];

export const AGENT_OPERATING_MODE_LABEL: Record<AgentOperatingMode, string> = {
  OFF: "Off",
  SUGGEST_ONLY: "Suggest replies only",
  AUTO_REPLY: "Reply automatically",
};

// ----------------------------------------------------------------- intent

export const LEAD_INTENTS = [
  "SERVICE_ENQUIRY",
  "PRICE_ENQUIRY",
  "AVAILABILITY_ENQUIRY",
  "BOOKING_REQUEST",
  "BOOKING_CHANGE",
  "QUALIFICATION_RESPONSE",
  "GENERAL_QUESTION",
  "POSITIVE_REPLY",
  "NEGATIVE_REPLY",
  "OBJECTION",
  "NOT_INTERESTED",
  "UNSUBSCRIBE",
  "HUMAN_REQUEST",
  "COMPLAINT",
  "WRONG_NUMBER",
  "SPAM",
  "EMERGENCY",
  "EXISTING_CUSTOMER",
  "SUPPLIER_OR_NON_LEAD",
  "JOB_APPLICATION",
  "UNKNOWN",
] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

/** Coarser bucket persisted for analytics on follow-up and reactivation. */
export const REPLY_CLASSIFICATIONS = [
  "POSITIVE",
  "QUESTION",
  "OBJECTION",
  "BOOKING_INTENT",
  "NOT_INTERESTED",
  "UNSUBSCRIBE",
  "HUMAN_REQUEST",
  "WRONG_NUMBER",
  "COMPLAINT",
  "UNKNOWN",
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

const REPLY_BUCKET: Record<LeadIntent, ReplyClassification> = {
  SERVICE_ENQUIRY: "QUESTION",
  PRICE_ENQUIRY: "QUESTION",
  AVAILABILITY_ENQUIRY: "QUESTION",
  BOOKING_REQUEST: "BOOKING_INTENT",
  BOOKING_CHANGE: "BOOKING_INTENT",
  QUALIFICATION_RESPONSE: "POSITIVE",
  GENERAL_QUESTION: "QUESTION",
  POSITIVE_REPLY: "POSITIVE",
  NEGATIVE_REPLY: "NOT_INTERESTED",
  OBJECTION: "OBJECTION",
  NOT_INTERESTED: "NOT_INTERESTED",
  UNSUBSCRIBE: "UNSUBSCRIBE",
  HUMAN_REQUEST: "HUMAN_REQUEST",
  COMPLAINT: "COMPLAINT",
  WRONG_NUMBER: "WRONG_NUMBER",
  SPAM: "UNKNOWN",
  EMERGENCY: "HUMAN_REQUEST",
  EXISTING_CUSTOMER: "HUMAN_REQUEST",
  SUPPLIER_OR_NON_LEAD: "NOT_INTERESTED",
  JOB_APPLICATION: "NOT_INTERESTED",
  UNKNOWN: "UNKNOWN",
};

export function replyClassificationFor(intent: LeadIntent): ReplyClassification {
  return REPLY_BUCKET[intent];
}

// ------------------------------------------------------------------ risk

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Confidence policy. Numbers never reach a customer -- they only decide
 * whether the runtime acts, clarifies, or hands over. High-risk tools carry
 * their own higher floor on top of this.
 */
export const AGENT_CONFIDENCE = {
  /** Act on the interpretation without further checks. */
  ACT: 0.85,
  /** Below this, clarify or hand over rather than guess. */
  CLARIFY: 0.6,
  /** Floor for anything the policy engine classes HIGH risk. */
  HIGH_RISK: 0.9,
} as const;

export type ConfidenceDecision = "ACT" | "CLARIFY" | "HANDOVER";

export function confidenceDecision(
  confidence: number | null,
  risk: RiskLevel = "LOW",
): ConfidenceDecision {
  if (confidence === null) return "CLARIFY";
  const floor =
    risk === "HIGH" || risk === "CRITICAL"
      ? AGENT_CONFIDENCE.HIGH_RISK
      : AGENT_CONFIDENCE.ACT;
  if (confidence >= floor) return "ACT";
  if (confidence >= AGENT_CONFIDENCE.CLARIFY) return "CLARIFY";
  return "HANDOVER";
}

// -------------------------------------------------------------- outcomes

export const AGENT_OUTCOMES = [
  "NO_ACTION",
  "MESSAGE_SENT",
  "MESSAGE_QUEUED",
  "MESSAGE_DRAFTED",
  "QUALIFICATION_UPDATED",
  "BOOKING_CREATED",
  "BOOKING_OPTIONS_SENT",
  "HANDOVER_CREATED",
  "SUPPRESSED",
  "WAITING_FOR_USER",
  "FAILED",
] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

export const AGENT_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "HANDED_OVER",
  "SUPPRESSED",
  "SKIPPED",
  "FAILED",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** Customer-facing wording for the conversation activity feed. */
export const AGENT_OUTCOME_LABEL: Record<AgentOutcome, string> = {
  NO_ACTION: "No action needed",
  MESSAGE_SENT: "Assistant replied",
  MESSAGE_QUEUED: "Reply queued for quiet hours",
  MESSAGE_DRAFTED: "Reply drafted for review",
  QUALIFICATION_UPDATED: "Qualification updated",
  BOOKING_CREATED: "Booking created",
  BOOKING_OPTIONS_SENT: "Booking options sent",
  HANDOVER_CREATED: "Passed to the team",
  SUPPRESSED: "Contact opted out",
  WAITING_FOR_USER: "Waiting for a reply",
  FAILED: "Assistant could not complete this",
};

export const HANDOVER_REASONS = [
  "HUMAN_REQUESTED",
  "COMPLAINT",
  "LOW_CONFIDENCE",
  "QUALIFICATION_REVIEW",
  "PRICING_NOT_CONFIGURED",
  "OUT_OF_SCOPE",
  "PROVIDER_FAILURE",
  "TOOL_FAILURE",
  "MAX_STEPS_EXCEEDED",
  "POLICY",
  "EMERGENCY",
  "HIGH_VALUE",
  "NO_NEXT_QUESTION",
] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

export const HANDOVER_REASON_LABEL: Record<HandoverReason, string> = {
  HUMAN_REQUESTED: "The lead asked for a person",
  COMPLAINT: "The lead raised a complaint",
  LOW_CONFIDENCE: "The reply was too unclear to answer safely",
  QUALIFICATION_REVIEW: "Qualification needs a person to review",
  PRICING_NOT_CONFIGURED: "The lead asked about price and none is published",
  OUT_OF_SCOPE: "The question is outside what the assistant may answer",
  PROVIDER_FAILURE: "A connected provider was unavailable",
  TOOL_FAILURE: "An action could not be completed",
  MAX_STEPS_EXCEEDED: "The assistant could not resolve this in one turn",
  POLICY: "A workspace rule requires a person",
  EMERGENCY: "The lead described an emergency",
  HIGH_VALUE: "A high-value enquiry your rules route to a person",
  NO_NEXT_QUESTION: "There is no next qualification question configured",
};

export type HandoverPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export const HANDOVER_PRIORITY_FOR: Record<HandoverReason, HandoverPriority> = {
  HUMAN_REQUESTED: "HIGH",
  COMPLAINT: "URGENT",
  LOW_CONFIDENCE: "NORMAL",
  QUALIFICATION_REVIEW: "NORMAL",
  PRICING_NOT_CONFIGURED: "NORMAL",
  OUT_OF_SCOPE: "NORMAL",
  PROVIDER_FAILURE: "HIGH",
  TOOL_FAILURE: "HIGH",
  MAX_STEPS_EXCEEDED: "NORMAL",
  POLICY: "NORMAL",
  EMERGENCY: "URGENT",
  HIGH_VALUE: "HIGH",
  NO_NEXT_QUESTION: "NORMAL",
};

// ------------------------------------------------------------ model I/O

/**
 * The only shape the model is allowed to return. Everything in it is a
 * *proposal*: the policy engine validates each field before any of it turns
 * into an action, and `reasoning_code` is a short auditable token, never a
 * narration of the model's reasoning.
 */
export const agentDecisionSchema = z.object({
  intent: z.enum(LEAD_INTENTS).catch("UNKNOWN"),
  confidence: z.number().min(0).max(1),
  proposed_action: z
    .enum([
      "REPLY",
      "ASK_NEXT_QUESTION",
      "ANSWER_AND_ASK",
      "CHECK_AVAILABILITY",
      "SEND_BOOKING_OPTIONS",
      "REQUEST_HANDOVER",
      "NO_ACTION",
    ])
    .catch("NO_ACTION"),
  message: z.string().max(2000).nullable().default(null),
  extracted: z
    .array(
      z.object({
        field: z.string().max(64),
        value: z.string().max(400),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8)
    .default([]),
  handover_reason: z.enum(HANDOVER_REASONS).nullable().default(null),
  reasoning_code: z.string().max(80).default("UNSPECIFIED"),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export type ProposedAction = AgentDecision["proposed_action"];

// ------------------------------------------------------------- validation

/** Fields the runtime is willing to write back onto a lead. */
export const EXTRACTABLE_LEAD_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "postcode",
  "service",
] as const;
export type ExtractableLeadField = (typeof EXTRACTABLE_LEAD_FIELDS)[number];

export function isExtractableField(value: string): value is ExtractableLeadField {
  return (EXTRACTABLE_LEAD_FIELDS as readonly string[]).includes(value);
}

/** Per-channel outbound length guidance. */
export const CHANNEL_LIMITS: Record<AgentChannel, { preferred: number; hard: number }> = {
  sms: { preferred: 320, hard: 480 },
  whatsapp: { preferred: 600, hard: 900 },
  email: { preferred: 2000, hard: 4000 },
};

/** Hard ceiling on tool/model iterations in a single turn. */
export const MAX_AGENT_STEPS = 5;

/** How long one turn may hold a conversation lock before it is reapable. */
export const AGENT_TURN_LOCK_SECONDS = 120;

/**
 * Messages passed verbatim before the rolling summary takes over. Anything
 * older is represented by `conversation_summaries`.
 */
export const VERBATIM_MESSAGE_WINDOW = 8;
export const SUMMARY_TRIGGER_MESSAGE_COUNT = 14;

export type AgentActionStatus =
  | "OK"
  | "DENIED_PERMISSION"
  | "DENIED_POLICY"
  | "DENIED_BUDGET"
  | "DENIED_CONFIDENCE"
  | "ERROR"
  | "SKIPPED";
