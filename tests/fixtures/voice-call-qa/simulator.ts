/**
 * Voice P3 call QA simulator (brief §62; extended by the voice QA pass,
 * 2026-09-28). Zero cost: no Retell, no model, no database. A scripted
 * PROSPECT (the scenario's lines, with ASR noise, background noise,
 * interruptions and speaking rate injected) talks to a scripted AGENT that
 * plays the voice model the way tests/stories plays the text model: it reads
 * the call brief (buildVoiceCallBrief), takes the brief's ONE move, hears the
 * lead with the SAME spoken-intent table the Retell prompt is rendered from
 * (voice/speech-intents.ts), and acts only through the real tool core
 * (runVoiceTool) over in-memory ports, so the deterministic gates,
 * idempotency and the time governor's signals are the production ones.
 *
 * The scripted agent is deliberately literal: it proves the brief and the
 * playbook carry enough for a model to do the right thing (the move, the
 * tools, the rules), and the scorer proves the call that results is
 * natural, loop-free, on route, commercially correct and inside its time
 * budget. It is not a measure of a live model's wording.
 */

import { buildVoiceCallBrief, briefGoal, ROUTE_GOAL, type BriefPermissions, type BriefRoute, type CallBrief, type CallBriefInput } from "../../../src/lib/voice/call-brief.ts";
import { buildLockedPreamble, houseStyleViolations, recordingAnswer, renderClosingLine, validateFirstUtterance } from "../../../src/lib/voice/opener.ts";
import { agentTargets, checkAgentTurn, countWords, measurePace, type Utterance } from "../../../src/lib/voice/pacing.ts";
import { ESCALATION_LINES, initialLoopState, observeTurn, type LoopState } from "../../../src/lib/voice/anti-loop.ts";
import { evaluateExtension, governTime, ROUTE_TARGETS, PROVIDER_MAX_DURATION_SEC, EXTENSION_STEP_SEC, type VoiceRouteKey } from "../../../src/lib/voice/time-governor.ts";
import { timeRouteFor } from "../../../src/lib/voice/call-brief.ts";
import { runVoiceTool, type PortOutcome, type PriorToolResult, type ToolCallRow, type ToolPermissions, type VoiceToolPorts, type VoiceToolResponse } from "../../../src/lib/voice/tools/core.ts";
import type { VoiceToolName } from "../../../src/lib/voice/tools/definitions.ts";
import { OBJECTIONS } from "../../../src/lib/sales-library/objections.ts";
import { detectBuyingSignal } from "../../../src/lib/agent/closing.ts";
import { detectDiscountAsk, detectQuoteRequest } from "../../../src/lib/agent/quote-flow.ts";
import { detectSpokenIntents } from "../../../src/lib/voice/speech-intents.ts";
import { spokenSlotChoice, spokenSlotLabel } from "../../../src/lib/voice/spoken-time.ts";
import type { NextBestAction } from "../../../src/lib/qualification-intelligence/types.ts";
import { availabilityOffers, checkingAvailabilityLines, unapprovedClaimSentences } from "../../../src/lib/voice/call-lint.ts";
import { stripQualifiedLabel } from "../../../src/lib/voice/summary-guard.ts";

/* ================================================================ scenario */

export type LeadLine = {
  text: string;
  /** The lead starts talking before the agent finished. */
  interrupt?: boolean;
  /** Garble some words as a poor ASR would on a heavy accent. */
  asrNoise?: boolean;
};

export type Scenario = {
  key: string;
  title: string;
  route: BriefRoute;
  nba?: NextBestAction | null;
  permissions?: Partial<BriefPermissions>;
  toolPermissions?: Partial<ToolPermissions>;
  transfer?: CallBriefInput["transfer"];
  consentBasis?: string;
  /** Seconds already on the clock when the simulation starts (near the time limit). */
  startElapsedSec?: number;
  leadWpm?: number;
  /** Extra silence before the lead answers (ms). */
  leadLatencyMs?: number;
  lines: LeadLine[];
  failTools?: VoiceToolName[];
  /** The call is recorded (default true): decides the opener's notice and the locked RECORDING answer. */
  recording?: boolean;
  /** The offer card's approved lines (default: the Acme Studio three). [] = nothing approved. */
  offerLines?: string[];
  /** The service the lead enquired about (default none). */
  serviceName?: string;
  /** What the lead wrote on the form (default none). */
  enquiry?: string;
  expect: {
    disposition: string;
    tools: VoiceToolName[];
    forbiddenTools?: VoiceToolName[];
    closing: boolean;
    /** Default: the route's own maximum (time-governor ROUTE_TARGETS). */
    maxSec?: number;
    /** opt_out was called with this scope. */
    optOutScope?: "CALLS" | "ALL";
    /** The agent said something matching this (a read-back, an honest AI answer). */
    agentSays?: RegExp[];
    /** The agent never said anything matching these (a pitch to a gatekeeper, a price of its own). */
    agentNeverSays?: RegExp[];
    /** calculate_quote was called with this many items. */
    quoteItems?: number;
  };
};

/* ================================================================== result */

export type ToolTrace = { name: VoiceToolName; args: unknown; status: number; ok: boolean; say: string | null; code?: string; timeLevel: string; atMs: number };

export type SimResult = {
  key: string;
  brief: CallBrief;
  /** When the scripted lead ran out of lines and the agent wrapped up on its own (ms); null = it did not. */
  fallbackAtMs?: number | null;
  transcript: Utterance[];
  tools: ToolTrace[];
  elapsedSec: number;
  disposition: string | null;
  closingSpoken: boolean;
  firstUtteranceOk: boolean;
  loops: LoopState;
  score: Score;
};

export type Score = {
  naturalness: number;
  loops: number;
  route: number;
  commercial: number;
  duration: number;
  tools: number;
  disposition: number;
  total: number;
  notes: string[];
};

/* ================================================================== clock */

const AGENT_WPM = 150;
const TOOL_SEC = 1.2;
const START = new Date("2026-09-29T10:00:00.000Z"); // Tuesday 11:00 London
/** At most this many sentences in one agent turn (the brief's "one or two short sentences"). */
export const MAX_SENTENCES_PER_TURN = 2;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, fife: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20, twenny: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

