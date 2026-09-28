/**
 * Promote and roll back experiment variants (brief §43). Pure.
 *
 * Builds on experiments.ts (0131): assignment, the Wilson / Newcombe results
 * and the "no winner below the minimum sample" rule stay exactly as they are.
 * This adds the step after a result: whether the winner may be rolled out to
 * everyone, and the history of that decision.
 *
 * The rules, in order (tests/experiment-promotion.test.ts):
 *   1. Only a RUNNING experiment with no live promotion can be promoted.
 *   2. The result must name a non-control WINNER (95% interval for the lift
 *      above zero, no credible rise in opt-outs), and EVERY arm must hold at
 *      least the minimum sample (>= 100, the 0131 floor).
 *   3. A two-sided two-proportion z-test against control must clear the
 *      significance threshold (p < alpha, default 0.05) for AUTOMATIC
 *      promotion. A person may still promote a WINNER on the interval alone.
 *   4. AUTOMATIC promotion is refused, always, when the variant touches a
 *      compliance-sensitive field: the opener, a disclosure, or pricing. Those
 *      are only ever suggested, and a person confirms.
 *   5. The default is SUGGEST: auto-promotion also needs the experiment's own
 *      opt-in (`auto_promote`), which is off unless an owner/admin turns it on.
 *   6. Rollback always returns everyone to the CONTROL copy. The control
 *      variant is never deleted or rewritten, so rollback is always possible.
 */

import {
  CONTROL_ARM,
  HOLDOUT_ARM,
  MIN_SAMPLE_FLOOR,
  type ArmOutcomes,
  type ExperimentResult,
  type ExperimentVariant,
  type PrimaryMetric,
} from "./experiments.ts";

export const DEFAULT_ALPHA = 0.05;

export const COMPLIANCE_SENSITIVE_FIELDS = ["opener", "disclosure", "pricing"] as const;
export type ComplianceSensitiveField = (typeof COMPLIANCE_SENSITIVE_FIELDS)[number];

/**
 * Experiment kinds that are sensitive by definition. Listed as strings so a
 * later kind (0131's CHECK extension for voice and quote experiments) is
 * covered the day it exists, without widening EXPERIMENT_KINDS here.
 */
export const SENSITIVE_KIND_FIELDS: Readonly<Record<string, readonly ComplianceSensitiveField[]>> = {
  VOICE_OPENER: ["opener", "disclosure"],
  VOICE_SCRIPT: ["opener", "disclosure"],
  QUOTE_PRESENTATION: ["pricing"],
  QUOTE_PRICING: ["pricing"],
};

const PRICING_WORDS = /(£|\$|€|\b\d+(?:\.\d+)?\s?%|\bprice|\bpricing|\bdiscount|\bcost\b|\bfee\b|\bper month\b|\bquote\b|\bdeposit\b|\bfree of charge\b)/i;
const DISCLOSURE_WORDS =
  /(\brecord(?:ed|ing)?\b|\bautomated\b|\bartificial\b|\bAI\b|\bbot\b|\bassistant\b|\bopt[ -]?out\b|\bunsubscribe\b|\breply stop\b|\bstop to\b|\bon behalf of\b|\bprivacy\b|\bconsent\b)/i;

/** Variants may declare what they change; undeclared text is inspected. */
export type PromotableVariant = ExperimentVariant & { changes?: readonly string[] };

/**
 * The compliance-sensitive fields an experiment touches. Fail-closed: a
 * declared field, a sensitive kind, or wording that reads like a price or a
 * disclosure all count. Control's own copy is not inspected (it is what the
 * workspace already sends).
 */
export function sensitiveFieldsOf(kind: string, variants: readonly PromotableVariant[]): ComplianceSensitiveField[] {
  const found = new Set<ComplianceSensitiveField>(SENSITIVE_KIND_FIELDS[kind] ?? []);
  for (const variant of variants) {
    if (variant.key === CONTROL_ARM) continue;
    for (const declared of variant.changes ?? []) {
      const field = declared.toLowerCase();
      if ((COMPLIANCE_SENSITIVE_FIELDS as readonly string[]).includes(field)) found.add(field as ComplianceSensitiveField);
    }
    for (const body of Object.values(variant.templates ?? {})) {
      if (PRICING_WORDS.test(body)) found.add("pricing");
      if (DISCLOSURE_WORDS.test(body)) found.add("disclosure");
    }
    for (const q of Object.values(variant.questions ?? {})) {
      const text = `${q.wordingFamily} ${q.rendering ?? ""}`;
      if (PRICING_WORDS.test(text)) found.add("pricing");
      if (DISCLOSURE_WORDS.test(text)) found.add("disclosure");
    }
  }
  return COMPLIANCE_SENSITIVE_FIELDS.filter((f) => found.has(f));
}

