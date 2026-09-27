/**
 * The next-best-action engine (08 §B.9, brief §§11, 18), versioned `nba-1`.
 *
 * Computed before any language generation, pure and deterministic. It runs in
 * the `lead.score` job (stored on the assessment) and at turn time in the
 * orchestrator, after `interpret()`. The model only words what this decides.
 *
 * Rules, first match wins (NbaRule R1..R12):
 *   R1  a binding deterministic verdict        existing handling, recorded
 *   R2  suppressed / opted out / intent NEGATIVE NO_ACTION (DISQUALIFY under goal G)
 *   R3  engine NOT_QUALIFIED, or a disqualifier on a CONFIRMED fact
 *                                              DISQUALIFY (+ suppress when the
 *                                              offer says so); a reviewInstead
 *                                              disqualifier is flagged for a
 *                                              person (assist_reason) and the
 *                                              plan carries on. On an INFERRED
 *                                              fact: a VERIFY question; asked
 *                                              twice unanswered, ESCALATE.
 *   R4  a person must take over                ESCALATE only for a last resort:
 *                                              the lead asked for a person, a
 *                                              legal or contract question, an
 *                                              offer hand-off rule or a workspace
 *                                              escalation condition. A REVIEW
 *                                              verdict or a security/procurement
 *                                              step is an assist, not an escalation
 *   R5  the lead asked a question              ANSWER, or ANSWER_AND_ASK when the
 *                                              best question is worth >= 0.4
 *   R6  intent NOT_NOW                         WAIT until resume_at (goal F after)
 *   R7  BOOKING_READY and goal B / E           CTA_BOOK, with at most one gating
 *                                              question and only for an unknown
 *                                              disqualifier / required / gate dimension
 *   R8  PURCHASE_READY and goal C / D          CTA_CHECKOUT / CTA_SIGNUP through the
 *                                              checkout gate; refused => INFORM with
 *                                              a SEND_ORDER_DETAILS assist
 *   R9  best question V >= 0.25, threshold unmet  ASK (one primary question)
 *   R10 threshold met                          the goal's close action
 *   R11 intent LOW / NO_DETECTED_INTENT        INFORM (they replied) or WAIT
 *   R12 otherwise                              INFORM (goal F: NURTURE)
 *
 * Owner decision 2026-09-27 (agent/handover-policy.ts): human hand-over is
 * the last resort. ESCALATE is kept for the lead asking for a person, a
 * complaint, an emergency, a legal or contract question, a verify asked twice
 * without an answer, and rules the workspace configured itself (offer hand-off
 * rules, escalation conditions, the qualify-only goal A). Everything else
 * continues; `assist_reason` asks a person to do one thing in the background.
 * Goal E closes with a booked meeting: the meeting is the hand-off.
 *
 * "Ask nothing" is a real outcome: answer, inform, CTA, book, checkout,
 * escalate, nurture, disqualify and wait are all compared before a question.
 * The adaptive tree stops as soon as the threshold is met (R10) or a
 * disqualifier is confirmed (R3).
 *
 * One primary question per turn: the NBA carries at most one question_intent.
 *
 * Pure.
 */

import {
  ALWAYS_MATERIAL_DIMENSIONS,
  CTA_ACTIONS,
  INTENT_STATES,
  INTENT_THRESHOLDS,
  NBA_ACTION_NEEDS_MODEL,
  NBA_REASON_MAX,
  NBA_VERSION,
  QUESTION_VALUE_FLOORS,
  UNMAPPED_DIMENSION,
  nextBestActionSchema,
  type ActionThreshold,
  type DimensionStatusEntry,
  type FactDimension,
  type GoalKey,
  type IntentAssessment,
  type IntentState,
  type Interpretation,
  type NbaAction,
  type NbaInput,
  type NbaQuestionIntent,
  type NbaRule,
  type NextBestAction,
  type OfferDisqualifier,
  type QiDimensionKey,
  type QualificationFact,
  type QualificationPolicy,
  type QuestionIntent,
  type QuestionIntentOverride,
  type QuestionValueTerms,
  type ResolvedGoal,
} from "./types.ts";
import { goalCloseAction } from "./goals.ts";
import {
  buildCandidates,
  evaluatePredicate,
  factValues,
  intentByKey,
  renderIntent,
  verifyIntentFor,
  type ConfiguredQuestion,
  type FactValue,
  type PredicateContext,
} from "./question-intents.ts";
import { expectedInformationGain, rankIntents, type RankedIntent, type ValueContext } from "./question-value.ts";
import { completenessFor, knownDimensions, thresholdStatus, type ResolvedOffer } from "./offer-profile.ts";
import { MOTIONS } from "../sales-library/motions.ts";
import { OBJECTIONS } from "../sales-library/objections.ts";
import { OBJECTION_KEYS, type ObjectionKey } from "../sales-library/types.ts";
import type { AgentChannel, AssistReason, HandoverReason } from "../agent/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import type { QualificationResult } from "../qualification/engine.ts";
import type { QuestionRecord } from "../qualification/next-question.ts";

export { NBA_VERSION };

/**
 * Intent states whose evidence supports a READY_TO_BUY hand-off. The label
 * reaches a rep as "the lead is ready to buy and needs a person to close"
 * with HIGH priority, so it must follow what the lead has shown, not the
 * rule that fired: a threshold met by a LOW-intent lead (`ecommerce-02`, intent
 * 44) is a qualified hand-off, not a buyer waiting.
 */
