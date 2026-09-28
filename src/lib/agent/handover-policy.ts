/**
 * The hand-over policy (owner decision 2026-09-27).
 *
 * "Human hand-over is the last resort of last resorts." The AI keeps the
 * conversation going and completes the sale (qualify, then book, check out or
 * sign up) whenever it lawfully and safely can. A person gets involved in one
 * of two ways (types.ts ESCALATION_KINDS):
 *
 *   HANDOVER        the conversation goes to a person and the AI stops. Only
 *                   for the triggers in HANDOVER_TRIGGERS below.
 *   ASSIST_REQUEST  a person confirms one fact or does one task in the
 *                   background and is notified; the AI keeps going.
 *
 * What does not change: the deterministic rules still decide the
 * qualification verdict, AI-inferred values never decide pass or fail, AI
 * never composes a binding promise, quote, availability or service-area claim
 * beyond approved facts and offers, and consent, opt-out, suppression and
 * quiet hours bind exactly as before (none of them pass through here).
 *
 * The orchestrator asks this module at three points of a turn, in order:
 *
 *   policyOnMessage   the lead's words, before the model;
 *   policyOnAnswer    the reply against the configured question, and the
 *                     deterministic verdict;
 *   policyOnDecision  the model's proposal.
 *
 * Plus `policyOnCompose` (validator rejections) and `assistAfterBooking`.
 * tests/golden-conversations/policy-harness.ts drives the same three stages
 * over the hand-over golden conversations.
 *
 * Pure: relative `.ts` imports, no server-only, no I/O.
 */

import { confidenceVerdictForTolerance, type AgentRiskTolerance, type AssistReason, type HandoverReason, type LeadIntent, type ProposedAction } from "./types.ts";
import { OBJECTIONS } from "../sales-library/objections.ts";
import type { ObjectionKey, SalesMotion } from "../sales-library/types.ts";
import type { QualificationResult } from "../qualification/engine.ts";

/* ================================================================ triggers */

/**
 * Every situation that still hands a conversation to a person. Nothing else
 * does. Each maps to the `agent_handoffs.reason` it is stored under (the
 * column's CHECK constraint is unchanged).
 */
export const HANDOVER_TRIGGERS = [
  /** The lead explicitly asks for a person. */
  "HUMAN_REQUESTED",
  /** A complaint or a legal threat (deterministic COMPLAINT verdict). */
  "COMPLAINT_OR_LEGAL_THREAT",
  /** An emergency, safety or safeguarding issue (EMERGENCY verdict). */
  "SAFEGUARDING",
  /** A data-rights or privacy request (access, erasure, a copy of their data). */
  "DATA_RIGHTS_REQUEST",
  /** A price or discount outside the approved offer card or policy, special terms, bespoke commitments. */
  "COMMERCIAL_COMMITMENT",
  /** A legal, regulatory or contract-terms question (COMPLIANCE / CONTRACT objections). */
  "LEGAL_OR_CONTRACT_QUESTION",
  /** A compliance or policy block the AI cannot resolve (e.g. confirming a suppression). */
  "POLICY_BLOCK",
  /** A rule the workspace configured itself: hand-over on review, offer hand-off rules, escalation conditions, the qualify-only goal. */
  "WORKSPACE_RULE",
  /** No usable answer after MAX_CLARIFICATIONS clarifying questions on the same point. */
  "REPEATED_CLARIFICATION_FAILURE",
  /** The validator rejected MAX_VALIDATOR_REJECTIONS drafts in one turn. */
  "VALIDATOR_REJECTED",
  /** A booking or checkout provider failure that cannot be retried. */
  "PROVIDER_FAILURE",
  /** The model returned nothing usable and there is no deterministic way to continue. */
  "MODEL_UNAVAILABLE",
  /** The budget manager decided a person should answer (AI spend cap). */
  "BUDGET_EXCEEDED",
] as const;
export type HandoverTrigger = (typeof HANDOVER_TRIGGERS)[number];