/** A deterministic "heavy accent" ASR: the same garbling a poor recogniser produces. */
export function asrGarble(text: string): string {
  return text
    .replace(/\btwenty\b/gi, "twenny")
    .replace(/\bfive\b/gi, "fife")
    .replace(/\bthink\b/gi, "fink")
    .replace(/\bthe\b/gi, "da")
    .replace(/\bwe're\b/gi, "wir");
}

function numberIn(text: string): number | null {
  // "fifteen grand", "15k", "twenty thousand": the figure the lead meant, not 15 (a read-back of "15" is wrong).
  const times = /\b(grand|thousand)\b|\d\s?k\b/i.test(text) ? 1000 : 1;
  const n = plainNumberIn(text);
  return n == null ? null : n * times;
}

function plainNumberIn(text: string): number | null {
  const digits = /\b(\d{1,5})(?:k\b|\b)/i.exec(text);
  if (digits) return Number(digits[1]);
  let total = 0;
  let seen = false;
  for (const w of text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (w in NUMBER_WORDS) {
      total += NUMBER_WORDS[w];
      seen = true;
    }
  }
  return seen ? total : null;
}

/* ============================================================ the ports */

function toolPorts(s: Scenario, clock: { now: Date }, answeredAt: Date): VoiceToolPorts & { rows: Map<string, { hash: string; status: string; tool: VoiceToolName; response: VoiceToolResponse | null }> } {
  const row: ToolCallRow = {
    id: "00000000-0000-4000-8000-00000000a001",
    business_id: "11111111-1111-4111-8111-111111111111",
    lead_id: "22222222-2222-4222-8222-222222222222",
    route: s.route,
    state: "IN_CONVERSATION",
    direction: s.route === "RETURN_CALL" ? "INBOUND" : "OUTBOUND",
    consent_basis: s.consentBasis ?? "CALL_REQUESTED",
    answered_at: answeredAt.toISOString(),
    started_at: answeredAt.toISOString(),
    created_at: answeredAt.toISOString(),
  };
  const perms: ToolPermissions = {
    aiEnabled: true,
    book: true,
    quote: false,
    sendQuote: false,
    checkout: false,
    transferMode: s.transfer?.mode ?? "ON_REQUEST",
    transferNumberSet: s.transfer?.available ?? false,
    transferHuman: s.transfer?.available ?? false,
    aiCall: true,
    hasEmail: true,
    smsLawful: true,
    bookingLink: false,
    ...(s.permissions ?? {}),
    ...(s.toolPermissions ?? {}),
  };
  const rows = new Map<string, { hash: string; status: string; tool: VoiceToolName; response: VoiceToolResponse | null }>();
  const fail = new Set(s.failTools ?? []);
  return {
    rows,
    now: () => clock.now,
    loadCall: async () => row,
    claim: async ({ toolCallId, tool, argsHash }) => {
      const r = rows.get(toolCallId);
      if (!r) {
        rows.set(toolCallId, { hash: argsHash, status: "IN_PROGRESS", tool, response: null });
        return { kind: "NEW" };
      }
      if (r.hash !== argsHash) return { kind: "MISMATCH" };
      if (r.status === "IN_PROGRESS") return { kind: "IN_PROGRESS" };
      return { kind: "DONE", response: r.response as VoiceToolResponse };
    },
    complete: async ({ toolCallId, status, response }) => {
      const r = rows.get(toolCallId)!;
      r.status = status;
      r.response = response;
    },
    priorResults: async (): Promise<PriorToolResult[]> =>
      [...rows.values()].filter((r) => r.response).map((r) => ({ tool: r.tool, status: r.status, result: r.response!.data })),
    permissions: async () => perms,
    execute: async (name, _call, args): Promise<PortOutcome> => {
      if (fail.has(name)) throw new Error(`${name} failed (injected)`);
      switch (name) {
        case "check_availability":
          return {
            ok: true,
            // The production wording (tools/work.ts): spoken labels, not screen labels.
            say: `I have ${spokenSlotChoice("Wed 30 Sep, 10:00am", "Wed 30 Sep, 2:00pm")}. Does either work?`,
            data: {
              slots: [
                { start: "2026-09-30T09:00:00.000Z", end: "2026-09-30T09:30:00.000Z", label: "Wed 30 Sep, 10:00am" },
                { start: "2026-09-30T13:00:00.000Z", end: "2026-09-30T13:30:00.000Z", label: "Wed 30 Sep, 2:00pm" },
              ],
            },
            operation: "booking.availability",
          };
        case "book_meeting": {
          const label = (args as { start_iso: string }).start_iso.startsWith("2026-09-30T13") ? "Wed 30 Sep, 2:00pm" : "Wed 30 Sep, 10:00am";
          return { ok: true, say: `You are booked for ${spokenSlotLabel(label)}. You will get a calendar invite by email.`, data: { outcome: "confirmed", label }, operation: "booking.create" };
        }
        case "calculate_quote": {
          const items = (args as { items: unknown[] }).items.length;
          return items > 1
            ? { ok: true, say: "For both, that comes to £4,490.00 plus VAT, so £5,388.00 in total.", data: { quote_ref: "calc:site-care", total: "£5,388.00", net: "£4,490.00" }, operation: "quote.calculate" }
            : { ok: true, say: "That comes to £4,000.00 plus VAT, so £4,800.00 in total.", data: { quote_ref: "calc:site", total: "£4,800.00", net: "£4,000.00" }, operation: "quote.calculate" };
        }
        case "send_quote":
          return { ok: true, say: "I have emailed the quote to you.", data: { status: "SENT" }, operation: "quote.send" };
        case "send_checkout_link":
          return { ok: true, say: "I have sent the link by text. It is £49 per month.", data: { price_text: "£49 per month" }, operation: "checkout.propose" };
        case "send_booking_link":
          return { ok: true, say: `I have sent the link by ${(args as { channel?: string }).channel === "email" ? "email" : "text"}.`, data: { channel: (args as { channel?: string }).channel ?? "sms" }, operation: "booking.link" };
        case "transfer_to_human":
          return { ok: true, say: "I will put you through to a colleague now.", data: { transfer: true }, operation: "handover.request" };
        case "schedule_callback":
          return { ok: true, say: (args as { by?: string }).by === "AI" ? "I will call you back then." : "A colleague will call you back then.", data: {}, operation: "lead.next_action" };
        case "opt_out":
          return { ok: true, say: (args as { scope?: string }).scope === "ALL" ? "Understood. We will not contact you again." : "Understood. We will not call you again.", data: {}, operation: "suppression.record" };
        default:
          return { ok: true, say: null, data: { ok: true }, operation: `voice_agent.${name}` };
      }
    },
  };
}

/* ========================================================== classification */

type Heard =
  | { kind: "MACHINE" }
  | { kind: "SCREEN" }
  | { kind: "OPT_OUT"; scope: "CALLS" | "ALL" }
  | { kind: "WRONG_NUMBER" }
  | { kind: "VULNERABLE" }
  | { kind: "GATEKEEPER" }
  | { kind: "ANGRY"; complaint: boolean }
  | { kind: "NOT_NOW" }
  | { kind: "BAD_LINE" }
  | { kind: "HUMAN" }
  | { kind: "AI_Q" }
  | { kind: "IDENTITY"; how: boolean }
  | { kind: "DATA_REQUEST" }
  | { kind: "PRIVACY"; recording: boolean }
  | { kind: "LANGUAGE"; noEnglish: boolean; asksOther: boolean }
  | { kind: "LINE_CHECK" }
  | { kind: "DISCOUNT" }
  | { kind: "QUOTE" }
  | { kind: "TERMS" }
  | { kind: "BUY" }
  | { kind: "BOOK" }
  | { kind: "SEND" }
  | { kind: "OBJECTION"; key: string; refusal: boolean }
  | { kind: "MISUNDERSTOOD"; who: "LEAD" | "AGENT" }
  | { kind: "SLOT"; index: number }
  | { kind: "YES" }
  | { kind: "NO" }
  | { kind: "TIME"; at: Date }
  | { kind: "EMAIL"; address: string }
  | { kind: "WINDOW"; text: string }
  | { kind: "FACT"; text: string };

// The simulator hears ONLY through voice/speech-intents.ts for everything the
// playbook owns (opt-outs, a person, bad time...). The adversarial QA pass
// removed its private fallback regexes: they had been passing scenarios the
// product table missed ("don't ring me", "take me off your mailing list").
const BUY = /\b(buy it|buy now|sign up|get started|pay now|purchase|order it)\b/i;
const BOOK = /\b(book (a|the) (call|meeting)|arrange a (call|meeting)|meeting with your team|call with your team)\b/i;
const HUH = /\b(sorry,? what|pardon|didn'?t catch|say that again|say (those|them|the)( times)? again|what was that)\b/i;
const YES = /\b(yes|yeah|yep|yup|aye|sure|ok|okay|fine|go on|sounds good|please do|that works|absolutely|righto|go ahead|that's right|correct)\b/i;
const NO = /\b(no|nope|not really|nah)\b/i;
const DECLINE = /\b(no|not yet|i'?ll (read|have a look|look)|let me (read|look)|i'?ll use the link|leave it there)\b/i;
/** Within a BAD_TIME hit: a bad line mid-call (offer a text) rather than a bad moment (a call-back). */
const BAD_LINE = /\b(breaking up|bad line|line('s| is) (bad|terrible)|on (a|the) train|can'?t hear you)\b/i;

function clean(text: string): string {
  return text.replace(/\[(noise|inaudible|crosstalk)\]/gi, " ").replace(/\s+/g, " ").trim();
}

/** "priya at northwind dot co dot uk" -> priya@northwind.co.uk (the recogniser spells it out in words). */
export function spokenEmail(text: string): string | null {
  const t = text.toLowerCase().replace(/[’']/g, "").replace(/[.,!?]/g, " ").replace(/\s+/g, " ");
  const m = /^(.*?)\bat ((?!dot\b)[a-z]+(?: (?!dot\b)[a-z]+)?) dot ([a-z]+(?: dot [a-z]+)*)\b/.exec(t);
  if (!m) return null;
  const before = m[1].trim().split(" ").filter(Boolean);
  if (!before.length) return null;
  const singles: string[] = [];
  for (let i = before.length - 1; i >= 0 && before[i].length === 1; i--) singles.unshift(before[i]);
  const local = singles.length >= 2 ? singles.join("") : before[before.length - 1];
  return `${local}@${m[2].replace(/ /g, "")}.${m[3].replace(/ dot /g, ".")}`;
}

/** Read an address back the way the brief says: the name letter by letter, the domain in words. */
export function readBackEmail(address: string): string {
  const [local, domain] = address.split("@");
  return `${local.split("").join(", ")}, at ${domain.replace(/\./g, " dot ")}`;
}

/** "In ten minutes", "after five", "tomorrow at two": a time in the future, or null. */
function timeIn(text: string, now: Date): Date | null {
  const rel = /\bin (\w+|half an|an|a) (minutes?|mins?|hours?|hour)\b/i.exec(text);
  if (rel) {
    const n = rel[1] === "half an" ? 30 : rel[1] === "an" || rel[1] === "a" ? 60 : numberIn(rel[1]);
    if (n != null) return new Date(now.getTime() + (rel[1] === "half an" || rel[1] === "an" || rel[1] === "a" ? n : /hour/.test(rel[2]) ? n * 60 : n) * 60_000);
  }
  const hour = numberIn(text);
  if (hour == null) return null;
  const h = hour < 8 ? hour + 12 : hour;
  const tomorrow = /tomorrow/i.test(text);
  // 2026-09-29 is the call day (Tuesday), London is UTC+1.
  let at = new Date(Date.UTC(2026, 8, tomorrow ? 30 : 29, h - 1, 0, 0));
  if (at <= now) at = new Date(at.getTime() + 86_400_000);
  return at;
}

function hear(raw: string, state: AgentState): Heard {
  const text = clean(raw);
  if (!text || countWords(text) === 0) return { kind: "MISUNDERSTOOD", who: "AGENT" };
  const intents = detectSpokenIntents(text);
  const has = (k: string) => intents.some((i) => i.key === k);
  // A screen, a machine and a stop come before everything else (speech-intents order).
  if (has("CALL_SCREEN")) return { kind: "SCREEN" };
  if (has("VOICEMAIL") || has("IVR")) return { kind: "MACHINE" };
  const optOut = intents.find((i) => i.key === "OPT_OUT_ALL" || i.key === "OPT_OUT_CALLS");
  if (optOut) return { kind: "OPT_OUT", scope: optOut.optOutScope ?? "CALLS" };
  if (state.awaiting === "STOP_OFFER" && YES.test(text)) return { kind: "OPT_OUT", scope: "CALLS" };
  if (has("WRONG_NUMBER")) return { kind: "WRONG_NUMBER" };
  if (has("VULNERABLE")) return { kind: "VULNERABLE" };
  if (has("GATEKEEPER")) return { kind: "GATEKEEPER" };
  if (has("ANGRY")) return { kind: "ANGRY", complaint: /\bcomplain|complaint\b/i.test(text) };
  if ((state.phase === "PERMISSION" || state.awaiting === "CALLBACK_TIME" || state.awaiting === "GATEKEEPER_TIME") && has("BAD_TIME") && !BAD_LINE.test(text)) {
    const at = timeIn(text, state.now());
    return at ? { kind: "TIME", at } : { kind: "NOT_NOW" };
  }
  if (state.awaiting === "CALLBACK_TIME" || state.awaiting === "GATEKEEPER_TIME") {
    const at = timeIn(text, state.now());
    if (at) return { kind: "TIME", at };
  }
  // Booking off: the lead names when a colleague may call (a day, a part of the day).
  if (state.awaiting === "CALLBACK_WINDOW" && !has("WANTS_PERSON") && !has("NOT_INTERESTED") && !has("SEND_DETAILS")) return { kind: "WINDOW", text };
  if (has("WANTS_PERSON")) return { kind: "HUMAN" };
  if (has("ASKS_IF_AI")) return { kind: "AI_Q" };
  if (has("HOW_GOT_NUMBER") || has("WHO_IS_THIS")) return { kind: "IDENTITY", how: has("HOW_GOT_NUMBER") };
  if (has("DATA_REQUEST")) return { kind: "DATA_REQUEST" };
  if (has("PRIVACY")) return { kind: "PRIVACY", recording: /\brecord/i.test(text) };
  const lang = intents.find((i) => i.key === "LANGUAGE_BARRIER");
  // After English was already hard, "I don't understand" is the language again, not the offer.
  if (!lang && state.languageTries > 0 && /\b(don'?t|do not|can'?t) understand\b/i.test(text)) return { kind: "LANGUAGE", noEnglish: false, asksOther: false };
  if (lang) return { kind: "LANGUAGE", noEnglish: Boolean(lang.noEnglish), asksOther: /\bspeak (in )?(?!english|slow)[a-z]+\b/i.test(text) && /\b(do|can) you\b/i.test(text) };
  if (has("LINE_CHECK")) return { kind: "LINE_CHECK" };
  const email = spokenEmail(text);
  if (email) return { kind: "EMAIL", address: email };
  if (detectDiscountAsk(text)) return { kind: "DISCOUNT" };
  if (detectQuoteRequest(text) || (has("PRICE_QUESTION") && /\b(how much|price|cost|charge|ballpark|rate|fee)\b/i.test(text))) return { kind: "QUOTE" };
  if (has("PRICE_QUESTION")) return { kind: "TERMS" };
  if (BUY.test(text)) return { kind: "BUY" };
  if (state.awaiting === "SLOT") {
    if (/^(no|nah|not yet)\b|\bi'?ll (read|have a look|look|use the link)\b|\blet me (read|look)\b/i.test(text)) return { kind: "NO" };
    if (/\b(first|earlier|morning|10|ten|either)\b/i.test(text)) return { kind: "SLOT", index: 0 };
    if (/\b(second|later|afternoon|2|two)\b/i.test(text)) return { kind: "SLOT", index: 1 };
    if (DECLINE.test(text) && !YES.test(text)) return { kind: "NO" };
  }
  // An answer to what the agent is waiting on beats a new topic.
  if (state.awaiting && state.awaiting !== "SLOT" && YES.test(text) && !has("SEND_DETAILS") && !has("NOT_INTERESTED")) return { kind: "YES" };
  if (state.awaiting === "TEXT_OFFER" && YES.test(text)) return { kind: "YES" };
  if (has("BAD_TIME")) return BAD_LINE.test(text) ? { kind: "BAD_LINE" } : { kind: "NOT_NOW" };
  if (has("SEND_DETAILS")) return { kind: "SEND" };
  if (BOOK.test(text) || ((has("BUYING_SIGNAL") || detectBuyingSignal(text)) && state.permissions.book && state.plan !== "CHECKOUT")) return { kind: "BOOK" };
  if (has("NOT_INTERESTED")) return { kind: "OBJECTION", key: "NOT_INTERESTED", refusal: true };
  const objection = intents.find((i) => i.key === "OBJECTION");
  if (objection?.objectionKey) return { kind: "OBJECTION", key: objection.objectionKey, refusal: OBJECTIONS[objection.objectionKey].respectAsRefusal };
  if (HUH.test(text)) return { kind: "MISUNDERSTOOD", who: "LEAD" };
  // "Okay, about ten of us": an answer with a number is the answer, not a yes.
  if (!state.awaiting && state.plan === "ASK" && numberIn(text) != null) return { kind: "FACT", text };
  // "Yes, the flat roof over the kitchen": a yes with an answer in it is the answer.
  if (!state.awaiting && state.plan === "ASK" && state.planQs.length && countWords(text) > 4) return { kind: "FACT", text };
  if (YES.test(text)) return { kind: "YES" };
  if (NO.test(text) && countWords(text) <= 3) return { kind: "NO" };
  return { kind: "FACT", text };
}

/* ================================================================ the agent */

type Plan = "BOOK" | "CHECKOUT" | "ASK" | "CHECK_IN";

type AgentState = {
  phase: "PERMISSION" | "MAIN" | "DONE";
  plan: Plan;
  question: string | null;
  awaiting: "SLOT" | "CONFIRM_NUMBER" | "CONFIRM_EMAIL" | "CONFIRM_SLOT" | "SEND_QUOTE" | "SEND_LINK" | "CALLBACK_TIME" | "CALLBACK_WINDOW" | "GATEKEEPER_TIME" | "TEXT_OFFER" | "STOP_OFFER" | "SCREENED" | null;
  pendingFact: { dimension: string; value: string } | null;
  now: () => Date;
  pendingSlot: number | null;
  slots: { start: string; label: string }[];
  slotOffers: number;
  quoteRef: string | null;
  permissions: BriefPermissions;
  loops: LoopState;
  amberHandled: boolean;
  factsRecorded: number;
  extensionsUsed: number;
  rephrases: number;
  languageTries: number;
  detailsSent: "LINK" | "COLLEAGUE" | null;
  callbackScheduled: boolean;
  objections: Record<string, number>;
  /** The last question the agent asked, repeated after "can you hear me". */
  lastQuestion: string | null;
  pendingEmail: string | null;
  lineChecks: number;
  /** The brief's QUESTION PLAN, the index of the question now open, what is answered, how many re-asks. */
  planQs: PlanQ[];
  planIdx: number;
  answered: Set<string>;
  /** Plan questions already put to the lead (never asked a second time in the same words). */
  askedPlan: Set<string>;
  reasks: number;
};

/** Different words for the same ask, so a rephrase is never a repeated question (anti-loop). */
const REPHRASINGS = [
  "In other words, roughly how big is the team?",
  "Put simply, how many of you would use it?",
  "Just roughly, is it a small team or a large one?",
];
const MISSED = ["Sorry, I missed that, could you say it once more?", "Sorry, the line dropped for a second, what was that?", "I did not quite catch that, sorry, could you repeat it?"];

/* ------------------------------------------------ the question plan (live call 2026-09-28) */

export type PlanQ = { text: string; key: string };

/**
 * The QUESTION PLAN as the brief TEXT gives it to the model: the scripted
 * agent reads it from the words, not from the builder's data, so a brief
 * that stops carrying a plan makes the agent (and the suite) fail.
 */
export function planFromBrief(text: string): { questions: PlanQ[]; required: number } {
  const section = /QUESTION PLAN\.[^\n]*/.exec(text)?.[0] ?? "";
  const questions: PlanQ[] = [];
  for (const m of section.matchAll(/(\d+)\. (.+?) \[([A-Za-z0-9_.:-]+)\]/g)) questions.push({ text: m[2].trim(), key: m[3] });
  const required = Number(/Ask 1 to (\d+) before/.exec(section)?.[1] ?? questions.length);
  return { questions, required };
}

/** The APPROVED OFFER LINES as the brief text gives them (the only claims allowed). */
export function offerLinesFromBrief(text: string): string[] {
  const m = /APPROVED OFFER LINES \([^)]*\): ([^\n]*)/.exec(text);
  return m ? m[1].split(" | ").map((l) => l.trim()).filter(Boolean) : [];
}

/** The same ask in simpler, different words (a bare "yes" is not an answer; never the same question twice). */
const REASK: Readonly<Record<string, string[]>> = {
  PROBLEM: ["Put simply, what would you like a hand with?", "In a few words, what's the job?"],
  PROJECT_SCOPE: ["Put simply, what would you like us to do?", "Is it a big job or a small one?"],
  TIMING: ["Is it for the next few weeks, or later on?", "Roughly when would suit you?"],
  BUDGET: ["Have you got a figure you'd like to stay under?", "Is there a rough amount in mind?"],
  AUTHORITY: ["Would you be making the call on this yourself?", "Is it your decision in the end?"],
  LOCATION: ["Which area would it be in?", "Whereabouts is it?"],
  TEAM_SIZE: REPHRASINGS,
  EMAIL: ["Which email is best to send it to?", "What's your email?"],
};
function reask(key: string, n: number): string {
  const list = REASK[key] ?? ["Put another way, could you tell me a little more?", "Could you say a bit more about that?"];
  return list[n % list.length];
}

/** Which plan question an answer fits best: the current one, unless it plainly answers another still open. */
function answerKey(text: string, current: string | null, open: readonly string[]): string {
  const fits: [string, RegExp][] = [
    ["TIMING", /\b(tomorrow|today|next (week|month|year)|this (week|month|year)|weeks?|months?|quarter|asap|soon|spring|summer|autumn|winter|january|february|march|april|may|june|july|august|september|october|november|december)\b/i],
    ["BUDGET", /£|\bpounds?\b|\bbudget\b|\bgrand\b|\d\s?k\b/i],
    ["AUTHORITY", /\b(md|director|boss|owner|manager|partner|wife|husband|just me|my decision|board)\b/i],
    ["TEAM_SIZE", /\b(team|people|staff|employees|of us)\b/i],
  ];
  for (const [key, re] of fits) if (key !== current && open.includes(key) && re.test(text)) return key;
  return current ?? "PROBLEM";
}

function planOf(brief: CallBrief): { plan: Plan; question: string | null } {
  const move = brief.move;
  const planned = planFromBrief(brief.text);
  if (planned.questions.length) return { plan: "ASK", question: planned.questions[0].text };
  if (/check_availability|book_meeting/.test(move)) return { plan: "BOOK", question: null };
  if (/send_checkout_link/.test(move)) return { plan: "CHECKOUT", question: null };
  const q = /in your own natural words: (.+?\?)/.exec(move);
  if (q) return { plan: "ASK", question: q[1] };
  const ask = /Ask (?:lightly )?(whether .+?\.|what .+?\.|how .+?\.)/.exec(move);
  return { plan: "CHECK_IN", question: ask ? `Can I ask ${ask[1].replace(/\.$/, "?")}` : "How are things going with what you enquired about?" };
}

/** The approved offer line with no figure in it: the only "reason" the scripted agent may give. */
const REASON_LINE = "Every site comes with a year of support";

/** The brief a scenario's call is given (the same builder production uses). */
export function briefFor(s: Scenario): { brief: CallBrief; permissions: BriefPermissions } {
  const closing = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false });
  const permissions: BriefPermissions = { book: true, quote: false, sendQuote: false, checkout: false, bookingLink: false, ...(s.permissions ?? {}) };
  const brief = buildVoiceCallBrief({
    route: s.route,
    direction: s.route === "RETURN_CALL" ? "INBOUND" : "OUTBOUND",
    callingAsName: "Acme Studio",
    personaName: "Sam",
    leadFirstName: "Priya",
    identityAnswer: "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.",
    openerSuffix: null,
    motion: s.route === "DIRECT_CLOSE" ? "SAAS_SELF_SERVE" : "BOOK_MEETING_B2B",
    goal: ROUTE_GOAL[s.route],
    nba: s.nba ?? null,
    known: ["Company: Northwind Ltd"],
    offerLines: s.offerLines ?? ["Websites from £4,000", "Care plans at £49 per month", REASON_LINE],
    workspaceObjections: null,
    booking: "SLOTS",
    permissions,
    transfer: s.transfer ?? { mode: "ON_REQUEST", available: false },
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: closing.text,
    recordingEnabled: s.recording ?? true,
    serviceName: s.serviceName ?? null,
    enquirySummary: s.enquiry ?? null,
    now: START,
    timezone: "Europe/London",
  });
  return { brief, permissions };
}

export async function simulate(s: Scenario): Promise<SimResult> {
  const closing = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false });
  const { brief, permissions } = briefFor(s);
  const approved = offerLinesFromBrief(brief.text);
  /** The one approved "reason" line, if the brief carries it (never a claim of our own). */
  const reasonLine = approved.includes(REASON_LINE) ? REASON_LINE : null;
  const goal = briefGoal({ route: s.route, motion: s.route === "DIRECT_CLOSE" ? "SAAS_SELF_SERVE" : "BOOK_MEETING_B2B", goal: ROUTE_GOAL[s.route], nba: s.nba ?? null, permissions } as CallBriefInput);

  const answeredAt = new Date(START.getTime() - (s.startElapsedSec ?? 0) * 1000);
  const clock = { now: START };
  const ports = toolPorts(s, clock, answeredAt);
  const transcript: Utterance[] = [];
  const agentLines: string[] = [];
  const tools: ToolTrace[] = [];
  let disposition: string | null = null;
  let closingSpoken = false;
  let toolSeq = 0;
  const route: VoiceRouteKey = timeRouteFor(s.route);
  const ms = () => clock.now.getTime() - answeredAt.getTime();
  const advance = (sec: number) => {
    clock.now = new Date(clock.now.getTime() + Math.round(sec * 1000));
  };

  const state: AgentState = {
    phase: "PERMISSION", plan: "ASK", question: null, awaiting: null, pendingFact: null, pendingSlot: null, slots: [], slotOffers: 0, quoteRef: null,
    permissions, loops: initialLoopState(), amberHandled: false, factsRecorded: 0, extensionsUsed: 0, rephrases: 0, languageTries: 0,
    detailsSent: null, callbackScheduled: false, objections: {}, now: () => clock.now,
    lastQuestion: null, pendingEmail: null, lineChecks: 0,
    planQs: planFromBrief(brief.text).questions, planIdx: 0, answered: new Set<string>(), askedPlan: new Set<string>(), reasks: 0,
  };
  let fallbackAtMs: number | null = null;
  const p = planOf(brief);
  state.plan = p.plan;
  state.question = p.question;
  const avail = { textFollowUpLawful: true, humanAvailable: Boolean(s.transfer?.available) };

  const say = (text: string, questionKey?: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    const start = ms();
    const dur = (countWords(t) / AGENT_WPM) * 60;
    advance(dur);
    transcript.push({ speaker: "AGENT", text: t, startMs: start, endMs: ms() });
    agentLines.push(t);
    state.loops = observeTurn(state.loops, { speaker: "AGENT", text: t, questionKey: questionKey ?? null }, avail).state;
    if (questionKey && t.includes("?")) state.lastQuestion = t.split(/(?<=[.!?])\s+/).filter((x) => x.endsWith("?")).pop() ?? null;
    if (t.includes(closing.text)) closingSpoken = true;
  };

  const tool = async (name: VoiceToolName, args: unknown): Promise<VoiceToolResponse> => {
    advance(TOOL_SEC);
    toolSeq += 1;
    const result = await runVoiceTool(ports, { name, toolCallId: `tc_${toolSeq}`, callId: "x", providerCallId: "p", args });
    const body = result.body as VoiceToolResponse;
    tools.push({ name, args, status: result.status, ok: Boolean(body.ok), say: body.say ?? null, code: body.code, timeLevel: body.time_level, atMs: ms() });
    return body;
  };

  const finish = async (d: string, speakClosing: boolean, summary: string, next?: string) => {
    if (speakClosing) say(closing.text);
    await tool("end_call_summary", { summary, disposition: d, ...(next ? { next_step: next } : {}) });
    disposition = d;
    state.phase = "DONE";
  };

  const callbackFallback = async (reason: string) => {
    await tool("schedule_callback", { by: "PERSON", note: reason });
    state.callbackScheduled = true;
    await finish("CALLBACK_REQUESTED", true, `A colleague will follow up: ${reason}`, "A colleague follows up");
  };

  /* ---- the question plan (live call 2026-09-28) */
  const currentPlanQ = (): PlanQ | null => state.planQs[state.planIdx] ?? null;
  const planOpenKeys = (): string[] => state.planQs.filter((q) => !state.answered.has(q.key)).map((q) => q.key);
  let introDone = false;
  /** Ask the next plan question still open (with a lead-in); false once the plan is done. */
  const askNextPlan = (prefix?: string): boolean => {
    const next = state.planQs.find((q) => !state.answered.has(q.key) && !state.askedPlan.has(q.key));
    if (!next) return false;
    state.askedPlan.add(next.key);
    state.planIdx = state.planQs.indexOf(next);
    state.question = next.text;
    state.reasks = 0;
    // Brief THEIR ENQUIRY: where their own words answer the need, confirm it instead of asking.
    const told = s.enquiry ? s.enquiry.split(/[,.]/)[0].trim() : "";
    if (told && ["PROBLEM", "PROJECT_SCOPE"].includes(next.key)) {
      say(`${prefix ? `${prefix} ` : ""}You mentioned the ${told.charAt(0).toLowerCase()}${told.slice(1)}, is that the job?`, `PLAN_${next.key}`);
      return true;
    }
    say(`${prefix ? `${prefix} ` : ""}${next.text}`, `PLAN_${next.key}`);
    return true;
  };
  /** A bare yes, or they did not follow: the same ask more simply; twice, and it is let go (they would rather not say). */
  const reaskPlan = (): void => {
    const q = currentPlanQ();
    if (!q) return;
    if (state.reasks >= 2) {
      state.answered.add(q.key);
      if (!askNextPlan("No problem.")) say("No problem at all.");
      return;
    }
    say(reask(q.key, state.reasks), `REASK_${q.key}_${state.reasks}`);
    state.reasks += 1;
  };
  /** Booking is off: after the plan, the next step is a call-back window a colleague keeps (brief CLOSE). */
  const qualificationBookingOff = () => s.route === "QUALIFICATION" && !state.permissions.book && state.planQs.length > 0;
  const askCallbackWindow = (lead: string) => {
    say(`${lead} What day and time of day suits a colleague to call you?`, "CB_WINDOW");
    state.awaiting = "CALLBACK_WINDOW";
  };

  /** The two offered times in words: only the tool's labels, never a time of our own. */
  const slotWords = () => {
    const [a, b] = state.slots;
    return spokenSlotChoice(a.label, b.label);
  };

  /** The assumptive two-slot offer; a second offer in the same call is worded afresh. */
  const offerSlots = async (lead?: string): Promise<boolean> => {
    const r = await tool("check_availability", {});
    if (!r.ok) {
      say(r.say ?? "I cannot see the diary just now.");
      await callbackFallback("booking");
      return false;
    }
    state.slots = ((r.data.slots as { start: string; label: string }[]) ?? []).slice(0, 2);
    state.slotOffers += 1;
    // A lead-in is a clause of the same sentence: one question, two sentences at most.
    if (state.slotOffers === 1 && !lead) say(r.say ?? "", "SLOTS");
    else say(`${lead ? `${lead}: ` : ""}I can do ${slotWords()}, which is better?`, `SLOTS_${state.slotOffers}`);
    state.awaiting = "SLOT";
    return true;
  };

  const startPlan = async (): Promise<void> => {
    if (state.plan === "BOOK") {
      await offerSlots();
    } else if (state.plan === "CHECKOUT") {
      say("Would you like me to text you the link to get started?", "LINK");
      state.awaiting = "SEND_LINK";
    } else if (state.planQs.length) {
      const why = !introDone && s.serviceName ? `Great, it's about your ${s.serviceName.toLowerCase()} enquiry.` : undefined;
      introDone = true;
      if (!askNextPlan(why)) say(state.question ?? "What prompted your enquiry?", "Q1");
    } else {
      say(state.question ?? "What prompted your enquiry?", "Q1");
    }
  };

  /** After a side question (is this a robot, who is this, privacy): carry on, in fresh words. */
  const carryOn = async (prefix: string) => {
    if (state.awaiting === "SLOT") {
      say(prefix);
      say("Would the morning or the afternoon suit you better?", "SLOT_AMPM");
    } else if (state.plan === "ASK" && state.planQs.length && currentPlanQ()) {
      say(prefix);
      reaskPlan();
    } else if (state.plan === "ASK" && state.question) {
      say(prefix);
      say(REPHRASINGS[state.rephrases % REPHRASINGS.length], `REPHRASE_${state.rephrases}`);
      state.rephrases += 1;
    } else {
      say(prefix);
      await startPlan();
    }
  };

  /** The goal's step after a repeated objection: one approved reason, then the step (brief OBJECTIONS). */
  const goalStep = async () => {
    if ((goal === "DIRECT_SALE" || goal === "TRIAL") && state.permissions.checkout) {
      say(reasonLine ? `${reasonLine}.` : "Fair enough.");
      say("Shall I text you the link so you can look it over properly?", "LINK_2");
      state.plan = "CHECKOUT";
      state.awaiting = "SEND_LINK";
    } else if (state.permissions.book) {
      state.plan = "BOOK";
      say(reasonLine ? `${reasonLine}, so a short call might help you weigh it up.` : "A short call might help you weigh it up.");
      await offerSlots();
    } else {
      say(reasonLine ? `${reasonLine}. A colleague can take you through it properly.` : "A colleague can take you through it properly.");
      await callbackFallback("follow up the objection");
    }
  };

  const timeCheck = async (): Promise<boolean> => {
    let sig = governTime({ route, elapsedSec: ms() / 1000, extensionSec: state.extensionsUsed * EXTENSION_STEP_SEC });
    // A valuable close in progress with an engaged lead earns up to two
    // 60-second extensions, inside the minutes reserved (time-governor.ts).
    if (sig.level === "TIME_RED" || sig.level === "OVER") {
      const closeInProgress = state.awaiting === "SLOT" || state.awaiting === "CONFIRM_SLOT" ? "CONFIRMING_BOOKING_SLOT" : state.awaiting === "SEND_LINK" || state.awaiting === "SEND_QUOTE" ? "SENDING_CHECKOUT_LINK" : null;
      const ext = evaluateExtension({ route, elapsedSec: ms() / 1000, extensionsUsed: state.extensionsUsed, closeInProgress, leadEngaged: true, leadAskedToEnd: false, reservedSec: 420 });
      if (ext.granted) {
        state.extensionsUsed += 1;
        sig = governTime({ route, elapsedSec: ms() / 1000, extensionSec: ext.extensionSec });
      }
    }
    if (sig.level === "TIME_RED" || sig.level === "OVER") {
      say("Thank you, that is really helpful. A colleague will follow up with the next step.");
      if (!state.factsRecorded && !state.callbackScheduled) await tool("schedule_callback", { by: "PERSON", note: "Out of time on the call" });
      await finish(state.factsRecorded ? "CONVERSATION" : "CALLBACK_REQUESTED", true, "Time is up: summarised and handed to a colleague.", "A colleague follows up");
      return true;
    }
    if (sig.level === "TIME_AMBER" && !state.amberHandled && state.plan !== "BOOK" && state.plan !== "CHECKOUT") {
      state.amberHandled = true;
      if (state.permissions.book && state.awaiting !== "CONFIRM_NUMBER") {
        say("So far that sounds like a good fit.");
        state.plan = "BOOK";
        await startPlan();
        return state.phase === "DONE";
      }
    }
    return false;
  };

  // ---- the locked opener, spoken by Retell before any model output.
  const preamble = buildLockedPreamble({ callingAsName: "Acme Studio", enquiryAt: new Date(START.getTime() - 86_400_000), now: START, timezone: "Europe/London", recordingEnabled: s.recording ?? true });
  say(preamble.text);
  const firstUtteranceOk = validateFirstUtterance(agentLines[0], preamble).ok;

  const wpm = s.leadWpm ?? 160;
  for (const line of s.lines) {
    if (state.phase === "DONE") break;
    const heardText = line.asrNoise ? asrGarble(line.text) : line.text;
    const lastAgent = transcript[transcript.length - 1];
    const start = line.interrupt && lastAgent ? lastAgent.endMs - 600 : ms() + (s.leadLatencyMs ?? 700);
    if (!line.interrupt) advance((s.leadLatencyMs ?? 700) / 1000);
    const dur = (Math.max(1, countWords(clean(heardText))) / wpm) * 60;
    advance(dur);
    transcript.push({ speaker: "LEAD", text: heardText, startMs: Math.max(0, start), endMs: ms() });

    const h = hear(heardText, state);
    const misunderstood = h.kind === "MISUNDERSTOOD";
    const loopStep = observeTurn(state.loops, { speaker: "LEAD", text: heardText, misunderstanding: misunderstood, objectionKey: h.kind === "OBJECTION" ? h.key : null }, avail);
    state.loops = loopStep.state;

    // ---- after a call screen: silence is nobody; a person gets the disclosure again
    if (state.awaiting === "SCREENED") {
      if (!clean(heardText)) {
        await finish("VOICEMAIL", false, "A call screen; nobody picked up.");
        break;
      }
      if (["LINE_CHECK", "YES", "FACT", "MISUNDERSTOOD", "IDENTITY", "NO"].includes(h.kind)) {
        state.awaiting = null;
        state.phase = "PERMISSION";
        // They may not have heard the opener: the AI disclosure and the recording notice again.
        say(`Thanks for picking up, this is Acme Studio's AI assistant about your enquiry${(s.recording ?? true) ? ", and the call is recorded" : ""}. Is now an OK time?`, "PERMISSION_SCREEN");
        continue;
      }
      state.awaiting = null;
    }

    // ---- what must be handled whatever the phase (speech-intents playbook)
    if (h.kind === "SCREEN") {
      // One sentence to the screen: who and why, nothing sold, no details.
      say("This is Acme Studio's AI assistant, calling about an enquiry.");
      state.awaiting = "SCREENED";
      continue;
    }
    if (h.kind === "VULNERABLE") {
      // Stop selling: ask nothing, note nothing, agree nothing.
      say("I'm so sorry to have troubled you. I'll let you go.");
      await finish("WRONG_PERSON", false, "Vulnerability signal (a child, a carer, illness or a bereavement): a person checks before any further contact.", "A person reviews before any contact");
      break;
    }
    if (h.kind === "MACHINE") {
      // A machine: say nothing more, no pitch, no closing line.
      await finish("VOICEMAIL", false, "Reached a voicemail greeting or phone menu.");
      break;
    }
    if (h.kind === "OPT_OUT") {
      const r = await tool("opt_out", { scope: h.scope });
      say(r.say ?? "Understood.");
      await finish("OPTED_OUT", false, "The lead asked not to be contacted again.");
      break;
    }
    if (h.kind === "WRONG_NUMBER") {
      await tool("opt_out", { scope: "CALLS" });
      say("Sorry to have bothered you, I must have the wrong number. We will not ring it again.");
      await finish("WRONG_PERSON", false, "Wrong number: this number will not be called again.");
      break;
    }
    if (h.kind === "GATEKEEPER") {
      say("No problem at all. When is Priya best to reach?", "GK_WHEN");
      state.awaiting = "GATEKEEPER_TIME";
      state.phase = "MAIN";
      continue;
    }
    if (h.kind === "ANGRY") {
      if (h.complaint) {
        say("I am sorry about that, let me get a colleague to deal with it properly.");
        const r = await tool("transfer_to_human", { reason: "COMPLAINT" });
        if (r.ok) {
          say(r.say ?? "Putting you through now.");
          await tool("end_call_summary", { summary: "A complaint: put through to a person.", disposition: "TRANSFERRED_TO_HUMAN" });
          disposition = "TRANSFERRED_TO_HUMAN";
          state.phase = "DONE";
        } else {
          await tool("schedule_callback", { by: "PERSON", note: "A complaint on the call" });
          say("A colleague will call you back about it.");
          await finish("CALLBACK_REQUESTED", false, "A complaint: a colleague calls back.", "A colleague calls back about the complaint");
        }
        break;
      }
      say("I am sorry, I did not mean to cause any trouble. Would you like me to stop calling you?", "STOP_OFFER");
      state.awaiting = "STOP_OFFER";
      state.phase = "MAIN";
      continue;
    }
    if (h.kind === "AI_Q") {
      const honest = "Yes, I am Acme Studio's AI assistant, and a person can follow up if you would prefer.";
      if (state.phase === "PERMISSION") {
        // Nothing is pitched before they said now is all right.
        say(honest);
        say("Is now still an OK time?", "PERMISSION_AI");
      } else await carryOn(honest);
      continue;
    }
    if (h.kind === "IDENTITY") {
      const answer = h.how
        ? "You gave us this number when you enquired yesterday, and I can stop calling if you would rather."
        : "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.";
      if (state.phase === "PERMISSION") {
        say(answer);
        say("Is now all right for a quick chat?", "PERMISSION_2");
      } else await carryOn(answer);
      continue;
    }
    if (h.kind === "PRIVACY") {
      await tool("log_objection", { key: "COMPLIANCE", excerpt: clean(heardText).slice(0, 200), handled: "PARTIALLY_RESOLVED" });
      // The brief's RECORDING answer word for word; never "it may be recorded".
      await carryOn(h.recording ? recordingAnswer(s.recording ?? true) : "Acme Studio's privacy notice covers that, and a colleague can answer anything more.");
      continue;
    }
    if (h.kind === "DATA_REQUEST") {
      // A subject access request: never refused, never questioned, passed to a person.
      await tool("log_objection", { key: "COMPLIANCE", excerpt: clean(heardText).slice(0, 200), handled: "ESCALATED" });
      await tool("schedule_callback", { by: "PERSON", note: "Data request: send the lead a copy of what we hold" });
      state.callbackScheduled = true;
      say("Of course. A colleague will send you a copy of what we hold.");
      await finish("CALLBACK_REQUESTED", true, "The lead asked what data we hold: passed to a colleague.", "Send the lead a copy of their data");
      break;
    }
    if (h.kind === "LINE_CHECK") {
      state.lineChecks += 1;
      if (state.phase === "PERMISSION") say("Yes, I'm here, it's Acme Studio's AI assistant about your enquiry. Is now an OK time?", `LINE_${state.lineChecks}`);
      else say(`Yes, I'm here. ${state.lastQuestion ?? "Where were we?"}`, `LINE_${state.lineChecks}`);
      continue;
    }
    if (h.kind === "LANGUAGE") {
      state.languageTries += h.noEnglish ? 2 : 1;
      if (state.languageTries === 1) {
        say(h.asksOther ? "Sorry, I can only speak English, so I will go slowly." : "No problem, I will speak slowly.");
        say(state.phase === "PERMISSION" ? "Is now a good time?" : "Would a call with our team help?", "SLOW_1");
        continue;
      }
      if (state.permissions.bookingLink) {
        const r = await tool("send_booking_link", { channel: "sms" });
        say(r.ok ? "I have texted you the details instead. Thank you." : "A colleague will send you the details.");
        if (!r.ok) await tool("schedule_callback", { by: "PERSON", note: "Send the details in writing" });
        await finish(r.ok ? "CONVERSATION" : "CALLBACK_REQUESTED", true, "Language barrier: the details go by text.", "Details sent by text");
      } else {
        say("I will get the details sent to you in writing. Thank you.");
        await callbackFallback("send the details in writing");
      }
      break;
    }

    if (state.phase === "PERMISSION") {
      if (h.kind === "TIME") {
        state.phase = "MAIN";
      } else if (h.kind === "NOT_NOW" || h.kind === "NO") {
        say("No problem. When would suit you better?", "WHEN");
        state.awaiting = "CALLBACK_TIME";
        state.phase = "MAIN";
        continue;
      } else if (["QUOTE", "BUY", "SEND", "HUMAN", "DISCOUNT", "TERMS", "OBJECTION", "EMAIL", "BOOK"].includes(h.kind)) {
        // "Yes, go on, how much is it?": answer what they asked first.
        state.phase = "MAIN";
      } else {
        state.phase = "MAIN";
        // A question: the clock first, never ask it and then wrap up before they can answer.
        // A close (slots, the link): start it, so it can earn the time governor's extension.
        const closePlan = state.plan === "BOOK" || state.plan === "CHECKOUT";
        if (!closePlan && (await timeCheck())) break;
        if (state.awaiting == null) {
          // Brief FIRST: one sentence on why, tied to their enquiry, then the move (no cold slot list).
          if (closePlan) say(state.plan === "BOOK" ? "Great, it's about your website enquiry, and the best next step is a short call with the team." : "Great, it's about the care plan you looked at.");
          await startPlan();
        }
        if (closePlan && (await timeCheck())) break;
        continue;
      }
    }

    if (loopStep.escalation !== "NONE") {
      if (loopStep.detected === "CIRCULAR_OBJECTION" && h.kind === "OBJECTION" && !h.refusal) {
        // The same objection again: never the same question twice; one
        // approved reason and the goal's step (brief OBJECTIONS).
        await goalStep();
        // goalStep may have finished the call (TypeScript cannot see the mutation).
        if ((state.phase as AgentState["phase"]) !== "DONE" && (await timeCheck())) break;
        continue;
      }
      if (loopStep.escalation === "REPHRASE") {
        say(`${ESCALATION_LINES.REPHRASE} ${state.awaiting === "SLOT" ? "Would the morning or the afternoon suit you?" : "What matters most to you right now?"}`, "LADDER_REPHRASE");
        state.rephrases += 1;
        continue;
      }
      if (loopStep.escalation === "OFFER_TEXT_FOLLOW_UP") {
        say(ESCALATION_LINES.OFFER_TEXT_FOLLOW_UP, "TEXT_OFFER");
        state.awaiting = "TEXT_OFFER";
        continue;
      }
      if (loopStep.escalation === "OFFER_HUMAN") {
        say(ESCALATION_LINES.OFFER_HUMAN, "HUMAN_OFFER");
        continue;
      }
      say(ESCALATION_LINES.END_POLITELY.replace(" and have a good day.", "."));
      await finish("CONVERSATION", true, "The call went round in circles; ended politely.");
      break;
    }

    switch (h.kind) {
      case "MISUNDERSTOOD":
        if (h.who === "LEAD" && state.awaiting === "SLOT" && state.slots.length) {
          say(`Of course, ${slotWords()}, which suits you?`, `SLOTS_AGAIN_${state.rephrases}`);
        } else if (h.who === "LEAD" && state.plan === "ASK" && currentPlanQ()) {
          reaskPlan();
        } else if (h.who === "LEAD") {
          // They did not follow the agent: the same ask in different words.
          say(REPHRASINGS[state.rephrases % REPHRASINGS.length], `REPHRASE_${state.rephrases}`);
        } else {
          say(MISSED[state.rephrases % MISSED.length], `AGAIN_${state.rephrases}`);
        }
        state.rephrases += 1;
        break;
      case "HUMAN": {
        const r = await tool("transfer_to_human", { reason: "ASKED_FOR_PERSON" });
        if (r.ok) {
          say(r.say ?? "Putting you through now.");
          disposition = "TRANSFERRED_TO_HUMAN";
          await tool("end_call_summary", { summary: "The lead asked for a person and was put through.", disposition: "TRANSFERRED_TO_HUMAN" });
          state.phase = "DONE";
        } else {
          say(r.say ?? "A colleague will call you back.");
          await callbackFallback("the lead asked for a person");
        }
        break;
      }
      case "DISCOUNT":
        await tool("log_objection", { key: "PRICE", excerpt: clean(heardText).slice(0, 200), handled: "ESCALATED" });
        say("I cannot agree a discount myself. A colleague will look at the price with you.");
        await callbackFallback("a discount question");
        break;
      case "QUOTE": {
        if (!state.permissions.quote) {
          if (state.permissions.checkout) {
            // The price comes from the tool that sends the link, never from us.
            say("I can text you the link with the price on it now. Shall I?", "LINK_PRICE");
            state.plan = "CHECKOUT";
            state.awaiting = "SEND_LINK";
            break;
          }
          say("A colleague will put the figures together for you.");
          await callbackFallback("a quote");
          break;
        }
        const wanted = [/\bwebsite|site\b/i.test(heardText) ? "Website" : null, /\bcare plan|support|maintenance\b/i.test(heardText) ? "Care plan" : null].filter(Boolean) as string[];
        const items = (wanted.length ? wanted : ["Website"]).map((name) => ({ name, quantity: 1 }));
        const r = await tool("calculate_quote", { items });
        if (!r.ok) {
          say(r.say ?? "A colleague will confirm the price.");
          await callbackFallback("a quote");
          break;
        }
        state.quoteRef = String(r.data.quote_ref ?? "");
        say(`${r.say ?? ""} Shall I email the quote to you?`, "SEND_QUOTE");
        state.awaiting = "SEND_QUOTE";
        break;
      }
      case "TERMS": {
        // An area, a date or a guarantee: only a tool answers, else a colleague.
        if (/\b(free|available|start|soon|when)\b/i.test(heardText) && state.permissions.book && state.awaiting !== "SLOT") {
          state.plan = "BOOK";
          await offerSlots();
        } else if (state.awaiting === "SLOT" && state.slots.length) {
          say(`A colleague will confirm that on the call, and I can do ${slotWords()}, which suits you?`, `SLOTS_TERMS_${state.rephrases}`);
          state.rephrases += 1;
        } else {
          say("I can't confirm that myself, so I will ask a colleague to.");
          await callbackFallback("confirm an area, date or guarantee");
        }
        break;
      }
      case "EMAIL":
        // Read it back before it is recorded (brief HEARING): the name letter by letter.
        // A second read-back (a correction) is worded afresh: never the same question twice.
        say(state.pendingEmail ? `Thanks, so that is ${readBackEmail(h.address)}, have I got it right now?` : `Let me read that back: ${readBackEmail(h.address)}. Is that right?`, `EMAIL_${h.address}`);
        state.pendingEmail = h.address;
        state.awaiting = "CONFIRM_EMAIL";
        break;
      case "BUY":
        if (!state.permissions.checkout) {
          say("A colleague will send you the details to get started.");
          await callbackFallback("ready to buy");
          break;
        }
        state.plan = "CHECKOUT";
        state.awaiting = "SEND_LINK";
        say("Great. Shall I text you the link to get started?", "LINK");
        break;
      case "BOOK":
        state.plan = "BOOK";
        if (state.slotOffers > 0) await offerSlots("Great");
        else await startPlan();
        break;
      case "SEND": {
        // "Just email me": send it now, then a short follow-up (brief SEND ME SOMETHING).
        await tool("log_objection", { key: "SEND_INFORMATION", excerpt: clean(heardText).slice(0, 200), handled: "PARTIALLY_RESOLVED" });
        const channel = /\be ?-?mail\b/i.test(heardText) ? "email" : "sms";
        if ((goal === "DIRECT_SALE" || goal === "TRIAL") && state.permissions.checkout) {
          const r = await tool("send_checkout_link", { item: "Care plan", channel });
          say(r.say ?? "A colleague will send the details.");
          await finish(r.ok ? "CHECKOUT_LINK_SENT" : "CALLBACK_REQUESTED", true, "Checkout link sent on request.", "Complete the checkout");
          break;
        }
        if (state.permissions.bookingLink) {
          const r = await tool("send_booking_link", { channel });
          say(r.say ?? "A colleague will send it.");
          state.detailsSent = r.ok ? "LINK" : "COLLEAGUE";
        } else {
          say("Happy to, a colleague will email the details over today.");
          await tool("schedule_callback", { by: "PERSON", note: "Send the details by email" });
          state.detailsSent = "COLLEAGUE";
          state.callbackScheduled = true;
        }
        if (state.permissions.book && state.slotOffers === 0) {
          state.plan = "BOOK";
          await offerSlots("And for a quick follow-up once you have read it");
        } else if (state.permissions.book) {
          say("Or I can hold one of those times for a quick follow-up, shall I?", "HOLD_SLOT");
          state.awaiting = "SLOT";
        } else {
          await finish(state.detailsSent === "LINK" ? "CONVERSATION" : "CALLBACK_REQUESTED", true, "Details sent on request.", "Follow up after they read it");
        }
        break;
      }
      case "BAD_LINE":
        // A bad line or a bad moment mid-call: no pitch, offer a text.
        say("It sounds like a tricky moment. Shall I text you the details instead?", "TEXT_OFFER_LINE");
        state.awaiting = "TEXT_OFFER";
        break;
      case "OBJECTION": {
        await tool("log_objection", { key: h.key, excerpt: clean(heardText).slice(0, 200), handled: h.refusal ? "LOST" : "UNRESOLVED" });
        state.objections[h.key] = (state.objections[h.key] ?? 0) + 1;
        if (h.refusal) {
          say("Understood, I will leave it there.");
          await finish("NOT_INTERESTED", true, "The lead is not interested.");
          break;
        }
        if ((h.key === "NOT_NOW" || h.key === "TIMING") && !/\b(next|quarter|month|week|year|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|christmas|after)\b/i.test(heardText)) {
          // "I'll have a think": no time named, so agree one (a clear next step).
          say("Of course. When would be a good time for a quick follow-up?", "FOLLOW_UP_WHEN");
          state.awaiting = "CALLBACK_TIME";
          break;
        }
        if (h.key === "TIMING" || h.key === "NOT_NOW" || h.key === "CALL_LATER") {
          // The playbook: accept the timing, offer to follow up then, record it.
          await tool("record_fact", { dimension: "TIMING", value: clean(heardText).slice(0, 200), confirmed: false });
          state.factsRecorded += 1;
          say("No problem at all. I will make a note to check in with you then.");
          await finish("CONVERSATION", true, "Not yet: noted their timing to check in later.", "Check in at the time they named");
          break;
        }
        if (h.key === "SEND_INFORMATION") {
          say("Happy to. A colleague will email the details today.");
          await callbackFallback("send information by email");
          break;
        }
        // First time: acknowledge in a few words, then the one clarifying question.
        {
          const q = OBJECTIONS[h.key as keyof typeof OBJECTIONS].clarifyingQuestion;
          // Some library questions already start with the acknowledgement: never "Fair enough. Fair enough."
          say(/^(fair enough|makes sense|no problem|understood|happy to|of course)\b/i.test(q) ? q : `Fair enough. ${q}`, `OBJ_${h.key}`);
        }
        break;
      }
      case "SLOT": {
        const slot = state.slots[h.index] ?? state.slots[0];
        const r = await tool("book_meeting", { start_iso: slot.start });
        say(r.say ?? "A colleague will confirm the time.");
        await finish(r.ok ? "MEETING_BOOKED" : "CALLBACK_REQUESTED", true, r.ok ? `Booked for ${slot.label}.` : "Booking to be confirmed.", r.ok ? `Meeting ${slot.label}` : undefined);
        break;
      }
      case "WINDOW": {
        const r = await tool("schedule_callback", { by: "PERSON", note: `Preferred time for a colleague's call: ${clean(heardText).slice(0, 120)}` });
        state.callbackScheduled = true;
        say(r.say ?? "A colleague will call you back then.");
        await finish("CALLBACK_REQUESTED", true, `Questions asked on the call; a colleague calls back (${clean(heardText).slice(0, 60)}).`, "A colleague calls back at the time they chose");
        break;
      }
      case "TIME": {
        const at = h.at;
        const byAi = (s.consentBasis ?? "CALL_REQUESTED") === "CALL_REQUESTED" && state.awaiting !== "GATEKEEPER_TIME";
        const r = await tool("schedule_callback", { at_iso: at.toISOString(), by: byAi ? "AI" : "PERSON", ...(state.awaiting === "GATEKEEPER_TIME" ? { note: "A colleague answered; call the lead then" } : {}) });
        say(r.say ?? "We will call back then.");
        await finish("CALLBACK_REQUESTED", true, "Asked to be called back.", `Call back ${at.toISOString()}`);
        break;
      }
      case "YES":
        if (state.awaiting === "SLOT") {
          // "Yes" to "X or Y?" names neither: confirm before booking (never guess a time).
          state.pendingSlot = 0;
          state.awaiting = "CONFIRM_SLOT";
          say(`Just to check, shall I book ${spokenSlotLabel(state.slots[0].label)}?`, "CONFIRM_SLOT");
        } else if (state.awaiting === "CONFIRM_SLOT") {
          const slot = state.slots[state.pendingSlot ?? 0];
          const r = await tool("book_meeting", { start_iso: slot.start });
          say(r.say ?? "");
          await finish("MEETING_BOOKED", true, `Booked for ${slot.label}.`, `Meeting ${slot.label}`);
        } else if (state.awaiting === "SEND_LINK") {
          const r = await tool("send_checkout_link", { item: "Care plan", channel: "sms" });
          say(r.say ?? "A colleague will send the details.");
          await finish(r.ok ? "CHECKOUT_LINK_SENT" : "CALLBACK_REQUESTED", true, "Checkout link sent by text.", "Complete the checkout");
        } else if (state.awaiting === "SEND_QUOTE") {
          const r = await tool("send_quote", { quote_ref: state.quoteRef, channel: "email" });
          say(r.say ?? "A colleague will send it.");
          await finish("QUOTE_REQUESTED", true, "Quote priced and emailed.", "Review the quote");
        } else if (state.awaiting === "CONFIRM_EMAIL" && state.pendingEmail) {
          await tool("record_fact", { dimension: "EMAIL", value: state.pendingEmail, confirmed: true });
          state.factsRecorded += 1;
          state.pendingEmail = null;
          state.awaiting = null;
          state.answered.add("EMAIL");
          if (state.planQs.length && askNextPlan("Thanks, I've got that.")) break;
          if (qualificationBookingOff()) {
            askCallbackWindow("Thanks, I've got that.");
          } else if (state.permissions.book) {
            say("Thanks, I've got that, and the best next step is a short call with the team.");
            state.plan = "BOOK";
            await startPlan();
          } else {
            say("Thanks, I've got that. A colleague will follow up by email.");
            await finish("CONVERSATION", true, "Email confirmed on the call.", "Follow up by email");
          }
        } else if (state.awaiting === "CONFIRM_NUMBER" && state.pendingFact) {
          await tool("record_fact", { ...state.pendingFact, confirmed: true });
          state.factsRecorded += 1;
          state.answered.add(state.pendingFact.dimension);
          state.pendingFact = null;
          state.awaiting = null;
          if (await timeCheck()) break;
          if (state.planQs.length && askNextPlan("Thanks.")) break;
          if (qualificationBookingOff()) {
            askCallbackWindow("Thanks, that is really helpful.");
          } else if (state.permissions.book) {
            say("Thanks. The best next step is a short call with the team.");
            state.plan = "BOOK";
            await startPlan();
          } else {
            say("Thanks, that is really helpful. A colleague will follow up with the next step.");
            await finish("CONVERSATION", true, "Answers recorded on the call.", "A colleague follows up");
          }
        } else if (state.awaiting === "TEXT_OFFER") {
          if (state.permissions.bookingLink) {
            const r = await tool("send_booking_link", { channel: "sms" });
            say(r.ok ? "Done, it is on its way." : "A colleague will text you the details.");
            if (!r.ok) await tool("schedule_callback", { by: "PERSON", note: "Send the details by text" });
            await finish(r.ok ? "CONVERSATION" : "CALLBACK_REQUESTED", true, "Hard to talk; details sent by text.", "Details by text");
          } else {
            await tool("schedule_callback", { by: "PERSON", note: "Send the details by text" });
            await finish("CALLBACK_REQUESTED", true, "Hard to hear; details to follow by text.", "Text the details");
          }
        } else if (state.awaiting === "STOP_OFFER") {
          const r = await tool("opt_out", { scope: "CALLS" });
          say(r.say ?? "Understood.");
          await finish("OPTED_OUT", false, "Upset; asked not to be called again.");
        } else if (state.plan === "ASK" && state.planQs.length && currentPlanQ()) {
          // Live call 2026-09-28: a bare "yes" is not an answer. The same ask, more simply.
          reaskPlan();
        } else if (state.plan === "ASK" && state.question) {
          // A bare "yes" to a question that wants a number: ask for the number, in new words.
          say(REPHRASINGS[state.rephrases % REPHRASINGS.length], `REPHRASE_${state.rephrases}`);
          state.rephrases += 1;
        } else {
          await startPlan();
        }
        break;
      case "NO":
        if (state.awaiting === "CONFIRM_EMAIL" || state.awaiting === "CONFIRM_NUMBER") {
          // Never record what they did not confirm: ask again, in new words.
          say(state.awaiting === "CONFIRM_EMAIL" ? "Sorry, could you spell it out for me?" : "Sorry, what was the number again?", `REASK_${state.rephrases}`);
          state.rephrases += 1;
        } else if (state.awaiting === "SLOT" && state.detailsSent) {
          say("No problem at all.");
          await finish(state.detailsSent === "LINK" ? "CONVERSATION" : "CALLBACK_REQUESTED", true, "Details sent; no follow-up call for now.", "Follow up after they read it");
        } else if (state.awaiting === "SEND_QUOTE" || state.awaiting === "SEND_LINK") {
          say("No problem at all.");
          await finish("CONVERSATION", true, "Declined the send for now.");
        } else if (state.awaiting === "STOP_OFFER") {
          say("Thank you. I will let you go.");
          await finish("CONVERSATION", false, "Upset; did not want to continue.");
        } else {
          say("Understood.");
          await finish("CONVERSATION", true, "Conversation.");
        }
        break;
      case "FACT": {
        if (state.awaiting === "GATEKEEPER_TIME") {
          say("Thank you, we will try her again then.");
          await tool("schedule_callback", { by: "PERSON", note: `A colleague answered: ${clean(heardText).slice(0, 120)}` });
          await finish("CALLBACK_REQUESTED", true, "A colleague answered; call the lead again.", "Call the lead again");
          break;
        }
        const n = numberIn(clean(heardText));
        const dimension = state.planQs.length
          ? answerKey(heardText, currentPlanQ()?.key ?? null, planOpenKeys())
          : /team|people|staff|employees|of us/i.test(heardText) ? "TEAM_SIZE" : /month|week|quarter|year|march|spring|soon/i.test(heardText) ? "TIMING" : /budget|£|pounds/i.test(heardText) ? "BUDGET" : /\b(md|director|boss|owner|manager)\b/i.test(heardText) ? "AUTHORITY" : "PROBLEM";
        if (n != null) {
          // §20: read every number back before it is recorded.
          state.pendingFact = { dimension, value: String(n) };
          state.awaiting = "CONFIRM_NUMBER";
          say(`Just to check, that is ${n}, is that right?`, `CONFIRM_${n}`);
        } else {
          await tool("record_fact", { dimension, value: clean(heardText).slice(0, 200), confirmed: false });
          state.factsRecorded += 1;
          state.answered.add(dimension);
          if (state.plan !== "CHECKOUT" && state.planQs.length && askNextPlan("Thanks.")) break;
          if (state.plan !== "CHECKOUT" && qualificationBookingOff()) {
            askCallbackWindow("Thanks, that's really helpful.");
          } else if (state.plan === "CHECKOUT" && state.permissions.checkout) {
            say("Thanks, that helps. Shall I text you the link so you can look it over properly?", "LINK_AFTER_FACT");
            state.awaiting = "SEND_LINK";
          } else if (state.plan === "CHECK_IN" || !state.permissions.book) {
            say("Thanks for letting me know. I will make a note of that.");
            await finish("CONVERSATION", true, "Checked in; noted their update.", "Check in again later");
          } else if (dimension === "AUTHORITY") {
            state.plan = "BOOK";
            await offerSlots("It would be good to get them on the call too");
          } else {
            say("Thanks, that helps. The best next step is a short call with the team.");
            state.plan = "BOOK";
            await startPlan();
          }
        }
        break;
      }
      default:
        break;
    }
    if (state.phase !== "DONE" && (await timeCheck())) break;
  }
  if (state.phase !== "DONE") {
    fallbackAtMs = ms();
    // The script ran out while the agent waited on an answer: the lead has
    // to go (a real call does not end on an unanswered question and a
    // goodbye in the same breath).
    const last = transcript[transcript.length - 1];
    if (last?.speaker === "AGENT" && last.text.trim().endsWith("?")) {
      advance(1.5);
      const start = ms();
      advance(1.2);
      transcript.push({ speaker: "LEAD", text: "Sorry, I have to dash.", startMs: start, endMs: ms() });
    }
    say("Thanks, I will let you go.");
    await finish(state.callbackScheduled ? "CALLBACK_REQUESTED" : "CONVERSATION", true, "Conversation ended.");
  }

  const result: SimResult = {
    key: s.key,
    brief,
    fallbackAtMs,
    transcript,
    tools,
    elapsedSec: Math.round(ms() / 1000),
    disposition,
    closingSpoken,
    firstUtteranceOk,
    loops: state.loops,
    score: { naturalness: 0, loops: 0, route: 0, commercial: 0, duration: 0, tools: 0, disposition: 0, total: 0, notes: [] },
  };
  result.score = score(s, result, route);
  return result;
}

/* ================================================================== scoring */

const MONEY = /£[\d,]+(?:\.\d{2})?|\b\d{1,3}\s?%/g;
/** A clock time or a day the agent said: an availability claim unless a tool (or the lead) said it first. */
const TIME_CLAIM = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
/** An area, a guarantee, a discount or a start date of the agent's own: never allowed (Resolved conflict 1). */
const COMMITMENT_CLAIM = /\bwe (?:do )?(?:cover|serve|work in)\b|\bguarantee(?:d)?\b(?! (?:that )?myself)|\byes,? we(?:'re| are) (?:free|available)\b|\b\d+\s?% off\b|\bdiscount of\b|\bwe can (?:start|deliver|have it)\b/i;
/** The agent claiming to be a person (OD-1: never). */
const CLAIMS_HUMAN = /\bI(?:'m| am) (?:a )?(?:real|human|person)\b|\bI(?:'m| am) not an? (?:ai|robot|bot|machine)\b|\bnot an? (?:ai|robot|bot) assistant\b/i;

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length;
}

/**
 * Tools after which nobody spoke before the lead did (or the call ended):
 * a silent note left the caller in dead air. end_call_summary is the one
 * tool the call may end on; a transfer hands the line to a person.
 */
export function deadAirAfter(r: SimResult): string[] {
  const out: string[] = [];
  for (const t of r.tools) {
    if (t.name === "end_call_summary" || t.name === "transfer_to_human") continue;
    const next = r.transcript.find((u) => u.startMs >= t.atMs);
    if (!next || next.speaker !== "AGENT") {
      // A tool that only ever precedes the final summary with nothing to say is still dead air.
      out.push(t.name);
    }
  }
  return out;
}

/**
 * What the lead heard as ONE turn: every agent utterance between two lead
 * utterances (adversarial QA pass: the scorer used to check each utterance
 * alone, so three back-to-back lines passed "at most two sentences").
 * The locked opener (turn 0) is excluded.
 */
export function agentTurnsMerged(r: SimResult): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  let cur: { text: string; index: number } | null = null;
  r.transcript.forEach((u, i) => {
    if (i === 0) return;
    if (u.speaker === "AGENT") {
      if (cur) cur.text = `${cur.text} ${u.text}`;
      else cur = { text: u.text, index: i };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

/** Fixed text the model does not compose (it is read word for word): exempt from the length rules. */
function lockedTexts(r: SimResult, s: Scenario): string[] {
  const closingText = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;
  return [
    closingText,
    "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.",
    recordingAnswer(s.recording ?? true),
    ...r.tools.map((t) => t.say ?? "").filter(Boolean),
  ];
}

function withoutLocked(text: string, locked: readonly string[]): string {
  let t = text;
  for (const l of locked) if (l) t = t.split(l).join(" ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Compliance and money rules checked on EVERY scenario, whatever it
 * expects (adversarial QA pass). Returns the failures.
 */
export function complianceFailures(s: Scenario, r: SimResult): string[] {
  const out: string[] = [];
  const agent = r.transcript.filter((u, i) => u.speaker === "AGENT" && i > 0);
  const lead = r.transcript.filter((u) => u.speaker === "LEAD");
  const toolSays = r.tools.map((t) => `${t.say ?? ""} ${JSON.stringify(t.args)}`).join(" ");
  const leadWords = lead.map((u) => u.text).join(" ");
  const composed = agent.map((u) => withoutLocked(u.text, r.tools.map((t) => t.say ?? "").filter(Boolean))).join(" \n ");

  if (CLAIMS_HUMAN.test(composed)) out.push("claimed to be human");
  if (COMMITMENT_CLAIM.test(composed)) out.push(`a commitment of its own: "${composed.match(COMMITMENT_CLAIM)?.[0]}"`);
  // Times and days: only as a tool returned them (or echoing the lead's own words).
  const allowed = `${toolSays} ${leadWords}`.toLowerCase();
  for (const claim of composed.match(TIME_CLAIM) ?? []) {
    const c = claim.toLowerCase().replace(/\s+/g, "");
    const day = c.slice(0, 3);
    const ok = /^[a-z]+day$/.test(c) ? allowed.includes(day) : allowed.replace(/\s+/g, "").includes(c);
    if (!ok) out.push(`time or day not from a tool: ${claim}`);
  }
  // An opt-out is confirmed with the tool's own words, and nothing is said after it.
  const optIdx = r.tools.findIndex((t) => t.name === "opt_out");
  if (optIdx >= 0) {
    const opt = r.tools[optIdx];
    const after = agent.filter((u) => u.startMs >= opt.atMs);
    if (s.expect.disposition === "OPTED_OUT") {
      if (after.length !== 1 || after[0].text !== opt.say) out.push(`after opt_out the agent said: ${after.map((u) => u.text).join(" / ") || "(nothing)"}`);
    }
    if (r.closingSpoken) out.push("the closing line after an opt-out");
  }
  // Asked whether the call is recorded: the locked answer, word for word.
  if (lead.some((u) => detectSpokenIntents(u.text).some((i) => i.key === "PRIVACY") && /\brecord/i.test(u.text))) {
    if (!agent.some((u) => u.text.includes(recordingAnswer(s.recording ?? true)))) out.push("the recording answer was not the locked line");
  }
  if (/\bmay be recorded\b/i.test(composed)) out.push('"may be recorded" (vague)');
  // Asked if it is an AI: an honest yes.
  if (lead.some((u) => detectSpokenIntents(u.text).some((i) => i.key === "ASKS_IF_AI")) && !/\bAI assistant\b/.test(composed)) out.push("no honest AI answer");
  // A call screen: the AI disclosure and who is calling, nothing else.
  if (lead.some((u) => detectSpokenIntents(u.text).some((i) => i.key === "CALL_SCREEN")) && !/Acme Studio's AI assistant/.test(composed)) out.push("the screen was not told who is calling");
  // A vulnerable person: no question, nothing recorded, nothing booked.
  if (lead.some((u) => detectSpokenIntents(u.text).some((i) => i.key === "VULNERABLE"))) {
    const vIdx = r.transcript.findIndex((u) => u.speaker === "LEAD" && detectSpokenIntents(u.text).some((i) => i.key === "VULNERABLE"));
    if (r.transcript.slice(vIdx).some((u) => u.speaker === "AGENT" && u.text.includes("?"))) out.push("asked a vulnerable person a question");
    if (r.tools.some((t) => ["record_fact", "book_meeting", "schedule_callback", "send_booking_link"].includes(t.name))) out.push("acted on a vulnerable person's call");
  }
  // Nothing unconfirmed with a number or an address in it is recorded (§20).
  for (const t of r.tools.filter((x) => x.name === "record_fact")) {
    const a = t.args as { value?: string; confirmed?: boolean };
    if (/@|\d/.test(a.value ?? "") && !a.confirmed) out.push(`recorded an unconfirmed ${a.value}`);
  }
  // A call-back is always in the future.
  for (const t of r.tools.filter((x) => x.name === "schedule_callback")) {
    const at = (t.args as { at_iso?: string | null }).at_iso;
    if (at && new Date(at).getTime() <= START.getTime() + t.atMs - (s.startElapsedSec ?? 0) * 1000) out.push(`call-back in the past: ${at}`);
  }
  out.push(...liveCallFailures(s, r));
  return out;
}

/* ============================== the live-call checks (owner's first real call, 2026-09-28) */

/** Tools that take a next step: a close, a send, a call-back. */
const CLOSE_TOOLS: ReadonlySet<string> = new Set(["check_availability", "book_meeting", "send_checkout_link", "send_booking_link", "calculate_quote", "send_quote", "schedule_callback"]);
/** Words that move to a next step without a tool (the live call's "A colleague will send you the details"). */
const CLOSE_PHRASE = /\b(a colleague will|the best next step|good time for a (?:quick )?(?:follow-up|call)|I can offer)\b/i;
/** Lead intents that do not start a close (the agent answers them and carries on). */
const BENIGN_INTENTS: ReadonlySet<string> = new Set(["ASKS_IF_AI", "WHO_IS_THIS", "HOW_GOT_NUMBER", "PRIVACY", "LINE_CHECK"]);
/** NBA actions after which a qualification call has no plan by design (the engine decided). */
const NO_PLAN_ACTIONS: ReadonlySet<string> = new Set(["ESCALATE", "DISQUALIFY", "NO_ACTION", "WAIT", "CTA_BOOK", "CTA_CHECKOUT", "CTA_SIGNUP"]);
/** With no plan in the brief, a qualification call still needs this many questions before a close. */
export const MIN_QUALIFYING_QUESTIONS = 3;

/** When the call first moved to a next step (ms), or null. */
function firstCloseAt(r: SimResult, closingText: string): number | null {
  const times: number[] = [];
  const tool = r.tools.find((t) => CLOSE_TOOLS.has(t.name));
  if (tool) times.push(tool.atMs - 1);
  const says = r.tools.map((t) => t.say ?? "").filter(Boolean);
  for (const [i, u] of r.transcript.entries()) {
    if (i === 0 || u.speaker !== "AGENT") continue;
    if (u.text.includes(closingText) || CLOSE_PHRASE.test(withoutLocked(u.text, says))) {
      times.push(u.startMs);
      break;
    }
  }
  return times.length ? Math.min(...times) : null;
}

/** The lead started the next step themselves before `at` (a stop, a person, "send me something", "book it", a price...). */
function leadInitiated(r: SimResult, at: number): boolean {
  return r.transcript.some((u) => {
    if (u.speaker !== "LEAD" || u.startMs >= at) return false;
    const t = u.text;
    if (detectSpokenIntents(t).some((i) => !BENIGN_INTENTS.has(i.key))) return true;
    return BUY.test(t) || BOOK.test(t) || detectQuoteRequest(t) || detectDiscountAsk(t) || detectBuyingSignal(t);
  });
}

/**
 * The failures of the owner's first real call, checked on EVERY scenario:
 *   1. a qualification call closes only after the brief's required plan
 *      questions were asked (unless the lead took it elsewhere, the call went
 *      round in circles, or the time plan said to wrap up), and its brief
 *      carries a plan at all;
 *   2. no availability offered before a check_availability returned times;
 *   3. no "checking availability" line when the brief says booking is off;
 *   4. no claim about the business that the approved offer lines do not make;
 *   5. the summary never labels the lead "qualified" (the engine's verdict).
 */
export function liveCallFailures(s: Scenario, r: SimResult): string[] {
  const out: string[] = [];
  const closingText = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;
  const says = r.tools.map((t) => t.say ?? "").filter(Boolean);
  const locked = [...says, closingText, "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.", recordingAnswer(s.recording ?? true)];
  const agent = r.transcript.filter((u, i) => u.speaker === "AGENT" && i > 0);

  if (r.brief.route === "QUALIFICATION") {
    const expected = !s.nba?.handover_reason && !NO_PLAN_ACTIONS.has(s.nba?.next_action ?? "");
    const plan = planFromBrief(r.brief.text);
    if (expected && !plan.questions.length) out.push("a qualification call whose brief has no QUESTION PLAN");
    const required = plan.questions.length ? plan.required : expected ? MIN_QUALIFYING_QUESTIONS : 0;
    const closeAt = firstCloseAt(r, closingText);
    const scriptEnded = r.fallbackAtMs != null && closeAt != null && closeAt >= r.fallbackAtMs;
    if (required > 0 && closeAt != null && !scriptEnded && !leadInitiated(r, closeAt) && !r.loops.loopsDetected.length) {
      const level = governTime({ route: "QUALIFICATION", elapsedSec: closeAt / 1000 }).level;
      if (level === "GREEN") {
        const before = agent.filter((u) => u.startMs < closeAt).map((u) => u.text).join(" ");
        // Asked, or already answered by something the lead said (the plan skips what is known).
        const recorded = new Set(r.tools.filter((t) => t.name === "record_fact" && t.atMs <= closeAt).map((t) => String((t.args as { dimension?: string }).dimension)));
        const asked = plan.questions.length
          ? plan.questions.filter((q) => before.includes(q.text) || recorded.has(q.key)).length
          : (before.match(/\?/g) ?? []).length;
        if (asked < required) out.push(`moved to a next step after ${asked} of ${required} qualifying questions`);
      }
    }
  }

  const check = r.tools.find((t) => t.name === "check_availability" && t.ok);
  for (const u of agent) {
    if (check && u.startMs >= check.atMs - TOOL_SEC * 1000) break;
    for (const x of availabilityOffers(withoutLocked(u.text, locked))) out.push(`availability not from a tool: "${x}"`);
  }
  if (/BOOKING IS OFF/.test(r.brief.text)) {
    for (const u of agent) for (const x of checkingAvailabilityLines(withoutLocked(u.text, locked))) out.push(`"checking availability" with booking off: "${x}"`);
  }
  const approved = offerLinesFromBrief(r.brief.text);
  for (const u of agent) for (const x of unapprovedClaimSentences(withoutLocked(u.text, locked), approved)) out.push(`a claim not in the offer lines: "${x}"`);
  for (const t of r.tools.filter((x) => x.name === "end_call_summary")) {
    const summary = String((t.args as { summary?: string }).summary ?? "");
    if (stripQualifiedLabel(summary, null).changed) out.push(`the summary labels the lead qualified: "${summary}"`);
  }
  return out;
}

/* ================================================ replaying a recorded call */

export type RecordedCall = {
  lines: { speaker: "AGENT" | "LEAD"; text: string }[];
  /** Tools the model called, after the line at `afterLine` (0-based index into `lines`). */
  tools: { afterLine: number; name: VoiceToolName; args: Record<string, unknown>; ok: boolean; say: string | null; code?: string }[];
};

/**
 * Scores a call that really happened (the transcript and tool calls as the
 * provider recorded them) with the SAME scorer, against the brief the call
 * WOULD get now. The owner's first real call must fail it; the scripted
 * agent on the same lead lines must pass.
 */
export function scoreRecorded(s: Scenario, rec: RecordedCall): SimResult {
  const { brief } = briefFor(s);
  const transcript: Utterance[] = [];
  const tools: ToolTrace[] = [];
  let t = 0;
  let loops = initialLoopState();
  const avail = { textFollowUpLawful: true, humanAvailable: false };
  rec.lines.forEach((l, i) => {
    const dur = Math.round((countWords(l.text) / (l.speaker === "AGENT" ? AGENT_WPM : 160)) * 60_000);
    transcript.push({ speaker: l.speaker, text: l.text, startMs: t, endMs: t + dur });
    loops = observeTurn(loops, l.speaker === "AGENT" ? { speaker: "AGENT", text: l.text, questionKey: null } : { speaker: "LEAD", text: l.text }, avail).state;
    t += dur + 700;
    for (const x of rec.tools.filter((y) => y.afterLine === i)) {
      t += TOOL_SEC * 1000;
      tools.push({ name: x.name, args: x.args, status: 200, ok: x.ok, say: x.say, code: x.code, timeLevel: "GREEN", atMs: t });
    }
  });
  const closingText = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;
  const summary = tools.find((x) => x.name === "end_call_summary");
  const result: SimResult = {
    key: s.key,
    brief,
    fallbackAtMs: null,
    transcript,
    tools,
    elapsedSec: Math.round(t / 1000),
    disposition: (summary?.args as { disposition?: string } | undefined)?.disposition ?? null,
    closingSpoken: rec.lines.some((l) => l.speaker === "AGENT" && l.text.includes(closingText)),
    firstUtteranceOk: true,
    loops,
    score: { naturalness: 0, loops: 0, route: 0, commercial: 0, duration: 0, tools: 0, disposition: 0, total: 0, notes: [] },
  };
  result.score = score(s, result, timeRouteFor(s.route));
  return result;
}

export function score(s: Scenario, r: SimResult, route: VoiceRouteKey): Score {
  const notes: string[] = [];
  // Naturalness proxies, on what the lead heard as one turn: length (the pace
  // targets for THIS lead), at most one question, at most two sentences of
  // the agent's own words, no dashes, emoji, lists or links. Locked text (the
  // closing line, the identity answer, the recording answer, a tool's own
  // words) is read word for word and is not counted against length.
  const locked = lockedTexts(r, s);
  const closingText = locked[0];
  const turns = agentTurnsMerged(r);
  let natural = 0;
  for (const turn of turns) {
    const targets = agentTargets(measurePace(r.transcript.slice(0, turn.index)));
    const own = withoutLocked(turn.text, locked);
    const heard = turn.text.split(closingText).join(" ");
    const problems: string[] = [...houseStyleViolations(turn.text)];
    if (own) problems.push(...checkAgentTurn(own, targets).filter((x) => x !== "MULTIPLE_QUESTIONS"));
    if ((heard.match(/\?/g) ?? []).length > targets.maxQuestionsPerTurn) problems.push("MULTIPLE_QUESTIONS");
    if (own && sentenceCount(own) > MAX_SENTENCES_PER_TURN) problems.push("TOO_MANY_SENTENCES");
    if (problems.length) notes.push(`turn "${turn.text.slice(0, 60)}": ${problems.join(",")}`);
    else natural++;
  }
  // Dead air (Retell speak_after_execution): every tool except the final
  // summary is followed by an agent line before the lead speaks again.
  const silent = deadAirAfter(r);
  if (silent.length) notes.push(`dead air after ${silent.join(",")}`);
  const naturalness = silent.length ? 0 : turns.length ? Math.round((25 * natural) / turns.length) : 25;

  const repeated = r.loops.loopsDetected.filter((k) => k === "REPEATED_QUESTION").length;
  const loops = repeated === 0 ? 15 : 0;
  if (repeated) notes.push(`repeated question x${repeated}`);

  const routeOk = r.brief.route === s.route && r.brief.record.route === s.route;
  const routeScore = routeOk ? 10 : 0;

  const agentTurns = r.transcript.filter((u, i) => u.speaker === "AGENT" && i > 0 && u.text !== closingText);
  const called = new Set(r.tools.filter((t) => t.ok).map((t) => t.name));
  const missing = s.expect.tools.filter((t) => !called.has(t));
  const forbidden = (s.expect.forbiddenTools ?? []).filter((t) => r.tools.some((x) => x.name === t));
  // The money rule: every figure the agent said came from a tool in this call.
  const toolWords = r.tools.map((t) => `${t.say ?? ""} ${JSON.stringify(t.args)}`).join(" ");
  const invented = agentTurns.flatMap((u) => u.text.match(MONEY) ?? []).filter((fig) => !toolWords.includes(fig));
  const agentText = agentTurns.map((u) => u.text).join(" \n ");
  const saysMissing = (s.expect.agentSays ?? []).filter((re) => !re.test(agentText));
  const saysForbidden = (s.expect.agentNeverSays ?? []).filter((re) => re.test(agentText));
  const optOut = r.tools.find((t) => t.name === "opt_out");
  const scopeWrong = s.expect.optOutScope && (optOut?.args as { scope?: string } | undefined)?.scope !== s.expect.optOutScope;
  const quote = r.tools.find((t) => t.name === "calculate_quote");
  const itemsWrong = s.expect.quoteItems != null && ((quote?.args as { items?: unknown[] } | undefined)?.items?.length ?? 0) !== s.expect.quoteItems;
  const compliance = complianceFailures(s, r);
  if (missing.length) notes.push(`missing tools: ${missing.join(",")}`);
  if (forbidden.length) notes.push(`forbidden tools: ${forbidden.join(",")}`);
  if (invented.length) notes.push(`invented figures: ${invented.join(",")}`);
  if (saysMissing.length) notes.push(`never said: ${saysMissing.map(String).join(",")}`);
  if (saysForbidden.length) notes.push(`said: ${saysForbidden.map(String).join(",")}`);
  if (scopeWrong) notes.push(`opt_out scope ${(optOut?.args as { scope?: string } | undefined)?.scope}, expected ${s.expect.optOutScope}`);
  if (itemsWrong) notes.push("quote items wrong");
  for (const c of compliance) notes.push(`compliance: ${c}`);
  const commercial = !missing.length && !forbidden.length && !invented.length && !saysMissing.length && !saysForbidden.length && !scopeWrong && !itemsWrong && !compliance.length ? 20 : 0;

  const maxSec = s.expect.maxSec ?? ROUTE_TARGETS[route].maxSec;
  const durationOk = r.elapsedSec <= maxSec && r.elapsedSec <= PROVIDER_MAX_DURATION_SEC;
  if (!durationOk) notes.push(`duration ${r.elapsedSec}s > ${maxSec}s`);
  const duration = durationOk ? 15 : 0;

  const toolsOk = r.tools.every((t) => t.status === 200) && r.firstUtteranceOk;
  if (!toolsOk) notes.push("a tool call or the first utterance failed");
  const toolsScore = toolsOk ? 5 : 0;

  const dispositionOk = r.disposition === s.expect.disposition && r.closingSpoken === s.expect.closing && r.tools.some((t) => t.name === "end_call_summary");
  if (!dispositionOk) notes.push(`disposition ${r.disposition} (closing ${r.closingSpoken}), expected ${s.expect.disposition} (closing ${s.expect.closing})`);
  const dispositionScore = dispositionOk ? 10 : 0;

  const total = naturalness + loops + routeScore + commercial + duration + toolsScore + dispositionScore;
  return { naturalness, loops, route: routeScore, commercial, duration, tools: toolsScore, disposition: dispositionScore, total, notes };
}
