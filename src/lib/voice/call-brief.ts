/**
 * The call brief (voice phase P3, brief §2, §6, §15 to §24). Pure.
 *
 * A voice call is an execution surface of the SAME sales agent as text, not a
 * second agent. Vercel serverless cannot hold Retell's custom-LLM websocket,
 * so the conversation runs on Retell's hosted LLM ("retell-llm"), and
 * ClientTurn drives it two ways (docs/VOICE.md §16):
 *
 *   1. this brief: a per-call plan passed as Retell dynamic variables
 *      (`call_brief`, `time_plan`, `known_facts`, ...) and read by the fixed
 *      general prompt (`voice/tools/definitions.ts` RETELL_GENERAL_PROMPT);
 *   2. custom functions: every action is a ClientTurn tool behind the service
 *      registry (`voice/tools/core.ts`), so the model decides nothing binding.
 *
 * The brief is built from the same inputs a text turn uses: the goal, the
 * lead's current next-best-action (qualification-intelligence nba.ts), what
 * is already known (never re-asked), the offer card's approved lines, the
 * sales library's objection playbooks plus the business's own answers, the
 * motion's close (agent/closing.ts), the loop ladder (anti-loop.ts) and the
 * pacing rules (pacing.ts). Only the wording is adapted for speech.
 *
 * Resolved conflict 1 (CLAUDE.md): the assistant never states a price, quote,
 * availability or service area of its own. It speaks only figures and times a
 * tool returned during this call, and the brief says so in words the model
 * cannot misread.
 *
 * Bounded: `CALL_BRIEF_MAX_TOKENS` is a hard ceiling. Optional sections are
 * dropped in a fixed order (workspace objection answers, then offer lines,
 * then the known list is shortened) before the move, the money rule or the
 * safety rules could ever be cut. `tests/voice-call-brief.test.ts` pins it.
 */

import { closeLine, type CloseRoute } from "../agent/closing.ts";
import { OBJECTIONS } from "../sales-library/objections.ts";
import { objectionGoalFor, type ObjectionGoal } from "../sales-library/objection-responses.ts";
import { MOTIONS } from "../sales-library/motions.ts";
import type { ObjectionKey, SalesMotion } from "../sales-library/types.ts";
import type { WorkspaceObjectionSet } from "../sales-library/workspace-objections.ts";
import { GOAL_LABEL, type GoalKey, type NextBestAction } from "../qualification-intelligence/types.ts";
import { BUILT_BY_ANSWER } from "./identity.ts";
import { ESCALATION_LINES } from "./anti-loop.ts";
import { ROUTE_TARGETS, thresholdsFor, PROVIDER_MAX_DURATION_SEC, type VoiceRouteKey } from "./time-governor.ts";
import { houseStyleViolations } from "./opener.ts";

export const CALL_BRIEF_VERSION = "brief.2026-09-28.v2";
/** ~4 characters per token (strategy.ts estimateTokens). */
export const CALL_BRIEF_MAX_TOKENS = 1100;
export const MAX_OFFER_LINES = 6;
export const MAX_KNOWN_ITEMS = 12;
export const MAX_WORKSPACE_ANSWERS = 3;
export const MAX_SUMMARY_CHARS = 600;

export type BriefRoute = VoiceRouteKey | "RETURN_CALL";
export type TransferModeLike = "ON_REQUEST" | "ON_REQUEST_OR_ESCALATION" | "NEVER";

/** A return call runs on the qualification budget: the caller chose to ring. */
const RETURN_CALL_TIME_ROUTE: VoiceRouteKey = "QUALIFICATION";

export function timeRouteFor(route: BriefRoute): VoiceRouteKey {
  return route === "RETURN_CALL" ? RETURN_CALL_TIME_ROUTE : route;
}

export const ROUTE_LABEL: Readonly<Record<BriefRoute, string>> = {
  QUALIFICATION: "Qualification call",
  BOOKING_CLOSE: "Booking call",
  DIRECT_CLOSE: "Direct close call",
  NURTURE: "Nurture call",
  REACTIVATION: "Reactivation call",
  RETURN_CALL: "Return call (they rang us)",
};

