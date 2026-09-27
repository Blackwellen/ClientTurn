/**
 * The /100 reply grader: human style and persuasion quality (elite-closer
 * brief). Pure. Beside the question grader (qualification-intelligence/
 * grade.ts), which grades the one question; this grades the whole reply.
 *
 * Anti-gaming, by construction (the same discipline as the question grader):
 *   - the held-out labelled fixture (tests/fixtures/reply-grades-heldout.json)
 *     was written and labelled before this file, and is never edited to fit
 *     it;
 *   - every criterion reads the reply against the lead's message and the
 *     approved claims only; none rewards length, keywords or flattery;
 *   - a critical failure (an emoji or dash, pressure, a list in a chat
 *     channel) grades the reply 0, whatever else it does well.
 *
 * Criteria (weights sum to 100):
 *   HUMAN STYLE (50)
 *     NO_AI_TELLS 15    no automated-sounding phrase or banned cliche
 *     LENGTH_FIT 10     sized to the lead's message and the channel
 *     NATURAL_VOICE 10  contractions where the reply is long enough to need
 *                       one; at most one exclamation; the name once at most
 *     UK_SPELLING 5
 *     CHAT_FORMAT 10    no sign-off, list, heading or bold in a chat channel
 *   PERSUASION (50)
 *     ANSWERS_FIRST 15  a lead's question is answered before anything is asked
 *     SPECIFIC 10       picks up the lead's own words
 *     ONE_CTA 15        ends on exactly one clear question or next step
 *     GROUNDED 10       an objection is answered with approved proof when
 *                       there is some (full marks when none exists)
 *
 * A reply passes with no critical failure, a total of at least
 * REPLY_GRADE_PASS, and no criterion below half its weight: one clear flaw
 * fails it, as it would for a person reading it.
 */

import { countQuestions, BANNED_CLICHES, pressureIn } from "./validate.ts";
import {
  aiTellsIn,
  exclamationCount,
  hasChatSignOff,
  hasListOrMarkdown,
  isChatChannel,
  usSpellingsIn,
} from "./human-style.ts";
import { dashesIn, emojisIn } from "../messaging/human-punctuation.ts";

export const REPLY_GRADE_PASS = 75;

export const REPLY_GRADE_WEIGHTS = {
  NO_AI_TELLS: 15,
  LENGTH_FIT: 10,
  NATURAL_VOICE: 10,
  UK_SPELLING: 5,
  CHAT_FORMAT: 10,
  ANSWERS_FIRST: 15,
  SPECIFIC: 10,
  ONE_CTA: 15,
  GROUNDED: 10,
} as const;
export type ReplyCriterion = keyof typeof REPLY_GRADE_WEIGHTS;

export type ReplyCritical = "AI_PUNCTUATION" | "PRESSURE" | "CHAT_LIST";

export type ReplyGradeInput = {
  channel: string;
  /** The lead's latest message. */
  inbound: string;
  leadFirstName?: string | null;
  /** Approved claims and reassurance facts available this turn. */
  approvedClaims?: readonly string[];
  /** The turn is answering an objection. */
  objection?: boolean;
};

export type ReplyGrade = {
  total: number;
  pass: boolean;
  scores: Record<ReplyCriterion, number>;
  critical: ReplyCritical[];
};

