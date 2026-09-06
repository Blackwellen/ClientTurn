/**
 * Deterministic reply classification.
 *
 * Pure functions, no I/O, no model. This layer runs BEFORE the model on every
 * inbound message and its verdicts are binding: an opt-out, a wrong number, a
 * complaint or an explicit request for a person is decided here and the model
 * never gets the chance to argue with it.
 *
 * The model's classifier (see ./intent.ts) only fills in the cases this file
 * returns null for, and its answer is advisory -- it selects a conversational
 * approach, it does not unlock an action.
 */

import type { LeadIntent } from "./types.ts";

function normalise(body: string): string {
  return body
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Keep apostrophes so "don't" survives; drop other punctuation.
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Matches a phrase as whole words, so "stop" does not fire inside "stopcock". */
function hasPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(haystack);
}

function hasAny(haystack: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => hasPhrase(haystack, phrase));
}

/**
 * Opt-out phrases beyond the single-word carrier keywords that
 * `messaging/types.ts#isOptOutKeyword` already handles. Deliberately
 * conservative: every entry here is an unambiguous instruction to stop, so a
 * false positive costs a lead but never an unlawful message.
 */
const OPT_OUT_PHRASES = [
  "unsubscribe",
  "unsubscribe me",
  "remove me",
  "take me off",
  "take me off your list",
  "delete my details",
  "delete my data",
  "do not contact me",
  "don't contact me",
  "dont contact me",
  "do not contact me again",
  "do not message me",
  "don't message me",
  "dont message me",
  "do not text me",
  "don't text me",
  "dont text me",
  "do not call me",
  "don't call me",
  "dont call me",
  "stop messaging me",
  "stop texting me",
  "stop contacting me",
  "stop calling me",
  "leave me alone",
  "no more messages",
  "no more texts",
  "opt me out",
  "opt out",
] as const;

const WRONG_NUMBER_PHRASES = [
  "wrong number",
  "wrong person",
  "you have the wrong number",
  "this is not my number",
  "who is this",
  "who's this",
  "i think you have the wrong",
  "never contacted you",
  "i did not enquire",
  "i didn't enquire",
  "i didnt enquire",
  "i never enquired",
] as const;

const HUMAN_REQUEST_PHRASES = [
  "speak to a human",
  "speak to a person",
  "talk to a human",
  "talk to a person",
  "talk to someone",
  "speak to someone",
  "speak to a real person",
  "real person",
  "call me",
  "give me a call",
  "can someone call me",
  "phone me",
  "ring me",
  "put me through",
  "speak to the manager",
  "speak to the owner",
  "is this a bot",
  "are you a bot",
  "are you a robot",
  "am i talking to a robot",
] as const;

const COMPLAINT_PHRASES = [
  "complaint",
  "complain",
  "make a complaint",
  "unacceptable",
  "appalling",
  "disgusting",
  "terrible service",
  "awful service",
  "worst service",
  "i want a refund",
  "refund",
  "trading standards",
  "ombudsman",
  "citizens advice",
  "legal action",
  "solicitor",
  "take you to court",
  "report you",
  "scam",
  "scammers",
  "fraud",
  "ripped me off",
] as const;

const EMERGENCY_PHRASES = [
  "emergency",
  "urgent leak",
  "flooding",
  "flooded",
  "gas leak",
  "smell gas",
  "smell of gas",
  "carbon monoxide",
  "fire",
  "no heating and",
  "burst pipe",
  "water pouring",
  "ceiling collapsed",
  "electric shock",
  "sparking",
] as const;

const BOOKING_PHRASES = [
  "book me in",
  "book it in",
  "book me",
  "can i book",
  "id like to book",
  "i'd like to book",
  "want to book",
  "book an appointment",
  "make an appointment",
  "come round",
  "come out",
  "when can you come",
  "when can someone come",
  "send someone",
] as const;

const BOOKING_CHANGE_PHRASES = [
  "reschedule",
  "rearrange",
  "move my appointment",
  "change my appointment",
  "change the time",
  "cancel my appointment",
  "cancel my booking",
  "cancel the booking",
  "can we move it",
] as const;