/** The route's default goal, when the lead has no assessed goal (gap map §1.1: routes = goal x trigger). */
export const ROUTE_GOAL: Readonly<Record<BriefRoute, GoalKey>> = {
  QUALIFICATION: "A_QUALIFY_ONLY",
  BOOKING_CLOSE: "B_BOOK_MEETING",
  DIRECT_CLOSE: "C_DIRECT_SALE",
  NURTURE: "F_NURTURE",
  REACTIVATION: "F_NURTURE",
  RETURN_CALL: "B_BOOK_MEETING",
};

/** Library objections worth a line on each route (the full taxonomy is still matched by log_objection). */
const ROUTE_OBJECTIONS: Readonly<Record<BriefRoute, readonly ObjectionKey[]>> = {
  QUALIFICATION: ["TOO_BUSY", "SEND_INFORMATION", "PRICE", "EXISTING_PROVIDER", "NOT_INTERESTED"],
  BOOKING_CLOSE: ["TOO_BUSY", "TIMING", "AUTHORITY", "SEND_INFORMATION", "NOT_INTERESTED"],
  DIRECT_CLOSE: ["PRICE", "COMPETITOR", "TRUST", "RISK", "NOT_INTERESTED"],
  NURTURE: ["NOT_NOW", "JUST_LOOKING", "SEND_INFORMATION", "NOT_INTERESTED"],
  REACTIVATION: ["STATUS_QUO", "EXISTING_PROVIDER", "NOT_NOW", "NOT_INTERESTED"],
  RETURN_CALL: ["PRICE", "TIMING", "SEND_INFORMATION", "NOT_INTERESTED"],
};

export type BriefPermissions = {
  /** Book meetings (commercial authority "book"). */
  book: boolean;
  /** calculate_quote (quote_ai_enabled + the AI quote permission). */
  quote: boolean;
  /** send_quote (the owner's standing permission to send). */
  sendQuote: boolean;
  /** send_checkout_link (direct close on, an approved link exists). */
  checkout: boolean;
  /** send_booking_link (the business has a booking link). Optional: absent reads as none. */
  bookingLink?: boolean;
};

export type CallBriefInput = {
  route: BriefRoute;
  direction: "OUTBOUND" | "INBOUND";
  callingAsName: string;
  personaName: string | null;
  leadFirstName: string | null;
  /** identity.ts identityAnswer: given deterministically when asked who is calling. */
  identityAnswer: string;
  /** The workspace's editable remainder after the locked opener (OD-1). */
  openerSuffix: string | null;
  motion: SalesMotion | null;
  /** The lead's assessed goal; null = the route's default goal. */
  goal: GoalKey | null;
  /** The lead's current next-best-action (lead_assessments.nba); null = not assessed. */
  nba: NextBestAction | null;
  /** Labels of what is already known about the lead: never asked again. */
  known: readonly string[];
  /** Approved offer-card lines (claims, published prices). Verbatim or not at all. */
  offerLines: readonly string[];
  workspaceObjections: WorkspaceObjectionSet | null;
  /** How a meeting close is taken (strategy.ts NbaBookingRoute). */
  booking: CloseRoute;
  permissions: BriefPermissions;
  transfer: { mode: TransferModeLike; available: boolean };
  /** A text follow-up is lawful for this lead (the loop ladder's second rung). */
  textFollowUpLawful: boolean;
  /** The conversation so far on text, summarised (continuity across channels). */
  conversationSummary: string | null;
  /**
   * The fixed closing line (opener.ts renderClosingLine, owner decision
   * 2026-09-28): the ClientTurn attribution unless the workspace is white
   * label. Spoken word for word as the call wraps up.
   */
  closingLine: string;
};