export const READY_TO_BUY_INTENT_STATES = ["HIGH", "BOOKING_READY", "PURCHASE_READY"] as const satisfies readonly IntentState[];

/** The hand-off reason the evidence supports: READY_TO_BUY becomes POLICY below HIGH intent. */
export function evidencedHandoverReason(reason: HandoverReason, intentState: IntentState): HandoverReason {
  if (reason !== "READY_TO_BUY") return reason;
  return (READY_TO_BUY_INTENT_STATES as readonly IntentState[]).includes(intentState) ? "READY_TO_BUY" : "POLICY";
}

/**
 * The contract's NbaInput plus the live facts. NbaInput carries dimension
 * *statuses* only; a disqualifier or a branch compares *values* ("fewer than
 * 5 staff"), so the caller passes the lead's live facts too. Absent = no
 * value predicate can match (nothing is disqualified on a guess).
 */
export type NbaDecisionInput = NbaInput & {
  facts?: readonly QualificationFact[];
  /**
   * A planned re-engagement check-in is due this turn (reengagement/
   * triggers.ts: the lead's "not now" resume date, a stated deadline that
   * passed). The wait the lead asked for is over, so the engine never answers
   * the check-in with another WAIT. Absent/false = an ordinary turn.
   */
  checkInDue?: boolean;
  /** Extra gating dimensions (the resolved offer's library profile gates). */
  gatingDimensions?: readonly QiDimensionKey[];
};

type Draft = {
  action: NbaAction;
  rule: NbaRule;
  reason: string;
  question: RankedIntent | null;
  handoverReason: HandoverReason | null;
  resumeAt: string | null;
  suppress: boolean;
  confidence?: number;
  /** A background task for a person while the plan carries on (never with ESCALATE). */
  assist?: AssistReason | null;
};

const DAY_MS = 86_400_000;

const POSITIVE_ORDER: readonly IntentState[] = INTENT_STATES.filter((s) => s !== "NOT_NOW" && s !== "NEGATIVE");

function intentRank(state: IntentState): number {
  return POSITIVE_ORDER.indexOf(state);
}

