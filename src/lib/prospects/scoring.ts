/**
 * Explainable prospect scoring (V4 §14).
 *
 * The division of labour this file exists to enforce:
 *   * AI extracts FEATURES — "is this company in the target industry?",
 *     "is this title a decision-making role?" — each with evidence and a
 *     confidence.
 *   * This module does the ARITHMETIC. Deterministic, versioned, and pure, so
 *     the same features always produce the same score and the same grade.
 *
 * "AI says 91" is explicitly not sufficient (§14.3). Every score therefore
 * carries its factors, each factor its evidence, source, freshness and
 * confidence — which is what the Prospect Drawer renders.
 *
 * No `server-only` marker and no Supabase import: the maths is unit-testable on
 * its own, and the persistence lives in `service.ts`.
 */

import type { Grade, ScoreFactorKey } from "./types.ts";

/** Bumped whenever the weights or the banding change, so an old score can
 *  always be explained against the policy that produced it. */
export const SCORE_VERSION = "v1.2026.09";

/** Default weights from §14.1. Overridable by platform policy, never by a model. */
export const DEFAULT_WEIGHTS: Record<ScoreFactorKey, number> = {
  ICP_FIT: 0.3,
  ROLE_AUTHORITY: 0.2,
  GEOGRAPHY: 0.15,
  NEED: 0.15,
  INTENT: 0.1,
  DATA_QUALITY: 0.1,
};

/**
 * One extracted feature. `value` is normalised to 0..1 — the extractor's job is
 * to say "how well does this match", not "how many points is it worth".
 */
export type ScoreFeature = {
  factor: ScoreFactorKey;
  /** 0..1. Clamped defensively: a model returning 4.2 must not produce a 400% score. */
  value: number;
  /** 0..1. Low-confidence evidence is discounted rather than discarded, so a
   *  thin signal moves the score a little rather than all-or-nothing. */
  confidence: number;
  evidenceSummary?: string | null;
  evidenceSource?: string | null;
  evidenceUrl?: string | null;
  observedAt?: string | null;
};

export type ScoredFactor = {
  factor: ScoreFactorKey;
  weight: number;
  rawValue: number;
  confidence: number;
  contribution: number;
  direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  evidenceSummary: string | null;
  evidenceSource: string | null;
  evidenceUrl: string | null;
  observedAt: string | null;
};

