/**
 * What the assistant said on a call, checked after the fact (live-call fix,
 * 2026-09-28). Pure.
 *
 * The owner's first real call said "we offer tailored solutions to fit your
 * specific needs" with nothing on the offer card, offered "this afternoon or
 * tomorrow morning" before any calendar tool ran, and said "one moment while
 * I check availability" for a tool the call was not allowed. The brief now
 * forbids all three; these checks catch them when a model does it anyway:
 * in post-call analysis (post-call.ts, stored as a quality flag on the
 * outcome) and in the call QA harness (tests/fixtures/voice-call-qa).
 *
 * Reuses the text agent's own AI-tell list (agent/human-style.ts), which
 * already names "tailored solutions", "industry-leading" and the rest.
 */

import { aiTellsIn } from "../agent/human-style.ts";

/** A sentence that says something about the business, its offer or its quality. */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /\bwe (?:offer|provide|deliver|speciali[sz]e|guarantee|pride ourselves|always|never|use only|only use)\b/i,
  /\bwe(?:'re| are) (?:experts?|specialists?|the (?:best|leading|number one|cheapest|fastest)|known for|fully (?:insured|certified|accredited))\b/i,
  /\bwe (?:have|'ve got) (?:years|decades|over \d+|a (?:team|wealth)|experience|expertise)\b/i,
  /\bwe can (?:help|handle|sort|fix|take care|save|guarantee|get (?:you|it) done)\b/i,
  /\bour (?:services?|team|solutions?|products?|experts?|engineers?|installers?|quality|approach|process|work|prices?|rates?|customers?|clients?) (?:is|are|can|will|offer|provide|have|has|include)\b/i,
  /\b(?:tailored|bespoke|customi[sz]ed|personali[sz]ed) (?:solutions?|services?|approach|packages?|plans?|options?)\b/i,
  /\b(?:award[- ]winning|market[- ]leading|industry[- ]leading|best[- ]in[- ]class|world[- ]class|top[- ]rated|five[- ]star|highly rated|second to none)\b/i,
];

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9£%\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** The sentence says (nearly) what an approved line says: most of its words are the line's. */
function approvedBy(sentence: string, approved: readonly string[]): boolean {
  const s = words(sentence);
  if (!s.length) return true;
  return approved.some((line) => {
    const l = new Set(words(line));
    if (!l.size) return false;
    return s.filter((w) => l.has(w)).length / s.length >= 0.6;
  });
}

/** Claim-like sentences that no approved offer line supports. */
export function unapprovedClaimSentences(text: string, approved: readonly string[]): string[] {
  return sentences(text).filter((s) => (CLAIM_PATTERNS.some((re) => re.test(s)) || aiTellsIn(s).length > 0) && !approvedBy(s, approved));
}

/**
 * Times or day parts offered as availability ("I can offer times this
 * afternoon or tomorrow morning", "I've got a slot tomorrow"). Clock times
 * and weekday names are caught separately by the QA compliance check.
 */
const AVAILABILITY_OFFER: readonly RegExp[] = [
  /\bI (?:can|could) (?:offer|do|fit you in|squeeze you in|book you in)\b[^.?!]*\b(?:morning|afternoon|evening|today|tomorrow|this week|next week|times?|slots?)\b/i,
  /\b(?:times?|slots?|space|availability|free) (?:this|tomorrow|today|later today|on)\b/i,
  /\b(?:I|we) (?:have|'ve got|'ve) (?:a |some )?(?:slots?|times?|space|availability|openings?)\b/i,
  /\b(?:this|tomorrow) (?:morning|afternoon|evening) or (?:this |tomorrow )?(?:morning|afternoon|evening)\b/i,
];

export function availabilityOffers(text: string): string[] {
  return sentences(text).filter((s) => AVAILABILITY_OFFER.some((re) => re.test(s)));
}

/** A holding line for a calendar check ("one moment while I check availability"). */
const CHECKING_AVAILABILITY = /\b(?:check(?:ing)?|look(?:ing)? at|have a look at|see) (?:the |our )?(?:availability|diary|calendar|times? (?:we have|available))\b/i;

export function checkingAvailabilityLines(text: string): string[] {
  return sentences(text).filter((s) => CHECKING_AVAILABILITY.test(s));
}

export type CallLintInput = {
  /** What the assistant said, turn by turn, without the words a tool returned. */
  agentTurns: readonly string[];
  /** Approved offer-card lines (the only claims allowed). */
  approvedLines: readonly string[];
  /** check_availability returned times in this call before the line was said. */
  availabilityChecked: boolean;
  /** Booking was on for this call (a holding line for a calendar check is fine). */
  bookingAllowed: boolean;
};

/** Quality flags for a finished call: each a short code and the words that raised it. */
export function lintCall(input: CallLintInput): string[] {
  const out: string[] = [];
  for (const turn of input.agentTurns) {
    for (const s of unapprovedClaimSentences(turn, input.approvedLines)) out.push(`UNAPPROVED_CLAIM: ${s}`);
    if (!input.availabilityChecked) for (const s of availabilityOffers(turn)) out.push(`AVAILABILITY_WITHOUT_TOOL: ${s}`);
    if (!input.bookingAllowed) for (const s of checkingAvailabilityLines(turn)) out.push(`CHECKING_WHEN_BOOKING_OFF: ${s}`);
  }
  return out;
}
