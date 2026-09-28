/**
 * The objection matrix rubric (voice QA pass, 2026-09-28). Deterministic, so
 * a regression in the library or the strategy is caught for free.
 *
 * A cell's grade is the written rubric below (100) for voice, and for a text
 * channel the mean of the rubric and the repo's own reply grader
 * (agent/reply-grader.ts gradeReply), whose critical failures (emoji, dash,
 * pressure, a list in chat) zero it. The held-out reply-grader fixture is
 * never touched and the grader is never special-cased: the cells are graded
 * by the same function production uses.
 *
 *   ACK 15      acknowledges without caving (no "you're right, it's too
 *               much", no discount), first sentence not a question
 *   ONE_Q 15    at most one question; a clarifying turn has exactly one and
 *               ends on it; a refusal asks nothing
 *   PROOF 15    uses an approved claim when one is expected; never a figure
 *               that is not in an approved claim
 *   STEP 20     one small next step that matches the goal (or the right
 *               non-sales step: stop, a later follow-up, a colleague)
 *   STYLE 15    the channel: SMS within two segments; WhatsApp and email
 *               sized; voice at most two sentences and 35 words; no lint
 *   LAWFUL 10   no pressure, deadline or scarcity (validate.ts pressureIn)
 *   FRESH 10    a repeat turn shares little with the earlier reply and does
 *               not ask its question again
 */

import { gradeReply } from "../../../src/lib/agent/reply-grader.ts";
import {
  countQuestions,
  pressureIn,
  repeatedQuestion,
} from "../../../src/lib/agent/validate.ts";
import { humanStyleFailures } from "../../../src/lib/agent/human-style.ts";
import {
  countSmsSegments,
  normaliseForSms,
} from "../../../src/lib/messaging/sms-segments.ts";
import {
  checkAgentTurn,
  agentTargets,
  measurePace,
  countWords,
} from "../../../src/lib/voice/pacing.ts";
import { houseStyleViolations } from "../../../src/lib/voice/opener.ts";

export type Channel = "sms" | "email" | "whatsapp" | "voice";
export type Goal = "MEETING" | "DIRECT_SALE" | "TRIAL" | "QUOTE";
export type Turn = "first" | "repeat";
/** What the next step must be, from the library pattern for the cell. */
export type StepKind =
  "clarify" | "goal" | "own" | "stop" | "later" | "handover" | "assist";

export type Cell = {
  id: string;
  key: string;
  channel: Channel;
  goal: Goal;
  turn: Turn;
  inbound: string;
  /** Repeat cells: what the lead said the first time, and what the agent replied. */
  priorInbound?: string;
  priorReply?: string;
  /** The AI concern: the reply must say it is an AI, honestly. */
  aiConcern?: boolean;
  reply: string;
  /** The reply the old library/strategy led to, when it differs (graded for the before column). */
  replyBefore?: string;
};

/** Approved claims per goal: the workspace's offer card in each scenario. */
export const CLAIMS: Readonly<Record<Goal, string[]>> = {
  MEETING: [
    "Clients typically see their first booked meeting within two weeks",
    "Every site includes a year of support",
  ],
  DIRECT_SALE: [
    "Orders ship within two working days",
    "You can cancel any time from your account",
  ],
  TRIAL: [
    "The 14 day trial needs no card",
    "Setup takes about ten minutes with the import tool",
  ],
  QUOTE: [
    "Quotes are fixed price with no hidden extras",
    "We have been trading since 2012",
  ],
};

const GOAL_STEP: Readonly<Record<Goal, RegExp>> = {
  MEETING:
    /\b(call|chat|meeting|two times|slots?|diary|monday|tuesday|wednesday|thursday|friday|either)\b|\d(am|pm)\b/i,
  DIRECT_SALE: /\b(link|checkout|order|go ahead|get started|basket)\b/i,
  TRIAL: /\b(trial|sign.?up|try it|link)\b/i,
  QUOTE:
    /\b(quote|price (it |that |this |them )?up|price it|figures?|priced|cost it|pricing)\b/i,
};
const MEETING_OFFER = /\b(a (quick |short )?(call|meeting|chat))\b/i;
/** A meeting being pushed (not "a note by email rather than a call"). */
const MEETING_PUSH =
  /\b(book|arrange|set up|schedule|pencil in|walk you through|go through (it|them)|show you round|talk it through|map the switch|compare notes)\b[^.?!]*\b(call|meeting|chat)\b|\b(two times|a (quick |short )?call (to|with|on)|on a (quick |short )?(call|chat))\b/i;
