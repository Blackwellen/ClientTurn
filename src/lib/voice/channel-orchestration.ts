/**
 * Channel orchestration (voice phase P3, brief §71). Pure and deterministic.
 *
 * Voice becomes one option of the next-action engine. At each decision point
 * this chooses ONE move now (and, at most, the step it leaves scheduled), from:
 * consent and eligibility, the lead's stated preference, urgency, intent,
 * cost, how they have responded before, the time of day (calling hours) and
 * the workspace's entitlement and AI permissions.
 *
 * Decision points:
 *   TEXT_REPLY       the lead wrote on SMS / WhatsApp / email this turn
 *   LEAD_CREATED     a new enquiry
 *   FOLLOW_UP_DUE    the follow-up engine's next automated step is due
 *   CALL_MISSED      an AI call ended NO_ANSWER / BUSY / VOICEMAIL
 *
 * Hard rules, first match wins:
 *   V0  NEGATIVE intent or no lawful channel at all               NONE
 *   V1  the lead asked for a call on a text channel, and voice can
 *       be used (entitled, route on, minutes, AI may call), with a
 *       buying signal or intent MEDIUM or above                    CALL now (a response, not
 *                                                                   an automated touch)
 *       otherwise                                                  the text conversation continues
 *   V2  an automated step the frequency guard stops or defers      NONE / WAIT
 *   V3  CALL_REQUESTED or FORM_CONSENT_TO_CALL, intent HIGH,
 *       BOOKING_READY or PURCHASE_READY (or stated urgency), and no
 *       call attempted yet                                        CALL, within the next
 *                                                                   CALL_NOW_WINDOW_MS of
 *                                                                   calling hours; else text now
 *   V4  preference "phone", the same consent, intent MEDIUM or
 *       above, attempts left                                      CALL
 *   V5  a missed call: SMS (UK mobile, lawful) if none since the
 *       call, else WhatsApp (open window) if none since, else
 *       email; the retry call stays scheduled at the best time
 *       (retry-policy.ts) while attempts remain                   SMS / WHATSAPP / EMAIL, then CALL
 *   V6  otherwise the preferred lawful text channel; else, for a new
 *       enquiry or a hot lead, the fastest (SMS first); else the
 *       cheapest lawful one                                       SMS / WHATSAPP / EMAIL
 *
 * Never: a call to a lead who did not ask for or consent to automated calls
 * (the only bases are CALL_REQUESTED and FORM_CONSENT_TO_CALL, or the lead's
 * own request in V1, which the caller records as CALL_REQUESTED with the
 * message as evidence); an AI-initiated call when the owner has not allowed
 * "Phone leads" (aiMay call). The dial path re-checks everything (entitlement,
 * canCallLead, calling hours, caps) immediately before it dials.
 */

import type { ConsentBasis } from "./eligibility.ts";
import type { VoiceRouteKey } from "./time-governor.ts";

export type TextChannel = "SMS" | "WHATSAPP" | "EMAIL";
export type ChannelMove = "CALL" | TextChannel | "WAIT" | "NONE";
export type DecisionPoint = "TEXT_REPLY" | "LEAD_CREATED" | "FOLLOW_UP_DUE" | "CALL_MISSED";
export type ChannelRule = "V0" | "V1" | "V1_TEXT" | "V2" | "V3" | "V3_TEXT" | "V4" | "V5" | "V6";

/**
 * What one touch costs ClientTurn, in pence, at base (docs/economics.md):
 * an email from the customer's own mailbox (0), a WhatsApp service message
 * from 1 Oct 2026 ($0.027 x 0.7546 = 2.04p, §5.1), a UK SMS segment
 * ($0.056 x 0.7546 = 4.23p, §4.3), and a three-minute AI call at the stack A
 * voice COGS (3 x 8.21p = 24.63p, §13). Used only to order text channels
 * when no preference or speed rule decides; a call is never chosen for being
 * cheap or dear, only by the rules above.
 */
export const TOUCH_COST_PENCE: Readonly<Record<"CALL" | TextChannel, number>> = {
  EMAIL: 0,
  WHATSAPP: 2.04,
  SMS: 4.23,
  CALL: 24.63,
};

/** "Call now" means within this long, inside the recipient's calling hours. */
export const CALL_NOW_WINDOW_MS = 4 * 60 * 60_000;

const MEDIUM_OR_ABOVE = new Set(["MEDIUM", "HIGH", "BOOKING_READY", "PURCHASE_READY"]);
const HIGH_OR_ABOVE = new Set(["HIGH", "BOOKING_READY", "PURCHASE_READY"]);
const AI_CALL_BASES: ReadonlySet<string> = new Set(["CALL_REQUESTED", "FORM_CONSENT_TO_CALL"]);