/* ------------------------------------------------------------ significance */

/** Standard normal CDF (Abramowitz and Stegun 26.2.17, |error| < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Two-sided p-value of a pooled two-proportion z-test. 1 when either arm is
 * empty or the pooled rate is 0 or 1 (no variance: no evidence either way).
 */
export function twoProportionPValue(a: { x: number; n: number }, b: { x: number; n: number }): number {
  if (a.n <= 0 || b.n <= 0) return 1;
  const pooled = (a.x + b.x) / (a.n + b.n);
  if (pooled <= 0 || pooled >= 1) return 1;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  if (se === 0) return 1;
  const z = (a.x / a.n - b.x / b.n) / se;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
}

function successes(arm: ArmOutcomes, metric: PrimaryMetric): number {
  return metric === "WIN" ? arm.wins : metric === "BOOKING" ? arm.bookings : arm.positiveReplies;
}

/* ------------------------------------------------------------ the decision */

export type PromotionAction = "AUTO_PROMOTE" | "SUGGEST_PROMOTE" | "HOLD";

export type PromotionDecision = {
  action: PromotionAction;
  /** The arm that would be promoted; null on HOLD. */
  candidate: string | null;
  pValue: number | null;
  /** 1 - p, for display. */
  confidence: number | null;
  sampleByArm: Record<string, number>;
  conversionByArm: Record<string, number | null>;
  sensitiveFields: ComplianceSensitiveField[];
  /** Why the action is what it is, in plain words, most important first. */
  reasons: string[];
};

export type PromotionInput = {
  kind: string;
  status: "DRAFT" | "RUNNING" | "STOPPED";
  promotedArm: string | null;
  variants: readonly PromotableVariant[];
  metric: PrimaryMetric;
  minSamplePerArm: number;
  arms: readonly ArmOutcomes[];
  result: ExperimentResult;
  /** The experiment's own opt-in to automatic promotion. Default false. */
  autoPromote: boolean;
  alpha?: number;
};

export function decidePromotion(input: PromotionInput): PromotionDecision {
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const minSample = Math.max(input.minSamplePerArm, MIN_SAMPLE_FLOOR);
  const contenders = input.arms.filter((a) => a.arm !== HOLDOUT_ARM);
  const sampleByArm = Object.fromEntries(contenders.map((a) => [a.arm, a.leads]));
  const conversionByArm = Object.fromEntries(
    contenders.map((a) => [a.arm, a.leads > 0 ? successes(a, input.metric) / a.leads : null]),
  );
  const sensitiveFields = sensitiveFieldsOf(input.kind, input.variants);
  const hold = (reasons: string[], pValue: number | null = null): PromotionDecision => ({
    action: "HOLD",
    candidate: null,
    pValue,
    confidence: pValue === null ? null : 1 - pValue,
    sampleByArm,
    conversionByArm,
    sensitiveFields,
    reasons,
  });

  if (input.status !== "RUNNING") return hold(["Only a running experiment can be promoted."]);
  if (input.promotedArm) return hold([`Variant ${input.promotedArm} is already promoted. Roll it back before promoting again.`]);

  const short = contenders.filter((a) => a.leads < minSample);
  if (contenders.length < 2 || short.length > 0) {
    return hold([`Every arm needs at least ${minSample} leads. Short: ${short.map((a) => `${a.arm} (${a.leads})`).join(", ") || "no arms yet"}.`]);
  }
  const winner = input.result.verdict === "WINNER" ? input.result.winner : null;
  if (!winner || winner === CONTROL_ARM) {
    return hold([
      winner === CONTROL_ARM
        ? "Control is doing better than every variant. Keep the current copy."
        : "No variant beats control with 95% confidence yet.",
    ]);
  }
  const arm = input.result.arms.find((a) => a.arm === winner);
  if (arm?.harmful) return hold([`Variant ${winner} raises opt-outs, so it cannot be promoted.`]);

  const control = contenders.find((a) => a.arm === CONTROL_ARM);
  const candidate = contenders.find((a) => a.arm === winner);
  const pValue =
    control && candidate
      ? twoProportionPValue(
          { x: successes(candidate, input.metric), n: candidate.leads },
          { x: successes(control, input.metric), n: control.leads },
        )
      : 1;
  const significant = pValue < alpha;

  const reasons: string[] = [];
  let auto = input.autoPromote && significant;
  if (sensitiveFields.length > 0) {
    auto = false;
    reasons.push(
      `Changes ${sensitiveFields.join(", ")}: compliance-sensitive, so this is never promoted automatically. A person must confirm.`,
    );
  }
  if (!significant) reasons.push(`p = ${pValue.toFixed(3)}, above the ${alpha} threshold for automatic promotion.`);
  if (!input.autoPromote) reasons.push("Automatic promotion is off for this experiment (the default): suggest only.");
  reasons.unshift(`Variant ${winner} beats control on ${input.metric.toLowerCase().replace("_", " ")}.`);

  return {
    action: auto ? "AUTO_PROMOTE" : "SUGGEST_PROMOTE",
    candidate: winner,
    pValue,
    confidence: 1 - pValue,
    sampleByArm,
    conversionByArm,
    sensitiveFields,
    reasons,
  };
}