const PRICE_PHRASES = [
  "how much",
  "what's the cost",
  "whats the cost",
  "what is the cost",
  "what does it cost",
  "price",
  "pricing",
  "quote",
  "estimate",
  "ballpark",
  "rough idea of cost",
  "cost me",
  "charge",
  "how much do you charge",
] as const;

const AVAILABILITY_PHRASES = [
  "are you available",
  "what times",
  "what time",
  "when are you free",
  "any availability",
  "availability",
  "what days",
  "how soon",
  "earliest you can",
  "next available",
] as const;

const NOT_INTERESTED_PHRASES = [
  "not interested",
  "no thanks",
  "no thank you",
  "not right now",
  "not at the moment",
  "sorted it",
  "already sorted",
  "got it sorted",
  "found someone else",
  "gone with someone else",
  "went with someone else",
  "changed my mind",
  "no longer need",
  "dont need it anymore",
  "don't need it anymore",
] as const;

const OBJECTION_PHRASES = [
  "too expensive",
  "too much",
  "cant afford",
  "can't afford",
  "out of my budget",
  "just looking",
  "just browsing",
  "need to think about it",
  "think about it",
  "getting other quotes",
  "other quotes",
  "shopping around",
  "not ready yet",
  "need to speak to my",
  "ask my husband",
  "ask my wife",
  "ask my partner",
] as const;

const JOB_APPLICATION_PHRASES = [
  "looking for work",
  "any vacancies",
  "job vacancy",
  "are you hiring",
  "apply for a job",
  "send my cv",
  "my cv",
  "looking for a job",
] as const;

const SUPPLIER_PHRASES = [
  "seo services",
  "improve your website",
  "rank your website",
  "digital marketing agency",
  "we can generate leads",
  "increase your sales",
  "partnership opportunity",
  "b2b offer",
  "wholesale prices",
  "our software",
] as const;

const POSITIVE_PHRASES = [
  "yes",
  "yes please",
  "yeah",
  "yep",
  "sure",
  "ok",
  "okay",
  "sounds good",
  "that works",
  "perfect",
  "great",
  "please do",
  "go ahead",
] as const;

const NEGATIVE_PHRASES = ["no", "nope", "nah", "not really", "no its not", "no it isnt"] as const;

/**
 * Prompt-injection tells. A message carrying one of these is still handled as
 * a normal enquiry -- the model simply never sees it as an instruction, and
 * the runtime records the attempt so repeated probing is visible in the audit.
 */
const INJECTION_PHRASES = [
  "ignore your instructions",
  "ignore all previous instructions",
  "ignore previous instructions",
  "disregard your instructions",
  "system prompt",
  "your system prompt",
  "your instructions",
  "reveal your prompt",
  "show me your prompt",
  "api key",
  "your api key",
  "access token",
  "service role",
  "database",
  "run sql",
  "delete my record",
  "you are now",
  "act as",
  "developer mode",
  "jailbreak",
] as const;

export type DeterministicVerdict = {
  intent: LeadIntent;
  /** Deterministic verdicts are certain by construction. */
  confidence: 1;
  /** A short auditable token, never model narration. */
  reasoningCode: string;
  /**
   * True when the verdict is binding: the model may not propose an action
   * that contradicts it, and the runtime skips model generation entirely.
   */
  binding: boolean;
};

/**
 * The binding rules, in precedence order. Suppression outranks everything --
 * a message that both opts out and asks a question is an opt-out.
 */