export type CallBrief = {
  version: string;
  route: BriefRoute;
  goal: GoalKey;
  /** The one opening move after the permission question. */
  move: string;
  text: string;
  timePlan: string;
  tokens: number;
  /** Sections dropped to stay inside the bound, in the order they went. */
  dropped: string[];
  /** Retell dynamic variables (every value a string: Retell's schema). */
  dynamicVariables: Record<string, string>;
  /** Stored on the call for the audit trail. */
  record: {
    version: string;
    route: BriefRoute;
    goal: GoalKey;
    nbaAction: NextBestAction["next_action"] | null;
    questionIntentKey: string | null;
    objectionKeys: ObjectionKey[];
    workspaceObjectionKeys: string[];
  };
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/* ------------------------------------------------------------------ speech */

/**
 * Makes a line safe to put in front of a speaking model: no dashes, no
 * emoji, no markdown bullets, no URLs (a link is sent by a tool, never read
 * out). Everything the brief quotes from workspace text passes through here.
 */
export function speechSafe(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, "the link")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu, "")
    .replace(/[‒–—―−]/g, ",")
    .replace(/\s-{1,2}\s/g, ", ")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function cap(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, "")}.`).trim();
}

/* -------------------------------------------------------------------- move */

function goalOf(input: CallBriefInput): GoalKey {
  return input.nba?.current_goal ?? input.goal ?? ROUTE_GOAL[input.route];
}

function meetingClose(input: CallBriefInput): string {
  if (!input.permissions.book) {
    return "You may not book: offer for a colleague to arrange the time, and call schedule_callback with what suits them.";
  }
  const how =
    input.booking === "SLOTS" || input.booking === "LINK"
      ? `call check_availability and offer two of its times as a choice ("I can do X or Y, which is better?"); when they choose, read it back and call book_meeting with that exact time`
      : input.booking === "ASK_PREFERRED_TIME"
        ? "ask which day and time suits them, then call book_meeting with it; a colleague confirms it"
        : "say a colleague will be in touch to arrange a time, and call schedule_callback";
  return `Close on a meeting: ${how}.`;
}

function checkoutClose(input: CallBriefInput): string {
  if (!input.permissions.checkout) {
    return "They may be ready to buy: say a colleague will send the details to get started, and call schedule_callback. Never give a price yourself.";
  }
  return "Close on the purchase: offer to text or email the checkout link, and call send_checkout_link. Say the price only as the tool returns it.";
}

/** The ONE opening move, from the lead's next-best-action, adapted for speech. */
export function voiceMove(input: CallBriefInput): string {
  const nba = input.nba;
  const goal = goalOf(input);
  if (nba?.handover_reason || nba?.next_action === "ESCALATE") {
    return "A person should take this lead. Tell them a colleague will follow up, then offer transfer_to_human if it is allowed, else schedule_callback.";
  }
  if (nba?.next_action === "DISQUALIFY" || nba?.next_action === "NO_ACTION") {
    return "Do not sell. Thank them for their time, ask if there is anything they need, and end politely.";
  }
  if (nba?.next_action === "WAIT") {
    return "They said it is not the right time before. Ask lightly whether anything has changed; if not, agree a better time with schedule_callback.";
  }
  const q = nba?.question_intent;
  switch (nba?.next_action) {
    case "ASK":
    case "ANSWER_AND_ASK":
      return `${nba.next_action === "ANSWER_AND_ASK" ? "Answer what they asked from the approved offer lines first. Then " : ""}ask one question, in your own natural words: ${speechSafe(q?.rendering ?? "what they need help with")} When they answer, call record_fact.`;
    case "CTA_BOOK":
      return `${q ? `Ask this one question first: ${speechSafe(q.rendering)} Then ` : ""}${meetingClose(input)}`;
    case "CTA_CHECKOUT":
    case "CTA_SIGNUP":
      return checkoutClose(input);
    case "ANSWER":
      return "Answer what they asked from the approved offer lines only. Ask no qualifying question.";
    case "INFORM":
    case "NURTURE":
      return "Share one useful point from the approved offer lines and ask if it would help to talk further. No pressure.";
    default:
      break;
  }
  // No assessment yet: the route's own move.
  switch (input.route) {
    case "BOOKING_CLOSE":
      return meetingClose(input);
    case "DIRECT_CLOSE":
      return checkoutClose(input);
    case "NURTURE":
      return "Check in: ask how things are going with what they enquired about. Share one useful point. No pitch.";
    case "REACTIVATION":
      return "They enquired a while ago. Ask whether it is still something they are looking at. If yes, find out what changed.";
    case "RETURN_CALL":
      return "They rang back. Thank them, ask how you can help, then follow the plan for their goal.";
    default:
      return goal === "B_BOOK_MEETING" || goal === "E_HUMAN_CLOSER"
        ? `Ask what prompted their enquiry, then ${meetingClose(input).replace(/^Close on a meeting: /, "").replace(/\.$/, "")}.`
        : "Ask what prompted their enquiry and what they hope to get from it. When they answer, call record_fact.";
  }
}

function closeFor(input: CallBriefInput, move?: string): string {
  const goal = goalOf(input);
  // The move already takes the close with its tools: say so, not twice.
  if (move && /check_availability|send_checkout_link/.test(move)) return "Take it as YOUR ONE MOVE says.";
  const target = MOTIONS[input.motion ?? "BOOK_MEETING_B2B"].closeTarget;
  if (goal === "C_DIRECT_SALE" || goal === "D_SIGNUP_TRIAL" || input.route === "DIRECT_CLOSE") return checkoutClose(input);
  if (goal === "F_NURTURE" || goal === "G_DISQUALIFY") {
    return "No close today. If they want to go further, offer a meeting; otherwise agree how to keep in touch.";
  }
  // The motion's own close wording (agent/closing.ts), for how a good closer
  // phrases it. The tools to take it are in the move (or meetingClose).
  const how = speechSafe(closeLine(target === "BUSINESS_CASE" ? "BUSINESS_CASE" : "BOOK_MEETING", input.booking)).replace(/^Close: /, "");
  return input.permissions.book ? `When it is time to close, phrase it the way a good closer would: ${how}` : meetingClose(input);
}

/* ---------------------------------------------------------------- sections */

type Section = { key: string; text: string; optional?: boolean };

/** The goal a call closes on, in the objection library's terms (objection-responses.ts). */
export function briefGoal(input: CallBriefInput): ObjectionGoal {
  const goal = goalOf(input);
  if (goal === "C_DIRECT_SALE" || input.route === "DIRECT_CLOSE") return "DIRECT_SALE";
  if (goal === "D_SIGNUP_TRIAL") return "TRIAL";
  return objectionGoalFor(MOTIONS[input.motion ?? "BOOK_MEETING_B2B"].closeTarget);
}

/**
 * The one small step toward the goal, as the call can take it with the tools
 * it is allowed (objection matrix pass): the same goal step the text
 * strategy uses, with the tool named.
 */
export function voiceGoalStep(input: CallBriefInput): string {
  const p = input.permissions;
  switch (briefGoal(input)) {
    case "DIRECT_SALE":
      return p.checkout ? "to text them the checkout link (send_checkout_link)" : "for a colleague to send the details (schedule_callback)";
    case "TRIAL":
      return p.checkout ? "to text them the sign-up link (send_checkout_link)" : "for a colleague to send the sign-up details (schedule_callback)";
    case "QUOTE":
      return p.quote ? "to price it now (calculate_quote)" : "for a colleague to price it (schedule_callback)";
    default:
      return p.book ? "a short call at two times from check_availability" : "for a colleague to arrange a short call (schedule_callback)";
  }
}

/** "Just email me / send me something": send it now, then a short follow-up. */
export function sendDetailsLine(input: CallBriefInput): string {
  const p = input.permissions;
  const goal = briefGoal(input);
  const follow = p.book ? "then offer a short follow-up call at two times from check_availability" : "then agree when a colleague follows up (schedule_callback)";
  let send: string;
  if ((goal === "DIRECT_SALE" || goal === "TRIAL") && p.checkout) send = "send the link now with send_checkout_link";
  else if (goal === "QUOTE" && p.quote && p.sendQuote) send = "price it with calculate_quote and send it with send_quote";
  else if (p.bookingLink) send = "send the booking link now with send_booking_link";
  else send = "say a colleague will send the details today (schedule_callback by a person, noting what to send)";
  return `SEND ME SOMETHING. If they say "just email me" or "send me something", say yes, ${send}, ${follow}.`;
}

function objectionSection(input: CallBriefInput): { text: string; keys: ObjectionKey[] } {
  const keys = ROUTE_OBJECTIONS[input.route];
  const lines = keys.map((key) => {
    const entry = OBJECTIONS[key];
    if (entry.respectAsRefusal) return `${entry.label}: accept it, thank them and end.`;
    if (key === "SEND_INFORMATION") return `${entry.label}: as SEND ME SOMETHING says.`;
    return `${entry.label}: "${speechSafe(entry.clarifyingQuestion)}"`;
  });
  return {
    keys: [...keys],
    text:
      "OBJECTIONS. Every time, call log_objection with its key and acknowledge it in a few words, without agreeing or arguing. " +
      "The first time, ask its one question below and stop. If they raise it again, never ask it twice. Timing, not now or happy with a supplier: accept it and agree when to follow up (schedule_callback). " +
      `Anything else: one approved reason from the offer lines, then offer ${voiceGoalStep(input)}. A legal or contract question is a colleague's. ` +
      lines.join(" "),
  };
}