const CAVE =
  /\b(you'?re right,? it'?s (too|a lot)|it is (too )?expensive|we can (do|knock|drop|lower|reduce)|discount|cheaper option|i'?ll (lower|reduce|drop))\b/i;
const LATER =
  /\b(when|pick (this|it) up|check in|come back|get back|in touch|follow up|remind|nearer the time|closer to|ahead of)\b/i;
const COLLEAGUE =
  /\b(colleague|someone from (the |our )?team|the team will|a person)\b/i;

const STOP_WORDS = new Set(
  "the a an and or but if so to of in on for with at by from it its this that is are was be i you your we our they them my me do not no yes can just what how when who which there here about as more some any all very really get got bit".split(
    " ",
  ),
);

export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function usesClaim(reply: string, claims: readonly string[]): boolean {
  const mine = contentWords(reply);
  return claims.some((claim) => {
    const c = contentWords(claim);
    let hit = 0;
    for (const w of c) if (mine.has(w)) hit++;
    return c.size > 0 && hit / c.size >= 0.5;
  });
}

export type RubricScore = {
  ACK: number;
  ONE_Q: number;
  PROOF: number;
  STEP: number;
  STYLE: number;
  LAWFUL: number;
  FRESH: number;
  total: number;
  notes: string[];
};

export function rubric(
  cell: Cell,
  reply: string,
  step: StepKind,
  proofExpected: boolean,
): RubricScore {
  const notes: string[] = [];
  const text = reply.trim();
  const sents = sentences(text);
  const first = sents[0] ?? "";
  const last = sents[sents.length - 1] ?? "";
  const claims = CLAIMS[cell.goal];
  const q = countQuestions(text);

  let ACK = 15;
  if (/\?\s*$/.test(first) && sents.length > 1) {
    ACK = 5;
    notes.push("opens with a question");
  }
  if (CAVE.test(text)) {
    ACK = 0;
    notes.push("caves");
  }
  if (cell.aiConcern && !/\b(AI|automated assistant)\b/.test(text)) {
    ACK = 0;
    notes.push("no honest AI answer");
  }

  let ONE_Q = q <= 1 ? 15 : 0;
  if (q > 1) notes.push(`${q} questions`);
  if (step === "clarify" && !(q === 1 && /\?\s*$/.test(text))) {
    ONE_Q = 5;
    notes.push("a clarifying turn must end on its one question");
  }
  if (step === "stop" && q > 0) {
    ONE_Q = 0;
    notes.push("a refusal asks nothing");
  }

  let PROOF = 15;
  const figures = (
    text.match(/£[\d,.]+|\b\d+(\.\d+)?\s?%|\b\d{2,}\b/g) ?? []
  ).filter((f) => !claims.some((c) => c.includes(f.replace(/[£%\s]/g, ""))));
  if (figures.length) {
    PROOF = 0;
    notes.push(`invented figures ${figures.join(",")}`);
  } else if (proofExpected && !usesClaim(text, claims)) {
    PROOF = 0;
    notes.push("no approved proof");
  }
  if (cell.aiConcern && !usesClaim(text, claims) && cell.channel !== "voice") {
    PROOF = Math.min(PROOF, 5);
    notes.push("AI answer without a reassuring fact");
  }

  let STEP = 0;
  switch (step) {
    case "clarify":
      STEP =
        /\?\s*$/.test(text) &&
        !(cell.goal !== "MEETING" && MEETING_PUSH.test(text))
          ? 20
          : 0;
      break;
    case "goal":
      STEP =
        GOAL_STEP[cell.goal].test(last) &&
        !(cell.goal !== "MEETING" && MEETING_OFFER.test(last))
          ? 20
          : 0;
      break;
    case "own":
      STEP =
        /\?\s*$/.test(text) || /\b(i'?ll|shall i|happy to|i can)\b/i.test(last)
          ? 20
          : 0;
      break;
    case "stop":
      STEP =
        q === 0 &&
        !GOAL_STEP[cell.goal].test(
          text.replace(/\b(contact|message|messages)\b/gi, ""),
        )
          ? 20
          : 0;
      break;
    case "later":
      STEP = LATER.test(text) && !MEETING_OFFER.test(last) ? 20 : 0;
      break;
    case "handover":
    case "assist":
      STEP = COLLEAGUE.test(text) ? 20 : 0;
      break;
  }
  if (!STEP) notes.push(`step (${step}) missing or wrong for ${cell.goal}`);

  let STYLE = 15;
  const lint =
    cell.channel === "voice"
      ? houseStyleViolations(text)
      : humanStyleFailures(text, {
          channel: cell.channel,
          leadFirstName: "Priya",
        }).map((f) => f.code);
  if (lint.length) {
    STYLE = 0;
    notes.push(`lint ${lint.join(",")}`);
  } else if (cell.channel === "sms") {
    const segs = countSmsSegments(normaliseForSms(text)).segments;
    if (segs > 2) {
      STYLE = segs > 3 ? 0 : 8;
      notes.push(`${segs} SMS segments`);
    }
  } else if (cell.channel === "whatsapp") {
    if (countWords(text) > 60) {
      STYLE = 5;
      notes.push("long for WhatsApp");
    }
  } else if (cell.channel === "email") {
    if (countWords(text) > 120) {
      STYLE = 5;
      notes.push("long email");
    }
  } else {
    const v = checkAgentTurn(text, agentTargets(measurePace([])));
    if (v.length || sents.length > 2 || /https?:|www\./i.test(text)) {
      STYLE = 0;
      notes.push(
        `voice: ${[...v, sents.length > 2 ? "MORE_THAN_TWO_SENTENCES" : ""].filter(Boolean).join(",")}`,
      );
    }
  }

  const LAWFUL = pressureIn(text).length === 0 ? 10 : 0;
  if (!LAWFUL) notes.push(`pressure ${pressureIn(text).join(",")}`);

  let FRESH = 10;
  if (cell.turn === "repeat" && cell.priorReply) {
    const overlap = jaccard(contentWords(text), contentWords(cell.priorReply));
    if (overlap >= 0.5) {
      FRESH = 0;
      notes.push(`repeats the earlier reply (${overlap.toFixed(2)})`);
    }
    if (repeatedQuestion(text, [cell.priorReply])) {
      FRESH = 0;
      notes.push("asks the earlier question again");
    }
  }

  const total = ACK + ONE_Q + PROOF + STEP + STYLE + LAWFUL + FRESH;
  return { ACK, ONE_Q, PROOF, STEP, STYLE, LAWFUL, FRESH, total, notes };
}

export type CellGrade = {
  grade: number;
  rubric: RubricScore;
  replyGrader: number | null;
  notes: string[];
};

/**
 * The cell's grade. Text: the mean of the rubric and gradeReply (claims only
 * where the library's step uses proof: a refusal, a later or a hand-over
 * gets none, so it is never marked down for leaving proof out). Voice: the
 * rubric.
 */
export function gradeCell(
  cell: Cell,
  reply: string,
  step: StepKind,
  proofExpected: boolean,
): CellGrade {
  const r = rubric(cell, reply, step, proofExpected);
  if (cell.channel === "voice")
    return { grade: r.total, rubric: r, replyGrader: null, notes: r.notes };
  const g = gradeReply(reply, {
    channel: cell.channel,
    inbound: cell.inbound,
    leadFirstName: "Priya",
    approvedClaims: proofExpected ? CLAIMS[cell.goal] : [],
    objection: true,
  });
  const notes = [...r.notes];
  if (g.critical.length) notes.push(`grader critical ${g.critical.join(",")}`);
  for (const [k, v] of Object.entries(g.scores))
    if (
      v < 10 &&
      v <
        (
          {
            NO_AI_TELLS: 15,
            LENGTH_FIT: 10,
            NATURAL_VOICE: 10,
            UK_SPELLING: 5,
            CHAT_FORMAT: 10,
            ANSWERS_FIRST: 15,
            SPECIFIC: 10,
            ONE_CTA: 15,
            GROUNDED: 10,
          } as Record<string, number>
        )[k]
    )
      notes.push(`grader ${k}=${v}`);
  return {
    grade: Math.round((r.total + g.total) / 2),
    rubric: r,
    replyGrader: g.total,
    notes,
  };
}
