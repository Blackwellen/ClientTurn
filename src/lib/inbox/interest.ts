/**
 * `conversations.interest`: the verdict the inbox's "Interested" view reads.
 *
 * Social replies wrote it from their own classifier; SMS, WhatsApp and email
 * replies are classified into the canonical `messages.reply_classification`
 * vocabulary and never reached the thread, so the Interested view only ever
 * showed social conversations. This maps the canonical classification onto the
 * interest vocabulary (the CHECK in migration 0095), once, for every channel.
 *
 * Pure: no `server-only`, no Supabase.
 */

import {
  classifyDeterministic,
  classifyHeuristic,
} from "../agent/classification.ts";
import {
  replyClassificationFor,
  toMessageReplyClassification,
  type MessageReplyClassification,
} from "../agent/types.ts";

/** Exactly `conversations_interest_check` (0095). */
export const CONVERSATION_INTERESTS = [
  "INTERESTED",
  "QUESTION",
  "OBJECTION",
  "NOT_NOW",
  "WRONG_PERSON",
  "OPT_OUT",
  "UNCLEAR",
] as const;

export type ConversationInterest = (typeof CONVERSATION_INTERESTS)[number];

/**
 * null means "this is not a reply from the person" (a bounce, an out-of-office)
 * and the thread's existing verdict is left alone rather than overwritten.
 */
const INTEREST_FOR: Record<MessageReplyClassification, ConversationInterest | null> = {
  POSITIVE_INTEREST: "INTERESTED",
  BOOKING_INTENT: "INTERESTED",
  NEUTRAL_QUESTION: "QUESTION",
  // Asking for a person is asking to be answered: it belongs in the view.
  HUMAN_REQUEST: "QUESTION",
  OBJECTION: "OBJECTION",
  NOT_INTERESTED: "OBJECTION",
  COMPLAINT: "OBJECTION",
  NOT_NOW: "NOT_NOW",
  WRONG_PERSON: "WRONG_PERSON",
  REFERRAL_TO_OTHER_PERSON: "WRONG_PERSON",
  UNSUBSCRIBE: "OPT_OUT",
  UNKNOWN: "UNCLEAR",
  BOUNCE: null,
  AUTO_RESPONSE: null,
};

export function interestForReplyClassification(
  classification: MessageReplyClassification | string | null | undefined,
): ConversationInterest | null {
  if (!classification) return null;
  return INTEREST_FOR[classification as MessageReplyClassification] ?? null;
}

/**
 * The canonical classification of a reply by the deterministic classifier
 * alone (no model), the same one campaign replies use. Used where no model
 * turn runs, so the verdict exists whether or not the assistant is on.
 */
export function deterministicReplyClassification(body: string): MessageReplyClassification {
  const verdict = classifyDeterministic(body) ?? classifyHeuristic(body);
  return toMessageReplyClassification(replyClassificationFor(verdict?.intent ?? "UNKNOWN"));
}