function workspaceAnswers(input: CallBriefInput): { text: string; keys: string[] } | null {
  const set = input.workspaceObjections;
  const enabled = (set?.objections ?? []).filter((o) => o.enabled).slice(0, MAX_WORKSPACE_ANSWERS);
  if (!enabled.length) return null;
  return {
    keys: enabled.map((o) => o.key),
    text:
      "THE BUSINESS'S OWN ANSWERS (approved: paraphrase, add nothing). " +
      enabled.map((o) => `If they say something like "${speechSafe(o.phrases[0] ?? o.label)}": ${cap(speechSafe(o.response), 220)}`).join(" "),
  };
}

function escalationSection(input: CallBriefInput): string {
  const t = input.transfer;
  if (t.mode === "NEVER" || !t.available) {
    return "A PERSON. Live transfer is off. If they want a person, say a colleague will call them back and call schedule_callback with a time that suits them. That is the last resort, not the first.";
  }
  const when = t.mode === "ON_REQUEST" ? "only when they ask for a person" : "when they ask for a person, or you are stuck after offering to text the details";
  return `A PERSON. Call transfer_to_human ${when}. Tell them first that you are putting them through. Never transfer to avoid a question you can answer.`;
}

function knownSection(known: readonly string[], limit: number): string | null {
  const items = known.map((k) => speechSafe(k)).filter(Boolean).slice(0, limit);
  if (!items.length) return null;
  return `ALREADY KNOWN, NEVER ASK AGAIN: ${items.join("; ")}.`;
}

