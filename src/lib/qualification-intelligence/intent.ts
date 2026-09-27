/**
 * The explainable intent score and state (design 08 §B.4), `ie-1`.
 *
 * Reads **only** intent signals (lead_intent_signals rows). FIT is computed by
 * the lead score from FIT features and never reaches this module, so FIT and
 * INTENT stay disjoint by construction (tested).
 *
 * Score = five capped components (sum 100):
 *   EXPLICIT 35 · BEHAVIOURAL 20 (+ CONTEXT, CD-1) · CONVERSATIONAL 25 ·
 *   RECENCY 10 · CONSISTENCY 10
 * Each signal category = cap x clamp01(max(decayed strength x confidence)
 *   + 0.15 when a second distinct type in the category is live).
 *
 * Contradictions are never summed; they cap (§B.4 precedence, first match):
 *   1 UNSUBSCRIBE / COMPLAINT live (or suppressed)       -> NEGATIVE, 0
 *   2 a hard refusal is newer than anything the lead
 *     *said* in favour                                  -> NEGATIVE, <= 10
 *   3 live NOT_NOW not lifted by a newer said positive   -> NOT_NOW,  <= 25
 *   4 booking / demo / callback request, decayed >= 0.6,
 *     no newer negative, no booking already scheduled    -> BOOKING_READY
 *   5 purchase / signup / ready-to-buy, decayed >= 0.6   -> PURCHASE_READY
 *   6-10 by score: HIGH >= 70, MEDIUM 45-69, EXPLORATORY 20-44 with an
 *     info-seeking signal, LOW 10-44, else NO_DETECTED_INTENT
 *
 * "Said" = EXPLICIT or CONVERSATIONAL category. A behavioural or context
 * signal (a pricing-page visit, a funding round) never lifts a refusal: the
 * brief's example, a pricing visit plus "not interested", is NEGATIVE with the
 * visit listed as contradicting evidence, never HIGH.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports.
 */

import {
  AI_EXTRACTION_MIN_CONFIDENCE,
  BOOKING_READY_SIGNAL_TYPES,
  CATEGORY_SCORE_COMPONENT,
  HARD_NEGATIVE_SIGNAL_TYPES,
  IE_VERSION,
  INFO_SEEKING_SIGNAL_TYPES,
  INTENT_COMPONENT_CAPS,
  INTENT_STATES,
  INTENT_THRESHOLDS,
  PURCHASE_READY_SIGNAL_TYPES,
  SIGNAL_EXCERPT_MAX,
  TERMINAL_NEGATIVE_SIGNAL_TYPES,
  type IntentAssessment,
  type IntentCategoryScores,
  type IntentEvidenceItem,
  type IntentSignal,
  type IntentState,
  type SignalType,
} from "./types.ts";
import { decayedStrength, isLive, nextDecayBoundary, recencyFactor } from "./decay.ts";

export type AssessIntentOptions = {
  /** The lead is opted out or on the suppression list (rule 1). */
  suppressed?: boolean;
  /** A booking is already scheduled (rule 4 excludes BOOKING_READY). */
  bookingScheduled?: boolean;
};

const HARD_NEGATIVE = new Set<string>(HARD_NEGATIVE_SIGNAL_TYPES);
const TERMINAL = new Set<string>(TERMINAL_NEGATIVE_SIGNAL_TYPES);
const BOOKING_READY = new Set<string>(BOOKING_READY_SIGNAL_TYPES);
const PURCHASE_READY = new Set<string>(PURCHASE_READY_SIGNAL_TYPES);
const INFO_SEEKING = new Set<string>(INFO_SEEKING_SIGNAL_TYPES);

const EVIDENCE_MAX = 40;
const CONTRADICTIONS_MAX = 20;