export type ChannelDecisionInput = {
  now: Date;
  point: DecisionPoint;
  lead: {
    consentBasis: ConsentBasis | null;
    /** This text asks for a phone call (agent/closing.ts isCallOnlyRequest). */
    askedForCallNow: boolean;
    /** The channel the lead wrote on this turn (TEXT_REPLY). */
    replyChannel: TextChannel | null;
    preferredChannel: "phone" | "sms" | "whatsapp" | "email" | null;
    intentState: string | null;
    buyingSignal: boolean;
    urgent: boolean;
  };
  voice: {
    /** Entitlement, number, route on, minutes: the workspace can place an AI call at all. */
    usable: boolean;
    /** aiMay(authority, "call"): the owner lets the assistant decide to call. */
    aiMayCall: boolean;
    /** The earliest time inside the recipient's calling hours (null = none known / never). */
    nextCallableAt: Date | null;
    attemptsUsed: number;
    maxAttempts: number;
  };
  /** Per-channel legality for THIS lead, from the channel policy (and WhatsApp's 24-hour window). */
  channels: Record<TextChannel, boolean>;
  /** Texts sent since the last call (CALL_MISSED): the V5 sequence. */
  sentSinceLastCall: readonly TextChannel[];
  /** The frequency guard's verdict for an automated touch (reengagement/frequency.ts). */
  frequency: { action: "allow" } | { action: "defer"; at: Date } | { action: "skip" };
  /** For V5: when the retry policy would place the next call (null = no retry). */
  retryCallAt: Date | null;
};

export type ChannelDecision = {
  move: ChannelMove;
  /** When the move happens (now, or the calling-hours start). Null for NONE. */
  at: Date | null;
  /** The route a CALL runs on. */
  route: VoiceRouteKey | null;
  /** The step left scheduled after this move (V5: the retry call). */
  then: { move: "CALL"; at: Date } | null;
  rule: ChannelRule;
  reason: string;
};

function routeFor(input: ChannelDecisionInput): VoiceRouteKey {
  const s = input.lead.intentState;
  if (s === "PURCHASE_READY") return "DIRECT_CLOSE";
  if (s === "BOOKING_READY" || input.lead.buyingSignal) return "BOOKING_CLOSE";
  return "QUALIFICATION";
}

/** The call time if it is "now enough": inside calling hours within the window. */
function callTime(input: ChannelDecisionInput): Date | null {
  const at = input.voice.nextCallableAt;
  if (!at) return null;
  const t = Math.max(at.getTime(), input.now.getTime());
  return t - input.now.getTime() <= CALL_NOW_WINDOW_MS ? new Date(t) : null;
}

/** The preferred lawful text channel, else the cheapest lawful one. */
export function textChannelFor(input: ChannelDecisionInput, exclude: readonly TextChannel[] = []): TextChannel | null {
  const lawful = (["SMS", "WHATSAPP", "EMAIL"] as const).filter((c) => input.channels[c] && !exclude.includes(c));
  if (!lawful.length) return null;
  const pref = input.lead.preferredChannel;
  const preferred: TextChannel | null = pref === "sms" ? "SMS" : pref === "whatsapp" ? "WHATSAPP" : pref === "email" ? "EMAIL" : null;
  if (preferred && lawful.includes(preferred)) return preferred;
  if (input.lead.replyChannel && lawful.includes(input.lead.replyChannel)) return input.lead.replyChannel;
  // Speed to lead (follow-up/channel-strategy.ts): a new enquiry, a hot or
  // urgent lead gets the fastest channel; anyone else the cheapest.
  const fast = input.point === "LEAD_CREATED" || HIGH_OR_ABOVE.has(input.lead.intentState ?? "") || input.lead.urgent;
  if (fast) return (["SMS", "WHATSAPP", "EMAIL"] as const).find((c) => lawful.includes(c)) ?? lawful[0];
  return [...lawful].sort((a, b) => TOUCH_COST_PENCE[a] - TOUCH_COST_PENCE[b])[0];
}

function none(rule: ChannelRule, reason: string): ChannelDecision {
  return { move: "NONE", at: null, route: null, then: null, rule, reason };
}

function text(input: ChannelDecisionInput, rule: ChannelRule, reason: string, exclude: readonly TextChannel[] = [], then: ChannelDecision["then"] = null): ChannelDecision {
  const channel = textChannelFor(input, exclude);
  return channel ? { move: channel, at: input.now, route: null, then, rule, reason } : { ...none(rule, `${reason} No lawful text channel.`), then };
}