export type ScoreResult = {
  scoreVersion: string;
  totalScore: number;
  grade: Grade;
  factors: ScoredFactor[];
  explanation: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Grade bands from §14.2. A prospect with no evidence at all lands in D, which
 * is what keeps expensive enrichment and outreach budget away from it.
 */
export function gradeForScore(score: number): Grade {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

/**
 * A factor with no feature at all scores zero rather than being dropped: an
 * unknown role is genuinely worth nothing, and silently renormalising the
 * weights would let a prospect reach grade A on two of six dimensions.
 */
function featureFor(features: ScoreFeature[], factor: ScoreFactorKey): ScoreFeature | null {
  const matches = features.filter((f) => f.factor === factor);
  if (matches.length === 0) return null;
  // When several signals speak to one factor, the strongest evidence wins;
  // averaging would let three weak signals outrank one authoritative one.
  return matches.reduce((best, current) =>
    current.value * current.confidence > best.value * best.confidence ? current : best,
  );
}

function directionFor(value: number): ScoredFactor["direction"] {
  if (value >= 0.6) return "POSITIVE";
  if (value <= 0.3) return "NEGATIVE";
  return "NEUTRAL";
}

export type ScoreOptions = {
  weights?: Partial<Record<ScoreFactorKey, number>>;
  /** Live intent contribution, already bounded per category by IntentService.
   *  Passed separately because it comes from dated events rather than from the
   *  feature extractor, and because an expired signal must contribute nothing. */
  intentBoost?: number;
};

/**
 * Turns features into the canonical 0-100 score.
 *
 * Weights are renormalised to sum to 1 so a caller supplying a partial
 * override cannot accidentally inflate or deflate every score.
 */
export function scoreProspect(
  features: ScoreFeature[],
  options: ScoreOptions = {},
): ScoreResult {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  const factors: ScoredFactor[] = (Object.keys(DEFAULT_WEIGHTS) as ScoreFactorKey[]).map(
    (factor) => {
      const normalisedWeight = weights[factor] / weightSum;
      const feature = featureFor(features, factor);

      const rawValue = feature ? clamp01(feature.value) : 0;
      const confidence = feature ? clamp01(feature.confidence) : 0;

      // Confidence discounts the contribution rather than gating it, so a
      // half-certain strong match still beats a certain weak one.
      const contribution = rawValue * confidence * normalisedWeight * 100;

      return {
        factor,
        weight: normalisedWeight,
        rawValue,
        confidence,
        contribution: round2(contribution),
        direction: feature ? directionFor(rawValue) : "NEGATIVE",
        evidenceSummary: feature?.evidenceSummary ?? null,
        evidenceSource: feature?.evidenceSource ?? null,
        evidenceUrl: feature?.evidenceUrl ?? null,
        observedAt: feature?.observedAt ?? null,
      };
    },
  );

  const base = factors.reduce((total, f) => total + f.contribution, 0);

  // Intent is additive on top of its own weighted factor: a fresh signal should
  // be able to lift a good-fit prospect above the outreach threshold, but it is
  // bounded so it can never carry a poor-fit one there on its own.
  const boost = Math.max(0, Math.min(options.intentBoost ?? 0, 15));
  const total = Math.max(0, Math.min(100, base + boost));

  const rounded = round2(total);
  const grade = gradeForScore(rounded);

  return {
    scoreVersion: SCORE_VERSION,
    totalScore: rounded,
    grade,
    factors,
    explanation: explain(factors, grade, boost),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A grounded sentence, built from the factors themselves rather than generated.
 * It can therefore never claim something the evidence does not support.
 */
function explain(factors: ScoredFactor[], grade: Grade, intentBoost: number): string {
  const ranked = [...factors].sort((a, b) => b.contribution - a.contribution);
  const strengths = ranked.filter((f) => f.direction === "POSITIVE").slice(0, 3);
  const weaknesses = ranked.filter((f) => f.direction === "NEGATIVE").slice(-2);

  const parts: string[] = [`Graded ${grade}.`];

  if (strengths.length > 0) {
    parts.push(`Strongest signals: ${strengths.map((f) => label(f.factor)).join(", ")}.`);
  }
  if (weaknesses.length > 0) {
    parts.push(`Weakest: ${weaknesses.map((f) => label(f.factor)).join(", ")}.`);
  }
  if (intentBoost > 0) {
    parts.push(`Includes a fresh buying-intent signal.`);
  }
  if (strengths.length === 0 && intentBoost === 0) {
    parts.push("Not enough evidence to justify outreach spend.");
  }

  return parts.join(" ");
}

const FACTOR_WORDS: Record<ScoreFactorKey, string> = {
  ICP_FIT: "customer fit",
  ROLE_AUTHORITY: "role authority",
  GEOGRAPHY: "location",
  NEED: "likely need",
  INTENT: "buying intent",
  DATA_QUALITY: "data quality",
};

function label(factor: ScoreFactorKey): string {
  return FACTOR_WORDS[factor] ?? factor;
}

/* ------------------------------------------------------------- gate helpers */

/**
 * The cheap-before-expensive gates from §53. Each answers "is this candidate
 * worth the next, more expensive, step?" — which is what keeps a sourcing run
 * inside budget rather than enriching everything it finds.
 */
export const ENRICHMENT_GATE_SCORE = 45;
export const CONTACT_DISCOVERY_GATE_SCORE = 55;
export const PERSONALISATION_GATE_SCORE = 70;

export function passesEnrichmentGate(score: number): boolean {
  return score >= ENRICHMENT_GATE_SCORE;
}

export function passesContactDiscoveryGate(score: number): boolean {
  return score >= CONTACT_DISCOVERY_GATE_SCORE;
}

/** Mini-model personalisation is only ever spent on a prospect that will
 *  actually be contacted (§53, last line). */
export function passesPersonalisationGate(score: number, willContact: boolean): boolean {
  return willContact && score >= PERSONALISATION_GATE_SCORE;
}

const GRADE_ORDER: Grade[] = ["D", "C", "B", "A", "A+"];

/** True when `grade` is at least `minimum`. Used by campaign audience gates. */
export function meetsMinimumGrade(grade: Grade | null, minimum: Grade): boolean {
  if (!grade) return false;
  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(minimum);
}