function t(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** A said signal: the lead wrote or submitted it, as opposed to behaviour or context. */
export function isSaid(signal: Pick<IntentSignal, "category">): boolean {
  return signal.category === "EXPLICIT" || signal.category === "CONVERSATIONAL";
}

/**
 * An AI-assist signal below the extraction floor may add weight but never
 * decides a holding state (CLAUDE.md resolved conflict 1): it cannot make a
 * lead NEGATIVE, NOT_NOW or ready on its own.
 */
function decisive(signal: IntentSignal): boolean {
  return signal.source !== "AI_ASSIST" || signal.confidence >= AI_EXTRACTION_MIN_CONFIDENCE;
}

/** Newest first; ties broken by id so the order never depends on input order. */
function newestFirst(a: IntentSignal, b: IntentSignal): number {
  return t(b.observedAt) - t(a.observedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function evidenceItem(signal: IntentSignal, now: Date): IntentEvidenceItem {
  return {
    signal_id: signal.id,
    signal_type: signal.type,
    category: signal.category,
    polarity: signal.polarity,
    decayed_strength: round3(decayedStrength(signal, now)),
    reason: signal.reason.slice(0, 200) || signal.type,
    observed_at: new Date(t(signal.observedAt)).toISOString(),
  };
}

/** The category component scores, before any cap. */
export function componentScores(live: IntentSignal[], now: Date): IntentCategoryScores {
  const positives = live.filter((s) => s.polarity === "POSITIVE");
  const scores: IntentCategoryScores = { EXPLICIT: 0, BEHAVIOURAL: 0, CONVERSATIONAL: 0, RECENCY: 0, CONSISTENCY: 0 };

  for (const component of ["EXPLICIT", "BEHAVIOURAL", "CONVERSATIONAL"] as const) {
    const inComponent = positives.filter((s) => CATEGORY_SCORE_COMPONENT[s.category] === component);
    let best = 0;
    const types = new Set<SignalType>();
    for (const s of inComponent) {
      const value = decayedStrength(s, now) * clamp01(s.confidence);
      if (value > 0) types.add(s.type);
      if (value > best) best = value;
    }
    const bonus = types.size >= 2 ? INTENT_THRESHOLDS.SECOND_TYPE_BONUS : 0;
    scores[component] = round3(INTENT_COMPONENT_CAPS[component] * clamp01(best + (best > 0 ? bonus : 0)));
  }

  const newestPositive = [...positives].sort(newestFirst)[0];
  scores.RECENCY = newestPositive
    ? round3(INTENT_COMPONENT_CAPS.RECENCY * recencyFactor(newestPositive.observedAt, now))
    : 0;

  // Consistency only means something when there is positive intent to be
  // consistent with; with none it is 0, so "no signals" stays NO_DETECTED_INTENT.
  if (!newestPositive) {
    scores.CONSISTENCY = 0;
  } else {
    const negatives = live.filter((s) => s.polarity === "NEGATIVE").sort(newestFirst);
    const newestNonNeutral = live.filter((s) => s.polarity !== "NEUTRAL").sort(newestFirst)[0];
    if (negatives.length === 0) scores.CONSISTENCY = INTENT_COMPONENT_CAPS.CONSISTENCY;
    else if (newestNonNeutral && newestNonNeutral.polarity === "NEGATIVE") scores.CONSISTENCY = 0;
    else scores.CONSISTENCY = INTENT_COMPONENT_CAPS.CONSISTENCY / 2;
  }
  return scores;
}

function total(scores: IntentCategoryScores): number {
  return Math.max(
    0,
    Math.min(100, Math.round(scores.EXPLICIT + scores.BEHAVIOURAL + scores.CONVERSATIONAL + scores.RECENCY + scores.CONSISTENCY)),
  );
}

/** Scale components down so they sum to at most `cap` (a capped state stays explainable). */
function capComponents(scores: IntentCategoryScores, cap: number): IntentCategoryScores {
  const sum = scores.EXPLICIT + scores.BEHAVIOURAL + scores.CONVERSATIONAL + scores.RECENCY + scores.CONSISTENCY;
  if (sum <= cap || sum <= 0) return scores;
  const k = cap / sum;
  return {
    EXPLICIT: round3(scores.EXPLICIT * k),
    BEHAVIOURAL: round3(scores.BEHAVIOURAL * k),
    CONVERSATIONAL: round3(scores.CONVERSATIONAL * k),
    RECENCY: round3(scores.RECENCY * k),
    CONSISTENCY: round3(scores.CONSISTENCY * k),
  };
}

/**
 * Confidence = mean confidence of the live signals x category coverage,
 * floored at 0.25 when any signal exists. Coverage counts the two categories
 * a lead can realistically show today (explicit, conversational) plus any
 * behavioural / context evidence, capped at 1: behavioural data is usually
 * absent (§D1) and its absence must not halve every lead's confidence.
 */
function confidenceOf(live: IntentSignal[]): number {
  if (live.length === 0) return 0;
  const mean = live.reduce((sum, s) => sum + clamp01(s.confidence), 0) / live.length;
  const categories = new Set(live.map((s) => (s.category === "CONTEXT" ? "BEHAVIOURAL" : s.category)));
  const coverage = Math.min(1, categories.size / 2);
  return round3(Math.max(INTENT_THRESHOLDS.CONFIDENCE_FLOOR, clamp01(mean * coverage)));
}

/**
 * Assess one lead's intent from its signals at `now`. Pure and deterministic:
 * the same signals and instant always give the same assessment, in any order.
 */
export function assessIntent(
  signals: readonly IntentSignal[],
  now: Date | string,
  options: AssessIntentOptions = {},
): IntentAssessment {
  const at = typeof now === "string" ? new Date(now) : now;
  const live = signals.filter((s) => s.retractedAt === null && isLive(s, at)).slice().sort(newestFirst);

  const positives = live.filter((s) => s.polarity === "POSITIVE");
  const negatives = live.filter((s) => s.polarity === "NEGATIVE");
  const saidPositives = positives.filter(isSaid);
  const newestSaidPositive = saidPositives[0] ?? null;
  const newestPositive = positives[0] ?? null;

  const raw = componentScores(live, at);
  const rawScore = total(raw);

  const evidence = [...live]
    .sort((a, b) => decayedStrength(b, at) * b.confidence - decayedStrength(a, at) * a.confidence || newestFirst(a, b))
    .slice(0, EVIDENCE_MAX)
    .map((s) => evidenceItem(s, at));
  const confidence = confidenceOf(live);
  const validUntil = nextDecayBoundary(live, at, { newestPositiveObservedAt: newestPositive?.observedAt ?? null });

  const result = (
    state: IntentState,
    categories: IntentCategoryScores,
    contradictions: IntentSignal[] = [],
    resumeAt: string | null = null,
  ): IntentAssessment => ({
    state,
    score: total(categories),
    categories,
    evidence,
    contradictions: contradictions.slice(0, CONTRADICTIONS_MAX).map((s) => evidenceItem(s, at)),
    confidence,
    validUntil,
    resumeAt,
    version: IE_VERSION,
  });

  /* ---- rule 1: opted out, suppressed, or a terminal negative not lifted */
  const terminal = negatives.find((s) => TERMINAL.has(s.type) && decisive(s)) ?? null;
  // Only a new explicit inbound (the lead wrote to us again) lifts a complaint
  // or an unsubscribe; behaviour, context and our own classifications do not.
  const liftedTerminal =
    terminal !== null &&
    positives.some(
      (s) => s.category === "EXPLICIT" && (s.source === "REPLY" || s.source === "FORM") && t(s.observedAt) > t(terminal.observedAt),
    );
  if (options.suppressed || (terminal && !liftedTerminal)) {
    return result("NEGATIVE", capComponents(raw, 0), positives);
  }

  /* ---- rule 2: the newest refusal outranks everything said before it */
  const hardNegative = negatives.find((s) => HARD_NEGATIVE.has(s.type) && decisive(s)) ?? null;
  if (hardNegative && (!newestSaidPositive || t(hardNegative.observedAt) >= t(newestSaidPositive.observedAt))) {
    return result(
      "NEGATIVE",
      capComponents(raw, INTENT_THRESHOLDS.NEGATIVE_CAP),
      positives.filter((s) => s.id !== hardNegative.id),
    );
  }

  /* ---- rule 3: a live NOT_NOW, unless the lead has since said otherwise */
  const notNow = negatives.find((s) => s.type === "NOT_NOW" && decisive(s)) ?? null;
  const resume = notNow?.resumeAt ?? notNow?.flatUntil ?? null;
  if (
    notNow &&
    resume !== null &&
    t(resume) > at.getTime() &&
    (!newestSaidPositive || t(notNow.observedAt) >= t(newestSaidPositive.observedAt))
  ) {
    return result("NOT_NOW", capComponents(raw, INTENT_THRESHOLDS.NOT_NOW_CAP), positives, new Date(t(resume)).toISOString());
  }

  const newerNegativeThan = (s: IntentSignal) => negatives.some((n) => t(n.observedAt) > t(s.observedAt));
  const ready = (types: Set<string>) =>
    positives.find(
      (s) =>
        types.has(s.type) &&
        decisive(s) &&
        decayedStrength(s, at) >= INTENT_THRESHOLDS.READY_MIN_DECAYED_STRENGTH &&
        !newerNegativeThan(s),
    ) ?? null;

  /* ---- rule 4: booking ready */
  if (!options.bookingScheduled && ready(BOOKING_READY)) return result("BOOKING_READY", raw);
  /* ---- rule 5: purchase ready */
  if (ready(PURCHASE_READY)) return result("PURCHASE_READY", raw);

  /* ---- rules 6-10: by score */
  if (rawScore >= INTENT_THRESHOLDS.HIGH) return result("HIGH", raw);
  if (rawScore >= INTENT_THRESHOLDS.MEDIUM) return result("MEDIUM", raw);
  const infoSeeking = positives.some((s) => INFO_SEEKING.has(s.type));
  if (rawScore >= INTENT_THRESHOLDS.EXPLORATORY_MIN && infoSeeking) return result("EXPLORATORY", raw);
  if (rawScore >= INTENT_THRESHOLDS.LOW_MIN) return result("LOW", raw);
  return result("NO_DETECTED_INTENT", raw);
}

/** Ordinal of a state among the positive ladder; holding states rank below everything. */
export function intentRank(state: IntentState): number {
  if (state === "NEGATIVE" || state === "NOT_NOW") return -1;
  return INTENT_STATES.indexOf(state);
}

/** Whether `state` meets a threshold's `minIntentState` (policy / offer thresholds). */
export function intentAtLeast(state: IntentState, min: IntentState | undefined): boolean {
  if (!min) return true;
  if (min === "NEGATIVE" || min === "NOT_NOW") return state === min;
  return intentRank(state) >= intentRank(min);
}

/** One plain sentence explaining an assessment, built only from the assessment. */
export function explainIntent(a: IntentAssessment): string {
  const top = a.evidence.filter((e) => e.polarity === "POSITIVE").slice(0, 2).map((e) => e.reason);
  const words: Record<IntentState, string> = {
    NO_DETECTED_INTENT: "No buying intent detected yet.",
    LOW: "Low intent.",
    EXPLORATORY: "Exploring: asking questions, not yet ready.",
    MEDIUM: "Medium intent.",
    HIGH: "High intent.",
    BOOKING_READY: "Ready to book.",
    PURCHASE_READY: "Ready to buy.",
    NOT_NOW: "Asked to be contacted later.",
    NEGATIVE: "Not interested, or asked us to stop.",
  };
  const parts = [`${words[a.state]} Score ${a.score}/100.`];
  if (a.state === "NEGATIVE" || a.state === "NOT_NOW") {
    const neg = a.evidence.find((e) => e.polarity === "NEGATIVE");
    if (neg) parts.push(`Because: ${neg.reason}`);
    if (a.contradictions.length > 0) parts.push(`${a.contradictions.length} earlier positive signal(s) overruled.`);
  } else if (top.length > 0) {
    parts.push(`Strongest: ${top.join("; ")}`);
  }
  return parts.join(" ").slice(0, SIGNAL_EXCERPT_MAX * 2);
}