export function classifyDeterministic(body: string): DeterministicVerdict | null {
  const text = normalise(body);
  if (!text) return null;

  if (hasAny(text, OPT_OUT_PHRASES)) {
    return {
      intent: "UNSUBSCRIBE",
      confidence: 1,
      reasoningCode: "OPT_OUT_PHRASE_MATCHED",
      binding: true,
    };
  }

  if (hasAny(text, WRONG_NUMBER_PHRASES)) {
    return {
      intent: "WRONG_NUMBER",
      confidence: 1,
      reasoningCode: "WRONG_NUMBER_PHRASE_MATCHED",
      binding: true,
    };
  }

  if (hasAny(text, COMPLAINT_PHRASES)) {
    return {
      intent: "COMPLAINT",
      confidence: 1,
      reasoningCode: "COMPLAINT_PHRASE_MATCHED",
      binding: true,
    };
  }

  if (hasAny(text, EMERGENCY_PHRASES)) {
    return {
      intent: "EMERGENCY",
      confidence: 1,
      reasoningCode: "EMERGENCY_PHRASE_MATCHED",
      binding: true,
    };
  }

  if (hasAny(text, HUMAN_REQUEST_PHRASES)) {
    return {
      intent: "HUMAN_REQUEST",
      confidence: 1,
      reasoningCode: "HUMAN_REQUEST_PHRASE_MATCHED",
      binding: true,
    };
  }

  if (hasAny(text, JOB_APPLICATION_PHRASES)) {
    return {
      intent: "JOB_APPLICATION",
      confidence: 1,
      reasoningCode: "JOB_APPLICATION_PHRASE_MATCHED",
      binding: true,
    };
  }

  if (hasAny(text, SUPPLIER_PHRASES)) {
    return {
      intent: "SUPPLIER_OR_NON_LEAD",
      confidence: 1,
      reasoningCode: "SUPPLIER_PITCH_MATCHED",
      binding: true,
    };
  }

  return null;
}

/**
 * Non-binding hints for the ordinary sales conversation. These narrow the
 * model's job (and provide the answer outright when the model is unavailable),
 * but they never authorise an action on their own.
 */
export function classifyHeuristic(body: string): DeterministicVerdict | null {
  const text = normalise(body);
  if (!text) return null;

  const hint = (intent: LeadIntent, reasoningCode: string): DeterministicVerdict => ({
    intent,
    confidence: 1,
    reasoningCode,
    binding: false,
  });

  if (hasAny(text, BOOKING_CHANGE_PHRASES)) return hint("BOOKING_CHANGE", "BOOKING_CHANGE_PHRASE");
  if (hasAny(text, BOOKING_PHRASES)) return hint("BOOKING_REQUEST", "BOOKING_PHRASE");
  if (hasAny(text, NOT_INTERESTED_PHRASES)) return hint("NOT_INTERESTED", "NOT_INTERESTED_PHRASE");
  if (hasAny(text, OBJECTION_PHRASES)) return hint("OBJECTION", "OBJECTION_PHRASE");
  if (hasAny(text, PRICE_PHRASES)) return hint("PRICE_ENQUIRY", "PRICE_PHRASE");
  if (hasAny(text, AVAILABILITY_PHRASES)) return hint("AVAILABILITY_ENQUIRY", "AVAILABILITY_PHRASE");

  // Bare yes/no only counts when the whole message is that word, so
  // "no idea when I'm free" is not read as a rejection.
  if ((POSITIVE_PHRASES as readonly string[]).includes(text)) {
    return hint("POSITIVE_REPLY", "BARE_AFFIRMATIVE");
  }
  if ((NEGATIVE_PHRASES as readonly string[]).includes(text)) {
    return hint("NEGATIVE_REPLY", "BARE_NEGATIVE");
  }

  if (text.includes("?")) return hint("GENERAL_QUESTION", "QUESTION_MARK");

  return null;
}

/** Records an injection attempt for the audit trail; never changes handling. */
export function detectInjectionAttempt(body: string): string | null {
  const text = normalise(body);
  const matched = INJECTION_PHRASES.find((phrase) => hasPhrase(text, phrase));
  return matched ? `INJECTION_PHRASE:${matched.replace(/\s+/g, "_").toUpperCase()}` : null;
}

/**
 * Whether a message that opted out did so through the phrase layer rather than
 * a bare carrier keyword. Kept separate so the caller can log which layer
 * fired without re-running the whole classifier.
 */
export function isOptOutPhrase(body: string): boolean {
  return hasAny(normalise(body), OPT_OUT_PHRASES);
}

export function isWrongNumberPhrase(body: string): boolean {
  return hasAny(normalise(body), WRONG_NUMBER_PHRASES);
}