export const HANDOVER_TRIGGER_REASON: Record<HandoverTrigger, HandoverReason> = {
  HUMAN_REQUESTED: "HUMAN_REQUESTED",
  COMPLAINT_OR_LEGAL_THREAT: "COMPLAINT",
  SAFEGUARDING: "EMERGENCY",
  DATA_RIGHTS_REQUEST: "POLICY",
  COMMERCIAL_COMMITMENT: "POLICY",
  LEGAL_OR_CONTRACT_QUESTION: "POLICY",
  POLICY_BLOCK: "POLICY",
  WORKSPACE_RULE: "POLICY",
  REPEATED_CLARIFICATION_FAILURE: "LOW_CONFIDENCE",
  VALIDATOR_REJECTED: "OUT_OF_SCOPE",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
  MODEL_UNAVAILABLE: "LOW_CONFIDENCE",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
};

/**
 * The situations that used to hand over and now keep the AI going, with or
 * without a background assist. Documentation, and the report's inventory.
 */
export const ASSIST_TRIGGERS = [
  "LOW_CONFIDENCE",
  "UNMATCHED_ANSWER",
  "QUALIFICATION_REVIEW",
  "ENTERPRISE_OR_HIGH_VALUE_CLOSE",
  "READY_TO_BUY_WITHOUT_DIRECT_CLOSE",
  "SECURITY_OR_PROCUREMENT_OBJECTION",
  "UNKNOWN_QUESTION",
  "PRICE_NOT_PUBLISHED",
  "NO_NEXT_QUESTION",
  "NO_CALENDAR_AVAILABILITY",
] as const;

/** Clarifying questions on the same point before a hand-over. */
export const MAX_CLARIFICATIONS = 2;

/** Drafts the validator may reject in one turn before a hand-over. */
export const MAX_VALIDATOR_REJECTIONS = 3;

/* ================================================================ decisions */

export type ClarificationState = { point: string; attempt: number } | null;

export type PolicyDecision =
  | { kind: "HANDOVER"; trigger: HandoverTrigger; reason: HandoverReason; detail: string }
  | { kind: "CLARIFY"; point: string; attempt: 1 | 2 }
  | {
      kind: "CONTINUE";
      assist: AssistReason | null;
      detail: string | null;
      /** The lead asked for a discount this turn: the AI answers within the approved maximum. */
      discount?: DiscountAsk | null;
      /** The lead asked whether they are talking to a bot: answer honestly and carry on. */
      disclose?: boolean;
    };

const CONTINUE: PolicyDecision = { kind: "CONTINUE", assist: null, detail: null };

function handover(trigger: HandoverTrigger, detail: string, reason?: HandoverReason): PolicyDecision {
  return { kind: "HANDOVER", trigger, reason: reason ?? HANDOVER_TRIGGER_REASON[trigger], detail };
}

function assist(reason: AssistReason, detail: string): PolicyDecision {
  return { kind: "CONTINUE", assist: reason, detail };
}

/**
 * The next clarification on `point`, or the hand-over when the lead has
 * already been asked MAX_CLARIFICATIONS times. `previous` is the clarification
 * the last turn on this conversation made (a turn that was not a
 * clarification resets the chain); a different point starts at 1.
 */
export function nextClarification(previous: ClarificationState, point: string): PolicyDecision {
  const attempt = previous && previous.point === point ? previous.attempt + 1 : 1;
  if (attempt > MAX_CLARIFICATIONS) {
    return handover(
      "REPEATED_CLARIFICATION_FAILURE",
      `No usable answer after ${MAX_CLARIFICATIONS} clarifying questions.`,
    );
  }
  return { kind: "CLARIFY", point, attempt: attempt as 1 | 2 };
}

/* ---------------------------------------------------------- binding verdicts */

/** The deterministic verdicts that still hand over; null for the rest (opt-out, wrong number, not a lead have their own rules). */
export function bindingDisposition(intent: LeadIntent): PolicyDecision | null {
  switch (intent) {
    case "HUMAN_REQUEST":
      return handover("HUMAN_REQUESTED", "The lead asked for a person.");
    case "COMPLAINT":
      return handover("COMPLAINT_OR_LEGAL_THREAT", "The lead raised a complaint or a legal threat.");
    case "EMERGENCY":
      return handover("SAFEGUARDING", "The lead described an emergency.");
    default:
      return null;
  }
}

