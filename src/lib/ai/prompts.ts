import { RUNTIME_SYSTEM_PREAMBLE } from "./safety";
import type { TaskType } from "./schemas";

/**
 * System-prompt bodies keyed by task. Nano tasks are terse and
 * structured-only; Mini tasks carry the full runtime preamble from
 * safety.ts. Business/conversation context is appended by context-builder.ts
 * as a separate section, never interpolated into these strings.
 */

export const PROMPT_BODIES: Record<TaskType, string> = {
  intent_classification:
    "Classify the customer's SMS/WhatsApp reply to a UK home-service business. " +
    'Respond with JSON only: {"intent": one of ' +
    '["SERVICE_ENQUIRY","QUESTION","BOOKING","HUMAN_REQUEST","OPT_OUT","UNKNOWN"], ' +
    '"service_id": string|null, "confidence": 0..1, "requires_human": boolean}. ' +
    'Use "UNKNOWN" when genuinely unclear. Never explain.',

  answer_extraction:
    "Extract the answer to one already-configured qualification question from " +
    "a customer's reply. Never guess and never infer beyond what the reply " +
    "states. If a set of options is supplied, the value must be exactly one " +
    "of them or null. " +
    'Respond with JSON only: {"question_id": string, "normalized_value": ' +
    'string|null, "matched_option_id": string|null, "confidence": 0..1, ' +
    '"requires_review": boolean}.',

  reply_generation:
    `${RUNTIME_SYSTEM_PREAMBLE}\n\n` +
    'Respond with JSON only: {"response_type": one of ' +
    '["ANSWER","ASK_NEXT_QUESTION","SEND_BOOKING_LINK","HANDOVER","NO_SEND"], ' +
    '"message": string, "reason": string, "requires_human": boolean}.',

  conversation_summary:
    "Summarize this lead conversation for a business owner picking it up cold. " +
    "Be factual and concise; do not invent anything not present in the messages. " +
    'Respond with JSON only: {"summary": string, "key_points": string[]}.',

  handover_reasoning:
    `${RUNTIME_SYSTEM_PREAMBLE}\n\n` +
    "The lead may need human handover. Decide whether to hand over and why. " +
    'Respond with JSON only: {"response_type": one of ' +
    '["ANSWER","ASK_NEXT_QUESTION","SEND_BOOKING_LINK","HANDOVER","NO_SEND"], ' +
    '"message": string, "reason": string, "requires_human": boolean}.',

  reactivation_copy:
    `${RUNTIME_SYSTEM_PREAMBLE}\n\n` +
    "Personalize this reactivation outreach message using only the supplied " +
    'merge context. Respond with JSON only: {"message": string}.',
};