function offerSection(lines: readonly string[], limit: number): string | null {
  const items = lines.map((l) => cap(speechSafe(l), 200)).filter(Boolean).slice(0, limit);
  if (!items.length) return null;
  return `APPROVED OFFER LINES (the only facts you may state about the business, word for word or not at all): ${items.join(" | ")}`;
}

/** The in-call time plan (time-governor.ts), as words the model follows. */
export function timePlanFor(route: BriefRoute): string {
  const r = timeRouteFor(route);
  const th = thresholdsFor(r);
  const target = ROUTE_TARGETS[r].targetSec;
  const mins = (sec: number) => `${Math.floor(sec / 60)} minute${Math.floor(sec / 60) === 1 ? "" : "s"}${sec % 60 ? ` ${sec % 60} seconds` : ""}`;
  return [
    `TIME. Aim for about ${mins(target)}. The call has run {{session_duration}}.`,
    `From ${mins(th.amberAtSec)} (TIME_AMBER): sum up what you have learned in one sentence, start nothing new, and steer to the next step.`,
    `From ${mins(th.redAtSec)} (TIME_RED): sum up, then take the next step now or offer a follow-up, and end the call.`,
    "Every tool result also says time_level; when it says TIME_AMBER or TIME_RED, do what it says at once.",
    `The call is cut at ${mins(PROVIDER_MAX_DURATION_SEC)} whatever happens.`,
  ].join(" ");
}

