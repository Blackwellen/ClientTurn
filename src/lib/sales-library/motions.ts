/**
 * Sales motions (design doc 04 §1).
 *
 * A motion is *how this workspace closes*: book a human, send a proposal, quote
 * a job, sell online, start a trial, or build an enterprise business case. The
 * archetype says what kind of business it is; the motion says what the
 * conversation is for. One archetype can run several motions (an MSP books
 * meetings for SMBs and runs an enterprise motion for larger accounts), which is
 * why `business_profiles.sales_motions` is an array.
 *
 * Every motion carries:
 *   * a close target: the next commercial step the conversation aims at;
 *   * a default method (the router may choose differently, see method-router.ts);
 *   * `maxPrimaryQuestionsPerMessage`: always 1. Asking two things at once is
 *     the most common way an automated follow-up reads as a form;
 *   * a decision threshold: which qualification dimensions must be known before
 *     the close action is offered. Questioning stops once it is met, so the
 *     agent never works through every configured question for its own sake;
 *   * handoff requirements: situations a human must take over.
 *
 * Pure module.
 */

import {
  SCORE_DIMENSIONS,
  type CloseTarget,
  type DimensionWeights,
  type QualificationDimensionKey,
  type SalesMethod,
  type SalesMotion,
  type ScoreDimension,
} from "./types.ts";

export type DecisionThreshold = {
  /** Every one of these must be known. */
  allOf: QualificationDimensionKey[];
  /** At least one of these must be known (empty = no extra requirement). */
  anyOf: QualificationDimensionKey[];
};

export type MotionDefinition = {
  key: SalesMotion;
  name: string;
  closeTarget: CloseTarget;
  closeTargetDescription: string;
  defaultMethod: SalesMethod;
  maxPrimaryQuestionsPerMessage: 1;
  /** The motion's qualification dimensions, in default order (§3 examples). */
  qualificationDimensions: QualificationDimensionKey[];
  decisionThreshold: DecisionThreshold;
  handoffRequirements: string[];
  /**
   * Adjustments applied on top of the archetype's scoring profile. Each set sums
   * to zero so the combined profile still totals 100 before clamping.
   */
  weightAdjustments: Partial<DimensionWeights>;
};

/** Hand-offs every motion shares. Pricing exceptions, legal and security are
 *  never negotiated by the agent (CLAUDE.md resolved conflict 1). */
const COMMON_HANDOFFS = [
  "The buyer asks for a price, discount or term that is not on the approved list.",
  "The buyer raises a legal, security, data-protection or contract question.",
  "The buyer asks to speak to a person.",
  "The buyer complains or is distressed.",
];

export const MOTIONS: Record<SalesMotion, MotionDefinition> = {
  BOOK_MEETING_B2B: {
    key: "BOOK_MEETING_B2B",
    name: "Qualify, then book a meeting",
    closeTarget: "BOOK_MEETING",
    closeTargetDescription: "Qualify the fit, then book a call with a person on the team.",
    defaultMethod: "SIMPLE_QUALIFICATION",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: ["USE_CASE", "TEAM_SIZE", "CURRENT_SOLUTION", "TIMING", "AUTHORITY"],
    decisionThreshold: { allOf: ["USE_CASE"], anyOf: ["TIMING", "TEAM_SIZE", "COMPANY_SIZE"] },
    handoffRequirements: [...COMMON_HANDOFFS],
    weightAdjustments: {},
  },
  DIRECT_B2B: {
    key: "DIRECT_B2B",
    name: "Qualify, then proposal or checkout",
    closeTarget: "PROPOSAL",
    closeTargetDescription: "Establish scope and timing, then send a proposal or a checkout link.",
    defaultMethod: "SIMPLE_QUALIFICATION",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: ["PROJECT_SCOPE", "TIMING", "BUDGET", "AUTHORITY"],
    decisionThreshold: { allOf: ["PROJECT_SCOPE", "TIMING"], anyOf: [] },
    handoffRequirements: [
      ...COMMON_HANDOFFS,
      "A proposal needs a price that is not a published list price.",
    ],
    weightAdjustments: { COMMERCIAL: 5, FIT: -5 },
  },
  LOCAL_SERVICE: {
    key: "LOCAL_SERVICE",
    name: "Requirements, then quote or visit",
    closeTarget: "QUOTE_OR_VISIT",
    closeTargetDescription: "Confirm the service, the location and the timing, then arrange a quote or a visit.",
    defaultMethod: "SIMPLE_QUALIFICATION",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: ["SERVICE_NEEDED", "LOCATION", "TIMING", "PROPERTY_TYPE"],
    decisionThreshold: { allOf: ["SERVICE_NEEDED", "LOCATION", "TIMING"], anyOf: [] },
    handoffRequirements: [
      ...COMMON_HANDOFFS,
      "The job sounds like an emergency or a safety risk.",
      "The postcode is outside the configured service area.",
    ],
    weightAdjustments: { TIMING: 5, FIT: -5 },
  },
  HIGH_TICKET_B2C: {
    key: "HIGH_TICKET_B2C",
    name: "Suitability, then consultation",
    closeTarget: "CONSULTATION",
    closeTargetDescription: "Check the person is a suitable candidate, then book a consultation.",
    defaultMethod: "SIMPLE_QUALIFICATION",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: ["SUITABILITY", "TIMING", "BUDGET"],
    decisionThreshold: { allOf: ["SUITABILITY", "TIMING"], anyOf: [] },
    handoffRequirements: [
      ...COMMON_HANDOFFS,
      "Any question about medical, financial or legal suitability is answered by a qualified person.",
    ],
    weightAdjustments: { NEED: 5, FIT: -5 },
  },
  ECOMMERCE_DIRECT: {
    key: "ECOMMERCE_DIRECT",
    name: "Product match, then checkout",
    closeTarget: "CHECKOUT",
    closeTargetDescription: "Match the buyer to the right product, then send them to checkout.",
    defaultMethod: "TRANSACTIONAL",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: ["PRODUCT_INTEREST", "VOLUME", "TIMING"],
    decisionThreshold: { allOf: ["PRODUCT_INTEREST"], anyOf: [] },
    handoffRequirements: [
      ...COMMON_HANDOFFS,
      "A refund, return or delivery problem on an existing order.",
    ],
    weightAdjustments: { INTENT: 5, DECISION_ACCESS: -5 },
  },
  SAAS_SELF_SERVE: {
    key: "SAAS_SELF_SERVE",
    name: "Fit, then trial or signup",
    closeTarget: "TRIAL_OR_SIGNUP",
    closeTargetDescription: "Confirm the use case fits, then point the buyer to a trial or signup.",
    defaultMethod: "PLG",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: ["USE_CASE", "TEAM_SIZE", "CURRENT_SOLUTION"],
    decisionThreshold: { allOf: ["USE_CASE"], anyOf: [] },
    handoffRequirements: [
      ...COMMON_HANDOFFS,
      "The account looks large enough for a sales-assisted or enterprise plan.",
    ],
    weightAdjustments: { ENGAGEMENT: 5, DECISION_ACCESS: -5 },
  },
  ENTERPRISE: {
    key: "ENTERPRISE",
    name: "Stakeholders, business case, then a person",
    closeTarget: "BUSINESS_CASE",
    closeTargetDescription:
      "Map the problem, the stakeholders and the decision process, then hand to a person to build the business case.",
    defaultMethod: "MEDDPICC",
    maxPrimaryQuestionsPerMessage: 1,
    qualificationDimensions: [
      "PROBLEM",
      "SUCCESS_METRICS",
      "STAKEHOLDERS",
      "DECISION_PROCESS",
      "COMPLIANCE_REQUIREMENTS",
      "TIMING",
      "BUDGET",
    ],
    decisionThreshold: { allOf: ["PROBLEM", "STAKEHOLDERS"], anyOf: ["DECISION_PROCESS", "SUCCESS_METRICS"] },
    handoffRequirements: [
      ...COMMON_HANDOFFS,
      "Procurement, a security questionnaire or a contract redline arrives.",
      "The business case stage is reached: a person owns it from there.",
    ],
    weightAdjustments: { DECISION_ACCESS: 5, ENGAGEMENT: -5 },
  },
};

