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
 *   * handoff requirements: situations a human must take over. Owner
 *     decision 2026-09-27: these are last resorts only (agent/handover-policy.ts);
 *     everything else the AI carries, with a colleague confirming a detail in
 *     the background where needed.
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
   * Dimensions that must be known before the close action even when the buyer
   * asks for it outright (Qualification Intelligence rule R7: at most one
   * gating question). Empty = a ready buyer is never slowed down.
   */
  bookingGate: QualificationDimensionKey[];
  /**
   * Dimensions the library never asks about in this motion (08 §B.7
   * hierarchy): a roofer's customer is not asked who else decides, an online
   * shopper is not asked about a procurement process. A workspace can still
   * configure such a question itself; this only governs library intents.
   */
  neverAsk: QualificationDimensionKey[];
  /**
   * Adjustments applied on top of the archetype's scoring profile. Each set sums
   * to zero so the combined profile still totals 100 before clamping.
   */
  weightAdjustments: Partial<DimensionWeights>;
};

/** Hand-offs every motion shares. Pricing exceptions and legal terms are
 *  never negotiated by the agent (CLAUDE.md resolved conflict 1). Security
 *  documents and procurement steps are provided by a colleague in the
 *  background; they are not a hand-off. */
const COMMON_HANDOFFS = [
  "The buyer asks for a price, discount or term that is not on the approved list.",
  "The buyer raises a legal, data-protection or contract-terms question, or a data-rights request.",
  "The buyer asks to speak to a person.",
  "The buyer complains, makes a legal threat or is distressed.",
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
    bookingGate: [],
    neverAsk: [],
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
    bookingGate: [],
    neverAsk: ["SUCCESS_METRICS"],
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
    bookingGate: ["LOCATION"],
    neverAsk: ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET", "PURCHASE_READINESS", "TECHNICAL_REQUIREMENTS"],
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
    bookingGate: ["SUITABILITY"],
    neverAsk: ["STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "COMPANY_SIZE", "TEAM_SIZE"],
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
    bookingGate: [],
    neverAsk: ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET", "COMPANY_SIZE", "TEAM_SIZE", "IMPLEMENTATION_READINESS"],
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
    bookingGate: [],
    neverAsk: ["STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET"],
    weightAdjustments: { ENGAGEMENT: 5, DECISION_ACCESS: -5 },
  },
  ENTERPRISE: {
    key: "ENTERPRISE",
    name: "Stakeholders, then a meeting with a person",
    closeTarget: "BUSINESS_CASE",
    // Owner decision 2026-09-27: the AI qualifies and books the meeting; the
    // meeting (with its hand-off brief) is the hand-off.
    closeTargetDescription:
      "Map the problem, the stakeholders and the decision process, then book a call with a person who builds the business case.",
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
      "A contract redline or a request to agree terms arrives (security documents and procurement steps are sent by a colleague in the background).",
    ],
    bookingGate: [],
    neverAsk: [],
    weightAdjustments: { DECISION_ACCESS: 5, ENGAGEMENT: -5 },
  },
};

/**
 * Dimensions that state the problem or need. BUDGET is never asked before one
 * of these is known (08 §C.4 invariant), and they are what a low-intent lead
 * is asked about first: they build intent rather than test it.
 */
export const PROBLEM_DIMENSIONS: readonly QualificationDimensionKey[] = [
  "PROBLEM",
  "USE_CASE",
  "SERVICE_NEEDED",
  "PROJECT_SCOPE",
  "PRODUCT_INTEREST",
  "SUITABILITY",
  "HIRING_NEED",
  "OUTCOME",
];

/** Who decides and how. Premature before the lead has engaged. */
export const AUTHORITY_DIMENSIONS: readonly QualificationDimensionKey[] = [
  "AUTHORITY",
  "STAKEHOLDERS",
  "DECISION_PROCESS",
];

/**
 * The enterprise checklist dimensions. MEDDPICC is only chosen for ENTERPRISE
 * (method-router.ts), and these are only asked in motions that tolerate a
 * multi-stakeholder process; never on LOCAL_SERVICE (tested by the matrix).
 */
export const MEDDPICC_ONLY_DIMENSIONS: readonly QualificationDimensionKey[] = [
  "STAKEHOLDERS",
  "DECISION_PROCESS",
  "SUCCESS_METRICS",
];

/** Money and commitment. Given no weight while intent is low (08 §B.8). */
export const COMMERCIAL_DIMENSIONS: readonly QualificationDimensionKey[] = [
  "BUDGET",
  "AUTHORITY",
  "STAKEHOLDERS",
  "DECISION_PROCESS",
  "PURCHASE_READINESS",
  "IMPLEMENTATION_READINESS",
];

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
