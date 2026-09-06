/**
 * Turning a stored score into the three panels the scoring page renders
 * (V4 §14.4-14.6): what helped, what held it back, and what the evidence was.
 *
 * Everything below is *derived from the persisted factors*. Nothing is
 * generated, and no number appears here that was not already produced by
 * `scoreProspect`. That is the whole point of §14.3: a customer must be able to
 * add the panel up and get the score back.
 *
 * Pure — no `server-only`, no Supabase, no model call.
 */

import type { ProspectScore, ScoreFactor, ScoreFactorKey } from "./types.ts";
import { scoreFactorLabel } from "./types.ts";

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

/**
 * Confidence is banded, never invented. The number comes from the extractor's
 * own recorded confidence on the evidence — §14.7 forbids a model asserting
 * "97% confident" of its own accord, so the band is a presentation of a stored
 * value rather than a new claim.
 */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

export function confidenceLabel(band: ConfidenceBand): string {
  return band === "HIGH"
    ? "High confidence"
    : band === "MEDIUM"
      ? "Medium confidence"
      : "Low confidence";
}

export function confidenceTone(band: ConfidenceBand): "success" | "warning" | "neutral" {
  return band === "HIGH" ? "success" : band === "MEDIUM" ? "warning" : "neutral";
}

export type ScoreContribution = {
  factor: ScoreFactorKey;
  title: string;
  detail: string;
  /** Whole points, signed. Positives are what the factor earned; concerns are
   *  what it left on the table against its own weight. */
  points: number;
  confidence: number;
};

/** The points a factor is worth if it scores perfectly — its weight, in points. */
export function factorCeiling(factor: ScoreFactor): number {
  return factor.weight * 100;
}

/**
 * The factors carrying the score.
 *
 * Ranked by points earned rather than by raw value, because a 0.9 on a 10%
 * factor moves the total less than a 0.7 on a 30% one, and the panel is about
 * what is driving the number.
 */
export function positiveFactors(score: ProspectScore, limit = 4): ScoreContribution[] {
  return score.factors
    .filter((f) => f.direction === "POSITIVE" && f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit)
    .map((f) => ({
      factor: f.factor,
      title: scoreFactorLabel(f.factor),
      detail: f.evidenceSummary ?? defaultPositiveDetail(f),
      points: Math.round(f.contribution),
      confidence: f.confidence,
    }));
}

/**
 * What is limiting the score.
 *
 * A concern is a *shortfall against a factor's own weight*, not a penalty: a
 * geography factor worth 15 points that earned 7 has left 8 on the table, and
 * that is the honest way to describe it. Presenting these as deductions from
 * 100 would imply punishments the engine never applied.
 */
export function scoreConcerns(score: ProspectScore, limit = 3): ScoreContribution[] {
  return score.factors
    .map((factor) => ({ factor, shortfall: factorCeiling(factor) - factor.contribution }))
    // Under a point of shortfall is noise, not a concern worth a customer's
    // attention.
    .filter(({ shortfall }) => shortfall >= 1)
    .sort((a, b) => b.shortfall - a.shortfall)
    .slice(0, limit)
    .map(({ factor, shortfall }) => ({
      factor: factor.factor,
      title: concernTitle(factor),
      detail: concernDetail(factor),
      points: -Math.round(shortfall),
      confidence: factor.confidence,
    }));
}

function defaultPositiveDetail(factor: ScoreFactor): string {
  return `${scoreFactorLabel(factor.factor)} scored ${Math.round(
    factor.rawValue * 100,
  )} out of 100 against your profile.`;
}

function concernTitle(factor: ScoreFactor): string {
  if (factor.confidence < 0.5) return `${scoreFactorLabel(factor.factor)} not confirmed`;
  if (factor.rawValue === 0) return `No ${scoreFactorLabel(factor.factor).toLowerCase()} evidence`;
  return `Limited ${scoreFactorLabel(factor.factor).toLowerCase()}`;
}