export function decideNextChannel(input: ChannelDecisionInput): ChannelDecision {
  const intent = input.lead.intentState ?? "";
  const anyText = input.channels.SMS || input.channels.WHATSAPP || input.channels.EMAIL;
  const callConsent = AI_CALL_BASES.has(input.lead.consentBasis ?? "");
  const canDecideCall = input.voice.usable && input.voice.aiMayCall && input.voice.attemptsUsed < input.voice.maxAttempts;

  // V0
  if (intent === "NEGATIVE") return none("V0", "The lead said no; nothing is sent or called.");
  if (!anyText && !(canDecideCall && (callConsent || input.lead.askedForCallNow))) return none("V0", "No lawful channel for this lead.");

  // V1: the lead's own request on a text channel is a response, not an automated touch.
  if (input.point === "TEXT_REPLY" && input.lead.askedForCallNow) {
    const strong = input.lead.buyingSignal || MEDIUM_OR_ABOVE.has(intent);
    const at = callTime(input);
    if (canDecideCall && strong && at) {
      return { move: "CALL", at, route: routeFor(input), then: null, rule: "V1", reason: "They asked for a call and are ready to talk: call them now." };
    }
    const why = !input.voice.usable
      ? "AI calling is not available here"
      : !input.voice.aiMayCall
        ? "the assistant is not allowed to place calls"
        : !strong
          ? "the request is not yet a strong buying signal"
          : "it is outside their calling hours for now";
    const channel = input.lead.replyChannel && input.channels[input.lead.replyChannel] ? input.lead.replyChannel : textChannelFor(input);
    return channel
      ? { move: channel, at: input.now, route: null, then: null, rule: "V1_TEXT", reason: `They asked for a call, but ${why}: the conversation offers call times on ${channel.toLowerCase()}.` }
      : none("V1_TEXT", `They asked for a call, but ${why}.`);
  }

  // V2: every other move is an automated touch.
  if (input.frequency.action === "skip") return none("V2", "The frequency guard stops further automated contact.");
  if (input.frequency.action === "defer") {
    return { move: "WAIT", at: input.frequency.at, route: null, then: null, rule: "V2", reason: "The frequency guard defers the next touch." };
  }

  // V5: a missed call. Texts first (one per missed call), the retry call stays scheduled.
  if (input.point === "CALL_MISSED") {
    const then = input.retryCallAt && canDecideCall ? { move: "CALL" as const, at: input.retryCallAt } : null;
    const sent = new Set(input.sentSinceLastCall);
    if (!sent.has("SMS") && input.channels.SMS) {
      return { move: "SMS", at: input.now, route: null, then, rule: "V5", reason: "No answer: a short text now, then the next call at the best time." };
    }
    if (!sent.has("WHATSAPP") && input.channels.WHATSAPP) {
      return { move: "WHATSAPP", at: input.now, route: null, then, rule: "V5", reason: "No answer again: a WhatsApp message now, then the next call at the best time." };
    }
    if (!sent.has("EMAIL") && input.channels.EMAIL && !then) {
      return { move: "EMAIL", at: input.now, route: null, then: null, rule: "V5", reason: "No answer and no more call attempts: an email." };
    }
    if (then) return { move: "WAIT", at: then.at, route: null, then, rule: "V5", reason: "Texts already sent since the call: wait for the next call." };
    return none("V5", "No answer, and every lawful follow-up has been used.");
  }

  // V3: consent to be called and a hot lead: call first.
  if (callConsent && canDecideCall && input.voice.attemptsUsed === 0 && (HIGH_OR_ABOVE.has(intent) || input.lead.urgent)) {
    const at = callTime(input);
    if (at) return { move: "CALL", at, route: routeFor(input), then: null, rule: "V3", reason: "They asked to be called and are ready: call within hours." };
    return text(input, "V3_TEXT", "They asked to be called, but calling hours are hours away: text now, the call waits for the window.");
  }

  // V4: they prefer the phone.
  if (callConsent && canDecideCall && input.lead.preferredChannel === "phone" && MEDIUM_OR_ABOVE.has(intent)) {
    const at = callTime(input);
    if (at) return { move: "CALL", at, route: routeFor(input), then: null, rule: "V4", reason: "They prefer the phone and are interested: call." };
  }

  // V6
  return text(input, "V6", "The next touch goes by text on their channel.");
}

/* ------------------------------------------------------------ fixed texts */

export const MISSED_CALL_TEXT_VERSION = "missed.2026-09-28.v1";

/**
 * The one text after a missed AI call (V5). Fixed and versioned, like the
 * voicemail: who, why, and how to reply. No price, no deadline, no pressure.
 */
export function missedCallText(input: { callingAsName: string; firstName: string | null; channel: TextChannel }): string {
  const name = input.callingAsName.replace(/\s+/g, " ").trim();
  const hello = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : "Hello,";
  const reply = input.channel === "EMAIL" ? "Just reply to this email" : "Just reply here";
  return `${hello} this is ${name}. We tried to call you about your enquiry but missed you. ${reply} whenever it suits, or tell us a good time to call.`;
}
