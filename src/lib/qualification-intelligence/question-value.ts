/**
 * The question value function (08 §B.8, brief §9), versioned `qv-1`.
 *
 *   V = decisionRelevance + informationGain·(1 − pKnown) + salesProgression
 *       + intentRelevance − friction − repetitionRisk − prematurity − pKnown
 *
 * Additive, every term 0..1, weights default to 1. It replaced the
 * multiplicative IG × DR × CV formula; next-question.ts delegates to it and
 * keeps its own signature and result shape.
 *
 *   decisionRelevance  attribute × 1.0 when the dimension is in the goal
 *                      threshold or the offer's required dimensions, × 0.5
 *                      otherwise (a required configured question counts too).
 *   informationGain    attribute × (1 − pKnown).
 *   salesProgression   1 when answering unlocks the goal's next step (a
 *                      missing threshold dimension, a booking gate, or the
 *                      target of a branch the last answer opened); 0.5 when it
 *                      narrows the offer; else 0.2.
 *   intentRelevance    HIGH / BOOKING_READY / PURCHASE_READY: only gating
 *                      dimensions score (> 0). LOW / EXPLORATORY / none:
 *                      PROBLEM / USE_CASE / OUTCOME score 0.8 (they build
 *                      intent), commercial dimensions 0. Otherwise the
 *                      attribute.
 *   friction           attribute + 0.15 for an open-text answer on SMS or
 *                      WhatsApp + 0.15 when the lead has not replied yet.
 *   repetitionRisk     0.5 asked once and unanswered, 1.0 asked twice. The
 *                      sticky re-ask is limited to one: a third ask never
 *                      happens (MAX_ASKS_PER_INTENT; candidates drop it).
 *   prematurity        stage-adjusted (adjustedPrematurity): BUDGET is at
 *                      least 0.8 until a problem is known, authority-type at
 *                      least 0.6 until the lead has engaged.
 *   pKnown             0 unknown; 0.6 for a VERIFY of an INFERRED fact; 0.3
 *                      when enrichment could supply it and has not run.
 *
 * "Ask nothing" is a scored alternative: nba.ts asks only when V >= the ASK
 * floor (0.25) and no higher-priority action applies.
 *
 * Pure.
 */

import {
  MAX_ASKS_PER_INTENT,
  QUESTION_VALUE_FLOORS,
  QV_VERSION,
  UNMAPPED_DIMENSION,
  type AnswerType,
  type FactDimension,
  type IntentState,
  type QiDimensionKey,
  type QuestionIntent,
  type QuestionIntentAttrs,
  type QuestionPurpose,
  type QuestionValueTerms,
} from "./types.ts";
import { AUTHORITY_DIMENSIONS, COMMERCIAL_DIMENSIONS, PROBLEM_DIMENSIONS } from "../sales-library/motions.ts";
import type { AgentChannel } from "../agent/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";

export { QV_VERSION };

export const ASK_FLOOR = QUESTION_VALUE_FLOORS.ASK;
export const ANSWER_AND_ASK_FLOOR = QUESTION_VALUE_FLOORS.ANSWER_AND_ASK;

/** Dimensions whose answer narrows which offer or scope applies. */
const NARROWING_DIMENSIONS: readonly QiDimensionKey[] = [
  "SERVICE_NEEDED",
  "PRODUCT_INTEREST",
  "PROJECT_SCOPE",
  "USE_CASE",
  "HIRING_NEED",
  "SUITABILITY",
];

/** Intent-building dimensions for a low-intent lead (§B.8 intentRelevance). */
const INTENT_BUILDING: readonly QiDimensionKey[] = ["PROBLEM", "USE_CASE", "OUTCOME"];

const HIGH_INTENT: readonly IntentState[] = ["HIGH", "BOOKING_READY", "PURCHASE_READY"];
const LOW_INTENT: readonly IntentState[] = ["LOW", "EXPLORATORY", "NO_DETECTED_INTENT"];

