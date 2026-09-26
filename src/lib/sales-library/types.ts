/**
 * Sales library vocabulary (Phase 2, design doc 04 §0).
 *
 * The canonical library lives in code, not in the database and not in prompts:
 * it is typed, reviewed and unit-tested for internal consistency, and every
 * decision it produces records `LIBRARY_VERSION` so an old score, method choice
 * or qualification plan can always be explained against the library that made
 * it. Workspaces override it through `workspace_sales_overrides` rows, which are
 * validated against these same types.
 *
 * Pure module: no `server-only`, no Supabase. Safe for tests and client code.
 */

/**
 * Bump on any content change that could change a decision (a weight, a
 * threshold, a pattern, a SIC prefix). Stored on business_profiles, lead_scores
 * and workspace_sales_overrides.
 */
export const LIBRARY_VERSION = "sl-2026.09.1";

/* ------------------------------------------------------------------ motions */

export const SALES_MOTIONS = [
  "BOOK_MEETING_B2B",
  "DIRECT_B2B",
  "LOCAL_SERVICE",
  "HIGH_TICKET_B2C",
  "ECOMMERCE_DIRECT",
  "SAAS_SELF_SERVE",
  "ENTERPRISE",
] as const;
export type SalesMotion = (typeof SALES_MOTIONS)[number];

/** What the conversation is trying to reach. Mirrors `opportunities.close_target`
 *  closely but is richer: a motion names the concrete next commercial step. */
export const CLOSE_TARGETS = [
  "BOOK_MEETING",
  "PROPOSAL",
  "CHECKOUT",
  "QUOTE_OR_VISIT",
  "CONSULTATION",
  "TRIAL_OR_SIGNUP",
  "BUSINESS_CASE",
] as const;
export type CloseTarget = (typeof CLOSE_TARGETS)[number];

/* ------------------------------------------------------------------ methods */

export const SALES_METHODS = [
  "TRANSACTIONAL",
  "SIMPLE_QUALIFICATION",
  "SPIN",
  "CHALLENGER_INSIGHT",
  "MEDDPICC",
  "PLG",
] as const;
export type SalesMethod = (typeof SALES_METHODS)[number];

/**
 * How each method is named on screen. The one place: acronyms stay upper case
 * (SPIN, MEDDPICC), which a generic "title-case the key" helper got wrong.
 */
export const SALES_METHOD_LABEL: Record<SalesMethod, string> = {
  TRANSACTIONAL: "Transactional",
  SIMPLE_QUALIFICATION: "Simple qualification",
  SPIN: "SPIN",
  CHALLENGER_INSIGHT: "Challenger insight",
  MEDDPICC: "MEDDPICC",
  PLG: "Product-led",
};