/* ------------------------------------------------------------- detectors */

const DATA_RIGHTS_PATTERNS: RegExp[] = [
  /\bsubject access request\b/i,
  /\bdata subject (access )?request\b/i,
  /\bright to (be forgotten|erasure|access)\b/i,
  /\bright of access\b/i,
  /\b(gdpr|data protection) request\b/i,
  /\b(copy|copies) of (all )?(the |my |our )?(personal )?(data|information)\b/i,
  /\bwhat (personal )?(data|information) (do )?you (hold|have|store|keep) (on|about) (me|us)\b/i,
  /\b(all )?(the )?personal data you (hold|have|store|keep)\b/i,
  /\berase (all )?(of )?(my|our) (personal )?(data|information|details)\b/i,
];

/** A data-rights or privacy request (access, erasure, a copy of their data). */
export function detectDataRightsRequest(text: string | null | undefined): boolean {
  const input = (text ?? "").slice(0, 2000);
  return DATA_RIGHTS_PATTERNS.some((pattern) => pattern.test(input));
}

const DISCOUNT_ENQUIRY = /\bdo you (offer|have|do|give) (any )?(discounts?|deals?|offers?)\b/i;
const DISCOUNT_REQUEST: RegExp[] = [
  /\b\d{1,3}\s?%\s?(off|discount)\b/i,
  /\bknock\b[^.?!]{0,40}\boff\b/i,
  /\btake\b[^.?!]{0,30}\boff (the )?(price|total|quote|invoice)\b/i,
  // "We need a better price" and "that's too expensive" are price objections
  // the AI handles with the playbook, not discount demands (owner decision
  // 2026-09-27): only an explicit ask for a discount or money off counts.
  /\b(give|do|offer|get|want|need|expect|approved?|agree|throw in|find)\b[^.?!]{0,20}\b(a |any |some )?(discount|money off)\b/i,
  /\bprice[- ]match\b/i,
  /\bmatch (their|the other|that|a competitor'?s?) (price|quote|offer)\b/i,
  /\bmates'? rates\b/i,
];

/**
 * A request for a discount or a price concession, with the percentage when
 * the lead names one. A plain enquiry ("do you offer discounts?") is not a
 * request: the AI answers it from approved data or asks a colleague.
 */
export function detectDiscountRequest(text: string | null | undefined): { percent: number | null } | null {
  const input = (text ?? "").slice(0, 2000);
  if (!input.trim() || DISCOUNT_ENQUIRY.test(input)) return null;
  if (!DISCOUNT_REQUEST.some((pattern) => pattern.test(input))) return null;
  const percent = /(\d{1,3})\s?%/.exec(input);
  return { percent: percent ? Number(percent[1]) : null };
}

const TERMS_REQUEST: RegExp[] = [
  /\b(bespoke|custom|special|different|revised|amended|non-standard) (contract|terms|t&cs?|pricing terms|payment terms|sla)\b/i,
  /\b(payment|credit) terms\b/i,
  /\bnet[- ]?(30|45|60|90)\b/i,
  /\b(change|amend|redline|negotiate|rewrite) (the |your |our )?(contract|terms|t&cs?)\b/i,
];

/** A request for bespoke contract or price terms: a commitment only a person can make. */
export function detectTermsRequest(text: string | null | undefined): boolean {
  const input = (text ?? "").slice(0, 2000);
  return TERMS_REQUEST.some((pattern) => pattern.test(input));
}

const INSISTENCE = /\b(or nothing|final offer|take it or leave it|not good enough|that'?s not enough|no deal|best you can do|still too (much|high|expensive))\b/i;

/** A discount the lead asked for, against what the workspace approved. */
export type DiscountAsk = {
  /** The percentage the lead named; null when they named none. */
  percent: number | null;
  /** The approved maximum (0 = no discount approved). */
  maxPercent: number;
  withinPolicy: boolean;
};

/** The reply asks something rather than answering. */
export function replyAsksQuestion(text: string | null | undefined): boolean {
  const input = (text ?? "").trim();
  if (!input) return false;
  return input.includes("?") || /^(how|what|when|where|why|who|which|can|could|do|does|is|are|will|would)\b/i.test(input);
}

/* ---------------------------------------------------------- the three stages */

export type MessagePolicyInput = {
  text: string | null;
  /** classifyDeterministic's intent, when it returned a binding verdict. */
  bindingIntent: LeadIntent | null;
  /** Every objection playbook the lead's words match (matchObjection), primary first. */
  objectionKeys: readonly ObjectionKey[];
  /** The workspace's direct-close authority; null = none configured. */
  commercial: { enabled: boolean; maxDiscountPercent: number } | null;
  /**
   * The previous turn on this conversation was an out-of-policy discount ask
   * the AI already answered. A second one (or insisting) hands over.
   */
  previousDiscountDemand?: boolean;
  /** The lead asked whether they are talking to a person (classification.ts isBotQuestion). */
  botQuestion?: boolean;
};

/** Stage 1: the lead's words, before any model call. */
export function policyOnMessage(input: MessagePolicyInput): PolicyDecision {
  if (input.bindingIntent) {
    const binding = bindingDisposition(input.bindingIntent);
    if (binding) return binding;
  }
  if (detectDataRightsRequest(input.text)) {
    return handover("DATA_RIGHTS_REQUEST", "The lead made a data-rights request.");
  }
  if (detectTermsRequest(input.text)) {
    return handover("COMMERCIAL_COMMITMENT", "The lead asked for bespoke contract or price terms.");
  }
  // Discounts are a two-step rule (owner decision 2026-09-27): the first ask
  // beyond what is approved is answered by the AI (what it can offer, the
  // value, the scope options); insisting after that answer hands over.
  let discountAsk: DiscountAsk | null = null;
  const discount = detectDiscountRequest(input.text);
  if (discount) {
    const authority = input.commercial;
    const max = authority?.enabled ? Math.max(0, authority.maxDiscountPercent) : 0;
    const within = discount.percent === null ? max > 0 : discount.percent <= max;
    discountAsk = { percent: discount.percent, maxPercent: max, withinPolicy: within };
  }
  const insisting =
    input.previousDiscountDemand === true && ((discountAsk !== null && !discountAsk.withinPolicy) || INSISTENCE.test(input.text ?? ""));
  if (insisting) {
    return handover(
      "COMMERCIAL_COMMITMENT",
      discountAsk?.percent
        ? `The lead insists on ${discountAsk.percent}% off, above the approved maximum of ${discountAsk.maxPercent}%, after the assistant answered.`
        : "The lead insists on a discount the approved offer does not allow, after the assistant answered.",
    );
  }
  // Any legal or contract question in the message hands over, even beside a
  // specialist one ("your security questionnaire and a DPA").
  const entries = input.objectionKeys.map((key) => OBJECTIONS[key]);
  const legal = entries.find((entry) => entry.handover.always);
  if (legal) {
    return handover("LEGAL_OR_CONTRACT_QUESTION", `The lead raised a ${legal.label.toLowerCase()} question that a person must answer.`);
  }
  const specialist = entries.find((entry) => entry.assist?.always);
  const base = specialist
    ? assist("SPECIALIST_REVIEW", `The lead raised a ${specialist.label.toLowerCase()} step; a colleague provides it.`)
    : CONTINUE;
  if (!discountAsk && !input.botQuestion) return base;
  return { ...(base as Extract<PolicyDecision, { kind: "CONTINUE" }>), discount: discountAsk, disclose: input.botQuestion === true };
}

/**
 * The one strategy line for a discount ask: what the AI may offer. It never
 * agrees to more than the approved maximum (the validator refuses it too).
 */
export function discountGuidance(ask: DiscountAsk): string {
  if (ask.withinPolicy) {
    return `They asked for a discount. You may offer at most ${ask.maxPercent}%, only through the approved offer, and never more.`;
  }
  if (ask.maxPercent > 0) {
    return (
      `They asked for more than the approved discount. Offer at most ${ask.maxPercent}%, explain the value and any ` +
      "scope options from the offer card, and do not agree to more. Do not hand over."
    );
  }
  return (
    "No discount is approved. Do not offer one: explain warmly what is included, the value and any scope options " +
    "from the offer card. Do not hand over."
  );
}

/** The one strategy line for "are you a bot?": honest, and the conversation carries on. */
export function disclosureGuidance(businessName: string | null): string {
  const who = businessName?.trim() ? `${businessName.trim()}'s AI assistant` : "the business's AI assistant";
  return (
    `They asked whether they are talking to a person. Say plainly that you are ${who} and that a person from the ` +
    "team can join if they would like, then carry on with the plan. Never claim or imply to be human. Do not hand " +
    "over unless they ask for a person."
  );
}

export type AnswerPolicyInput = {
  text: string | null;
  /** The reply read against the configured question just asked; null when none was. */
  answer: { questionId: string; matched: boolean; structured: boolean } | null;
  /** The deterministic verdict after the reply was recorded; null when unchanged. */
  verdict: { result: QualificationResult; reasons: { code: string; questionId?: string }[] } | null;
  /** business_ai_settings.agent_handover_on_review: an explicit workspace opt-in. */
  handoverOnReview: boolean;
  previousClarification: ClarificationState;
};

const UNMATCHED_CODES = new Set(["answer_unmatched", "rule_unevaluable"]);

/**
 * Stage 2: the reply against the configured question, and the deterministic
 * verdict. An unusable answer is clarified (twice at most); a REVIEW verdict
 * is recorded and flagged for a person, and the AI carries on. The verdict
 * itself is never changed here: the rules decide it.
 */
export function policyOnAnswer(input: AnswerPolicyInput): PolicyDecision {
  const answer = input.answer;
  const asking = replyAsksQuestion(input.text);
  const unmatchedOnQuestion =
    answer !== null &&
    answer.structured &&
    !asking &&
    (!answer.matched ||
      (input.verdict?.reasons ?? []).some((r) => UNMATCHED_CODES.has(r.code) && r.questionId === answer.questionId));

  if (input.verdict?.result === "REVIEW" && input.handoverOnReview) {
    return handover("WORKSPACE_RULE", "The workspace hands a REVIEW result to a person.", "QUALIFICATION_REVIEW");
  }
  if (unmatchedOnQuestion) {
    return nextClarification(input.previousClarification, `question:${answer!.questionId}`);
  }
  if (input.verdict?.result === "REVIEW") {
    return assist("QUALIFICATION_REVIEW", "The qualification rules returned REVIEW; a person checks it in the background.");
  }
  return CONTINUE;
}

export type DecisionPolicyInput = {
  proposedAction: ProposedAction;
  handoverReason: HandoverReason | null;
  confidence: number | null;
  riskTolerance: AgentRiskTolerance | null | undefined;
  previousClarification: ClarificationState;
};

/** The model hand-over reasons honoured as a hand-over; every other one becomes an assist. */
const MODEL_HANDOVER: Partial<Record<HandoverReason, HandoverTrigger>> = {
  HUMAN_REQUESTED: "HUMAN_REQUESTED",
  COMPLAINT: "COMPLAINT_OR_LEGAL_THREAT",
  EMERGENCY: "SAFEGUARDING",
  POLICY: "POLICY_BLOCK",
};

const MODEL_ASSIST: Partial<Record<HandoverReason, AssistReason>> = {
  PRICING_NOT_CONFIGURED: "CONFIRM_PRICE",
  READY_TO_BUY: "SEND_ORDER_DETAILS",
  QUALIFICATION_REVIEW: "QUALIFICATION_REVIEW",
};

/**
 * Stage 3: the model's proposal. A reply it could not read is clarified; a
 * hand-over it proposes is honoured only for a last resort, otherwise a
 * colleague is asked to confirm the detail in the background and the AI
 * carries on.
 */
export function policyOnDecision(input: DecisionPolicyInput): PolicyDecision {
  if (confidenceVerdictForTolerance(input.confidence, input.riskTolerance) === "UNCLEAR") {
    return nextClarification(input.previousClarification, "reply");
  }
  if (input.proposedAction === "REQUEST_HANDOVER") {
    const reason = input.handoverReason;
    const trigger = reason ? MODEL_HANDOVER[reason] : undefined;
    if (trigger && reason) return handover(trigger, "The assistant judged this needs a person.", reason);
    return assist(
      (reason && MODEL_ASSIST[reason]) || "CONFIRM_DETAIL",
      "The assistant asked a colleague to confirm a detail and carried on.",
    );
  }
  return CONTINUE;
}

/** After `rejections` validator rejections in this turn: draft again, or hand over. */
export function policyOnCompose(rejections: number): "RETRY" | "HANDOVER" {
  return rejections >= MAX_VALIDATOR_REJECTIONS ? "HANDOVER" : "RETRY";
}

/**
 * A booked meeting that closes through a person (the ENTERPRISE motion, or
 * goal E) carries the hand-off brief: the meeting is the hand-off.
 */
export function assistAfterBooking(input: { motion: SalesMotion | null; goal: string | null }): AssistReason | null {
  return input.motion === "ENTERPRISE" || input.goal === "E_HUMAN_CLOSER" ? "MEETING_BRIEF" : null;
}

/* ================================================================ wording */

export type ClarifiedQuestion = {
  questionText: string;
  responseType: string;
  options: { label: string; value: string }[];
};

function listOf(labels: string[]): string {
  const items = labels.map((label) => label.trim()).filter(Boolean).slice(0, 5);
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function asQuestion(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return /[?]$/.test(clean) ? clean : `${clean.replace(/[.!]+$/, "")}?`;
}

/**
 * The fixed clarifying question: deterministic, no model call, one question,
 * and the second attempt worded differently from the first so it never reads
 * as a repeat. With options, the options are named so the lead can pick one.
 */
export function clarifyingQuestion(input: { question: ClarifiedQuestion | null; attempt: 1 | 2; firstName: string | null }): string {
  const name = input.firstName?.trim() ? `, ${input.firstName.trim()}` : "";
  const question = input.question;
  if (!question) {
    return input.attempt === 1
      ? `Sorry${name}, I want to make sure I understand. Could you tell me a little more about what you need?`
      : `Thanks for bearing with me${name}. In a sentence, what would you like help with?`;
  }
  const options = listOf(question.options.map((option) => option.label || option.value));
  if (options) {
    return input.attempt === 1
      ? `Sorry${name}, I did not quite catch that. ${asQuestion(question.questionText)} For example: ${options}.`
      : `Sorry to ask again${name}. Which of these is closest: ${options}?`;
  }
  if (question.responseType === "number") {
    return input.attempt === 1
      ? `Sorry${name}, I did not quite catch that. ${asQuestion(question.questionText)} A rough number is fine.`
      : `Sorry to ask again${name}. Roughly what number would you put on it?`;
  }
  return input.attempt === 1
    ? `Sorry${name}, I did not quite catch that. ${asQuestion(question.questionText)}`
    : `Sorry to ask again${name}. Could you put it another way, in a few words?`;
}

/**
 * The fixed line sent when an assist is raised and the model has nothing
 * usable to say. It promises a colleague, never a time, a price or an outcome.
 */
export function assistLine(reason: AssistReason, firstName: string | null): string {
  const thanks = firstName?.trim() ? `Thanks ${firstName.trim()}. ` : "Thanks. ";
  switch (reason) {
    case "QUALIFICATION_REVIEW":
      return `${thanks}I have asked a colleague to take a look at that, and I can help with anything else in the meantime.`;
    case "CONFIRM_DETAIL":
      return `${thanks}Good question. I have asked a colleague to confirm that detail, and I can help with anything else in the meantime.`;
    case "CONFIRM_PRICE":
      return `${thanks}Pricing depends on the details, so I have asked a colleague to confirm it for you.`;
    case "SPECIALIST_REVIEW":
      return `${thanks}I have asked a colleague to send that information over.`;
    case "SEND_ORDER_DETAILS":
      return `${thanks}Great. I have asked a colleague to send over the details to get you started.`;
    case "ARRANGE_TIME":
      return "I could not find anything free in the next couple of weeks, so I have asked a colleague to arrange a time with you.";
    case "MEETING_BRIEF":
      return `${thanks}I have passed everything you told me to the colleague you are meeting, so you will not need to repeat it.`;
    case "QUOTE_REVIEW":
      return `${thanks}Your quote is with a colleague for a final check, and it will come over to you once it is ready.`;
  }
}