const OPEN_TEXT: readonly AnswerType[] = ["text"];

export type ValueWeights = Partial<Record<Exclude<keyof QuestionValueTerms, "total">, number>>;

export type ValueContext = {
  stage: ConversationStage;
  /** Null = no intent assessment (the legacy selector): intentRelevance = the attribute. */
  intentState: IntentState | null;
  channel: AgentChannel | null;
  /** Dimensions known (CONFIRMED or INFERRED), for prematurity. */
  known: ReadonlySet<FactDimension>;
  /** Threshold dimensions still unknown. */
  thresholdMissing: readonly FactDimension[];
  /** The offer's required dimensions. */
  requiredDimensions?: readonly FactDimension[];
  /** Booking gate + disqualifier dimensions: what a ready buyer may still be asked. */
  gatingDimensions?: readonly FactDimension[];
  askHistory?: readonly { key: string; asked: number; answered: boolean }[];
  /** Intent keys a branch of the last answer points at (adaptive trees). */
  branchTargets?: ReadonlySet<string>;
  /** Dimensions enrichment could supply and has not yet run for. */
  derivableDimensions?: ReadonlySet<FactDimension>;
  /** The lead has replied at least once in this conversation. */
  leadHasReplied?: boolean;
  weights?: ValueWeights;
};

