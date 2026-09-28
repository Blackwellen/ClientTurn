/**
 * Post-call analysis: transcript -> disposition, summary, facts, objections,
 * next action and intent signals. Pure and deterministic.
 *
 * No voice-only extractor (gap map §1.1): the lead's own words are run through
 * the SAME rules the text path uses: `extractTextSignals` (qualification
 * intelligence) and `matchObjection` (the sales library's one objection
 * taxonomy). The provider's summary is used as the summary when present; the
 * model's reasoning is never stored or shown, only what was said and decided.
 *
 * Qualification changes are not made here: the server writes the signals
 * through the QI service (`writeIntentSignals`) and queues the ordinary
 * `lead.score` reassessment, exactly as for an inbound message.
 */

import { extractTextSignals, type TextSignalHit } from "../qualification-intelligence/signals.ts";
import { matchObjection } from "../sales-library/objections.ts";
import type { CallOutcome, TranscriptTurn } from "./providers/types.ts";
import { detectSpokenIntents, isMachineOnly } from "./speech-intents.ts";

export const DISPOSITIONS = [
  "CONVERSATION",
  "MEETING_BOOKED",
  "CHECKOUT_LINK_SENT",
  "QUOTE_REQUESTED",
  "CALLBACK_REQUESTED",
  "NOT_INTERESTED",
  "WRONG_PERSON",
  "OPTED_OUT",
  "TRANSFERRED_TO_HUMAN",
  "NO_CONVERSATION",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type CallObjection = {
  key: string;
  excerpt: string;
  handledOutcome: "RESOLVED" | "PARTIALLY_RESOLVED" | "UNRESOLVED" | "ESCALATED" | "LOST";
};

export type CallAnalysis = {
  disposition: Disposition;
  summary: string | null;
  facts: Record<string, string>;
  nextAction: string | null;
  callbackRequestedFor: string | null;
  objections: CallObjection[];
  /** The person asked not to be called again. */
  voiceOptOut: boolean;
  /**
   * What the opt-out covers, read from their words (speech-intents.ts): ALL
   * for "take me off your list" / "stop contacting me", CALLS otherwise.
   * Null when there was no opt-out.
   */
  optOutScope: "CALLS" | "ALL" | null;
  /** Signals from the lead's words, for the QI service. */
  signals: TextSignalHit[];
  /** The lead's words only (never the agent's), for the QI extractors. */
  leadText: string;
};

// Adversarial QA pass (2026-09-28): the private opt-out regex that lived here
// ("stop calling", "take me off") recorded "stop calling it a website" and
// "take me off speaker" as opt-outs. Opt-outs now come only from
// speech-intents.ts (with its negatives) and the UNSUBSCRIBE text signal.
const CALLBACK = /\b(call (me|us) back|ring (me|us) back|call (me|us) (later|tomorrow|next week|on \w+day)|another time|bad time|not a good time)\b/i;
const QUOTE = /\b(quote|quotation|proposal|price it up|estimate)\b/i;

const NO_CONVERSATION_OUTCOMES: readonly CallOutcome[] = ["NO_ANSWER", "BUSY", "FAILED", "CANCELLED", "VOICEMAIL"];

const MAX_SUMMARY = 4000;
const MAX_EXCERPT = 500;

function leadTurns(transcript: readonly TranscriptTurn[]): TranscriptTurn[] {
  return transcript.filter((t) => t.role === "user" && t.content.trim().length > 0);
}

/** A short deterministic summary when the provider gives none: what happened, not why. */
function fallbackSummary(disposition: Disposition, durationSec: number | null, leadTurnCount: number): string {
  const mins = durationSec != null ? Math.max(1, Math.round(durationSec / 60)) : null;
  const length = mins != null ? ` (${mins} min)` : "";
  switch (disposition) {
    case "NO_CONVERSATION":
      return "No conversation took place.";
    case "OPTED_OUT":
      return `The lead asked not to be called again${length}. Calls to this number are now stopped.`;
    case "WRONG_PERSON":
      return `The person who answered said it was the wrong person${length}.`;
    case "NOT_INTERESTED":
      return `The lead said they are not interested${length}.`;
    case "CALLBACK_REQUESTED":
      return `The lead asked to be called back at another time${length}.`;
    case "QUOTE_REQUESTED":
      return `The lead asked for a quote${length}.`;
    case "TRANSFERRED_TO_HUMAN":
      return `The call was handed to a person on your team${length}.`;
    default:
      return `Conversation with the lead${length}; ${leadTurnCount} response${leadTurnCount === 1 ? "" : "s"} from them.`;
  }
}

export function analyseCall(input: {
  outcome: CallOutcome | null;
  durationSec: number | null;
  transcript: readonly TranscriptTurn[];
  providerSummary: string | null;
  endedAt: Date;
}): CallAnalysis {
  // A voicemail greeting or phone menu that reached the model is not the
  // lead talking (speech-intents.ts): no conversation, and its words never
  // reach the qualification extractors.
  const machine = isMachineOnly(leadTurns(input.transcript).map((t) => t.content));
  const turns = machine ? [] : leadTurns(input.transcript);
  const leadText = turns.map((t) => t.content.trim()).join("\n").slice(0, 8000);
  const spoken = turns.flatMap((t) => detectSpokenIntents(t.content));

  const signals = leadText ? extractTextSignals(leadText, input.endedAt) : [];
  const types = new Set<string>(signals.map((s) => s.type));

  // Objections: one per key, from each lead turn, with the words that raised it.
  const objections: CallObjection[] = [];
  const seen = new Set<string>();
  for (const t of turns) {
    for (const m of matchObjection(t.content)) {
      if (seen.has(m.key)) continue;
      seen.add(m.key);
      objections.push({
        key: m.key,
        excerpt: t.content.trim().slice(0, MAX_EXCERPT),
        handledOutcome: m.handoverRequired ? "ESCALATED" : m.key === "NOT_INTERESTED" ? "LOST" : "UNRESOLVED",
      });
    }
  }

  const spokenOptOut = spoken.find((i) => i.key === "OPT_OUT_ALL") ?? spoken.find((i) => i.key === "OPT_OUT_CALLS");
  const voiceOptOut = types.has("UNSUBSCRIBE") || Boolean(spokenOptOut);
  const optOutScope: CallAnalysis["optOutScope"] = voiceOptOut ? (spokenOptOut?.optOutScope ?? (types.has("UNSUBSCRIBE") ? "ALL" : "CALLS")) : null;
  const callbackHit = signals.find((s) => s.type === ("NOT_NOW") || s.type === ("CALLBACK_REQUEST"));
  const callback = CALLBACK.test(leadText) || Boolean(callbackHit);

  let disposition: Disposition;
  if (input.outcome && NO_CONVERSATION_OUTCOMES.includes(input.outcome)) disposition = "NO_CONVERSATION";
  else if (input.outcome === "TRANSFERRED") disposition = "TRANSFERRED_TO_HUMAN";
  else if (turns.length === 0) disposition = "NO_CONVERSATION";
  else if (voiceOptOut) disposition = "OPTED_OUT";
  else if (types.has("WRONG_PERSON") || spoken.some((i) => i.key === "WRONG_NUMBER" || i.key === "VULNERABLE")) disposition = "WRONG_PERSON";
  else if (types.has("NOT_INTERESTED") || seen.has("NOT_INTERESTED")) disposition = "NOT_INTERESTED";
  else if (callback) disposition = "CALLBACK_REQUESTED";
  else if (types.has("QUOTE_REQUEST") || QUOTE.test(leadText)) disposition = "QUOTE_REQUESTED";
  else disposition = "CONVERSATION";

  const callbackRequestedFor = disposition === "CALLBACK_REQUESTED" ? (callbackHit?.resumeAt ?? null) : null;

  const facts: Record<string, string> = {};
  for (const s of signals) {
    if (s.statedDate) facts.stated_date = s.statedDate;
    if (s.type === ("BOOKING_REQUEST")) facts.wants_meeting = "yes";
    if (s.type === ("PRICING_REQUEST")) facts.asked_about_price = "yes";
    if (s.type === ("URGENCY")) facts.urgency = "high";
  }

  const nextAction = nextActionFor(disposition, facts, callbackRequestedFor);
  const summary = (input.providerSummary?.trim() || fallbackSummary(disposition, input.durationSec, turns.length)).slice(0, MAX_SUMMARY);

  return { disposition, summary, facts, nextAction, callbackRequestedFor, objections, voiceOptOut, optOutScope, signals, leadText };
}

function nextActionFor(disposition: Disposition, facts: Record<string, string>, callbackAt: string | null): string | null {
  switch (disposition) {
    case "NO_CONVERSATION":
      return "Follow up by text or email; the retry policy decides whether to call again.";
    case "OPTED_OUT":
      return null;
    case "WRONG_PERSON":
      return "Check the contact details before any further contact.";
    case "NOT_INTERESTED":
      return null;
    case "CALLBACK_REQUESTED":
      return callbackAt ? `Call back after ${callbackAt.slice(0, 16).replace("T", " ")}.` : "Call back at a time that suits them.";
    case "QUOTE_REQUESTED":
      return "Prepare and send a quote.";
    case "TRANSFERRED_TO_HUMAN":
      return "Your team is handling this lead.";
    default:
      return facts.wants_meeting === "yes" ? "Send a booking link." : "Continue the conversation by text or email.";
  }
}
