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
import { buildLockedPreamble, houseStyleViolations, renderClosingLine, validateFirstUtterance } from "../../../src/lib/voice/opener.ts";
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
import type { NextBestAction } from "../../../src/lib/qualification-intelligence/types.ts";

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
  const digits = /\b(\d{1,5})\b/.exec(text);
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
            say: "I have Wed 30 Sep, 10:00am or Wed 30 Sep, 2:00pm. Does either work?",
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
          return { ok: true, say: `You are booked for ${label}. You will get a calendar invite by email.`, data: { outcome: "confirmed", label }, operation: "booking.create" };
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
  | { kind: "OPT_OUT"; scope: "CALLS" | "ALL" }
  | { kind: "WRONG_NUMBER" }
  | { kind: "GATEKEEPER" }
  | { kind: "ANGRY"; complaint: boolean }
  | { kind: "NOT_NOW" }
  | { kind: "BAD_LINE" }
  | { kind: "HUMAN" }
  | { kind: "AI_Q" }
  | { kind: "IDENTITY"; how: boolean }
  | { kind: "PRIVACY" }
  | { kind: "LANGUAGE" }
  | { kind: "DISCOUNT" }
  | { kind: "QUOTE" }
  | { kind: "BUY" }
  | { kind: "BOOK" }
  | { kind: "SEND" }
  | { kind: "OBJECTION"; key: string; refusal: boolean }
  | { kind: "MISUNDERSTOOD"; who: "LEAD" | "AGENT" }
  | { kind: "SLOT"; index: number }
  | { kind: "YES" }
  | { kind: "NO" }
  | { kind: "TIME"; hour: number; tomorrow: boolean }
  | { kind: "FACT"; text: string };