/** What the value function needs to know about a question. */
export type ValueSubject = {
  key: string;
  dimension: FactDimension;
  purpose: QuestionPurpose;
  answerType: AnswerType;
  attrs: QuestionIntentAttrs;
  /** A configured question marked required, or a REQUIRE override. */
  required?: boolean;
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Stage adjustment of the static prematurity attribute (moved here from
 * next-question.ts, which re-exports it).
 *   * BUDGET is at least 0.8 premature until a problem dimension is known, then
 *     a quarter of its base.
 *   * AUTHORITY-type questions are at least 0.6 premature until the lead has
 *     engaged (any stage after NEW), then about a third of their base.
 *   * Everything else halves once the lead has engaged.
 */
export function adjustedPrematurity(
  dimension: FactDimension | null,
  base: number,
  stage: ConversationStage,
  known: ReadonlySet<FactDimension>,
): number {
  const engaged = stage !== "NEW";
  if (dimension === "BUDGET") {
    const problemStated = PROBLEM_DIMENSIONS.some((key) => known.has(key));
    return problemStated ? base * 0.25 : Math.max(base, 0.8);
  }
  if (dimension && dimension !== UNMAPPED_DIMENSION && AUTHORITY_DIMENSIONS.includes(dimension)) {
    return engaged ? base * 0.35 : Math.max(base, 0.6);
  }
  return engaged ? base * 0.5 : base;
}

function includesDim(list: readonly FactDimension[] | undefined, dimension: FactDimension): boolean {
  return !!list && list.includes(dimension);
}

/** The value terms of one question in context. Deterministic. */
export function questionValue(subject: ValueSubject, ctx: ValueContext): QuestionValueTerms {
  const w = ctx.weights ?? {};
  const weight = (key: keyof ValueWeights) => (typeof w[key] === "number" && Number.isFinite(w[key]) ? (w[key] as number) : 1);
  const dimension = subject.dimension;
  const inThreshold = includesDim(ctx.thresholdMissing, dimension);
  const required = subject.required === true || includesDim(ctx.requiredDimensions, dimension);
  const gating = includesDim(ctx.gatingDimensions, dimension);

  // pKnown
  let pKnown = 0;
  if (subject.purpose === "VERIFY") pKnown = 0.6;
  else if (ctx.derivableDimensions?.has(dimension)) pKnown = 0.3;

  const decisionRelevance = clamp01(subject.attrs.decisionRelevance * (inThreshold || required ? 1 : 0.5));
  const informationGain = clamp01(subject.attrs.informationGain * (1 - pKnown));

  let salesProgression: number;
  if (inThreshold || gating || ctx.branchTargets?.has(subject.key) || subject.purpose === "CLARIFY") salesProgression = 1;
  else if (dimension !== UNMAPPED_DIMENSION && NARROWING_DIMENSIONS.includes(dimension)) salesProgression = 0.5;
  else salesProgression = 0.2;

  let intentRelevance = subject.attrs.intentRelevance;
  if (ctx.intentState && HIGH_INTENT.includes(ctx.intentState)) {
    intentRelevance = gating || inThreshold || required ? Math.max(subject.attrs.intentRelevance, 0.5) : 0;
  } else if (ctx.intentState && LOW_INTENT.includes(ctx.intentState)) {
    if (dimension !== UNMAPPED_DIMENSION && INTENT_BUILDING.includes(dimension)) intentRelevance = 0.8;
    else if (dimension !== UNMAPPED_DIMENSION && COMMERCIAL_DIMENSIONS.includes(dimension)) intentRelevance = 0;
  }
  intentRelevance = clamp01(intentRelevance);

  let friction = subject.attrs.friction;
  if (OPEN_TEXT.includes(subject.answerType) && (ctx.channel === "sms" || ctx.channel === "whatsapp")) friction += 0.15;
  if (ctx.leadHasReplied === false) friction += 0.15;
  friction = clamp01(friction);

  const history = ctx.askHistory?.find((h) => h.key === subject.key);
  const unansweredAsks = history && !history.answered ? history.asked : 0;
  const repetitionRisk = unansweredAsks >= MAX_ASKS_PER_INTENT ? 1 : unansweredAsks === 1 ? 0.5 : 0;

  const prematurity = clamp01(adjustedPrematurity(dimension, subject.attrs.prematurity, ctx.stage, ctx.known));

  const total =
    weight("decisionRelevance") * decisionRelevance +
    weight("informationGain") * informationGain +
    weight("salesProgression") * salesProgression +
    weight("intentRelevance") * intentRelevance -
    weight("friction") * friction -
    weight("repetitionRisk") * repetitionRisk -
    weight("prematurity") * prematurity -
    weight("pKnown") * pKnown;

  return {
    decisionRelevance: round4(decisionRelevance),
    informationGain: round4(informationGain),
    salesProgression: round4(salesProgression),
    intentRelevance: round4(intentRelevance),
    friction: round4(friction),
    repetitionRisk: round4(repetitionRisk),
    prematurity: round4(prematurity),
    pKnown: round4(pKnown),
    total: round4(total),
  };
}

export type RankedIntent = { intent: QuestionIntent; terms: QuestionValueTerms };

/**
 * Candidates ranked best first: value, then required, then CLARIFY / VERIFY
 * before discovery (a conflict or an unverified material fact blocks every
 * gate), then key. Deterministic.
 */
export function rankIntents(candidates: readonly QuestionIntent[], ctx: ValueContext): RankedIntent[] {
  const purposeRank: Record<QuestionPurpose, number> = { CLARIFY: 0, DISQUALIFY_CHECK: 1, VERIFY: 2, DISCOVER: 3 };
  return candidates
    .map((intent) => ({ intent, terms: questionValue(intent, ctx) }))
    .sort(
      (a, b) =>
        b.terms.total - a.terms.total ||
        Number(b.intent.required === true) - Number(a.intent.required === true) ||
        purposeRank[a.intent.purpose] - purposeRank[b.intent.purpose] ||
        a.intent.key.localeCompare(b.intent.key),
    );
}

/** Whether a question is worth asking at all (§B.8: V >= 0.25). */
export function worthAsking(terms: QuestionValueTerms, floor: number = ASK_FLOOR): boolean {
  return terms.total >= floor;
}

/** The expected information gain the NBA reports (unit interval). */
export function expectedInformationGain(terms: QuestionValueTerms | null): number {
  return terms ? clamp01(terms.informationGain) : 0;
}