/** A stored method key's label; an unknown key reads as plain words, not a code. */
export function salesMethodLabel(method: string): string {
  if (method in SALES_METHOD_LABEL) return SALES_METHOD_LABEL[method as SalesMethod];
  const words = method.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Evidence grades, from docs/revenue-engine/01-evidence-register.md §7.
 *
 * `OPERATIONAL_DEFAULT` is not a claim about persuasion at all: it is "ask one
 * relevant question and move to the next step", which needs no theory.
 * `SALES_CONVENTION*` methods are internal question-planning heuristics only and
 * are never presented to a buyer (or a customer) as science. NLP has no grade
 * here because it is not implemented in any form.
 */
export const EVIDENCE_GRADES = [
  "OPERATIONAL_DEFAULT",
  "SALES_CONVENTION_OBSERVATIONAL",
  "SALES_CONVENTION",
] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

/* ------------------------------------------------------------ deal size */

/**
 * Coarse first-year value bands, in GBP. They are planning buckets for the
 * method router and the COMMERCIAL dimension, not market statistics.
 */
export const DEAL_SIZE_BANDS = ["MICRO", "SMALL", "MID", "LARGE", "ENTERPRISE"] as const;
export type DealSizeBand = (typeof DEAL_SIZE_BANDS)[number];

export const DEAL_SIZE_RANGES_GBP: Record<DealSizeBand, { min: number; max: number | null }> = {
  MICRO: { min: 0, max: 500 },
  SMALL: { min: 500, max: 5_000 },
  MID: { min: 5_000, max: 50_000 },
  LARGE: { min: 50_000, max: 250_000 },
  ENTERPRISE: { min: 250_000, max: null },
};

/* ------------------------------------------------------- score dimensions */

export const SCORE_DIMENSIONS = [
  "FIT",
  "INTENT",
  "NEED",
  "COMMERCIAL",
  "DECISION_ACCESS",
  "TIMING",
  "ENGAGEMENT",
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export type DimensionWeights = Record<ScoreDimension, number>;

/**
 * Fit signals: the FIT-dimension features an archetype cares about. Each one is
 * also a lead-score feature key (see scoring/lead-score.ts FEATURE_ALLOW_LIST),
 * which is how an archetype's profile reaches the arithmetic.
 *
 * Note the direction: the archetype is the *seller* (the workspace), and these
 * describe the seller's *buyers*. An MSP's fit is about the SMB enquiring
 * (size, location); a roofer's is about the job (service area, property).
 */
export const FIT_SIGNALS = [
  "industry_match",
  "company_size_match",
  "geography_match",
  "service_match",
  "incorporated",
  "tech_stack_match",
  "property_type_match",
  "revenue_band_match",
  "growth_signal",
  "website_present",
] as const;
export type FitSignal = (typeof FIT_SIGNALS)[number];

export type ScoringProfile = {
  key: string;
  /** Integer points per dimension. Must sum to exactly 100 (tested). */
  weights: DimensionWeights;
  /** Ordered, most important first. The FIT dimension averages over these. */
  fitSignals: FitSignal[];
  /** Why this shape — shown to reviewers, never to buyers. */
  rationale: string;
};

/* --------------------------------------------- qualification dimensions */

export const QUALIFICATION_DIMENSION_KEYS = [
  "PROBLEM",
  "USE_CASE",
  "SERVICE_NEEDED",
  "PROJECT_SCOPE",
  "LOCATION",
  "PROPERTY_TYPE",
  "TIMING",
  "TEAM_SIZE",
  "COMPANY_SIZE",
  "CURRENT_SOLUTION",
  "AUTHORITY",
  "BUDGET",
  "VOLUME",
  "PRODUCT_INTEREST",
  "SUITABILITY",
  "STAKEHOLDERS",
  "SUCCESS_METRICS",
  "DECISION_PROCESS",
  "COMPLIANCE_REQUIREMENTS",
  "HIRING_NEED",
] as const;
export type QualificationDimensionKey = (typeof QUALIFICATION_DIMENSION_KEYS)[number];

/**
 * One thing worth knowing before the close action. The five 0..1 attributes
 * feed the adaptive-qualification value formula (design doc §3):
 *
 *   informationGain × decisionRelevance × commercialValue − friction − prematurity
 *
 * They are static library judgements, adjusted by stage at run time.
 */
export type QualificationDimension = {
  key: QualificationDimensionKey;
  label: string;
  informationGain: number;
  decisionRelevance: number;
  commercialValue: number;
  friction: number;
  prematurity: number;
  /** One plain question, no preamble. `{service}` / `{business}` placeholders
   *  are filled from approved workspace data only. */
  question: string;
};

/* ------------------------------------------------------------ objections */

export const OBJECTION_KEYS = [
  "PRICE",
  "BUDGET",
  "TIMING",
  "COMPETITOR",
  "EXISTING_PROVIDER",
  "NO_NEED",
  "DONT_UNDERSTAND",
  "TRUST",
  "IMPLEMENTATION",
  "COMPLEXITY",
  "SWITCHING_COST",
  "SECURITY",
  "COMPLIANCE",
  "FEATURE",
  "AUTHORITY",
  "PROCUREMENT",
  "CONTRACT",
  "SEND_INFORMATION",
  "NOT_INTERESTED",
  "TOO_BUSY",
  "CALL_LATER",
  "INTERNAL_BUILD",
  "RISK",
] as const;
export type ObjectionKey = (typeof OBJECTION_KEYS)[number];

/* ------------------------------------------------------------ archetypes */

export const ARCHETYPE_GROUPS = [
  "SOFTWARE",
  "IT_TELECOM",
  "MARKETING_CREATIVE",
  "PROFESSIONAL_SERVICES",
  "PEOPLE_SERVICES",
  "FINANCE_INSURANCE",
  "PROPERTY",
  "CONSTRUCTION_TRADES",
  "FACILITIES",
  "AUTOMOTIVE",
  "LOGISTICS",
  "INDUSTRIAL_TRADE",
  "RETAIL_ECOMMERCE",
  "HOSPITALITY_EVENTS",
  "EDUCATION_COACHING",
  "HEALTH_WELLBEING",
  "ORGANISATIONS",
  "OTHER",
] as const;
export type ArchetypeGroup = (typeof ARCHETYPE_GROUPS)[number];

/** Per-archetype override of a catalogue question (wording only, or any attribute). */
export type QualificationSpec =
  | QualificationDimensionKey
  | ({ key: QualificationDimensionKey } & Partial<Omit<QualificationDimension, "key">>);

export type Archetype = {
  key: string;
  name: string;
  group: ArchetypeGroup;
  /**
   * UK SIC 2026 codes in dotted form ("62.12/1", "62.20", "43"). Matching is
   * hierarchical prefix matching, so "62.20" covers "62.20/1" and "62.20/9".
   * Every entry must exist in migration 0120 (tested). Empty only for
   * archetypes that describe a business *form* rather than an activity
   * (freelancer, franchise, other).
   */
  sic2026Prefixes: string[];
  /** Lower-case phrases a customer might type or a website might use. */
  aliases: string[];
  /** First entry is the default. */
  defaultMotions: SalesMotion[];
  dealSizeBand: DealSizeBand;
  decisionMakerRoles: string[];
  scoringProfile: ScoringProfile;
  /** Ordered: the order is the default asking order before value ranking. */
  qualification: QualificationDimension[];
  commonObjections: ObjectionKey[];
  /** DEEP archetypes are the ClientTurn ICP (CLAUDE.md resolved conflict 5):
   *  hand-tuned questions and profiles rather than family defaults. */
  depth: "DEEP" | "STANDARD";
};
