/**
 * Closing craft (elite-closer brief, 2026-09-27). Pure.
 *
 * Owner goal: "keep everything automated all the way to close so nobody does
 * anything". Three deterministic reads of the lead's words, and one close line
 * per motion:
 *
 *   * `detectBuyingSignal`: the lead is ready ("what's the next step?",
 *     "sounds good, let's do it"). The turn trial-closes instead of asking
 *     another optional qualifying question, so a ready buyer is never
 *     over-qualified. A required question is still asked.
 *   * `isCallRequest`: "can you give me a call?" is a warm close, not a
 *     hand-over. When a booking route exists the turn offers bookable call
 *     times through the ordinary booking flow (the booking is marked as a
 *     phone call; a "Phone call" meeting type is used when the workspace has
 *     one). Only with no way to book does it stay a hand-over.
 *   * `closeLine`: how to close for the motion's goal: two specific slots
 *     then "Does either work?" for a meeting; the checkout link with the one
 *     line of value that matters to this lead for a direct sale; friction
 *     removed for a trial; a meeting with a brief for enterprise.
 *
 * Every close is assumptive but polite, a single clear CTA, and uses only
 * confirmed slots, approved links and approved facts. No invented deadline,
 * scarcity or pressure (validate.ts STYLE_PRESSURE rejects them anyway).
 */

import type { CloseTarget } from "../sales-library/types.ts";

const BUYING_SIGNALS: RegExp[] = [
  /\bhow (do|can|would) (we|i) (get started|sign up|start|proceed|go ahead|move forward|buy|order)\b/i,
  /\bwhat(?:'?s| is| are) (the )?next steps?\b/i,
  /\b(sounds|looks) (good|great|perfect|ideal|spot on|like what we need)\b/i,
  /\blet'?s (do it|go|go ahead|get (it|this) (started|going|booked)|get started|book (it|in|a call))\b/i,
  /\b(ready|keen|happy) to (go|start|proceed|go ahead|move forward|sign up|get started|buy)\b/i,
  /\b(when|how soon) (can|could) (you|we) start\b/i,
  /\bwhere do i sign\b/i,
  /\bsign (me|us) up\b/i,
  /\b(i'?m|we'?re) in\b[.!]?\s*$/i,
  /\bcan (we|i) (book|get) (a call|something|a meeting|a time) in\b/i,
];

/** The lead's words show they are ready to take the next step. */
export function detectBuyingSignal(text: string | null | undefined): boolean {
  const value = (text ?? "").normalize("NFKC").replace(/[’]/g, "'").slice(0, 600);
  if (!value.trim()) return false;
  // A refusal or a stop phrase is never a buying signal ("not ready to go ahead").
  if (/\b(not|isn'?t|aren'?t|never|no longer)\s+(\w+\s+){0,2}(ready|keen|happy|good)\b/i.test(value)) return false;
  return BUYING_SIGNALS.some((pattern) => pattern.test(value));
}

const CALL_REQUEST =
  /\b(call me|ring me|phone me|give (me|us) a (call|ring|bell|buzz)|can (someone|somebody|you|we) (call|ring|phone)( me| us)?|(have|jump on|hop on|arrange|book|set up|do) a (quick |short )?(call|phone call|chat on the phone)|(speak|talk|chat) (on|over) the phone|prefer a (call|phone call))\b/i;

/** The lead asks to talk by phone. An opt-out ("don't call me") is caught first by classifyDeterministic. */
export function isCallRequest(text: string | null | undefined): boolean {
  const value = (text ?? "").normalize("NFKC").replace(/[’]/g, "'");
  if (/\b(don'?t|do not|never|stop) (call|ring|phone)/i.test(value)) return false;
  return CALL_REQUEST.test(value);
}

/** How the close can be taken this turn (mirrors strategy.ts NbaBookingRoute). */
export type CloseRoute = "SLOTS" | "LINK" | "ASK_PREFERRED_TIME" | "TEAM_FOLLOW_UP";

const MEETING_TARGETS: ReadonlySet<CloseTarget> = new Set(["BOOK_MEETING", "CONSULTATION", "QUOTE_OR_VISIT", "BUSINESS_CASE"]);

/**
 * The one close instruction for the motion's goal and the booking route.
 * Short on purpose: it sits in the per-turn strategy block.
 */
export function closeLine(
  target: CloseTarget,
  route: CloseRoute,
  options: { callRequested?: boolean } = {},
): string {
  const call = options.callRequested === true;
  if (call || MEETING_TARGETS.has(target)) {
    const what = call ? "a phone call" : target === "BUSINESS_CASE" ? "a meeting" : "a call";
    const brief = target === "BUSINESS_CASE" ? " Say the right person gets a brief of what they've told you." : "";
    switch (route) {
      case "SLOTS":
        return `Close: offer ${what} at two of the confirmed times ("I can do X or Y"), then "Does either work?".${brief}`;
      case "LINK":
        return `Close: the booking link for ${what}, with one line on what they get from it.${brief}`;
      case "ASK_PREFERRED_TIME":
        return `Close: offer ${what} and ask which day and time suits them.${brief}`;
      default:
        return `Close: say the team will be in touch to arrange ${what}.${brief}`;
    }
  }
  if (target === "CHECKOUT" || target === "PROPOSAL") {
    return "Close: the checkout link with the one line of value that matters most to them, in their words. No other question.";
  }
  // TRIAL_OR_SIGNUP
  return "Close: make starting easy: the sign-up link, and answer the one friction they raised from approved facts. No other question.";
}

/** A trial close: used when a ready buyer still has an optional question pending. */
export const TRIAL_CLOSE_LINE =
  "They sound ready: skip the optional question and trial-close with the next step instead.";

const PERSON_REQUEST =
  /\b(human|real person|a person|an actual person|someone real|the manager|the owner|put me through|not a (bot|robot|machine))\b/i;

/**
 * A call request that is not also an explicit ask for a person ("can I speak
 * to a human, call me") hands over as before; "give me a call" on its own is
 * a close. Used with classifyDeterministic's HUMAN_REQUEST, which still
 * matches call phrases so the agent-off path notifies the team as before.
 */
export function isCallOnlyRequest(text: string | null | undefined): boolean {
  return isCallRequest(text) && !PERSON_REQUEST.test((text ?? "").normalize("NFKC"));
}
