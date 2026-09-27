/**
 * Anti-loop for calls. Pure reducer over turns.
 *
 * Detects three loops:
 *   - REPEATED_QUESTION   the agent asks the same thing again (same question
 *                         key, or near-identical wording: the thresholds the
 *                         text validator uses, >= 0.6 Jaccard on normalised
 *                         words);
 *   - REPEATED_MISUNDERSTANDING  the lead did not understand, or the agent did
 *                         not understand the lead, twice in a row;
 *   - CIRCULAR_OBJECTION  the same objection comes back after it was handled.
 *
 * Each detected loop moves one rung up the escalation ladder:
 *   REPHRASE -> OFFER_TEXT_FOLLOW_UP -> OFFER_HUMAN -> END_POLITELY
 * A rung that is not available (text follow-up not lawful for this lead, no
 * person to transfer to) is skipped. A person is the last resort before ending,
 * in line with the hand-over policy (docs/AGENT_RUNTIME.md).
 */

export type LoopKind = "REPEATED_QUESTION" | "REPEATED_MISUNDERSTANDING" | "CIRCULAR_OBJECTION";
export type Escalation = "NONE" | "REPHRASE" | "OFFER_TEXT_FOLLOW_UP" | "OFFER_HUMAN" | "END_POLITELY";
export const LADDER: readonly Exclude<Escalation, "NONE">[] = ["REPHRASE", "OFFER_TEXT_FOLLOW_UP", "OFFER_HUMAN", "END_POLITELY"];

export type LoopTurn =
  | { speaker: "AGENT"; text: string; questionKey?: string | null; isQuestion?: boolean }
  | {
      speaker: "LEAD";
      text: string;
      /** From the classifier: the lead said "sorry, what?" or the agent could not parse the answer. */
      misunderstanding?: boolean;
      /** Objection key from the shared taxonomy (sales-library OBJECTION_KEYS). */
      objectionKey?: string | null;
    };

export type LoopState = {
  askedQuestions: { key: string | null; words: string[] }[];
  misunderstandingStreak: number;
  objectionCounts: Record<string, number>;
  rung: number; // 0 = none, 1..4 = LADDER index + 1
  loopsDetected: LoopKind[];
};

export const initialLoopState = (): LoopState => ({
  askedQuestions: [],
  misunderstandingStreak: 0,
  objectionCounts: {},
  rung: 0,
  loopsDetected: [],
});

const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "is", "are", "you", "your", "do", "does", "can", "could", "would", "just", "so"]);
export function normaliseWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const SIMILARITY_THRESHOLD = 0.6;
export const MISUNDERSTANDING_LIMIT = 2;
export const OBJECTION_REPEAT_LIMIT = 2;

export type Availability = { textFollowUpLawful: boolean; humanAvailable: boolean };

export type LoopStep = { state: LoopState; detected: LoopKind | null; escalation: Escalation };

function nextRung(from: number, avail: Availability): number {
  let r = from + 1;
  while (r <= LADDER.length) {
    const step = LADDER[r - 1];
    if (step === "OFFER_TEXT_FOLLOW_UP" && !avail.textFollowUpLawful) r++;
    else if (step === "OFFER_HUMAN" && !avail.humanAvailable) r++;
    else break;
  }
  return Math.min(r, LADDER.length);
}

export function observeTurn(state: LoopState, turn: LoopTurn, avail: Availability): LoopStep {
  const s: LoopState = {
    askedQuestions: [...state.askedQuestions],
    misunderstandingStreak: state.misunderstandingStreak,
    objectionCounts: { ...state.objectionCounts },
    rung: state.rung,
    loopsDetected: [...state.loopsDetected],
  };
  let detected: LoopKind | null = null;

  if (turn.speaker === "AGENT") {
    const isQ = turn.isQuestion ?? turn.text.includes("?");
    if (isQ) {
      const words = normaliseWords(turn.text);
      const key = turn.questionKey ?? null;
      const repeat = s.askedQuestions.some(
        (q) => (key != null && q.key === key) || jaccard(q.words, words) >= SIMILARITY_THRESHOLD,
      );
      if (repeat) detected = "REPEATED_QUESTION";
      s.askedQuestions.push({ key, words });
    }
  } else {
    if (turn.misunderstanding) {
      s.misunderstandingStreak += 1;
      if (s.misunderstandingStreak >= MISUNDERSTANDING_LIMIT) {
        detected = "REPEATED_MISUNDERSTANDING";
        s.misunderstandingStreak = 0;
      }
    } else {
      s.misunderstandingStreak = 0;
    }
    if (turn.objectionKey) {
      const n = (s.objectionCounts[turn.objectionKey] ?? 0) + 1;
      s.objectionCounts[turn.objectionKey] = n;
      if (n >= OBJECTION_REPEAT_LIMIT && !detected) detected = "CIRCULAR_OBJECTION";
    }
  }

  if (!detected) return { state: s, detected: null, escalation: "NONE" };
  s.loopsDetected.push(detected);
  s.rung = nextRung(s.rung, avail);
  return { state: s, detected, escalation: LADDER[s.rung - 1] };
}

/** Fixed spoken lines for each rung (no dashes, no emoji). */
export const ESCALATION_LINES: Readonly<Record<Exclude<Escalation, "NONE">, string>> = {
  REPHRASE: "Let me put that another way.",
  OFFER_TEXT_FOLLOW_UP: "Would it be easier if I sent you the details in a message instead?",
  OFFER_HUMAN: "Would you like me to pass this to a colleague who can help?",
  END_POLITELY: "I do not want to take up more of your time. Thank you for speaking with me, and have a good day.",
};