const OPT_OUT = /\b(stop calling|don'?t call (me|us)( again)?|do not call|never call|remove (me|my number)|take me off)\b/i;
const NOT_NOW = /\b(not a good time|bad time|i'?m driving|in a meeting|call (me )?back later|busy right now)\b/i;
const HUMAN = /\b(real person|a human|speak to (someone|a person|a human)|put me through|talk to someone)\b/i;
const BUY = /\b(buy it|buy now|sign up|get started|pay now|purchase|order it)\b/i;
const BOOK = /\b(book (a|the) (call|meeting)|arrange a (call|meeting)|meeting with your team|call with your team)\b/i;
const HUH = /\b(sorry,? what|pardon|didn'?t catch|say that again|what was that)\b/i;
const YES = /\b(yes|yeah|yep|yup|aye|sure|ok|okay|fine|go on|sounds good|please do|that works|absolutely|righto|go ahead)\b/i;
const NO = /\b(no|nope|not really|nah)\b/i;
const DECLINE = /\b(no|not yet|i'?ll (read|have a look|look)|let me (read|look)|i'?ll use the link|leave it there)\b/i;
const BAD_LINE = /\b(breaking up|bad line|line('s| is) (bad|terrible)|on (a|the) train|can'?t hear you)\b/i;

function clean(text: string): string {
  return text.replace(/\[(noise|inaudible|crosstalk)\]/gi, " ").replace(/\s+/g, " ").trim();
}

function hear(raw: string, state: AgentState): Heard {
  const text = clean(raw);
  if (!text || countWords(text) === 0) return { kind: "MISUNDERSTOOD", who: "AGENT" };
  const intents = detectSpokenIntents(text);
  const has = (k: string) => intents.some((i) => i.key === k);
  // A machine and a stop come before everything else (speech-intents order).
  if (has("VOICEMAIL") || has("IVR")) return { kind: "MACHINE" };
  const optOut = intents.find((i) => i.key === "OPT_OUT_ALL" || i.key === "OPT_OUT_CALLS");
  if (optOut || OPT_OUT.test(text)) return { kind: "OPT_OUT", scope: optOut?.optOutScope ?? "CALLS" };
  if (state.awaiting === "STOP_OFFER" && YES.test(text)) return { kind: "OPT_OUT", scope: "CALLS" };
  if (has("WRONG_NUMBER")) return { kind: "WRONG_NUMBER" };
  if (has("GATEKEEPER")) return { kind: "GATEKEEPER" };
  if (has("ANGRY")) return { kind: "ANGRY", complaint: /\bcomplain|complaint\b/i.test(text) };
  if ((state.phase === "PERMISSION" || state.awaiting === "CALLBACK_TIME" || state.awaiting === "GATEKEEPER_TIME") && (NOT_NOW.test(text) || has("BAD_TIME")) && !BAD_LINE.test(text)) {
    const hour = numberIn(text);
    if (hour != null) return { kind: "TIME", hour: hour < 8 ? hour + 12 : hour, tomorrow: /tomorrow/i.test(text) };
    return { kind: "NOT_NOW" };
  }
  if (state.awaiting === "CALLBACK_TIME" || state.awaiting === "GATEKEEPER_TIME") {
    const hour = numberIn(text);
    if (hour != null) return { kind: "TIME", hour: hour < 8 ? hour + 12 : hour, tomorrow: /tomorrow/i.test(text) };
  }
  if (HUMAN.test(text) || has("WANTS_PERSON")) return { kind: "HUMAN" };
  if (has("ASKS_IF_AI")) return { kind: "AI_Q" };
  if (has("HOW_GOT_NUMBER") || has("WHO_IS_THIS")) return { kind: "IDENTITY", how: has("HOW_GOT_NUMBER") };
  if (has("PRIVACY")) return { kind: "PRIVACY" };
  if (has("LANGUAGE_BARRIER")) return { kind: "LANGUAGE" };
  if (detectDiscountAsk(text)) return { kind: "DISCOUNT" };
  if (detectQuoteRequest(text) || /\bhow much (is it|does it cost|would it be)\b/i.test(text)) return { kind: "QUOTE" };
  if (BUY.test(text)) return { kind: "BUY" };
  if (state.awaiting === "SLOT") {
    if (/^(no|nah|not yet)\b|\bi'?ll (read|have a look|look|use the link)\b|\blet me (read|look)\b/i.test(text)) return { kind: "NO" };
    if (/\b(first|earlier|morning|10|ten|either)\b/i.test(text)) return { kind: "SLOT", index: 0 };
    if (/\b(second|later|afternoon|2|two)\b/i.test(text)) return { kind: "SLOT", index: 1 };
    if (DECLINE.test(text) && !YES.test(text)) return { kind: "NO" };
  }
  // An answer to what the agent is waiting on beats a new topic.
  if (state.awaiting && state.awaiting !== "SLOT" && YES.test(text) && !has("SEND_DETAILS")) return { kind: "YES" };
  if (state.awaiting === "TEXT_OFFER" && YES.test(text)) return { kind: "YES" };
  if (BAD_LINE.test(text) || has("BAD_TIME")) return { kind: "BAD_LINE" };
  if (has("SEND_DETAILS")) return { kind: "SEND" };
  if (BOOK.test(text) || ((has("BUYING_SIGNAL") || detectBuyingSignal(text)) && state.permissions.book && state.plan !== "CHECKOUT")) return { kind: "BOOK" };
  if (has("NOT_INTERESTED")) return { kind: "OBJECTION", key: "NOT_INTERESTED", refusal: true };
  const objection = intents.find((i) => i.key === "OBJECTION");
  if (objection?.objectionKey) return { kind: "OBJECTION", key: objection.objectionKey, refusal: OBJECTIONS[objection.objectionKey].respectAsRefusal };
  if (HUH.test(text)) return { kind: "MISUNDERSTOOD", who: "LEAD" };
  // "Okay, about ten of us": an answer with a number is the answer, not a yes.
  if (!state.awaiting && state.plan === "ASK" && numberIn(text) != null) return { kind: "FACT", text };
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
  awaiting: "SLOT" | "CONFIRM_NUMBER" | "CONFIRM_SLOT" | "SEND_QUOTE" | "SEND_LINK" | "CALLBACK_TIME" | "GATEKEEPER_TIME" | "TEXT_OFFER" | "STOP_OFFER" | null;
  pendingFact: { dimension: string; value: string } | null;
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
};

/** Different words for the same ask, so a rephrase is never a repeated question (anti-loop). */
const REPHRASINGS = [
  "In other words, roughly how big is the team?",
  "Put simply, how many of you would use it?",
  "Just a rough number is fine. Is it a small team or a large one?",
];
const MISSED = ["Sorry, I missed that. Could you say it once more?", "Sorry, the line dropped for a second. What was that?", "I did not quite catch that, sorry. Could you repeat it?"];

function planOf(brief: CallBrief): { plan: Plan; question: string | null } {
  const move = brief.move;
  if (/check_availability|book_meeting/.test(move)) return { plan: "BOOK", question: null };
  if (/send_checkout_link/.test(move)) return { plan: "CHECKOUT", question: null };
  const q = /in your own natural words: (.+?\?)/.exec(move);
  if (q) return { plan: "ASK", question: q[1] };
  const ask = /Ask (?:lightly )?(whether .+?\.|what .+?\.|how .+?\.)/.exec(move);
  return { plan: "CHECK_IN", question: ask ? `Can I ask ${ask[1].replace(/\.$/, "?")}` : "How are things going with what you enquired about?" };
}

/** The approved offer line with no figure in it: the only "reason" the scripted agent may give. */
const REASON_LINE = "Every site comes with a year of support";

export async function simulate(s: Scenario): Promise<SimResult> {
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
    offerLines: ["Websites from £4,000", "Care plans at £49 per month", REASON_LINE],
    workspaceObjections: null,
    booking: "SLOTS",
    permissions,
    transfer: s.transfer ?? { mode: "ON_REQUEST", available: false },
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: closing.text,
  });
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
    detailsSent: null, callbackScheduled: false, objections: {},
  };
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
    const [a, b] = state.slots;
    if (lead) say(lead);
    if (state.slotOffers === 1 && !lead) say(r.say ?? "", "SLOTS");
    else say(`I can do ${a.label.replace(/^Wed 30 Sep, /, "Wednesday at ")} or ${b.label.replace(/^Wed 30 Sep, /, "")}. Which is better?`, `SLOTS_${state.slotOffers}`);
    state.awaiting = "SLOT";
    return true;
  };

  const startPlan = async (): Promise<void> => {
    if (state.plan === "BOOK") {
      await offerSlots();
    } else if (state.plan === "CHECKOUT") {
      say("Would you like me to text you the link to get started?", "LINK");
      state.awaiting = "SEND_LINK";
    } else {
      say(state.question ?? "What prompted your enquiry?", "Q1");
    }
  };

  /** After a side question (is this a robot, who is this, privacy): carry on, in fresh words. */
  const carryOn = async (prefix: string) => {
    if (state.awaiting === "SLOT") {
      say(prefix);
      say("Would the morning or the afternoon suit you better?", "SLOT_AMPM");
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
      say(`${REASON_LINE}.`);
      say("Shall I text you the link so you can look it over properly?", "LINK_2");
      state.plan = "CHECKOUT";
      state.awaiting = "SEND_LINK";
    } else if (state.permissions.book) {
      state.plan = "BOOK";
      await offerSlots(`${REASON_LINE}. A short call might help you weigh it up.`);
    } else {
      say(`${REASON_LINE}. A colleague can take you through it properly.`);
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
  const preamble = buildLockedPreamble({ callingAsName: "Acme Studio", enquiryAt: new Date(START.getTime() - 86_400_000), now: START, timezone: "Europe/London", recordingEnabled: true });
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

    // ---- what must be handled whatever the phase (speech-intents playbook)
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
        say("I am sorry about that. Let me get a colleague to deal with it properly.");
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
      const honest = "Yes, I am an AI assistant calling for Acme Studio. A person can follow up if you would prefer.";
      if (state.phase === "PERMISSION") {
        // Nothing is pitched before they said now is all right.
        say(honest);
        say("Is now still an OK time?", "PERMISSION_AI");
      } else await carryOn(honest);
      continue;
    }
    if (h.kind === "IDENTITY") {
      const answer = h.how
        ? "You gave us this number when you enquired yesterday. I can stop calling if you would rather."
        : "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.";
      if (state.phase === "PERMISSION") {
        say(answer);
        say("Is now all right for a quick chat?", "PERMISSION_2");
      } else await carryOn(answer);
      continue;
    }
    if (h.kind === "PRIVACY") {
      await tool("log_objection", { key: "COMPLIANCE", excerpt: clean(heardText).slice(0, 200), handled: "PARTIALLY_RESOLVED" });
      await carryOn("The call may be recorded, as I said. Acme Studio's privacy notice covers the rest, and a colleague can answer anything more.");
      continue;
    }
    if (h.kind === "LANGUAGE") {
      state.languageTries += 1;
      if (state.languageTries === 1) {
        say("No problem. I will speak slowly.");
        say(state.phase === "PERMISSION" ? "Is now a good time?" : "Would a call with our team help?", "SLOW_1");
        continue;
      }
      if (state.permissions.bookingLink) {
        const r = await tool("send_booking_link", { channel: "sms" });
        say(r.ok ? "I will text you the details instead. Thank you." : "A colleague will send you the details.");
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
      } else if (h.kind === "QUOTE" || h.kind === "BUY" || h.kind === "SEND" || h.kind === "HUMAN" || h.kind === "DISCOUNT") {
        // "Yes, go on, how much is it?": answer what they asked first.
        state.phase = "MAIN";
      } else {
        state.phase = "MAIN";
        await startPlan();
        if (await timeCheck()) break;
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
        if (h.who === "LEAD") {
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
        if (state.slotOffers > 0) await offerSlots("Great.");
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
          say("Happy to. A colleague will email the details over today.");
          await tool("schedule_callback", { by: "PERSON", note: "Send the details by email" });
          state.detailsSent = "COLLEAGUE";
          state.callbackScheduled = true;
        }
        if (state.permissions.book && state.slotOffers === 0) {
          state.plan = "BOOK";
          await offerSlots("And a quick follow-up once you have read it?");
        } else if (state.permissions.book) {
          say("Or if you would rather, I can hold one of those times for a quick follow-up. Shall I?", "HOLD_SLOT");
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
        say(`Fair enough. ${OBJECTIONS[h.key as keyof typeof OBJECTIONS].clarifyingQuestion}`, `OBJ_${h.key}`);
        break;
      }
      case "SLOT": {
        const slot = state.slots[h.index] ?? state.slots[0];
        const r = await tool("book_meeting", { start_iso: slot.start });
        say(r.say ?? "A colleague will confirm the time.");
        await finish(r.ok ? "MEETING_BOOKED" : "CALLBACK_REQUESTED", true, r.ok ? `Booked for ${slot.label}.` : "Booking to be confirmed.", r.ok ? `Meeting ${slot.label}` : undefined);
        break;
      }
      case "TIME": {
        const at = new Date(Date.UTC(2026, 8, h.tomorrow ? 30 : 29, h.hour - 1, 0, 0));
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
          say(`Just to check, shall I book ${state.slots[0].label.replace(/^Wed 30 Sep, /, "Wednesday at ")}?`, "CONFIRM_SLOT");
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
        } else if (state.awaiting === "CONFIRM_NUMBER" && state.pendingFact) {
          await tool("record_fact", { ...state.pendingFact, confirmed: true });
          state.factsRecorded += 1;
          state.pendingFact = null;
          state.awaiting = null;
          if (await timeCheck()) break;
          if (state.permissions.book) {
            say("Thanks. The best next step is a short call with the team.");
            state.plan = "BOOK";
            await startPlan();
          } else {
            say("Thanks, that is really helpful. A colleague will follow up with the next step.");
            await finish("CONVERSATION", true, "Qualified on the call.", "A colleague follows up");
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
        } else if (state.plan === "ASK" && state.question) {
          // A bare "yes" to a question that wants a number: ask for the number, in new words.
          say(REPHRASINGS[state.rephrases % REPHRASINGS.length], `REPHRASE_${state.rephrases}`);
          state.rephrases += 1;
        } else {
          await startPlan();
        }
        break;
      case "NO":
        if (state.awaiting === "SLOT" && state.detailsSent) {
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
        const dimension = /team|people|staff|employees|of us/i.test(heardText) ? "TEAM_SIZE" : /month|week|quarter|year|march|spring|soon/i.test(heardText) ? "TIMING" : /budget|£|pounds/i.test(heardText) ? "BUDGET" : /\b(md|director|boss|owner|manager)\b/i.test(heardText) ? "AUTHORITY" : "PROBLEM";
        if (n != null) {
          // §20: read every number back before it is recorded.
          state.pendingFact = { dimension, value: String(n) };
          state.awaiting = "CONFIRM_NUMBER";
          say(`Just to check, that is ${n}, is that right?`, `CONFIRM_${n}`);
        } else {
          await tool("record_fact", { dimension, value: clean(heardText).slice(0, 200), confirmed: false });
          state.factsRecorded += 1;
          if (state.plan === "CHECK_IN" || !state.permissions.book) {
            say("Thanks for letting me know. I will make a note of that.");
            await finish("CONVERSATION", true, "Checked in; noted their update.", "Check in again later");
          } else if (dimension === "AUTHORITY") {
            state.plan = "BOOK";
            await offerSlots("Shall we get them on the call too?");
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
    say("Thanks, I will let you go.");
    await finish(state.callbackScheduled ? "CALLBACK_REQUESTED" : "CONVERSATION", true, "Conversation ended.");
  }

  const result: SimResult = {
    key: s.key,
    brief,
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

export function score(s: Scenario, r: SimResult, route: VoiceRouteKey): Score {
  const notes: string[] = [];
  const closingText = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;
  // Naturalness proxies: turn length (the pace targets for THIS lead), one
  // question, at most two sentences, no dashes, emoji, lists or links. The
  // locked opener and the fixed closing line are excluded (fixed text).
  const agentTurns = r.transcript.filter((u, i) => u.speaker === "AGENT" && i > 0 && u.text !== closingText);
  let natural = 0;
  for (let i = 0; i < agentTurns.length; i++) {
    const idx = r.transcript.indexOf(agentTurns[i]);
    const targets = agentTargets(measurePace(r.transcript.slice(0, idx)));
    const problems = [...checkAgentTurn(agentTurns[i].text, targets), ...houseStyleViolations(agentTurns[i].text)];
    if (sentenceCount(agentTurns[i].text) > MAX_SENTENCES_PER_TURN) problems.push("TOO_MANY_SENTENCES" as never);
    if (problems.length) notes.push(`turn "${agentTurns[i].text.slice(0, 40)}": ${problems.join(",")}`);
    else natural++;
  }
  // Dead air (Retell speak_after_execution): every tool except the final
  // summary is followed by an agent line before the lead speaks again.
  const silent = deadAirAfter(r);
  if (silent.length) notes.push(`dead air after ${silent.join(",")}`);
  const naturalness = silent.length ? 0 : agentTurns.length ? Math.round((25 * natural) / agentTurns.length) : 25;

  const repeated = r.loops.loopsDetected.filter((k) => k === "REPEATED_QUESTION").length;
  const loops = repeated === 0 ? 15 : 0;
  if (repeated) notes.push(`repeated question x${repeated}`);

  const routeOk = r.brief.route === s.route && r.brief.record.route === s.route;
  const routeScore = routeOk ? 10 : 0;

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
  if (missing.length) notes.push(`missing tools: ${missing.join(",")}`);
  if (forbidden.length) notes.push(`forbidden tools: ${forbidden.join(",")}`);
  if (invented.length) notes.push(`invented figures: ${invented.join(",")}`);
  if (saysMissing.length) notes.push(`never said: ${saysMissing.map(String).join(",")}`);
  if (saysForbidden.length) notes.push(`said: ${saysForbidden.map(String).join(",")}`);
  if (scopeWrong) notes.push(`opt_out scope ${(optOut?.args as { scope?: string } | undefined)?.scope}, expected ${s.expect.optOutScope}`);
  if (itemsWrong) notes.push("quote items wrong");
  const commercial = !missing.length && !forbidden.length && !invented.length && !saysMissing.length && !saysForbidden.length && !scopeWrong && !itemsWrong ? 20 : 0;

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