const SPEECH_RULES =
  "HOW YOU SPEAK. One or two short sentences a turn, under 35 words. One question at most, then stop and listen. " +
  "No lists, no dashes, no emoji, no web addresses read aloud. Plain British English. Use their first name at most twice.";

const HEARING_RULES =
  "HEARING. Read every number back to confirm it, a digit at a time for phone numbers. Spell an email address back letter by letter. " +
  "If you did not catch something, say sorry and ask once more in simpler words. If it still is not clear, offer to text them instead. " +
  "Never guess a name, number, date or amount.";

const LOOP_RULES =
  `LOOPS. Never ask the same thing twice. If you are going round in circles, move one step: "${ESCALATION_LINES.REPHRASE}", then offer a text, then a person, then end politely.`;

const ETHICS_RULES =
  "HONEST SELLING. Help them decide, do not push. No invented deadline, scarcity, discount or statistic. If they say no, accept it and thank them.";

const MONEY_RULES =
  "MONEY, TIMES AND AREAS. Never say a price, quote, discount, delivery date, availability or service area from your own knowledge. " +
  "Say only what a tool returned in this call, exactly. If a tool refused, a colleague will confirm it.";

function permissionLine(p: BriefPermissions): string {
  const can: string[] = [];
  const cannot: string[] = [];
  (p.book ? can : cannot).push("book meetings");
  (p.quote ? can : cannot).push("price a quote");
  (p.sendQuote ? can : cannot).push("send a quote");
  (p.checkout ? can : cannot).push("send a checkout link");
  const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items[0]);
  return `WHAT YOU MAY DO: ${can.length ? can.join(", ") : "nothing commercial"}.${cannot.length ? ` You may not ${list(cannot)}: a colleague does that.` : ""}`;
}

/* ----------------------------------------------------------------- builder */