/** Thrown by the op when an automatic promotion is attempted on a decision that does not allow it. */
export class AutoPromotionRefused extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons[0] ?? "Automatic promotion is not allowed for this experiment.");
    this.name = "AutoPromotionRefused";
    this.reasons = reasons;
  }
}

/**
 * The guard the promote operation runs for an automatic (unattended) call.
 * A human-confirmed promotion needs SUGGEST_PROMOTE or AUTO_PROMOTE; an
 * automatic one needs AUTO_PROMOTE and nothing less.
 */
export function assertPromotionAllowed(decision: PromotionDecision, mode: "HUMAN" | "AUTO"): string {
  if (decision.action === "HOLD" || !decision.candidate) throw new AutoPromotionRefused(decision.reasons);
  if (mode === "AUTO" && decision.action !== "AUTO_PROMOTE") throw new AutoPromotionRefused(decision.reasons);
  return decision.candidate;
}

/* ------------------------------------------------------------ history */

export type PromotionRecord = {
  action: "PROMOTE" | "ROLLBACK";
  experimentId: string;
  /** The arm serving everyone after this record. Control after a rollback. */
  arm: string;
  /** The arm it replaced. */
  fromArm: string | null;
  version: number;
  sampleByArm: Record<string, number>;
  conversionByArm: Record<string, number | null>;
  pValue: number | null;
  decidedBy: "HUMAN" | "AUTO";
  reason: string;
  at: string;
};

/** The row to append when promoting. */
export function promotionRecord(input: {
  experimentId: string;
  version: number;
  decision: PromotionDecision;
  decidedBy: "HUMAN" | "AUTO";
  reason: string;
  at: string;
}): PromotionRecord {
  return {
    action: "PROMOTE",
    experimentId: input.experimentId,
    arm: input.decision.candidate ?? CONTROL_ARM,
    fromArm: CONTROL_ARM,
    version: input.version + 1,
    sampleByArm: input.decision.sampleByArm,
    conversionByArm: input.decision.conversionByArm,
    pValue: input.decision.pValue,
    decidedBy: input.decidedBy,
    reason: input.reason,
    at: input.at,
  };
}

/** The row to append when rolling back. Always back to control. */
export function rollbackRecord(input: {
  experimentId: string;
  version: number;
  promotedArm: string | null;
  reason: string;
  at: string;
}): PromotionRecord {
  if (!input.promotedArm) throw new Error("Nothing is promoted, so there is nothing to roll back.");
  return {
    action: "ROLLBACK",
    experimentId: input.experimentId,
    arm: CONTROL_ARM,
    fromArm: input.promotedArm,
    version: input.version + 1,
    sampleByArm: {},
    conversionByArm: {},
    pValue: null,
    decidedBy: "HUMAN",
    reason: input.reason,
    at: input.at,
  };
}

/**
 * The arm a lead is served. A promoted experiment serves the promoted arm to
 * everyone (no holdout: the test is over); otherwise the deterministic arm.
 */
export function servedArm(promotedArm: string | null, assigned: () => string): string {
  return promotedArm ?? assigned();
}
