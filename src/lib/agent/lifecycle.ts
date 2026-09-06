/**
 * Lifecycle and mode resolution.
 *
 * Pure derivation. The agent never stores a lifecycle of its own and never
 * mutates one: `LifecycleState` is a read-only projection of the columns that
 * already exist (`leads.status`, `leads.qualification_state`, `leads.opted_out`,
 * `leads.human_takeover`, `conversations.owner`) plus whether a live booking
 * exists. Status transitions remain the job of the deterministic services that
 * already own them -- the qualification engine, the booking sync, the send
 * pipeline.
 */

import type {
  AgentEventType,
  AgentMode,
  ConversationOwner,
  LeadIntent,
  LifecycleState,
} from "./types.ts";

export type LifecycleInput = {
  /** leads.status: NEW | CONTACTED | RESPONDED | QUALIFIED | BOOKED | WON | LOST */
  status: string;
  /** leads.qualification_state: PENDING | QUALIFIED | NOT_QUALIFIED | REVIEW */
  qualificationState: string;
  optedOut: boolean;
  humanTakeover: boolean;
  conversationOwner: ConversationOwner;
  hasLiveBooking: boolean;
  hasReplied: boolean;
  /** True while at least one required question is still unanswered. */
  hasOutstandingQuestions: boolean;
};

/**
 * Precedence matters more than completeness here. Suppression beats
 * everything; human ownership beats every sales state; a real booking beats
 * an inferred qualification state.
 */
export function resolveLifecycle(input: LifecycleInput): LifecycleState {
  if (input.optedOut) return "SUPPRESSED";
  if (input.status === "WON") return "WON";
  if (input.status === "LOST") return "LOST";

  if (
    input.humanTakeover ||
    input.conversationOwner === "HUMAN_ACTIVE" ||
    input.conversationOwner === "HANDED_OVER"
  ) {
    return "HANDED_OVER";
  }

  if (input.status === "BOOKED" || input.hasLiveBooking) return "BOOKED";

  if (input.qualificationState === "NOT_QUALIFIED") return "NOT_QUALIFIED";
  if (input.qualificationState === "REVIEW") return "REVIEW";

  if (input.qualificationState === "QUALIFIED" || input.status === "QUALIFIED") {
    // Qualified with nothing booked yet is the moment booking help is useful.
    return "BOOKING_PENDING";
  }

  if (input.hasOutstandingQuestions && input.hasReplied) return "QUALIFYING";
  if (input.hasReplied || input.status === "RESPONDED") return "ENGAGED";
  if (input.status === "CONTACTED") return "CONTACTED";
  return "NEW";
}

export type ModeInput = {
  lifecycle: LifecycleState;
  eventType: AgentEventType;
  intent: LeadIntent;
  hasOutstandingQuestions: boolean;
  bookingEnabled: boolean;
};

/**
 * Which playbook this turn runs. Terminal and ownership states win outright;
 * otherwise the lead's own intent picks the mode, and only when the intent is
 * neutral does the lifecycle decide.
 */
export function resolveMode(input: ModeInput): AgentMode {
  const { lifecycle, intent, eventType } = input;

  if (lifecycle === "SUPPRESSED") return "CLOSED";
  if (lifecycle === "HANDED_OVER") return "HUMAN_HANDOVER";
  if (lifecycle === "WON" || lifecycle === "LOST" || lifecycle === "NOT_QUALIFIED") {
    return "CLOSED";
  }

  // Intents that override whatever stage the lead is at.
  if (intent === "UNSUBSCRIBE") return "CLOSED";
  if (
    intent === "HUMAN_REQUEST" ||
    intent === "COMPLAINT" ||
    intent === "EMERGENCY" ||
    intent === "WRONG_NUMBER" ||
    intent === "EXISTING_CUSTOMER"
  ) {
    return "HUMAN_HANDOVER";
  }
  if (intent === "OBJECTION" || intent === "NOT_INTERESTED") return "OBJECTION_HANDLING";

  if (lifecycle === "BOOKED") {
    return intent === "BOOKING_CHANGE" ? "BOOKING_ASSISTANCE" : "POST_BOOKING";
  }

  if (intent === "BOOKING_REQUEST" || intent === "BOOKING_CHANGE" || intent === "AVAILABILITY_ENQUIRY") {
    return input.bookingEnabled ? "BOOKING_ASSISTANCE" : "HUMAN_HANDOVER";
  }

  if (lifecycle === "REVIEW") return "HUMAN_HANDOVER";
  if (lifecycle === "BOOKING_PENDING") {
    return input.bookingEnabled ? "BOOKING_ASSISTANCE" : "HUMAN_HANDOVER";
  }

  if (eventType === "REACTIVATION_REPLY") return "REACTIVATION";
  if (eventType === "FOLLOW_UP_DUE") return "FOLLOW_UP";

  if (intent === "PRICE_ENQUIRY" || intent === "GENERAL_QUESTION" || intent === "SERVICE_ENQUIRY") {
    // A question mid-qualification is answered, then qualification resumes --
    // the composer handles both halves in one reply.
    return input.hasOutstandingQuestions ? "QUALIFICATION" : "GENERAL_ENQUIRY";
  }

  if (input.hasOutstandingQuestions) return "QUALIFICATION";
  if (lifecycle === "NEW" || lifecycle === "CONTACTED") return "NEW_LEAD_RESPONSE";

  return "GENERAL_ENQUIRY";
}

/**
 * Modes in which the agent has nothing useful or permitted to say. The
 * orchestrator stops before generation rather than producing a reply the
 * policy engine would only reject.
 */
export function modeIsSilent(mode: AgentMode): boolean {
  return mode === "CLOSED" || mode === "NO_RESPONSE";
}