const STOP = new Set(
  "the a an and or but if so to of in on for with at by from it its it's this that these those is are was were be been am i im i'm you your we our us they them their he she my me do does did have has had not no yes can could would should will just what how when where who why which there here about as more some any all very really get got bit".split(" "),
);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const CONTRACTION = /\b\w+['’](s|re|ve|ll|d|m|t)\b/i;
const STIFF = /\b(i am|we are|it is|do not|does not|cannot|we have|i have|you are|that is|would not|will not)\b/i;

/** A lead's message asks something (a "?" or an interrogative opening). */
function leadAsks(text: string): boolean {
  return /\?/.test(text) || /^(do|does|can|could|would|will|is|are|how|what|when|where|which|who|why)\b/i.test(text.trim());
}

/** Ends with one clear question or a concrete next step. */
function endsOnCta(text: string): boolean {
  // A reply that ends on the approved link ends on its call to action.
  if (/https?:\/\/\S+\s*$/i.test(text)) return true;
  const last = sentences(text).pop() ?? "";
  if (/\?\s*$/.test(last)) return true;
  return /\b(shall i|i can|i'll|let me|happy to|book|pick a time|here'?s the link|drop you|send (you|over))\b/i.test(last);
}

export function gradeReply(reply: string, input: ReplyGradeInput): ReplyGrade {
  const text = reply.normalize("NFKC").trim();
  const chat = isChatChannel(input.channel);
  const critical: ReplyCritical[] = [];
  if (emojisIn(reply).length > 0 || dashesIn(reply) > 0) critical.push("AI_PUNCTUATION");
  if (pressureIn(text).length > 0) critical.push("PRESSURE");
  if (chat && hasListOrMarkdown(reply)) critical.push("CHAT_LIST");

  const W = REPLY_GRADE_WEIGHTS;
  const scores = {} as Record<ReplyCriterion, number>;

  // ---- human style
  const tells = aiTellsIn(text).length + BANNED_CLICHES.filter((c) => c.pattern.test(text)).length;
  scores.NO_AI_TELLS = tells === 0 ? W.NO_AI_TELLS : tells === 1 ? 5 : 0;

  const n = words(text);
  const inboundWords = Math.max(1, words(input.inbound));
  const cap = chat ? Math.max(30, inboundWords * 6) : Math.max(70, inboundWords * 8);
  scores.LENGTH_FIT = n <= cap ? W.LENGTH_FIT : n <= cap * 1.5 ? 5 : 0;

  let voice = W.NATURAL_VOICE;
  if (n >= 15 && !CONTRACTION.test(text) && STIFF.test(text)) voice -= 6;
  if (exclamationCount(text) > 1) voice -= 6;
  const name = (input.leadFirstName ?? "").trim();
  if (name.length > 1 && (text.match(new RegExp(`\\b${name}\\b`, "gi")) ?? []).length > 1) voice -= 6;
  scores.NATURAL_VOICE = Math.max(0, voice);

  scores.UK_SPELLING = usSpellingsIn(text).length === 0 ? W.UK_SPELLING : 0;
  scores.CHAT_FORMAT = chat && (hasChatSignOff(text) || hasListOrMarkdown(reply)) ? 0 : W.CHAT_FORMAT;

  // ---- persuasion
  const first = sentences(text)[0] ?? "";
  if (leadAsks(input.inbound)) {
    scores.ANSWERS_FIRST = /\?\s*$/.test(first) && sentences(text).length === 1 ? 0 : /\?\s*$/.test(first) ? 5 : W.ANSWERS_FIRST;
  } else {
    scores.ANSWERS_FIRST = W.ANSWERS_FIRST;
  }

  const lead = contentWords(input.inbound);
  const mine = contentWords(text);
  let shared = 0;
  for (const w of lead) if (mine.has(w)) shared += 1;
  scores.SPECIFIC = lead.size === 0 || shared > 0 ? W.SPECIFIC : W.SPECIFIC / 2;

  const questions = countQuestions(text);
  scores.ONE_CTA = questions > 1 ? 0 : endsOnCta(text) ? W.ONE_CTA : 5;

  const claims = input.approvedClaims ?? [];
  if (input.objection && claims.length > 0) {
    const used = claims.some((claim) => {
      const c = contentWords(claim);
      let hit = 0;
      for (const w of c) if (mine.has(w)) hit += 1;
      return c.size > 0 && hit / c.size >= 0.5;
    });
    scores.GROUNDED = used ? W.GROUNDED : 0;
  } else {
    scores.GROUNDED = W.GROUNDED;
  }

  const raw = Object.values(scores).reduce((a, b) => a + b, 0);
  const total = critical.length > 0 ? 0 : Math.round(raw);
  // One clear flaw fails a reply, as it would for a person reading it: every
  // criterion must keep at least half its marks, as well as the total.
  const noWeakCriterion = (Object.keys(scores) as ReplyCriterion[]).every((key) => scores[key] >= W[key] / 2);
  return { total, pass: critical.length === 0 && noWeakCriterion && total >= REPLY_GRADE_PASS, scores, critical };
}
