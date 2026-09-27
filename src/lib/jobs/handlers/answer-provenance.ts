/**
 * Provenance of a recorded qualification answer (defect Q-D1, design 08 F10).
 * Pure.
 *
 * `qualification_answers.source` says how a value was derived. An answer the
 * AI fallback matched (and the deterministic matcher then re-validated) is
 * still an AI-assisted proposal: stored as `ai_assist` with the model's
 * confidence, it stays distinguishable from something the lead typed that the
 * rules matched directly. The deterministic engine still decides the outcome
 * either way (CLAUDE.md resolved conflict 1).
 */

export type AnswerMatch =
  | { matchedBy: "rules" }
  | { matchedBy: "ai"; confidence: number | null }
  | { matchedBy: "none" };

export type AnswerProvenance = { source: "reply" | "ai_assist"; confidence: number | null };

export function answerProvenance(match: AnswerMatch): AnswerProvenance {
  switch (match.matchedBy) {
    case "rules":
      return { source: "reply", confidence: 1 };
    case "ai":
      return {
        source: "ai_assist",
        confidence: match.confidence === null ? null : Math.max(0, Math.min(1, Math.round(match.confidence * 1000) / 1000)),
      };
    case "none":
      // The lead's own words, unmatched: the engine sees no value (REVIEW).
      return { source: "reply", confidence: 0 };
  }
}