export function motionFor(key: SalesMotion): MotionDefinition {
  return MOTIONS[key];
}

/** True once enough is known to take the motion's close action (§3 stopping rule). */
export function isDecisionThresholdMet(
  motion: SalesMotion,
  known: Iterable<QualificationDimensionKey>,
): boolean {
  const knownSet = new Set(known);
  const { allOf, anyOf } = MOTIONS[motion].decisionThreshold;
  if (!allOf.every((key) => knownSet.has(key))) return false;
  return anyOf.length === 0 || anyOf.some((key) => knownSet.has(key));
}

/** The threshold dimensions still unknown, in the motion's asking order. */
export function missingForThreshold(
  motion: SalesMotion,
  known: Iterable<QualificationDimensionKey>,
): QualificationDimensionKey[] {
  const knownSet = new Set(known);
  const { allOf, anyOf } = MOTIONS[motion].decisionThreshold;
  const missing = allOf.filter((key) => !knownSet.has(key));
  if (anyOf.length > 0 && !anyOf.some((key) => knownSet.has(key))) missing.push(anyOf[0]);
  return missing;
}

/* ------------------------------------------------------- weight arithmetic */

/**
 * Normalises any non-negative weight set to integers summing to exactly 100.
 *
 * Largest-remainder rounding, with ties broken by dimension order, so the
 * result is deterministic and never 99 or 101. A set whose weights are all zero
 * (a misconfigured override) falls back to `fallback` rather than dividing by
 * zero.
 */
export function normaliseWeights(
  weights: Partial<DimensionWeights>,
  fallback: DimensionWeights,
): DimensionWeights {
  const raw = SCORE_DIMENSIONS.map((dimension) => {
    const value = weights[dimension] ?? 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...fallback };

  const exact = raw.map((value) => (value / sum) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of order) {
    if (remaining <= 0) break;
    floors[index] += 1;
    remaining -= 1;
  }

  const out = {} as DimensionWeights;
  SCORE_DIMENSIONS.forEach((dimension, index) => {
    out[dimension] = floors[index];
  });
  return out;
}

/**
 * Archetype profile × motion adjustments × workspace override → final weights.
 *
 * A workspace override *replaces* the named dimensions (it is what the customer
 * chose), then everything is renormalised to 100, so a partial override can
 * never inflate every score.
 */
export function combineWeights(
  archetypeWeights: DimensionWeights,
  motion: SalesMotion | null,
  workspaceOverride?: Partial<DimensionWeights> | null,
): DimensionWeights {
  const adjusted: Partial<Record<ScoreDimension, number>> = {};
  const deltas = motion ? MOTIONS[motion].weightAdjustments : {};
  for (const dimension of SCORE_DIMENSIONS) {
    adjusted[dimension] = Math.max(0, archetypeWeights[dimension] + (deltas[dimension] ?? 0));
  }
  if (workspaceOverride) {
    for (const dimension of SCORE_DIMENSIONS) {
      const value = workspaceOverride[dimension];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        adjusted[dimension] = value;
      }
    }
  }
  return normaliseWeights(adjusted, archetypeWeights);
}