export function buildVoiceCallBrief(input: CallBriefInput): CallBrief {
  const goal = goalOf(input);
  const move = voiceMove(input);
  const persona = input.personaName?.trim() || "the assistant";
  const name = input.callingAsName.replace(/\s+/g, " ").trim();
  const objections = objectionSection(input);
  const answers = workspaceAnswers(input);

  const head: Section[] = [
    {
      key: "role",
      text:
        `YOU ARE ${persona}, an AI assistant ${input.direction === "INBOUND" ? "answering a call" : "calling"} for ${name}. ` +
        `This is a ${ROUTE_LABEL[input.route].toLowerCase()}. Goal: ${GOAL_LABEL[goal]}. ` +
        `If asked who you are or how to contact the business, say: ${speechSafe(input.identityAnswer)} If asked who built you, say: ${BUILT_BY_ANSWER} Never claim to be human.`,
    },
    {
      key: "permission",
      text:
        input.direction === "INBOUND"
          ? "FIRST. They rang you. Ask how you can help before anything else."
          : "FIRST. You asked if now is a good time. If they say no or sound rushed, ask when suits, call schedule_callback, thank them and end: no pitch. If yes, go straight in: one sentence on why you are calling, tied to what they enquired about, then your one move.",
    },
    { key: "move", text: `YOUR ONE MOVE NOW: ${move}` },
    ...(input.openerSuffix?.trim() ? [{ key: "suffix", text: `After the permission question, the business asked you to say: ${cap(speechSafe(input.openerSuffix), 240)}` }] : []),
    { key: "close", text: `CLOSE. ${closeFor(input, move)} When they sound keen, one light trial close first ("Does that sound like it would help?"); on a yes, close at once.` },
    { key: "send", text: sendDetailsLine(input) },
    { key: "money", text: `${MONEY_RULES} ${permissionLine(input.permissions)}` },
    { key: "speech", text: SPEECH_RULES },
    { key: "hearing", text: HEARING_RULES },
    { key: "loops", text: `${LOOP_RULES}${input.textFollowUpLawful ? "" : " Texting is not allowed for this lead, so skip that step."}` },
    { key: "ethics", text: ETHICS_RULES },
    { key: "objections", text: objections.text },
    { key: "escalation", text: escalationSection(input) },
    {
      key: "ending",
      text:
        `ENDING. When the next step is agreed or the call ends politely, say exactly: "${input.closingLine}" ` +
        "Every call, however it ends, finishes with end_call_summary.",
    },
    {
      key: "stop",
      text: "STOP. If they ask not to be called again, call opt_out at once (scope ALL if they want no contact at all), confirm it in one sentence, and end without the closing line.",
    },
  ];

  const summary = input.conversationSummary?.trim()
    ? { key: "history", text: `EARLIER CONVERSATION (so you do not repeat it): ${cap(speechSafe(input.conversationSummary), MAX_SUMMARY_CHARS)}`, optional: true }
    : null;

  let knownLimit = MAX_KNOWN_ITEMS;
  let offerLimit = MAX_OFFER_LINES;
  let includeAnswers = Boolean(answers);
  let includeSummary = Boolean(summary);
  const dropped: string[] = [];

  const assemble = (): string => {
    const parts: string[] = head.map((s) => s.text);
    const known = knownSection(input.known, knownLimit);
    if (known) parts.splice(3, 0, known);
    const offer = offerSection(input.offerLines, offerLimit);
    if (offer) parts.push(offer);
    if (includeAnswers && answers) parts.push(answers.text);
    if (includeSummary && summary) parts.push(summary.text);
    return parts.join("\n");
  };

  let text = assemble();
  // Drop optional detail, least important first, until the bound holds.
  const steps: (() => boolean)[] = [
    () => (includeSummary ? ((includeSummary = false), dropped.push("history"), true) : false),
    () => (includeAnswers ? ((includeAnswers = false), dropped.push("workspace_answers"), true) : false),
    () => (offerLimit > 2 ? ((offerLimit = 2), dropped.push("offer_lines"), true) : false),
    () => (knownLimit > 5 ? ((knownLimit = 5), dropped.push("known_items"), true) : false),
    () => (offerLimit > 0 ? ((offerLimit = 0), dropped.push("offer_all"), true) : false),
  ];
  for (const step of steps) {
    if (estimateTokens(text) <= CALL_BRIEF_MAX_TOKENS) break;
    if (step()) text = assemble();
  }
  if (estimateTokens(text) > CALL_BRIEF_MAX_TOKENS) {
    // The fixed sections alone fit with room to spare; only oversized
    // workspace text can get here. Hard cut at a sentence, never mid-rule.
    text = cap(text, CALL_BRIEF_MAX_TOKENS * 4);
    dropped.push("hard_cut");
  }

  const timePlan = timePlanFor(input.route);
  const knownList = input.known.map((k) => speechSafe(k)).filter(Boolean).slice(0, MAX_KNOWN_ITEMS).join("; ");
  return {
    version: CALL_BRIEF_VERSION,
    route: input.route,
    goal,
    move,
    text,
    timePlan,
    tokens: estimateTokens(text) + estimateTokens(timePlan),
    dropped,
    dynamicVariables: {
      call_brief: text,
      time_plan: timePlan,
      known_facts: knownList,
      brief_version: CALL_BRIEF_VERSION,
      goal: GOAL_LABEL[goal],
      route_label: ROUTE_LABEL[input.route],
      closing_line: input.closingLine,
    },
    record: {
      version: CALL_BRIEF_VERSION,
      route: input.route,
      goal,
      nbaAction: input.nba?.next_action ?? null,
      questionIntentKey: input.nba?.question_intent?.key ?? null,
      objectionKeys: objections.keys,
      workspaceObjectionKeys: includeAnswers && answers ? answers.keys : [],
    },
  };
}

/** House-style problems in a finished brief (tests; a dash or emoji must never reach the voice model). */
export function briefStyleProblems(brief: CallBrief): string[] {
  const text = `${brief.text}\n${brief.timePlan}`;
  // The "{{session_duration}}" placeholder and quoted escalation lines are fine; only dashes and emoji matter.
  return houseStyleViolations(text.replace(/\{\{[a-z_]+\}\}/g, ""));
}