function meetsActionThreshold(threshold: ActionThreshold | undefined, intent: IntentState, completeness: number): boolean {
  if (!threshold) return true;
  if (threshold.minIntentState && intentRank(intent) < intentRank(threshold.minIntentState)) return false;
  if (typeof threshold.minCompleteness === "number" && completeness < threshold.minCompleteness) return false;
  return true;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function isMaterial(dimension: FactDimension, input: NbaDecisionInput): boolean {
  if (dimension === UNMAPPED_DIMENSION) return false;
  return (
    (ALWAYS_MATERIAL_DIMENSIONS as readonly string[]).includes(dimension) ||
    (input.offer.requiredDimensions ?? []).includes(dimension) ||
    allDisqualifiers(input).some((d) => d.dimension === dimension)
  );
}

/** Every disqualifier that applies, hard ones (reviewInstead false) first so they win over a review. */
function allDisqualifiers(input: NbaDecisionInput): OfferDisqualifier[] {
  const list = [...(input.offer.disqualifiers ?? []), ...(input.policy.disqualifiers ?? [])];
  const answered = intentByKey(input.interpretation?.answered_intent_key ?? null);
  if (answered?.disqualifies && answered.dimension !== UNMAPPED_DIMENSION) {
    list.push({
      dimension: answered.dimension,
      when: answered.disqualifies.when,
      reason: answered.disqualifies.reason,
      reviewInstead: answered.disqualifies.reviewInstead,
      suppress: false,
    });
  }
  return list.map((d, i) => ({ d, i })).sort((x, y) => Number(x.d.reviewInstead) - Number(y.d.reviewInstead) || x.i - y.i).map((x) => x.d);
}

/**
 * The dimension statuses with this turn's interpretation laid over them, so
 * a dimension the lead just answered is never asked again in the same turn.
 * The stored statuses win where they are already known (facts.ts owns the
 * merge; this only fills UNKNOWN gaps).
 */
export function overlayInterpretation(
  dimensions: readonly DimensionStatusEntry[],
  interpretation: Interpretation | null,
  materialOf: (dimension: FactDimension) => boolean,
): DimensionStatusEntry[] {
  const out = dimensions.map((entry) => ({ ...entry }));
  if (!interpretation) return out;
  for (const fact of interpretation.facts) {
    const existing = out.find((entry) => entry.dimension === fact.dimension);
    if (existing && existing.status !== "UNKNOWN" && !existing.stale) {
      if (existing.status === "INFERRED" && fact.state === "CONFIRMED") existing.status = "CONFIRMED";
      continue;
    }
    if (existing) {
      existing.status = fact.state;
      existing.stale = false;
      existing.material = materialOf(fact.dimension);
    } else {
      out.push({
        dimension: fact.dimension,
        status: fact.state,
        fact_ids: [],
        material: materialOf(fact.dimension),
        required: false,
        stale: false,
      });
    }
  }
  return out;
}

/** Values for predicates: stored facts plus this turn's interpretation. */
function valuesFor(input: NbaDecisionInput, confirmedOnly: boolean): Map<FactDimension, FactValue> {
  const values = factValues(input.facts ?? [], input.now, { includeAi: !confirmedOnly, confirmedOnly });
  for (const fact of input.interpretation?.facts ?? []) {
    if (confirmedOnly && fact.state !== "CONFIRMED") continue;
    const existing = values.get(fact.dimension);
    if (existing && existing.status === "CONFIRMED" && fact.state !== "CONFIRMED") continue;
    values.set(fact.dimension, { status: fact.state, value: fact.value, normalised: fact.value_normalised });
  }
  return values;
}

function toQuestionIntent(ranked: RankedIntent, channel: AgentChannel | null): NbaQuestionIntent {
  const intent = ranked.intent;
  const rendering = renderIntent(intent, channel) || intent.renderings.default;
  return {
    key: intent.key,
    dimension: intent.dimension,
    purpose: intent.purpose,
    question_id: intent.questionId ?? null,
    wording_family: clip(intent.wordingFamily, 80),
    rendering: clip(rendering, 300),
  };
}

function termsOrNull(ranked: RankedIntent | null): QuestionValueTerms | null {
  return ranked ? { ...ranked.terms } : null;
}

/** The gating dimensions a ready buyer may still be asked about (R7). */
export function gateDimensions(input: NbaDecisionInput): QiDimensionKey[] {
  const gate = new Set<QiDimensionKey>([
    ...MOTIONS[input.goal.motion].bookingGate,
    ...(input.offer.requiredDimensions ?? []),
    ...allDisqualifiers(input).map((d) => d.dimension),
    ...(input.gatingDimensions ?? []),
  ]);
  return [...gate];
}

/** Handover-always objections: a legal, regulatory or contract-terms question. */
function handoverObjection(interpretation: Interpretation | null): ObjectionKey | null {
  for (const key of interpretation?.objections ?? []) {
    if ((OBJECTION_KEYS as readonly string[]).includes(key) && OBJECTIONS[key as ObjectionKey].handover.always) {
      return key as ObjectionKey;
    }
  }
  return null;
}

/** Assist-always objections: security documents, procurement steps (a colleague provides them). */
function assistObjection(interpretation: Interpretation | null): ObjectionKey | null {
  for (const key of interpretation?.objections ?? []) {
    if ((OBJECTION_KEYS as readonly string[]).includes(key) && OBJECTIONS[key as ObjectionKey].assist?.always) {
      return key as ObjectionKey;
    }
  }
  return null;
}

function bindingDraft(verdict: string): Draft {
  const base = { rule: "R1_BINDING_VERDICT" as const, question: null, resumeAt: null, confidence: 1 };
  switch (verdict) {
    case "UNSUBSCRIBE":
      return { ...base, action: "NO_ACTION", reason: "The lead opted out: stop, suppress, send nothing.", handoverReason: null, suppress: true };
    case "WRONG_NUMBER":
      return { ...base, action: "NO_ACTION", reason: "Wrong number: suppress that endpoint only, send nothing.", handoverReason: null, suppress: true };
    case "COMPLAINT":
      return { ...base, action: "ESCALATE", reason: "A complaint: a person takes over urgently.", handoverReason: "COMPLAINT", suppress: false };
    case "HUMAN_REQUEST":
      return { ...base, action: "ESCALATE", reason: "The lead asked for a person.", handoverReason: "HUMAN_REQUESTED", suppress: false };
    case "EMERGENCY":
      return { ...base, action: "ESCALATE", reason: "An emergency was described: the existing urgent handover applies.", handoverReason: "POLICY", suppress: false };
    default:
      return { ...base, action: "NO_ACTION", reason: `Not a sales conversation (${verdict}): stop the sequence, no sales reply.`, handoverReason: null, suppress: false };
  }
}

/** Decides the next best action. Deterministic; the output always validates against the contract. */
export function decideNextBestAction(input: NbaDecisionInput): NextBestAction {
  const intent: IntentAssessment = input.intent;
  const goal: GoalKey = input.goal.goal;
  const interpretation = input.interpretation;
  const dimensions = overlayInterpretation(input.dimensions, interpretation, (d) => isMaterial(d, input));
  const known = knownDimensions(dimensions);
  const statusByDim = new Map(dimensions.map((d) => [d.dimension, d]));

  const motion = MOTIONS[input.goal.motion];
  const threshold = {
    allOf: [...new Set<QiDimensionKey>([...motion.decisionThreshold.allOf, ...(input.offer.requiredDimensions ?? [])])],
    anyOf: [...motion.decisionThreshold.anyOf] as QiDimensionKey[],
  };
  const tStatus = thresholdStatus(threshold, dimensions);
  const thresholdMet = input.thresholdMet || tStatus.met;
  const gating = gateDimensions(input);
  const requiredDims = [...new Set<QiDimensionKey>([...(input.offer.requiredDimensions ?? []), ...(input.policy.requiredDimensions ?? [])])];

  // Never ask a known dimension, whatever the caller's candidate list says.
  const candidates = input.candidates.filter((c) => {
    if (c.dimension === UNMAPPED_DIMENSION) return true;
    const entry = statusByDim.get(c.dimension);
    if (!entry || entry.status === "UNKNOWN") return c.purpose === "DISCOVER" || c.purpose === "DISQUALIFY_CHECK";
    if (entry.status === "CONFLICTING") return c.purpose === "CLARIFY";
    if (entry.stale) return c.purpose === "VERIFY";
    if (entry.status === "INFERRED" && entry.material) return c.purpose === "VERIFY";
    return false;
  });

  // Branches opened by the answer just given (adaptive trees).
  const branchTargets = new Set<string>();
  const answered = intentByKey(interpretation?.answered_intent_key ?? null);
  const predicateCtx: PredicateContext = {
    values: valuesFor(input, false),
    statuses: new Map(dimensions.map((d) => [d.dimension, d.status])),
    intentState: intent.state,
  };
  let branchToCta = false;
  for (const branch of answered?.branches ?? []) {
    if (!evaluatePredicate(branch.when, predicateCtx)) continue;
    if (branch.next === "CTA") branchToCta = true;
    else if (branch.next !== "ESCALATE") branchTargets.add(branch.next);
  }

  const valueCtx: ValueContext = {
    stage: input.stage,
    intentState: intent.state,
    channel: input.channel,
    known,
    thresholdMissing: tStatus.missing,
    requiredDimensions: requiredDims,
    gatingDimensions: gating,
    askHistory: input.askHistory,
    branchTargets,
    leadHasReplied: interpretation !== null || input.stage !== "NEW",
  };
  const ranked = rankIntents(candidates, valueCtx);
  const isRequired = (r: RankedIntent) =>
    r.intent.required === true || (r.intent.dimension !== UNMAPPED_DIMENSION && requiredDims.includes(r.intent.dimension) && !known.has(r.intent.dimension));
  // Once the threshold is met only what the engine or the offer still requires is asked.
  // Nurture (goal F) resumes from what is stored: it verifies stale facts and
  // resolves conflicts, it never restarts discovery.
  const nurturing = goal === "F_NURTURE";
  const askable = ranked.filter((r) => {
    if (nurturing && r.intent.purpose !== "VERIFY" && r.intent.purpose !== "CLARIFY") return false;
    return thresholdMet && !branchToCta ? isRequired(r) : !branchToCta || isRequired(r);
  });
  const best = askable[0] ?? null;

  // A background task for a person, raised by a rule that no longer escalates
  // (owner decision 2026-09-27). The first one raised wins.
  let assistReason: AssistReason | null = null;
  const draft = holdCloseUnderReview(decide());
  return finalise(draft);

  /**
   * A lead under review is helped, not closed: the deterministic verdict (or
   * the offer's review rule) has not cleared them, so no CTA until a person
   * has looked. The conversation still carries on.
   */
  function holdCloseUnderReview(d: Draft): Draft {
    if (assistReason !== "QUALIFICATION_REVIEW" || !(CTA_ACTIONS as readonly string[]).includes(d.action)) return d;
    return {
      ...d,
      action: "INFORM",
      question: null,
      reason: clip(`${d.reason} Held back: a person is reviewing the qualification, so carry on helping without the close.`, NBA_REASON_MAX),
    };
  }

  function decide(): Draft {
    // R1
    if (input.bindingVerdict) return bindingDraft(input.bindingVerdict);

    // R2
    if (input.suppressed || intent.state === "NEGATIVE") {
      const why = input.suppressed ? "The lead is suppressed or opted out" : "Intent is negative";
      return goal === "G_DISQUALIFY"
        ? { action: "DISQUALIFY", rule: "R2_NEGATIVE_OR_SUPPRESSED", reason: `${why}; the goal is to disqualify.`, question: null, handoverReason: null, resumeAt: null, suppress: false, confidence: 1 }
        : { action: "NO_ACTION", rule: "R2_NEGATIVE_OR_SUPPRESSED", reason: `${why}: stop follow-up, never pursue.`, question: null, handoverReason: null, resumeAt: null, suppress: false, confidence: 1 };
    }

    // R3
    if (input.engineVerdict === "NOT_QUALIFIED") {
      return { action: "DISQUALIFY", rule: "R3_DISQUALIFIED", reason: "The qualification rules returned NOT_QUALIFIED.", question: null, handoverReason: null, resumeAt: null, suppress: false, confidence: 1 };
    }
    const confirmedValues: PredicateContext = { ...predicateCtx, values: valuesFor(input, true) };
    const reviewed = new Set<string>();
    const keyOf = (d: OfferDisqualifier) => `${d.dimension}|${d.reason}`;
    for (const d of allDisqualifiers(input)) {
      if (evaluatePredicate(d.when, confirmedValues)) {
        if (d.reviewInstead) {
          // Flagged for a person; the plan carries on (owner decision
          // 2026-09-27). The verdict is not changed here: a review is never
          // a disqualification, and never a pass.
          assistReason ??= "QUALIFICATION_REVIEW";
          reviewed.add(keyOf(d));
          continue;
        }
        return { action: "DISQUALIFY", rule: "R3_DISQUALIFIED", reason: clip(`Disqualified on a confirmed answer: ${d.reason}`, NBA_REASON_MAX), question: null, handoverReason: null, resumeAt: null, suppress: d.suppress, confidence: 0.95 };
      }
    }
    for (const d of allDisqualifiers(input)) {
      if (reviewed.has(keyOf(d))) continue;
      if (!evaluatePredicate(d.when, predicateCtx)) continue;
      // Matched only on an inferred value: verify before anything gates on it (§B.12).
      const inferred = predicateCtx.values.get(d.dimension);
      const verify = verifyIntentFor(d.dimension, inferred?.value ?? null, inferred?.normalised ?? null);
      const history = input.askHistory.find((h) => h.key === verify.key);
      const exhausted = !!history && !history.answered && history.asked >= 2;
      if (!exhausted && !(input.policy.escalationConditions ?? []).includes("INFERRED_DISQUALIFIER") && (!input.channel || verify.channels.includes(input.channel))) {
        const rankedVerify = rankIntents([verify], valueCtx)[0];
        return { action: "ASK", rule: "R3_DISQUALIFIED", reason: clip(`A disqualifier (${d.reason}) matched an unverified value: verify it before deciding.`, NBA_REASON_MAX), question: rankedVerify, handoverReason: null, resumeAt: null, suppress: false };
      }
      return { action: "ESCALATE", rule: "R3_DISQUALIFIED", reason: clip(`A disqualifier (${d.reason}) matched an unverified value; a person reviews it.`, NBA_REASON_MAX), question: null, handoverReason: "QUALIFICATION_REVIEW", resumeAt: null, suppress: false };
    }

    // R4
    const escalate = (reason: string, handoverReason: HandoverReason): Draft => ({
      action: "ESCALATE",
      rule: "R4_ESCALATE",
      reason: clip(reason, NBA_REASON_MAX),
      question: null,
      handoverReason,
      resumeAt: null,
      suppress: false,
    });
    if (interpretation?.requested_action === "HUMAN") return escalate("The lead asked for a person.", "HUMAN_REQUESTED");
    const objection = handoverObjection(interpretation);
    if (objection) return escalate(`A ${OBJECTIONS[objection].label.toLowerCase()} question is always a person's job.`, "POLICY");
    // Owner decision 2026-09-27: these used to escalate and now carry on.
    // A security or procurement step is provided by a colleague in the
    // background; a REVIEW verdict is flagged for a person; a deal above the
    // human-closer value (goal E) and goal E at its threshold close with a
    // booked meeting (R7 / R10), which is the hand-off.
    if (assistObjection(interpretation)) assistReason ??= "SPECIALIST_REVIEW";
    if (input.engineVerdict === "REVIEW") assistReason ??= "QUALIFICATION_REVIEW";
    for (const rule of input.offer.handoffRules ?? []) {
      if (evaluatePredicate(rule.when, predicateCtx)) return escalate("An offer hand-off rule matched.", rule.reason);
    }
    const conditions = input.policy.escalationConditions ?? [];
    if (conditions.includes("LOW_CONFIDENCE") && intent.confidence < 0.4 && interpretation !== null) {
      return escalate("Intent confidence is too low to act on safely.", "LOW_CONFIDENCE");
    }
    if (conditions.includes("CONFLICTING_MATERIAL_FACT") && dimensions.some((d) => d.status === "CONFLICTING" && d.material)) {
      return escalate("Two answers conflict on a material point.", "LOW_CONFIDENCE");
    }
    if (conditions.includes("REPEATED_DEFLECTION") && interpretation?.completeness === "DEFLECTED") {
      const key = interpretation.answered_intent_key;
      const history = key ? input.askHistory.find((h) => h.key === key) : null;
      if (history && history.asked >= 2) return escalate("The lead deflected the same question twice.", "LOW_CONFIDENCE");
    }

    // A clear buying signal (interpret.ts close_instead: "what's the next
    // step?", "sounds good, let's do it") moves a lead who is still qualifying
    // to the close, as the legacy strategy's trial close does (closing.ts):
    // optional questions are skipped; a gating question is still asked (R7).
    // A request to book never becomes a checkout, nor a purchase a meeting.
    const closeNow = interpretation?.close_instead === true && intent.state !== "NOT_NOW";
    const signalToBook = closeNow && interpretation?.requested_action !== "BUY" && interpretation?.requested_action !== "SIGNUP";
    const signalToBuy = closeNow && interpretation?.requested_action !== "BOOK" && interpretation?.requested_action !== "CALLBACK";
    const bookingReady =
      (intent.state === "BOOKING_READY" || signalToBook) && (goal === "B_BOOK_MEETING" || goal === "E_HUMAN_CLOSER") && !input.bookingScheduled;
    const purchaseReady = (intent.state === "PURCHASE_READY" || signalToBuy) && (goal === "C_DIRECT_SALE" || goal === "D_SIGNUP_TRIAL");
    const askedToBook = intent.state === "BOOKING_READY" ? "The lead asked to book" : "The lead gave a clear buying signal";

    // R5
    if (interpretation?.lead_asked_question && !interpretation.close_instead && !bookingReady && !purchaseReady) {
      if (best && best.terms.total >= QUESTION_VALUE_FLOORS.ANSWER_AND_ASK && (!thresholdMet || isRequired(best))) {
        return { action: "ANSWER_AND_ASK", rule: "R5_LEAD_ASKED", reason: clip(`Answer their question first, then ask about ${labelOf(best.intent)}.`, NBA_REASON_MAX), question: best, handoverReason: null, resumeAt: null, suppress: false };
      }
      return { action: "ANSWER", rule: "R5_LEAD_ASKED", reason: "The lead asked a question: answer it; no further question is worth asking now.", question: null, handoverReason: null, resumeAt: null, suppress: false };
    }

    // A due check-in (the lead's own resume date, a stated deadline): the
    // wait is over, so re-engage briefly from what is known. Never a new
    // discovery question, never pressure (NURTURE; strategy.ts).
    const checkIn = (rule: NbaRule): Draft => ({
      action: "NURTURE",
      rule,
      reason: "A planned check-in is due: re-engage briefly from what is already known, no pressure.",
      question: null,
      handoverReason: null,
      resumeAt: null,
      suppress: false,
    });

    // R6
    if (intent.state === "NOT_NOW") {
      const due = input.checkInDue === true && (!intent.resumeAt || Date.parse(intent.resumeAt) <= Date.parse(input.now));
      if (due) return checkIn("R6_NOT_NOW");
      const resume = intent.resumeAt ?? new Date(Date.parse(input.now) + INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS * DAY_MS).toISOString();
      return { action: "WAIT", rule: "R6_NOT_NOW", reason: "The lead asked to wait: resume then, from what is already known.", question: null, handoverReason: null, resumeAt: resume, suppress: false };
    }

    // R7
    if (bookingReady) {
      const gate = askable
        .concat(ranked)
        .find((r) => r.intent.dimension !== UNMAPPED_DIMENSION && gating.includes(r.intent.dimension) && !known.has(r.intent.dimension));
      if (gate) {
        return { action: "CTA_BOOK", rule: "R7_BOOKING_READY", reason: clip(`${askedToBook}; one gating question first (${labelOf(gate.intent)}), then the booking.`, NBA_REASON_MAX), question: gate, handoverReason: null, resumeAt: null, suppress: false };
      }
      return { action: "CTA_BOOK", rule: "R7_BOOKING_READY", reason: `${askedToBook}; booking is not slowed by an optional question.`, question: null, handoverReason: null, resumeAt: null, suppress: false };
    }

    // R8
    if (purchaseReady) {
      if (input.checkoutAllowed) {
        const action: NbaAction = goal === "D_SIGNUP_TRIAL" ? "CTA_SIGNUP" : "CTA_CHECKOUT";
        return { action, rule: "R8_PURCHASE_READY", reason: "The lead is ready to buy and direct close is allowed.", question: null, handoverReason: null, resumeAt: null, suppress: false };
      }
      return orderDetails("R8_PURCHASE_READY", "The lead is ready to buy but direct close is not permitted: a colleague sends the details and the conversation stays with the assistant.");
    }

    // R9
    if (best && best.terms.total >= QUESTION_VALUE_FLOORS.ASK && (!thresholdMet || isRequired(best))) {
      return { action: "ASK", rule: "R9_ASK", reason: clip(askReason(best), NBA_REASON_MAX), question: best, handoverReason: null, resumeAt: null, suppress: false };
    }

    // R10
    const completeness = input.completeness;
    if (thresholdMet || branchToCta) {
      const close = goalCloseAction(goal);
      const thresholdKey = close.action === "CTA_BOOK" ? "booking" : close.action === "CTA_CHECKOUT" || close.action === "CTA_SIGNUP" ? "directSale" : "handoff";
      const offerThreshold = input.offer.thresholds?.[thresholdKey] ?? input.policy.thresholds?.[thresholdKey];
      if (meetsActionThreshold(offerThreshold, intent.state, completeness)) {
        if (close.action === "CTA_BOOK" && input.bookingScheduled) {
          return { action: "NO_ACTION", rule: "R10_THRESHOLD_MET", reason: "A meeting is already booked: nothing to ask or offer.", question: null, handoverReason: null, resumeAt: null, suppress: false };
        }
        if ((close.action === "CTA_CHECKOUT" || close.action === "CTA_SIGNUP") && !input.checkoutAllowed) {
          return orderDetails("R10_THRESHOLD_MET", "Enough is known, but direct close is not permitted: a colleague sends the details and the conversation stays with the assistant.");
        }
        if (close.action === "ESCALATE") {
          return escalateRule("R10_THRESHOLD_MET", goal === "A_QUALIFY_ONLY" ? "Qualified: hand over with the brief." : "Enough is known: a person closes.", close.handoverReason ?? "POLICY");
        }
        const why = branchToCta && !thresholdMet ? "The answer just given makes this the moment to close." : `Enough is known to decide (${threshold.allOf.join(", ") || "threshold"} met).`;
        return { action: close.action, rule: "R10_THRESHOLD_MET", reason: clip(`${why} No further question is asked.`, NBA_REASON_MAX), question: null, handoverReason: null, resumeAt: null, suppress: false };
      }
    }

    // R11
    if (intent.state === "LOW" || intent.state === "NO_DETECTED_INTENT") {
      if (interpretation) {
        return { action: "INFORM", rule: "R11_LOW_INTENT", reason: "Intent is low: share one useful point from the offer with a soft next step, no qualifying question.", question: null, handoverReason: null, resumeAt: null, suppress: false };
      }
      if (input.checkInDue === true) return checkIn("R11_LOW_INTENT");
      const resume = new Date(Date.parse(input.now) + 7 * DAY_MS).toISOString();
      return { action: "WAIT", rule: "R11_LOW_INTENT", reason: "Intent is low and the lead has not replied: wait rather than chase.", question: null, handoverReason: null, resumeAt: resume, suppress: false };
    }

    // R12
    if (goal === "F_NURTURE") {
      return { action: "NURTURE", rule: "R12_FALLBACK", reason: "Nurture: keep in touch from what is known, no new question.", question: null, handoverReason: null, resumeAt: null, suppress: false };
    }
    if (goal === "G_DISQUALIFY") {
      return { action: "DISQUALIFY", rule: "R12_FALLBACK", reason: "The goal is to disqualify.", question: null, handoverReason: null, resumeAt: null, suppress: false };
    }
    return { action: "INFORM", rule: "R12_FALLBACK", reason: "No question is worth asking and the threshold is not met: share one useful point and a soft next step.", question: null, handoverReason: null, resumeAt: null, suppress: false };
  }

  /**
   * A buyer the assistant may not send a checkout link to (direct close off,
   * the motion, no approved link, the value ceiling). It keeps the
   * conversation; a colleague sends the order details in the background. The
   * assist follows the evidence, as READY_TO_BUY did (MI-4): below HIGH
   * intent this is a qualified lead, not a buyer waiting, and nobody is asked
   * to send anything.
   */
  function orderDetails(rule: NbaRule, reason: string): Draft {
    const ready = (READY_TO_BUY_INTENT_STATES as readonly IntentState[]).includes(intent.state);
    return {
      action: "INFORM",
      rule,
      reason: clip(ready ? reason : `${reason} Intent is ${intent.state} (${Math.round(intent.score)}), so this is a qualified lead, not a ready buyer.`, NBA_REASON_MAX),
      question: null,
      handoverReason: null,
      resumeAt: null,
      suppress: false,
      assist: ready ? "SEND_ORDER_DETAILS" : null,
    };
  }

  function escalateRule(rule: NbaRule, reason: string, handoverReason: HandoverReason): Draft {
    return { action: "ESCALATE", rule, reason: clip(reason, NBA_REASON_MAX), question: null, handoverReason, resumeAt: null, suppress: false };
  }

  function askReason(chosen: RankedIntent): string {
    const t = chosen.terms;
    const parts: string[] = [];
    if (chosen.intent.purpose === "VERIFY") parts.push(`verify an inferred ${labelOf(chosen.intent)}`);
    else if (chosen.intent.purpose === "CLARIFY") parts.push(`resolve two conflicting answers on ${labelOf(chosen.intent)}`);
    else parts.push(`ask about ${labelOf(chosen.intent)}`);
    if (t.salesProgression >= 1) parts.push("it unlocks the next step");
    if (tStatus.missing.length > 0) parts.push(`still needed: ${tStatus.missing.join(", ")}`);
    return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `; ${parts.slice(1).join("; ")}` : ""} (value ${t.total.toFixed(2)}).`;
  }

  function finalise(d: Draft): NextBestAction {
    const alternatives: NextBestAction["alternatives"] = [];
    for (const r of askable) {
      if (alternatives.length >= 4) break;
      if (d.question && r.intent.key === d.question.intent.key) continue;
      alternatives.push({ action: "ASK", intent: r.intent.key, value: r.terms.total });
    }
    const close = goalCloseAction(goal);
    if (close.action !== d.action && alternatives.length < 5) alternatives.push({ action: close.action, intent: null, value: thresholdMet ? 1 : 0 });

    const unknownRequired = new Set<QiDimensionKey>();
    for (const d2 of dimensions) {
      if (d2.required && d2.status === "UNKNOWN" && d2.dimension !== UNMAPPED_DIMENSION) unknownRequired.add(d2.dimension);
    }
    for (const key of [...threshold.allOf, ...requiredDims]) if (!known.has(key)) unknownRequired.add(key);

    const confidence =
      d.confidence ?? Math.round(Math.max(0.25, Math.min(1, 0.4 + 0.3 * intent.confidence + 0.3 * input.completeness)) * 100) / 100;

    // A READY_TO_BUY label the intent does not support is relabelled, and
    // the reason says why, so the rep reads the lead as it is.
    const relabelled = d.action === "ESCALATE" && d.handoverReason === "READY_TO_BUY" && evidencedHandoverReason("READY_TO_BUY", intent.state) !== "READY_TO_BUY";
    const reason = relabelled
      ? `${d.reason} Intent is ${intent.state} (${Math.round(intent.score)}), so this is a qualified hand-off, not a ready buyer.`
      : d.reason;

    const nba: NextBestAction = {
      current_goal: goal,
      intent_state: intent.state,
      intent_score: Math.max(0, Math.min(100, Math.round(intent.score))),
      known_dimensions: dimensions
        .filter((x) => x.status !== "UNKNOWN")
        .slice(0, 30)
        .map((x) => ({ dimension: x.dimension, state: x.status as "CONFIRMED" | "INFERRED" | "CONFLICTING" })),
      unknown_required_dimensions: [...unknownRequired].slice(0, 26),
      next_action: d.action,
      question_intent: d.question ? toQuestionIntent(d.question, input.channel) : null,
      reason: clip(reason, NBA_REASON_MAX),
      rule: d.rule,
      expected_information_gain: expectedInformationGain(d.question ? d.question.terms : null),
      qualification_score: Math.max(0, Math.min(100, input.qualificationScore)),
      qualification_completeness: Math.max(0, Math.min(1, input.completeness)),
      engine_verdict: input.engineVerdict,
      confidence,
      handover_reason: d.action === "ESCALATE" ? evidencedHandoverReason(d.handoverReason ?? "NO_NEXT_QUESTION", intent.state) : null,
      assist_reason: d.action === "ESCALATE" ? null : (d.assist ?? assistReason),
      resume_at: d.action === "WAIT" ? d.resumeAt : null,
      suppress: (d.action === "DISQUALIFY" || d.action === "NO_ACTION") && d.suppress,
      model_call_required: NBA_ACTION_NEEDS_MODEL[d.action],
      question_value: termsOrNull(d.question),
      alternatives: alternatives.slice(0, 5),
      engine_version: NBA_VERSION,
    };
    return nextBestActionSchema.parse(nba);
  }
}

function labelOf(intent: QuestionIntent): string {
  return intent.dimension === UNMAPPED_DIMENSION ? "their configured question" : intent.dimension.toLowerCase().replace(/_/g, " ");
}

/** Short alias used by the orchestrator (A3) and the assessment service (A1). */
export const nba = decideNextBestAction;

/* --------------------------------------------------------- whole pipeline */

export type PlanTurnInput = {
  now: string;
  channel: AgentChannel | null;
  stage: ConversationStage;
  resolved: ResolvedOffer;
  goal: ResolvedGoal;
  intent: IntentAssessment;
  dimensions: readonly DimensionStatusEntry[];
  facts?: readonly QualificationFact[];
  configuredQuestions?: readonly ConfiguredQuestion[];
  serviceId?: string | null;
  answeredQuestionIds?: readonly string[];
  intentOverrides?: Readonly<Record<string, QuestionIntentOverride>>;
  askHistory?: readonly { key: string; asked: number; answered: boolean }[];
  engineVerdict: QualificationResult;
  qualificationScore: number;
  /** Lead-score completeness when known; otherwise computed from the offer plan. */
  completeness?: number;
  suppressed: boolean;
  interpretation: Interpretation | null;
  bindingVerdict: string | null;
  policy: QualificationPolicy;
  checkoutAllowed: boolean;
  bookingScheduled: boolean;
  dealValueGbp: number | null;
  inferDimension?: (question: QuestionRecord) => QiDimensionKey | null;
  /** A planned re-engagement check-in is due (NbaDecisionInput.checkInDue). */
  checkInDue?: boolean;
};

/**
 * The whole pure pipeline for one lead: candidates (question-intents.ts),
 * threshold and completeness (offer-profile.ts), then the NBA. What the
 * assessment service and the orchestrator call when they hold the raw
 * ingredients rather than a prepared NbaInput.
 */
export function planNextBestAction(args: PlanTurnInput): {
  nba: NextBestAction;
  input: NbaDecisionInput;
  excluded: { key: string; reason: string }[];
} {
  const materialOf = (dimension: FactDimension) =>
    dimension !== UNMAPPED_DIMENSION &&
    ((ALWAYS_MATERIAL_DIMENSIONS as readonly string[]).includes(dimension) ||
      args.resolved.requiredDimensions.includes(dimension) ||
      args.resolved.disqualifiers.some((d) => d.dimension === dimension));
  const dimensions = overlayInterpretation(args.dimensions, args.interpretation, materialOf);
  const { candidates, excluded } = buildCandidates({
    resolved: args.resolved,
    goal: args.goal.goal,
    stage: args.stage,
    channel: args.channel,
    intentState: args.intent.state,
    dimensions,
    facts: args.facts,
    now: args.now,
    configuredQuestions: args.configuredQuestions,
    serviceId: args.serviceId ?? null,
    answeredQuestionIds: args.answeredQuestionIds,
    intentOverrides: args.intentOverrides,
    askHistory: args.askHistory,
    inferDimension: args.inferDimension,
  });
  const threshold = thresholdStatus(args.resolved.threshold, dimensions);
  const input: NbaDecisionInput = {
    now: args.now,
    channel: args.channel,
    stage: args.stage,
    goal: args.goal,
    intent: args.intent,
    dimensions,
    candidates,
    askHistory: [...(args.askHistory ?? [])],
    engineVerdict: args.engineVerdict,
    qualificationScore: args.qualificationScore,
    completeness: args.completeness ?? completenessFor(args.resolved, dimensions),
    thresholdMet: threshold.met,
    suppressed: args.suppressed,
    interpretation: args.interpretation,
    bindingVerdict: args.bindingVerdict,
    offer: args.resolved.offer,
    policy: args.policy,
    checkoutAllowed: args.checkoutAllowed,
    bookingScheduled: args.bookingScheduled,
    dealValueGbp: args.dealValueGbp,
    facts: args.facts,
    gatingDimensions: args.resolved.gatingDimensions,
    checkInDue: args.checkInDue === true,
  };
  return { nba: decideNextBestAction(input), input, excluded };
}

/** True when the NBA asks or pitches (the matrix's "pursuit"). */
export function pursues(action: NbaAction): boolean {
  return action === "ASK" || action === "ANSWER_AND_ASK" || (CTA_ACTIONS as readonly string[]).includes(action) || action === "INFORM" || action === "NURTURE";
}