function concernDetail(factor: ScoreFactor): string {
  if (factor.rawValue === 0 && factor.confidence === 0) {
    return "Nothing was found for this factor, so it contributed nothing to the score.";
  }
  if (factor.confidence < 0.5) {
    return factor.evidenceSource
      ? `Evidence came from ${factor.evidenceSource} only, so its contribution was discounted.`
      : "The evidence behind this factor is weak, so its contribution was discounted.";
  }
  return (
    factor.evidenceSummary ??
    `Scored ${Math.round(factor.rawValue * 100)} out of 100 against a factor worth ${Math.round(
      factorCeiling(factor),
    )} points.`
  );
}

export type EvidenceSource = {
  source: string;
  facts: string[];
  url: string | null;
  confidence: number;
  band: ConfidenceBand;
  observedAt: string | null;
};

/**
 * Evidence grouped by where it came from.
 *
 * A source's confidence is the *lowest* of the facts it supplied, not the
 * average: one shaky fact from a source is a reason to trust that source less,
 * and averaging would hide it behind three solid ones.
 */
export function evidenceSources(score: ProspectScore): EvidenceSource[] {
  const bySource = new Map<string, EvidenceSource>();

  for (const factor of score.factors) {
    const source = factor.evidenceSource;
    if (!source) continue;

    const fact = factor.evidenceSummary ?? scoreFactorLabel(factor.factor);
    const existing = bySource.get(source);

    if (existing) {
      if (!existing.facts.includes(fact)) existing.facts.push(fact);
      existing.confidence = Math.min(existing.confidence, factor.confidence);
      existing.band = confidenceBand(existing.confidence);
      if (!existing.url && factor.evidenceUrl) existing.url = factor.evidenceUrl;
      if (
        factor.observedAt &&
        (!existing.observedAt || factor.observedAt > existing.observedAt)
      ) {
        existing.observedAt = factor.observedAt;
      }
      continue;
    }

    bySource.set(source, {
      source,
      facts: [fact],
      url: factor.evidenceUrl,
      confidence: factor.confidence,
      band: confidenceBand(factor.confidence),
      observedAt: factor.observedAt,
    });
  }

  return [...bySource.values()].sort((a, b) => b.confidence - a.confidence);
}

/* ------------------------------------------------------------- grade bands */

export type GradeBand = {
  grade: "A+" | "A" | "B" | "C" | "D";
  min: number;
  max: number;
  meaning: string;
};

/** The bands from §14.2, as data so the page and the engine cannot disagree. */
export const GRADE_BANDS: GradeBand[] = [
  { grade: "A+", min: 95, max: 100, meaning: "Exceptional match" },
  { grade: "A", min: 85, max: 94, meaning: "Strong match" },
  { grade: "B", min: 70, max: 84, meaning: "Good match" },
  { grade: "C", min: 55, max: 69, meaning: "Possible match (review)" },
  { grade: "D", min: 0, max: 54, meaning: "Weak match (do not spend)" },
];

/** The headline sentence on the scoring page. Built from the band, so it can
 *  never describe a prospect more warmly than its grade allows. */
export function gradeHeadline(grade: GradeBand["grade"]): {
  title: string;
  description: string;
} {
  switch (grade) {
    case "A+":
      return {
        title: "Exceptional match",
        description:
          "This prospect matches your ideal customer profile on nearly every factor that was checked.",
      };
    case "A":
      return {
        title: "Strong match",
        description:
          "This prospect is a high-quality match for your business based on multiple positive indicators.",
      };
    case "B":
      return {
        title: "Good match",
        description:
          "This prospect fits your profile on the factors that matter most, with some gaps in the evidence.",
      };
    case "C":
      return {
        title: "Possible match",
        description:
          "There is enough here to be worth a look, but not enough to justify automated outreach spend without review.",
      };
    default:
      return {
        title: "Weak match",
        description:
          "Too little of your profile is matched to justify spending enrichment or outreach budget here.",
      };
  }
}
