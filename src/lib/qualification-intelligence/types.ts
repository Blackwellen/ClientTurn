/**
 * Qualification Intelligence & Intent Engine: the shared contract.
 *
 * docs/revenue-engine/08-qualification-intelligence.md (design) and its
 * "Contract decisions" appendix. Phase 0 output: **frozen** for the four
 * Wave 1 build agents. Change it only through a reviewed contract change,
 * never as a side effect of a feature.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports, so client
 * components, the node test runner and every engine module can import it.
 *
 * The binding rules this contract serves (CLAUDE.md resolved conflict 1,
 * docs/AGENT_RUNTIME.md "the model proposes, code decides"):
 *   - the deterministic engine is the system of record;
 *   - AI may only classify intent or extract a *candidate* value, which is
 *     stored as INFERRED at most and re-validated deterministically;
 *   - low confidence or any unmatched value => REVIEW + human handover;
 *   - AI never composes a binding promise, quote, availability or service area.
 *
 * Naming: TypeScript shapes are camelCase. Where a shape is persisted as jsonb
 * or crosses the RPC boundary, its snake_case wire form is declared next to
 * it with a zod schema (the design's §B.9 NBA JSON is snake_case, so the NBA
 * is snake_case end to end).
 */

import { z } from "zod";

import {
  QUALIFICATION_DIMENSION_KEYS,
  SALES_MOTIONS,
  type QualificationDimensionKey,
  type SalesMotion,
} from "../sales-library/types.ts";
import { ASSIST_REASONS, HANDOVER_REASONS, type AgentChannel, type HandoverReason } from "../agent/types.ts";
import type { ConversionGoalType } from "../business-profile/types.ts";
import { RESPONSE_TYPES } from "../qualification/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import type { OpportunityCloseTarget } from "../opportunities/stages.ts";
import type { FeatureKey } from "../scoring/lead-score.ts";
import type { QualificationResult } from "../qualification/engine.ts";

/* ================================================================ versions */

/** Intent engine (signals -> score -> state). */
export const IE_VERSION = "ie-1";
/** Next-best-action rules. */
export const NBA_VERSION = "nba-1";
/** Question value function. */
export const QV_VERSION = "qv-1";
/** Question-intent library content. */
export const QI_LIBRARY_VERSION = "qi-1";
/** Fact merge rules (states, validity windows, materiality). */
export const FACTS_VERSION = "qf-1";
/** Deterministic signal extraction rules; stored on lead_intent_signals.rule_version. */
export const SIGNAL_RULES_VERSION = "sig-1";
/** Pre-send QA checks and the /100 grader. */
export const QA_VERSION = "qa-1";

/**
 * Stored on lead_assessments.engine_version: every component version, so an
 * assessment is always explainable against the engine that made it, and the
 * (lead, trigger_event, engine_version) idempotency key changes whenever any
 * component does.
 */
export const QIE_ENGINE_VERSION =
  `${IE_VERSION}+${NBA_VERSION}+${QV_VERSION}+${QI_LIBRARY_VERSION}+${FACTS_VERSION}` as const;

/* ========================================================= rollout / mode */

/**
 * Per-workspace rollout flag (stored in the QUALIFICATION_POLICY '*' override).
 *   OFF    no assessment is computed.
 *   SHADOW the assessment and NBA are computed and stored beside the legacy
 *          selection (lead_assessments.legacy_decision); the agent acts on the
 *          legacy selection. Differences feed the diff report.
 *   LIVE   the NBA is the agent's source of truth.
 * The end state is LIVE everywhere; SHADOW is a rollout stage, not a permanent mode.
 */
export const QI_ENGINE_MODES = ["OFF", "SHADOW", "LIVE"] as const;
export type QiEngineMode = (typeof QI_ENGINE_MODES)[number];

/** What an assessment row records (OFF never writes one). lead_assessments.engine_mode. */
export const ASSESSMENT_ENGINE_MODES = ["SHADOW", "LIVE"] as const;
export type AssessmentEngineMode = (typeof ASSESSMENT_ENGINE_MODES)[number];

/**
 * Flipped to true by the reviewed change that records the §C.5 release gates
 * as passed. Until then every workspace without an explicit mode runs SHADOW.
 */
export const QI_RELEASE_GATES_PASSED = false as boolean;

/**
 * The mode for a workspace with no explicit `engineMode` in its policy.
 * New workspaces default to LIVE once the gates pass; existing workspaces keep
 * whatever they have stored (an explicit value always wins).
 */
export function defaultEngineMode(gatesPassed: boolean = QI_RELEASE_GATES_PASSED): QiEngineMode {
  return gatesPassed ? "LIVE" : "SHADOW";
}

export function resolveEngineMode(
  stored: QiEngineMode | null | undefined,
  gatesPassed: boolean = QI_RELEASE_GATES_PASSED,
): QiEngineMode {
  return stored ?? defaultEngineMode(gatesPassed);
}

/* ================================================================ signals */

/** lead_intent_signals.category */
export const SIGNAL_CATEGORIES = ["EXPLICIT", "BEHAVIOURAL", "CONVERSATIONAL", "CONTEXT"] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

/** lead_intent_signals.polarity */
export const SIGNAL_POLARITIES = ["POSITIVE", "NEGATIVE", "NEUTRAL"] as const;
export type SignalPolarity = (typeof SIGNAL_POLARITIES)[number];

/** Explicit positive signals (the lead asked for something). */
export const EXPLICIT_SIGNAL_TYPES = [
  "BOOKING_REQUEST",
  "DEMO_REQUEST",
  "CALLBACK_REQUEST",
  "QUOTE_REQUEST",
  "PRICING_REQUEST",
  "PURCHASE_REQUEST",
  "TRIAL_OR_SIGNUP_REQUEST",
  "IMPLEMENTATION_QUESTION",
  "INBOUND_ENQUIRY",
  "STATED_PROBLEM",
  "GENERAL_QUESTION",
] as const;

export const CONVERSATIONAL_SIGNAL_TYPES = [
  "URGENCY",
  "TIMEFRAME",
  "DISSATISFACTION_CURRENT",
  "REPLACEMENT_SEARCH",
  "COMPETITOR_COMPARISON",
  "PRICING_CONCERN_ENGAGED",
  "READY_TO_MEET",
  "READY_TO_BUY",
] as const;

/** First-party only (design §D1): nothing else is lawful or available. */
export const BEHAVIOURAL_SIGNAL_TYPES = [
  "CONVERTING_PAGE_PRICING",
  "CONVERTING_PAGE_DEMO",
  "REPEAT_SUBMISSION",
  "FAST_REPLY",
  "BOOKING_LINK_OPENED",
  /** The lead opened their quote 3+ times (quotes/follow-up.ts): HIGH buying intent. Migration 0158. */
  "QUOTE_VIEWED_REPEATEDLY",
] as const;

/**
 * From Find Leads' permitted sources for a promoted prospect; input only.
 * The later types carry the find-leads intent catalogue
 * (find-leads/intent-catalogue.ts) into lead context: signals.ts
 * CONTEXT_BY_INTENT_TYPE maps each catalogue type to one of these.
 * Migration 0155 widens lead_intent_signals_signal_type_check to match.
 */
export const CONTEXT_SIGNAL_TYPES = [
  "FUNDING",
  "HIRING",
  "JOB_CHANGE",
  "TECH_CHANGE",
  "TENDER",
  "EXPANSION",
  "LEADERSHIP_HIRE",
  "KEY_DEPARTURE",
  "ACQUISITION",
  "REBRAND",
  "WEBSITE_RELAUNCH",
  "PRODUCT_LAUNCH",
  "AWARD",
  "PARTNERSHIP",
  "FILING_DEADLINE",
  "ACCOUNTS_GROWTH",
  "CONTRACT_RENEWAL",
] as const;

export const NEGATIVE_SIGNAL_TYPES = [
  "NOT_INTERESTED",
  "NO_NEED",
  "WRONG_PERSON",
  "NOT_NOW",
  "UNSUBSCRIBE",
  "COMPLAINT",
  "NON_LEAD",
  "NO_SHOW",
  "OPPORTUNITY_LOST",
] as const;

/** lead_intent_signals.signal_type (order matches the migration CHECK). */
export const SIGNAL_TYPES = [
  ...EXPLICIT_SIGNAL_TYPES,
  ...CONVERSATIONAL_SIGNAL_TYPES,
  ...BEHAVIOURAL_SIGNAL_TYPES,
  ...CONTEXT_SIGNAL_TYPES,
  ...NEGATIVE_SIGNAL_TYPES,
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type NegativeSignalType = (typeof NEGATIVE_SIGNAL_TYPES)[number];

/**
 * Every signal type's category. Negative signals keep the category of how they
 * were observed (CD-2): said => EXPLICIT, a no-show => BEHAVIOURAL, a lost
 * opportunity => CONTEXT. Polarity, not category, is what makes them negative.
 */
export const SIGNAL_TYPE_CATEGORY: Record<SignalType, SignalCategory> = {
  BOOKING_REQUEST: "EXPLICIT",
  DEMO_REQUEST: "EXPLICIT",
  CALLBACK_REQUEST: "EXPLICIT",
  QUOTE_REQUEST: "EXPLICIT",
  PRICING_REQUEST: "EXPLICIT",
  PURCHASE_REQUEST: "EXPLICIT",
  TRIAL_OR_SIGNUP_REQUEST: "EXPLICIT",
  IMPLEMENTATION_QUESTION: "EXPLICIT",
  INBOUND_ENQUIRY: "EXPLICIT",
  STATED_PROBLEM: "EXPLICIT",
  GENERAL_QUESTION: "EXPLICIT",
  URGENCY: "CONVERSATIONAL",
  TIMEFRAME: "CONVERSATIONAL",
  DISSATISFACTION_CURRENT: "CONVERSATIONAL",
  REPLACEMENT_SEARCH: "CONVERSATIONAL",
  COMPETITOR_COMPARISON: "CONVERSATIONAL",
  PRICING_CONCERN_ENGAGED: "CONVERSATIONAL",
  READY_TO_MEET: "CONVERSATIONAL",
  READY_TO_BUY: "CONVERSATIONAL",
  CONVERTING_PAGE_PRICING: "BEHAVIOURAL",
  CONVERTING_PAGE_DEMO: "BEHAVIOURAL",
  REPEAT_SUBMISSION: "BEHAVIOURAL",
  FAST_REPLY: "BEHAVIOURAL",
  BOOKING_LINK_OPENED: "BEHAVIOURAL",
  QUOTE_VIEWED_REPEATEDLY: "BEHAVIOURAL",
  FUNDING: "CONTEXT",
  HIRING: "CONTEXT",
  JOB_CHANGE: "CONTEXT",
  TECH_CHANGE: "CONTEXT",
  TENDER: "CONTEXT",
  EXPANSION: "CONTEXT",
  LEADERSHIP_HIRE: "CONTEXT",
  KEY_DEPARTURE: "CONTEXT",
  ACQUISITION: "CONTEXT",
  REBRAND: "CONTEXT",
  WEBSITE_RELAUNCH: "CONTEXT",
  PRODUCT_LAUNCH: "CONTEXT",
  AWARD: "CONTEXT",
  PARTNERSHIP: "CONTEXT",
  FILING_DEADLINE: "CONTEXT",
  ACCOUNTS_GROWTH: "CONTEXT",
  CONTRACT_RENEWAL: "CONTEXT",
  NOT_INTERESTED: "EXPLICIT",
  NO_NEED: "EXPLICIT",
  WRONG_PERSON: "EXPLICIT",
  NOT_NOW: "EXPLICIT",
  UNSUBSCRIBE: "EXPLICIT",
  COMPLAINT: "EXPLICIT",
  NON_LEAD: "EXPLICIT",
  NO_SHOW: "BEHAVIOURAL",
  OPPORTUNITY_LOST: "CONTEXT",
};

/** Default polarity of each type. NEUTRAL is reserved for evidence-only rows (CD-3). */
export function signalPolarity(type: SignalType): SignalPolarity {
  return (NEGATIVE_SIGNAL_TYPES as readonly string[]).includes(type) ? "NEGATIVE" : "POSITIVE";
}

/** Precedence rule 2 (§B.4): the newest of these makes the lead NEGATIVE. */
export const HARD_NEGATIVE_SIGNAL_TYPES = ["NOT_INTERESTED", "NO_NEED", "WRONG_PERSON", "NON_LEAD"] as const satisfies readonly NegativeSignalType[];
/** Precedence rule 1: never decays; lifted only by a new explicit inbound. */
export const TERMINAL_NEGATIVE_SIGNAL_TYPES = ["UNSUBSCRIBE", "COMPLAINT"] as const satisfies readonly NegativeSignalType[];
/** Rule 4: BOOKING_READY. */
export const BOOKING_READY_SIGNAL_TYPES = ["BOOKING_REQUEST", "DEMO_REQUEST", "CALLBACK_REQUEST"] as const satisfies readonly SignalType[];
/** Rule 5: PURCHASE_READY. */
export const PURCHASE_READY_SIGNAL_TYPES = ["PURCHASE_REQUEST", "TRIAL_OR_SIGNUP_REQUEST", "READY_TO_BUY"] as const satisfies readonly SignalType[];
/** Rule 8: EXPLORATORY needs one of these. */
export const INFO_SEEKING_SIGNAL_TYPES = ["PRICING_REQUEST", "GENERAL_QUESTION", "STATED_PROBLEM"] as const satisfies readonly SignalType[];

/** lead_intent_signals.source */
export const SIGNAL_SOURCES = [
  "FORM",
  "REPLY",
  "CLASSIFICATION",
  "BOOKING",
  "OPPORTUNITY",
  "TOUCH",
  "ENRICHMENT",
  "SOURCING",
  "MANUAL",
  "AI_ASSIST",
] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const SIGNAL_REASON_MAX = 200;
export const SIGNAL_EXCERPT_MAX = 240;
export const SOURCE_REF_MAX = 200;
export const DEDUPE_KEY_MAX = 200;

const unit = z.number().min(0).max(1);
const isoDateTime = z.iso.datetime({ offset: true });

/**
 * One signal as the service writes it (snake_case = the table's columns).
 * `dedupe_key` must be deterministic per (lead, source event, signal type).
 */
export const intentSignalWriteSchema = z
  .object({
    lead_id: z.uuid(),
    service_id: z.uuid().nullable().default(null),
    category: z.enum(SIGNAL_CATEGORIES),
    signal_type: z.enum(SIGNAL_TYPES),
    polarity: z.enum(SIGNAL_POLARITIES),
    strength: unit,
    confidence: unit,
    source: z.enum(SIGNAL_SOURCES),
    source_ref: z.string().min(1).max(SOURCE_REF_MAX).nullable().default(null),
    observed_at: isoDateTime,
    half_life_hours: z.number().int().min(1).max(17520).nullable(),
    flat_until: isoDateTime.nullable().default(null),
    expires_at: isoDateTime.nullable().default(null),
    resume_at: isoDateTime.nullable().default(null),
    reason: z.string().min(1).max(SIGNAL_REASON_MAX),
    evidence_excerpt: z.string().max(SIGNAL_EXCERPT_MAX).nullable().default(null),
    dedupe_key: z.string().min(1).max(DEDUPE_KEY_MAX),
    rule_version: z.string().min(1).max(40),
  })
  .superRefine((s, ctx) => {
    if (SIGNAL_TYPE_CATEGORY[s.signal_type] !== s.category) {
      ctx.addIssue({ code: "custom", path: ["category"], message: `${s.signal_type} is ${SIGNAL_TYPE_CATEGORY[s.signal_type]}` });
    }
    const negative = (NEGATIVE_SIGNAL_TYPES as readonly string[]).includes(s.signal_type);
    if (negative !== (s.polarity === "NEGATIVE")) {
      ctx.addIssue({ code: "custom", path: ["polarity"], message: "polarity must be NEGATIVE exactly for negative signal types" });
    }
    if (s.resume_at !== null && s.signal_type !== "NOT_NOW") {
      ctx.addIssue({ code: "custom", path: ["resume_at"], message: "resume_at is for NOT_NOW only" });
    }
    if (s.expires_at !== null && Date.parse(s.expires_at) <= Date.parse(s.observed_at)) {
      ctx.addIssue({ code: "custom", path: ["expires_at"], message: "expires_at must be after observed_at" });
    }
  });
export type IntentSignalWrite = z.infer<typeof intentSignalWriteSchema>;

/** A stored signal, as the pure engine reads it. */
export type IntentSignal = {
  id: string;
  leadId: string;
  serviceId: string | null;
  category: SignalCategory;
  type: SignalType;
  polarity: SignalPolarity;
  /** 0..1 at observation. */
  strength: number;
  /** 0..1. */
  confidence: number;
  source: SignalSource;
  sourceRef: string | null;
  observedAt: string;
  /** null = does not decay. */
  halfLifeHours: number | null;
  flatUntil: string | null;
  expiresAt: string | null;
  resumeAt: string | null;
  reason: string;
  evidenceExcerpt: string | null;
  ruleVersion: string;
  retractedAt: string | null;
};

/* ================================================================= intent */

/** Ordered weakest to strongest positive, then the two holding states. */
export const INTENT_STATES = [
  "NO_DETECTED_INTENT",
  "LOW",
  "EXPLORATORY",
  "MEDIUM",
  "HIGH",
  "BOOKING_READY",
  "PURCHASE_READY",
  "NOT_NOW",
  "NEGATIVE",
] as const;
export type IntentState = (typeof INTENT_STATES)[number];

/** The five score components and their caps (sum 100). */
export const INTENT_SCORE_COMPONENTS = ["EXPLICIT", "BEHAVIOURAL", "CONVERSATIONAL", "RECENCY", "CONSISTENCY"] as const;
export type IntentScoreComponent = (typeof INTENT_SCORE_COMPONENTS)[number];

export const INTENT_COMPONENT_CAPS: Record<IntentScoreComponent, number> = {
  EXPLICIT: 35,
  BEHAVIOURAL: 20,
  CONVERSATIONAL: 25,
  RECENCY: 10,
  CONSISTENCY: 10,
};

/** Which capped component a positive signal of each category feeds (CD-1). */
export const CATEGORY_SCORE_COMPONENT: Record<SignalCategory, Exclude<IntentScoreComponent, "RECENCY" | "CONSISTENCY">> = {
  EXPLICIT: "EXPLICIT",
  BEHAVIOURAL: "BEHAVIOURAL",
  CONVERSATIONAL: "CONVERSATIONAL",
  CONTEXT: "BEHAVIOURAL",
};

/** Category score shape; stored as lead_assessments.intent_categories. Points, 0..cap. */
export type IntentCategoryScores = Record<IntentScoreComponent, number>;

export const intentCategoryScoresSchema = z
  .object({
    EXPLICIT: z.number().min(0).max(INTENT_COMPONENT_CAPS.EXPLICIT),
    BEHAVIOURAL: z.number().min(0).max(INTENT_COMPONENT_CAPS.BEHAVIOURAL),
    CONVERSATIONAL: z.number().min(0).max(INTENT_COMPONENT_CAPS.CONVERSATIONAL),
    RECENCY: z.number().min(0).max(INTENT_COMPONENT_CAPS.RECENCY),
    CONSISTENCY: z.number().min(0).max(INTENT_COMPONENT_CAPS.CONSISTENCY),
  })
  .strict();

/** Thresholds of the §B.4 precedence table. */
export const INTENT_THRESHOLDS = {
  HIGH: 70,
  MEDIUM: 45,
  EXPLORATORY_MIN: 20,
  LOW_MIN: 10,
  /** Rule 2: a hard negative caps the score here. */
  NEGATIVE_CAP: 10,
  /** Rule 3: a live NOT_NOW caps the score here. */
  NOT_NOW_CAP: 25,
  /** Rules 4-5: minimum decayed strength of the ready signal. */
  READY_MIN_DECAYED_STRENGTH: 0.6,
  /** Bonus for a second distinct type in one category. */
  SECOND_TYPE_BONUS: 0.15,
  /** Recency half-life (days). */
  RECENCY_HALF_LIFE_DAYS: 7,
  /** Confidence floor. */
  CONFIDENCE_FLOOR: 0.25,
  /** A signal is ignored after this many half-lives. */
  IGNORE_AFTER_HALF_LIVES: 4,
  /** NOT_NOW with no stated date resumes after this many days. */
  NOT_NOW_DEFAULT_DAYS: 60,
} as const;

/** One item of lead_assessments.intent_evidence / intent_contradictions. */
export const intentEvidenceItemSchema = z
  .object({
    signal_id: z.uuid(),
    signal_type: z.enum(SIGNAL_TYPES),
    category: z.enum(SIGNAL_CATEGORIES),
    polarity: z.enum(SIGNAL_POLARITIES),
    decayed_strength: unit,
    reason: z.string().min(1).max(SIGNAL_REASON_MAX),
    observed_at: isoDateTime,
  })
  .strict();
export type IntentEvidenceItem = z.infer<typeof intentEvidenceItemSchema>;

/** The output of `assessIntent(signals, now)` (pure). */
export type IntentAssessment = {
  state: IntentState;
  /** 0..100 integer. */
  score: number;
  categories: IntentCategoryScores;
  evidence: IntentEvidenceItem[];
  /** Positive evidence overruled by a negative. Never summed (§B.4). */
  contradictions: IntentEvidenceItem[];
  /** 0..1, floored at INTENT_THRESHOLDS.CONFIDENCE_FLOOR when any signal exists. */
  confidence: number;
  /** The next decay boundary; the sweep re-assesses after it. */
  validUntil: string | null;
  /** NOT_NOW: when to resume. */
  resumeAt: string | null;
  version: typeof IE_VERSION;
};

/* ============================================================= dimensions */

/**
 * The six keys the design adds to the library (§B.7). Owned by the sales
 * library (A2 adds them to QUALIFICATION_DIMENSION_KEYS and the catalogue);
 * listed here so the contract and the migration CHECK are complete before
 * that lands. QI_DIMENSION_KEYS de-duplicates, so it is stable either way.
 */
export const QI_ADDED_DIMENSION_KEYS = [
  "OUTCOME",
  "AVAILABILITY",
  "DISSATISFACTION",
  "TECHNICAL_REQUIREMENTS",
  "IMPLEMENTATION_READINESS",
  "PURCHASE_READINESS",
] as const;
export type QiAddedDimensionKey = (typeof QI_ADDED_DIMENSION_KEYS)[number];

/** The 26 dimension keys: the library's, then the added ones (order = migration CHECK). */
export const QI_DIMENSION_KEYS: readonly QiDimensionKey[] = [
  ...new Set<QiDimensionKey>([...QUALIFICATION_DIMENSION_KEYS, ...QI_ADDED_DIMENSION_KEYS]),
];
export type QiDimensionKey = QualificationDimensionKey | QiAddedDimensionKey;

/** A fact from a configured question with no dimension (dimension_key null and not inferable). */
export const UNMAPPED_DIMENSION = "UNMAPPED" as const;
export type FactDimension = QiDimensionKey | typeof UNMAPPED_DIMENSION;

export const qiDimensionKeySchema = z.enum(
  [...QUALIFICATION_DIMENSION_KEYS, ...QI_ADDED_DIMENSION_KEYS] as [QiDimensionKey, ...QiDimensionKey[]],
);
export const factDimensionSchema = z.union([qiDimensionKeySchema, z.literal(UNMAPPED_DIMENSION)]);

/**
 * The brief's dimension names mapped onto library keys, without duplication
 * (§B.7). Every value is a QiDimensionKey (tested).
 */
export const BRIEF_DIMENSION_ALIASES: Record<string, QiDimensionKey> = {
  NEED: "PROBLEM",
  PROBLEM: "PROBLEM",
  USE_CASE: "USE_CASE",
  OUTCOME: "OUTCOME",
  SCOPE: "PROJECT_SCOPE",
  SERVICE: "SERVICE_NEEDED",
  LOCATION: "LOCATION",
  PROPERTY: "PROPERTY_TYPE",
  TIMING: "TIMING",
  URGENCY: "TIMING",
  AVAILABILITY: "AVAILABILITY",
  SIZE: "COMPANY_SIZE",
  COMPANY_SIZE: "COMPANY_SIZE",
  TEAM_SIZE: "TEAM_SIZE",
  EXISTING_PROVIDER: "CURRENT_SOLUTION",
  CURRENT_SOLUTION: "CURRENT_SOLUTION",
  DISSATISFACTION: "DISSATISFACTION",
  AUTHORITY: "AUTHORITY",
  BUDGET: "BUDGET",
  VOLUME: "VOLUME",
  PRODUCT_INTEREST: "PRODUCT_INTEREST",
  SUITABILITY: "SUITABILITY",
  STAKEHOLDERS: "STAKEHOLDERS",
  SUCCESS_METRICS: "SUCCESS_METRICS",
  DECISION_PROCESS: "DECISION_PROCESS",
  PROCUREMENT: "DECISION_PROCESS",
  COMPLIANCE: "COMPLIANCE_REQUIREMENTS",
  SECURITY: "COMPLIANCE_REQUIREMENTS",
  TECHNICAL_REQUIREMENTS: "TECHNICAL_REQUIREMENTS",
  INTEGRATION: "TECHNICAL_REQUIREMENTS",
  IMPLEMENTATION_READINESS: "IMPLEMENTATION_READINESS",
  DELIVERY_REQUIREMENT: "PROJECT_SCOPE",
  PURCHASE_READINESS: "PURCHASE_READINESS",
  HIRING_NEED: "HIRING_NEED",
};

/**
 * Always material (§B.12): an INFERRED value must be verified before it can
 * gate anything. Material also: LOCATION under a service-area rule, any
 * dimension named by a hard_fail rule or an offer disqualifier, and the offer's
 * requiredDimensions (resolved at run time by facts.ts).
 */
export const ALWAYS_MATERIAL_DIMENSIONS = ["BUDGET", "AUTHORITY"] as const satisfies readonly QiDimensionKey[];

/**
 * Validity windows (§B.12), in days after observed_at. TIMING is special: valid
 * until the stated date + TIMING_VALID_AFTER_STATED_DAYS. Absent = no expiry.
 */
export const FACT_VALIDITY_DAYS: Partial<Record<QiDimensionKey, number>> = {
  BUDGET: 180,
  AUTHORITY: 180,
  CURRENT_SOLUTION: 365,
};
export const TIMING_VALID_AFTER_STATED_DAYS = 14;

/* ================================================================== facts */

/** Stored on lead_qualification_facts.state. UNKNOWN is never stored. */
export const FACT_STATES = ["CONFIRMED", "INFERRED", "CONFLICTING", "REJECTED"] as const;
export type FactState = (typeof FACT_STATES)[number];

/** The derived per-dimension status the engine, UI and NBA use. */
export const DIMENSION_STATUSES = ["CONFIRMED", "INFERRED", "UNKNOWN", "CONFLICTING"] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];

/** lead_qualification_facts.source */
export const FACT_SOURCES = ["ANSWER", "FORM", "LEAD_FIELD", "ENRICHMENT", "REPLY", "AI_ASSIST", "CRM", "MANUAL"] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/** The AI assist's acceptance floor for an extracted candidate (§B.11). */
export const AI_EXTRACTION_MIN_CONFIDENCE = 0.85;

export const FACT_VALUE_MAX = 500;
export const FACT_VALUE_NORMALISED_MAX = 200;

/** Library intent key: "DIMENSION_FAMILY.SPECIFIC", e.g. "TIMING.START_WINDOW". */
export const LIBRARY_INTENT_KEY_PATTERN = /^[A-Z][A-Z_]{1,39}\.[A-Z][A-Z0-9_]{1,39}$/;
/** Synthetic intent for a configured question with no library key. */
export const CUSTOM_INTENT_KEY_PATTERN = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function customIntentKey(questionId: string): `custom:${string}` {
  return `custom:${questionId.toLowerCase()}`;
}

export function isCustomIntentKey(key: string): boolean {
  return CUSTOM_INTENT_KEY_PATTERN.test(key);
}

export const libraryIntentKeySchema = z.string().regex(LIBRARY_INTENT_KEY_PATTERN);
export const questionIntentKeySchema = z
  .string()
  .refine((k) => LIBRARY_INTENT_KEY_PATTERN.test(k) || CUSTOM_INTENT_KEY_PATTERN.test(k), "not a question intent key");

/** One fact as the service writes it (snake_case = the table's columns). */
export const qualificationFactWriteSchema = z
  .object({
    lead_id: z.uuid(),
    service_id: z.uuid().nullable().default(null),
    dimension: factDimensionSchema,
    value: z.string().min(1).max(FACT_VALUE_MAX),
    value_normalised: z.string().min(1).max(FACT_VALUE_NORMALISED_MAX).nullable().default(null),
    state: z.enum(FACT_STATES),
    source: z.enum(FACT_SOURCES),
    source_ref: z.string().min(1).max(SOURCE_REF_MAX).nullable().default(null),
    question_id: z.uuid().nullable().default(null),
    question_intent_key: questionIntentKeySchema.nullable().default(null),
    confidence: unit,
    observed_at: isoDateTime,
    valid_until: isoDateTime.nullable().default(null),
    verified_at: isoDateTime.nullable().default(null),
    set_by: z.uuid().nullable().default(null),
  })
  .superRefine((f, ctx) => {
    if (f.dimension === UNMAPPED_DIMENSION && !(f.question_intent_key && isCustomIntentKey(f.question_intent_key))) {
      ctx.addIssue({ code: "custom", path: ["question_intent_key"], message: "an UNMAPPED fact needs its custom:<question id> intent key" });
    }
    // CLAUDE.md resolved conflict 1: the AI never confirms anything.
    if (f.source === "AI_ASSIST" && f.state === "CONFIRMED") {
      ctx.addIssue({ code: "custom", path: ["state"], message: "an AI_ASSIST fact is INFERRED at most" });
    }
    if (f.source === "AI_ASSIST" && f.state === "INFERRED" && f.confidence < AI_EXTRACTION_MIN_CONFIDENCE) {
      ctx.addIssue({ code: "custom", path: ["confidence"], message: `AI_ASSIST facts need confidence >= ${AI_EXTRACTION_MIN_CONFIDENCE}` });
    }
  });
export type QualificationFactWrite = z.infer<typeof qualificationFactWriteSchema>;

/** A stored fact, as the pure engine reads it. */
export type QualificationFact = {
  id: string;
  leadId: string;
  serviceId: string | null;
  dimension: FactDimension;
  value: string;
  valueNormalised: string | null;
  state: FactState;
  source: FactSource;
  sourceRef: string | null;
  questionId: string | null;
  questionIntentKey: string | null;
  confidence: number;
  observedAt: string;
  validUntil: string | null;
  verifiedAt: string | null;
  setBy: string | null;
  supersededAt: string | null;
};

/** One item of lead_assessments.dimension_status. */
export const dimensionStatusEntrySchema = z
  .object({
    dimension: factDimensionSchema,
    status: z.enum(DIMENSION_STATUSES),
    /** The live fact ids behind the status (2+ when CONFLICTING). */
    fact_ids: z.array(z.uuid()).max(10),
    /** An INFERRED material fact must be verified before it gates (§B.12). */
    material: z.boolean(),
    /** In the goal threshold or the offer's requiredDimensions. */
    required: z.boolean(),
    /** The fact expired and is "last known" (goal F nurture). */
    stale: z.boolean().default(false),
  })
  .strict();
export type DimensionStatusEntry = z.infer<typeof dimensionStatusEntrySchema>;

/* ======================================================= question intents */

export const QUESTION_PURPOSES = ["DISCOVER", "VERIFY", "CLARIFY", "DISQUALIFY_CHECK"] as const;
export type QuestionPurpose = (typeof QUESTION_PURPOSES)[number];

/** The configured-question response types, plus the library's richer ones. */
export const ANSWER_TYPES = [...RESPONSE_TYPES, "money", "count", "date", "role"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

/** Deterministic extractors (extractors.ts implements exactly these). */
export const EXTRACTOR_KEYS = [
  "YES_NO",
  "CHOICE",
  "FREE_TEXT",
  "NUMBER",
  "COUNT",
  "MONEY",
  "TIMELINE",
  "DATE",
  "POSTCODE",
  "ROLE_MENTION",
  "PROVIDER_MENTION",
  "SERVICE_NAME",
  "URGENCY",
  "DISSATISFACTION",
  "READINESS",
] as const;
export type ExtractorKey = (typeof EXTRACTOR_KEYS)[number];

/** The conversation stages of the router (sales-library/method-router.ts ConversationStage). */
export const CONVERSATION_STAGES = [
  "NEW",
  "ENGAGED",
  "QUALIFYING",
  "OBJECTION",
  "CLOSING",
  "POST_BOOKING",
] as const satisfies readonly ConversationStage[];
// Exhaustiveness: fails to compile if the router adds a stage this list lacks.
type _StagesExhaustive = ConversationStage extends (typeof CONVERSATION_STAGES)[number] ? true : never;
const _stagesExhaustive: _StagesExhaustive = true;
void _stagesExhaustive;

/** The agent channels (agent/types.ts AgentChannel), as a runtime list. */
export const QI_CHANNELS = ["sms", "whatsapp", "email", "messenger", "instagram", "tiktok", "linkedin", "voice"] as const satisfies readonly AgentChannel[];
type _ChannelsExhaustive = AgentChannel extends (typeof QI_CHANNELS)[number] ? true : never;
const _channelsExhaustive: _ChannelsExhaustive = true;
void _channelsExhaustive;

/**
 * A serialisable predicate over the lead's state. Deliberately small: every
 * branch, prerequisite and disqualifier in the library and in workspace
 * policy is one of these, so they can be stored as jsonb, validated by zod,
 * and evaluated by pure code without eval.
 */
export type Predicate =
  | { op: "known"; dimension: QiDimensionKey }
  | { op: "unknown"; dimension: QiDimensionKey }
  | { op: "equals"; dimension: QiDimensionKey; value: string }
  | { op: "in"; dimension: QiDimensionKey; values: string[] }
  | { op: "lt" | "lte" | "gt" | "gte"; dimension: QiDimensionKey; value: number }
  | { op: "intentIn"; states: IntentState[] }
  | { op: "all"; of: Predicate[] }
  | { op: "any"; of: Predicate[] }
  | { op: "not"; of: Predicate };

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal("known"), dimension: qiDimensionKeySchema }).strict(),
    z.object({ op: z.literal("unknown"), dimension: qiDimensionKeySchema }).strict(),
    z.object({ op: z.literal("equals"), dimension: qiDimensionKeySchema, value: z.string().min(1).max(200) }).strict(),
    z.object({ op: z.literal("in"), dimension: qiDimensionKeySchema, values: z.array(z.string().min(1).max(200)).min(1).max(50) }).strict(),
    z.object({ op: z.enum(["lt", "lte", "gt", "gte"]), dimension: qiDimensionKeySchema, value: z.number().finite() }).strict(),
    z.object({ op: z.literal("intentIn"), states: z.array(z.enum(INTENT_STATES)).min(1) }).strict(),
    z.object({ op: z.literal("all"), of: z.array(predicateSchema).min(1).max(10) }).strict(),
    z.object({ op: z.literal("any"), of: z.array(predicateSchema).min(1).max(10) }).strict(),
    z.object({ op: z.literal("not"), of: predicateSchema }).strict(),
  ]),
);

/** The question-intent attributes, each 0..1 (§B.8). */
export type QuestionIntentAttrs = {
  decisionRelevance: number;
  informationGain: number;
  salesProgression: number;
  intentRelevance: number;
  friction: number;
  prematurity: number;
};

/**
 * One question intent (§B.7). Library intents live in question-intents.ts;
 * a configured question with no key becomes a synthetic `custom:<id>` intent.
 */
export type QuestionIntent = {
  key: string;
  /** UNMAPPED only for a synthetic custom intent with no dimension. */
  dimension: FactDimension;
  purpose: QuestionPurpose;
  prerequisites: {
    knownAllOf?: QiDimensionKey[];
    stageAtLeast?: ConversationStage;
    intentIn?: IntentState[];
    intentNotIn?: IntentState[];
  };
  appliesTo: {
    archetypes?: string[];
    sicPrefixes?: string[];
    motions?: SalesMotion[];
    goals?: GoalKey[];
    pricingModels?: PricingModel[];
    customerType?: "B2B" | "B2C";
  };
  stages: ConversationStage[];
  channels: AgentChannel[];
  answerType: AnswerType;
  extractor: ExtractorKey;
  /** Lead-score facts the answer produces. */
  scoring: { feature: FeatureKey; map: ExtractorKey }[];
  branches: { when: Predicate; next: string | "CTA" | "ESCALATE" }[];
  disqualifies?: { when: Predicate; reason: string; reviewInstead: boolean };
  attrs: QuestionIntentAttrs;
  /** The experiment unit (QUESTION_STRATEGY variants map intent -> wording family). */
  wordingFamily: string;
  renderings: { default: string; sms?: string; email?: string; social?: string };
  /** Set for a synthetic custom intent. */
  questionId?: string;
  /** A configured question marked required survives depth and the threshold. */
  required?: boolean;
};

/** A workspace override of one intent (QUALIFICATION_QUESTION kind, key = intent key). */
export const questionIntentOverrideSchema = z
  .object({
    action: z.enum(["REWORD", "FORBID", "REQUIRE"]),
    renderings: z
      .object({
        default: z.string().min(3).max(300),
        sms: z.string().min(3).max(160).optional(),
        email: z.string().min(3).max(300).optional(),
        social: z.string().min(3).max(300).optional(),
      })
      .strict()
      .optional(),
    /** Narrow the intent to some offers; absent = every offer. */
    serviceIds: z.array(z.uuid()).max(50).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.action === "REWORD" && !o.renderings) {
      ctx.addIssue({ code: "custom", path: ["renderings"], message: "REWORD needs renderings" });
    }
  });
export type QuestionIntentOverride = z.infer<typeof questionIntentOverrideSchema>;

/* ================================================================ goals */

/** Goal routing A-G (§B.10). */
export const GOAL_KEYS = [
  "A_QUALIFY_ONLY",
  "B_BOOK_MEETING",
  "C_DIRECT_SALE",
  "D_SIGNUP_TRIAL",
  "E_HUMAN_CLOSER",
  "F_NURTURE",
  "G_DISQUALIFY",
] as const;
export type GoalKey = (typeof GOAL_KEYS)[number];

export const GOAL_LABEL: Record<GoalKey, string> = {
  A_QUALIFY_ONLY: "Qualify, then hand over",
  B_BOOK_MEETING: "Book a meeting",
  C_DIRECT_SALE: "Direct sale",
  D_SIGNUP_TRIAL: "Sign-up or trial",
  E_HUMAN_CLOSER: "Hand to a closer",
  F_NURTURE: "Nurture",
  G_DISQUALIFY: "Disqualify",
};

/**
 * A lead's or workspace's conversion goal type -> goal. HUMAN_HANDOVER and
 * CUSTOM map to A only when the goal has qualification_required; otherwise to
 * E (goals.ts applies that; this is the qualification_required=true mapping).
 * PHONE_CALL and REQUEST_QUOTE book a conversation, so B.
 */
export const CONVERSION_GOAL_TO_GOAL: Record<ConversionGoalType, GoalKey> = {
  BOOK_APPOINTMENT: "B_BOOK_MEETING",
  BOOK_SITE_VISIT: "B_BOOK_MEETING",
  BOOK_DEMO: "B_BOOK_MEETING",
  REQUEST_QUOTE: "B_BOOK_MEETING",
  PHONE_CALL: "B_BOOK_MEETING",
  DIRECT_SIGNUP: "D_SIGNUP_TRIAL",
  DIRECT_PURCHASE: "C_DIRECT_SALE",
  HUMAN_HANDOVER: "A_QUALIFY_ONLY",
  CUSTOM: "A_QUALIFY_ONLY",
};

/** The motion's default goal, the last step of resolution (closeTargetForMotion order). */
export const MOTION_DEFAULT_GOAL: Record<SalesMotion, GoalKey> = {
  BOOK_MEETING_B2B: "B_BOOK_MEETING",
  LOCAL_SERVICE: "B_BOOK_MEETING",
  HIGH_TICKET_B2C: "B_BOOK_MEETING",
  ECOMMERCE_DIRECT: "C_DIRECT_SALE",
  DIRECT_B2B: "C_DIRECT_SALE",
  SAAS_SELF_SERVE: "D_SIGNUP_TRIAL",
  ENTERPRISE: "E_HUMAN_CLOSER",
};

/** Motions each goal is designed for; empty = any motion (§B.10). */
export const GOAL_MOTIONS: Record<GoalKey, readonly SalesMotion[]> = {
  A_QUALIFY_ONLY: [],
  B_BOOK_MEETING: ["BOOK_MEETING_B2B", "LOCAL_SERVICE", "HIGH_TICKET_B2C"],
  C_DIRECT_SALE: ["ECOMMERCE_DIRECT", "DIRECT_B2B"],
  D_SIGNUP_TRIAL: ["SAAS_SELF_SERVE"],
  E_HUMAN_CLOSER: ["ENTERPRISE", "DIRECT_B2B"],
  F_NURTURE: [],
  G_DISQUALIFY: [],
};

/** opportunities.close_target a goal drives toward; null = no close (A, F, G hand over, wait or stop). */
export const GOAL_CLOSE_TARGET: Record<GoalKey, OpportunityCloseTarget | null> = {
  A_QUALIFY_ONLY: null,
  B_BOOK_MEETING: "BOOK",
  C_DIRECT_SALE: "BUY",
  D_SIGNUP_TRIAL: "TRIAL",
  E_HUMAN_CLOSER: "NEXT_STAGE",
  F_NURTURE: null,
  G_DISQUALIFY: null,
};

/** Where a resolved goal came from, first match wins (§B.10 "Order"). */
export const GOAL_SOURCES = ["LEAD_CONVERSION_GOAL", "OFFER_PROFILE", "WORKSPACE_POLICY", "WORKSPACE_DEFAULT_GOAL", "MOTION", "STATE"] as const;
export type GoalSource = (typeof GOAL_SOURCES)[number];

export type ResolvedGoal = { goal: GoalKey; source: GoalSource; motion: SalesMotion };

/* ========================================================== offer profile */

export const PRICING_MODELS = ["FIXED", "FROM", "QUOTE", "SUBSCRIPTION", "USAGE", "RETAINER"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];
export const BILLING_TYPES = ["ONE_OFF", "RECURRING"] as const;
export const CYCLE_COMPLEXITIES = ["SIMPLE", "CONSIDERED", "COMPLEX"] as const;
export const CUSTOMER_TYPES = ["B2B", "B2C", "BOTH"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Intent state + completeness a threshold needs (booking / direct-sale / handoff). */
export const actionThresholdSchema = z
  .object({
    minIntentState: z.enum(INTENT_STATES).optional(),
    minCompleteness: unit.optional(),
  })
  .strict();
export type ActionThreshold = z.infer<typeof actionThresholdSchema>;

const customerShapeSchema = z
  .object({
    /** Employee bands, e.g. "1-9", "10-49", "50-249", "250+". */
    sizes: z.array(z.string().min(1).max(20)).max(10).optional(),
    /** UK SIC 2007/2026 prefixes, digits and dots. */
    sicPrefixes: z.array(z.string().regex(/^\d{1,2}(\.\d{1,2}(\/\d)?)?$/)).max(50).optional(),
    roles: z.array(z.string().min(1).max(60)).max(20).optional(),
    icpProfileId: z.uuid().optional(),
  })
  .strict();

const disqualifierSchema = z
  .object({
    dimension: qiDimensionKeySchema,
    when: predicateSchema,
    reason: z.string().min(3).max(200),
    /** INFERRED or borderline => REVIEW instead of DISQUALIFY. */
    reviewInstead: z.boolean().default(true),
    /** Also suppress (lead.suppress) on a CONFIRMED match. */
    suppress: z.boolean().default(false),
  })
  .strict();
export type OfferDisqualifier = z.infer<typeof disqualifierSchema>;

/**
 * services.offer_profile (§B.6). Every field optional: defaults come from
 * archetype x motion. Readers safeParse and fall back to {} on failure (the
 * column is browser-writable through services' own grant).
 */
export const offerProfileSchema = z
  .object({
    // Commercial
    pricingModel: z.enum(PRICING_MODELS).optional(),
    averageDealValue: z.number().min(0).max(100_000_000).optional(),
    billing: z.enum(BILLING_TYPES).optional(),
    cycleComplexity: z.enum(CYCLE_COMPLEXITIES).optional(),
    // Who
    customerType: z.enum(CUSTOMER_TYPES).optional(),
    targetCustomer: customerShapeSchema.optional(),
    excludedCustomer: customerShapeSchema.optional(),
    geography: z
      .object({
        postcodePrefixes: z.array(z.string().regex(/^[A-Z]{1,2}\d{0,2}[A-Z]?$/)).max(200).optional(),
        regions: z.array(z.string().min(1).max(60)).max(50).optional(),
      })
      .strict()
      .optional(),
    // Fit
    buyingRequirements: z.array(z.string().min(1).max(200)).max(20).optional(),
    prerequisites: z
      .array(z.object({ dimension: qiDimensionKeySchema, when: predicateSchema }).strict())
      .max(20)
      .optional(),
    disqualifiers: z.array(disqualifierSchema).max(20).optional(),
    painSolved: z.string().min(1).max(500).optional(),
    /** Approved claims only; they feed the offer card. */
    differentiators: z.array(z.string().min(1).max(200)).max(10).optional(),
    // Delivery
    onboarding: z.string().min(1).max(500).optional(),
    availability: z.string().min(1).max(200).optional(),
    // Selling
    goal: z.enum(GOAL_KEYS).optional(),
    motion: z.enum(SALES_MOTIONS).optional(),
    requiredDimensions: z.array(qiDimensionKeySchema).max(26).optional(),
    forbiddenQuestionIntents: z.array(libraryIntentKeySchema).max(100).optional(),
    thresholds: z
      .object({
        booking: actionThresholdSchema.optional(),
        directSale: actionThresholdSchema.optional(),
        handoff: actionThresholdSchema.optional(),
      })
      .strict()
      .optional(),
    handoffRules: z.array(z.object({ when: predicateSchema, reason: z.enum(HANDOVER_REASONS) }).strict()).max(20).optional(),
    /**
     * The approved checkout link (commercial_authority.approved_checkout_links[].id)
     * that sells this offer, for a lead with several interests (interests.ts
     * checkoutLinkForService). Absent: the link whose product names the offer.
     */
    checkoutLinkId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
  })
  .strict();
export type OfferProfile = z.infer<typeof offerProfileSchema>;

/** Safe read of services.offer_profile: invalid or absent => {} (defaults apply). */
export function parseOfferProfile(raw: unknown): { profile: OfferProfile; valid: boolean } {
  const parsed = offerProfileSchema.safeParse(raw ?? {});
  return parsed.success ? { profile: parsed.data, valid: true } : { profile: {}, valid: false };
}

/* =================================================== qualification policy */

/** workspace_sales_overrides.kind (0121 + 0134). Order = migration CHECK. */
export const SALES_OVERRIDE_KINDS = [
  "SCORING_WEIGHTS",
  "QUALIFICATION_QUESTION",
  "OBJECTION",
  "DISQUALIFIER",
  "ARCHETYPE_SETTINGS",
  "QUALIFICATION_POLICY",
] as const;
export type SalesOverrideKind = (typeof SALES_OVERRIDE_KINDS)[number];

export const QUALIFICATION_POLICY_KIND = "QUALIFICATION_POLICY" as const satisfies SalesOverrideKind;
export const WORKSPACE_POLICY_KEY = "*" as const;
export function servicePolicyKey(serviceId: string): `service:${string}` {
  return `service:${serviceId.toLowerCase()}`;
}
export const POLICY_KEY_PATTERN = /^(\*|service:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Autonomy the policy may narrow to (business_ai_settings.agent_mode values). */
export const POLICY_AUTONOMY_LEVELS = ["OFF", "SUGGEST_ONLY", "AUTO_REPLY"] as const;
export type PolicyAutonomy = (typeof POLICY_AUTONOMY_LEVELS)[number];

export const ESCALATION_CONDITIONS = [
  "HIGH_VALUE",
  "LOW_CONFIDENCE",
  "CONFLICTING_MATERIAL_FACT",
  "INFERRED_DISQUALIFIER",
  "READY_TO_BUY_NOT_ALLOWED",
  "REPEATED_DEFLECTION",
] as const;
export type EscalationCondition = (typeof ESCALATION_CONDITIONS)[number];

/**
 * QUALIFICATION_POLICY payload (key '*' or 'service:<uuid>'), §B.18.
 * `engineMode` is meaningful on '*' only. Depth, methods and budgets already
 * live in ARCHETYPE_SETTINGS and are not repeated here.
 */
export const qualificationPolicySchema = z
  .object({
    engineMode: z.enum(QI_ENGINE_MODES).optional(),
    goal: z.enum(GOAL_KEYS).optional(),
    /** Framework override for this scope. */
    motion: z.enum(SALES_MOTIONS).optional(),
    requiredDimensions: z.array(qiDimensionKeySchema).max(26).optional(),
    forbiddenQuestionIntents: z.array(libraryIntentKeySchema).max(100).optional(),
    customQuestionIntents: z.array(libraryIntentKeySchema).max(100).optional(),
    disqualifiers: z.array(disqualifierSchema).max(20).optional(),
    thresholds: z
      .object({
        booking: actionThresholdSchema.optional(),
        directSale: actionThresholdSchema.optional(),
        handoff: actionThresholdSchema.optional(),
      })
      .strict()
      .optional(),
    escalationConditions: z.array(z.enum(ESCALATION_CONDITIONS)).max(ESCALATION_CONDITIONS.length).optional(),
    /** Deal value (GBP) above which the goal becomes E_HUMAN_CLOSER. */
    humanCloserAboveValue: z.number().min(0).max(100_000_000).optional(),
    /** May only narrow agent_mode, never widen it (widensAutonomy rule). */
    maxAutonomy: z.enum(POLICY_AUTONOMY_LEVELS).optional(),
    /** Industry profile override (archetype key). */
    archetypeKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(),
  })
  .strict();
export type QualificationPolicy = z.infer<typeof qualificationPolicySchema>;

/**
 * The narrow-only rule Copilot is held to (§B.19): it may add a forbidden
 * intent, add a required dimension, add an escalation condition, add a
 * disqualifier, or lower maxAutonomy. Anything else is UI-only.
 */
export function policyChangeOnlyNarrows(before: QualificationPolicy, after: QualificationPolicy): boolean {
  const superset = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined) =>
    (a ?? []).every((x) => (b ?? []).includes(x));
  const autonomyRank = (m: PolicyAutonomy | undefined) => (m === undefined ? POLICY_AUTONOMY_LEVELS.length : POLICY_AUTONOMY_LEVELS.indexOf(m));
  const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (
    superset(before.forbiddenQuestionIntents, after.forbiddenQuestionIntents) &&
    superset(before.requiredDimensions, after.requiredDimensions) &&
    superset(before.escalationConditions, after.escalationConditions) &&
    superset(
      (before.disqualifiers ?? []).map((d) => JSON.stringify(d)),
      (after.disqualifiers ?? []).map((d) => JSON.stringify(d)),
    ) &&
    autonomyRank(after.maxAutonomy) <= autonomyRank(before.maxAutonomy) &&
    sameJson(before.engineMode, after.engineMode) &&
    sameJson(before.goal, after.goal) &&
    sameJson(before.motion, after.motion) &&
    sameJson(before.customQuestionIntents, after.customQuestionIntents) &&
    sameJson(before.thresholds, after.thresholds) &&
    sameJson(before.humanCloserAboveValue, after.humanCloserAboveValue) &&
    sameJson(before.archetypeKey, after.archetypeKey)
  );
}

/* ========================================================= question value */

/** Additive value terms, each 0..1 (§B.8). total = the V formula. */
export type QuestionValueTerms = {
  decisionRelevance: number;
  informationGain: number;
  salesProgression: number;
  intentRelevance: number;
  friction: number;
  repetitionRisk: number;
  prematurity: number;
  pKnown: number;
  total: number;
};

export const QUESTION_VALUE_FLOORS = {
  /** Rule 9: ask only at or above this. */
  ASK: 0.25,
  /** Rule 5: ANSWER_AND_ASK only at or above this. */
  ANSWER_AND_ASK: 0.4,
} as const;

/** Sticky re-ask is limited to one (§B.8 repetitionRisk). */
export const MAX_ASKS_PER_INTENT = 2;

/* ==================================================================== NBA */

export const NBA_ACTIONS = [
  "ANSWER",
  "ASK",
  "ANSWER_AND_ASK",
  "INFORM",
  "CTA_BOOK",
  "CTA_CHECKOUT",
  "CTA_SIGNUP",
  "ESCALATE",
  "WAIT",
  "NURTURE",
  "DISQUALIFY",
  "NO_ACTION",
] as const;
export type NbaAction = (typeof NBA_ACTIONS)[number];

/** Actions that ask a qualifying question (QA check 12 forbids one otherwise). */
export const ASKING_ACTIONS = ["ASK", "ANSWER_AND_ASK"] as const satisfies readonly NbaAction[];
export const CTA_ACTIONS = ["CTA_BOOK", "CTA_CHECKOUT", "CTA_SIGNUP"] as const satisfies readonly NbaAction[];

/**
 * Whether the action needs a language-model call (§B.16 zero-token decisions).
 * ESCALATE sends a templated acknowledgement; WAIT / NO_ACTION / DISQUALIFY
 * send nothing. The rest compose a message.
 */
export const NBA_ACTION_NEEDS_MODEL: Record<NbaAction, boolean> = {
  ANSWER: true,
  ASK: true,
  ANSWER_AND_ASK: true,
  INFORM: true,
  CTA_BOOK: true,
  CTA_CHECKOUT: true,
  CTA_SIGNUP: true,
  ESCALATE: false,
  WAIT: false,
  NURTURE: true,
  DISQUALIFY: false,
  NO_ACTION: false,
};

/** Which §B.9 rule produced the action (1..12), for the "why" and the diff report. */
export const NBA_RULES = [
  "R1_BINDING_VERDICT",
  "R2_NEGATIVE_OR_SUPPRESSED",
  "R3_DISQUALIFIED",
  "R4_ESCALATE",
  "R5_LEAD_ASKED",
  "R6_NOT_NOW",
  "R7_BOOKING_READY",
  "R8_PURCHASE_READY",
  "R9_ASK",
  "R10_THRESHOLD_MET",
  "R11_LOW_INTENT",
  "R12_FALLBACK",
] as const;
export type NbaRule = (typeof NBA_RULES)[number];

export const NBA_REASON_MAX = 400;

const nbaQuestionIntentSchema = z
  .object({
    key: questionIntentKeySchema,
    dimension: factDimensionSchema,
    purpose: z.enum(QUESTION_PURPOSES),
    /** The configured question, when the intent is (or adopts) one. */
    question_id: z.uuid().nullable(),
    wording_family: z.string().min(1).max(80),
    /** The rendering chosen for the channel; the model rewords, never re-plans. */
    rendering: z.string().min(1).max(300),
  })
  .strict();
export type NbaQuestionIntent = z.infer<typeof nbaQuestionIntentSchema>;

/**
 * The structured NBA (§B.9 / §18), snake_case, computed before any language
 * generation. Stored on lead_assessments.nba and on
 * conversation_agent_runs.decision_json.qi.nba; consumed by the orchestrator
 * (LIVE: it acts on it; SHADOW: it records it beside the legacy decision).
 */
export const nextBestActionSchema = z
  .object({
    current_goal: z.enum(GOAL_KEYS),
    intent_state: z.enum(INTENT_STATES),
    intent_score: z.number().int().min(0).max(100),
    known_dimensions: z
      .array(z.object({ dimension: factDimensionSchema, state: z.enum(["CONFIRMED", "INFERRED", "CONFLICTING"]) }).strict())
      .max(30),
    unknown_required_dimensions: z.array(qiDimensionKeySchema).max(26),
    next_action: z.enum(NBA_ACTIONS),
    /** Set iff next_action asks (ASK / ANSWER_AND_ASK), or a CTA_BOOK carries its one gating question. */
    question_intent: nbaQuestionIntentSchema.nullable(),
    reason: z.string().min(1).max(NBA_REASON_MAX),
    rule: z.enum(NBA_RULES),
    expected_information_gain: unit,
    /** The lead score total (lead-score.ts), 0..100. */
    qualification_score: z.number().min(0).max(100),
    qualification_completeness: unit,
    /** The deterministic engine verdict the NBA ran against. */
    engine_verdict: z.enum(["PENDING", "QUALIFIED", "NOT_QUALIFIED", "REVIEW"] as const satisfies readonly QualificationResult[]),
    confidence: unit,
    /** Set when next_action is ESCALATE (an existing HandoverReason). */
    handover_reason: z.enum(HANDOVER_REASONS).nullable(),
    /**
     * A background task for a person while the AI carries on (owner decision
     * 2026-09-27, agent/types.ts ASSIST_REQUEST): a REVIEW to check, a
     * specialist document, order details for a ready buyer. Never set on an
     * ESCALATE. Optional so assessments stored before it still parse.
     */
    assist_reason: z.enum(ASSIST_REASONS).nullable().optional(),
    /** Set when next_action is WAIT: when to resume. */
    resume_at: isoDateTime.nullable(),
    /** Set when next_action is DISQUALIFY: also suppress (offer disqualifier suppress:true). */
    suppress: z.boolean(),
    /** Whether composing the turn needs a model call (NBA_ACTION_NEEDS_MODEL, after overrides). */
    model_call_required: z.boolean(),
    /** Value terms of the chosen question, for "Why this question?". */
    question_value: z
      .object({
        decisionRelevance: z.number(),
        informationGain: z.number(),
        salesProgression: z.number(),
        intentRelevance: z.number(),
        friction: z.number(),
        repetitionRisk: z.number(),
        prematurity: z.number(),
        pKnown: z.number(),
        total: z.number(),
      })
      .strict()
      .nullable(),
    alternatives: z
      .array(
        z
          .object({
            action: z.enum(NBA_ACTIONS),
            intent: questionIntentKeySchema.nullable(),
            value: z.number(),
          })
          .strict(),
      )
      .max(5),
    engine_version: z.literal(NBA_VERSION),
  })
  .strict()
  .superRefine((n, ctx) => {
    const asks = (ASKING_ACTIONS as readonly string[]).includes(n.next_action);
    if (asks && !n.question_intent) {
      ctx.addIssue({ code: "custom", path: ["question_intent"], message: `${n.next_action} needs a question_intent` });
    }
    if (!asks && n.question_intent && n.next_action !== "CTA_BOOK") {
      ctx.addIssue({ code: "custom", path: ["question_intent"], message: `${n.next_action} carries no question` });
    }
    if ((n.next_action === "ESCALATE") !== (n.handover_reason !== null)) {
      ctx.addIssue({ code: "custom", path: ["handover_reason"], message: "handover_reason is set exactly when escalating" });
    }
    if (n.next_action === "ESCALATE" && n.assist_reason) {
      ctx.addIssue({ code: "custom", path: ["assist_reason"], message: "an escalation is a hand-over, not an assist" });
    }
    if (n.next_action !== "WAIT" && n.resume_at !== null) {
      ctx.addIssue({ code: "custom", path: ["resume_at"], message: "resume_at is for WAIT only" });
    }
    if (n.suppress && n.next_action !== "DISQUALIFY" && n.next_action !== "NO_ACTION") {
      ctx.addIssue({ code: "custom", path: ["suppress"], message: "suppress only with DISQUALIFY or NO_ACTION" });
    }
    // A NEGATIVE lead is never pursued (matrix invariant).
    if (n.intent_state === "NEGATIVE" && ((ASKING_ACTIONS as readonly string[]).includes(n.next_action) || (CTA_ACTIONS as readonly string[]).includes(n.next_action))) {
      ctx.addIssue({ code: "custom", path: ["next_action"], message: "a NEGATIVE lead is never asked or pitched" });
    }
  });
export type NextBestAction = z.infer<typeof nextBestActionSchema>;

/**
 * Everything `decideNextBestAction` needs (pure). Built by service.ts from the
 * database, and by the orchestrator at turn time after `interpret()`.
 */
export type NbaInput = {
  now: string;
  channel: AgentChannel | null;
  stage: ConversationStage;
  goal: ResolvedGoal;
  intent: IntentAssessment;
  dimensions: DimensionStatusEntry[];
  /** Candidate intents, already filtered by appliesTo / stages / channels / forbidden. */
  candidates: QuestionIntent[];
  /** Asks per intent key so far, and whether each was answered. */
  askHistory: { key: string; asked: number; answered: boolean }[];
  engineVerdict: QualificationResult;
  qualificationScore: number;
  completeness: number;
  thresholdMet: boolean;
  suppressed: boolean;
  /** Set by interpret() for the current inbound reply. */
  interpretation: Interpretation | null;
  /** A binding deterministic classification (classifyDeterministic) outranks everything. */
  bindingVerdict: string | null;
  offer: OfferProfile;
  policy: QualificationPolicy;
  /** Direct close permitted (checkoutGate result), for CTA_CHECKOUT / CTA_SIGNUP. */
  checkoutAllowed: boolean;
  /** A booking already scheduled (rule 4 excludes). */
  bookingScheduled: boolean;
  dealValueGbp: number | null;
};

/* ======================================================== interpretation */

export const ANSWER_COMPLETENESS = ["FULL", "PARTIAL", "NONE", "DEFLECTED"] as const;
export type AnswerCompleteness = (typeof ANSWER_COMPLETENESS)[number];

/** What the lead asked us to do in this reply, if anything. */
export const REQUESTED_ACTIONS = ["BOOK", "CALLBACK", "PRICE", "BUY", "SIGNUP", "HUMAN", "STOP", "LATER", "INFO"] as const;
export type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

/** One interpreted fact: a write minus the columns the service fills. */
const interpretedFactSchema = z
  .object({
    dimension: factDimensionSchema,
    value: z.string().min(1).max(FACT_VALUE_MAX),
    value_normalised: z.string().min(1).max(FACT_VALUE_NORMALISED_MAX).nullable(),
    state: z.enum(["CONFIRMED", "INFERRED"]),
    source: z.enum(["ANSWER", "REPLY", "AI_ASSIST"]),
    confidence: unit,
    question_id: z.uuid().nullable(),
    question_intent_key: questionIntentKeySchema.nullable(),
    /** AI_ASSIST only: must be a verbatim substring of the reply (§B.11 / D4). */
    evidence_span: z.string().max(SIGNAL_EXCERPT_MAX).nullable(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.source === "AI_ASSIST" && (f.state !== "INFERRED" || !f.evidence_span || f.confidence < AI_EXTRACTION_MIN_CONFIDENCE)) {
      ctx.addIssue({ code: "custom", message: "an AI_ASSIST fact is INFERRED, carries a verbatim evidence_span, and has confidence >= 0.85" });
    }
  });

const interpretedSignalSchema = z
  .object({
    signal_type: z.enum(SIGNAL_TYPES),
    strength: unit,
    confidence: unit,
    reason: z.string().min(1).max(SIGNAL_REASON_MAX),
    evidence_excerpt: z.string().max(SIGNAL_EXCERPT_MAX).nullable(),
    resume_at: isoDateTime.nullable(),
    /** TIMEFRAME: the stated date, ISO. */
    stated_date: z.iso.date().nullable(),
  })
  .strict();

/**
 * `interpret(reply, state)` output (§B.11), snake_case because it is written
 * back after every inbound reply: facts -> lead_qualification_facts, signals ->
 * lead_intent_signals (both with source_ref = the inbound message id), and the
 * whole object to conversation_agent_runs.decision_json.qi.interpretation.
 */
export const interpretationSchema = z
  .object({
    message_id: z.uuid(),
    answered_question_id: z.uuid().nullable(),
    answered_intent_key: questionIntentKeySchema.nullable(),
    completeness: z.enum(ANSWER_COMPLETENESS),
    facts: z.array(interpretedFactSchema).max(26),
    signals: z.array(interpretedSignalSchema).max(20),
    /** sales-library ObjectionKey values matched deterministically. */
    objections: z.array(z.string().regex(/^[A-Z][A-Z_]{1,39}$/)).max(10),
    lead_asked_question: z.boolean(),
    requested_action: z.enum(REQUESTED_ACTIONS).nullable(),
    /** Signed change in intent score this reply caused, -100..100 (after reassessment). */
    intent_delta: z.number().int().min(-100).max(100),
    /** The reply means we should close now rather than ask more. */
    close_instead: z.boolean(),
    /** Whether the AI assist ran (and so cost tokens) for this interpretation. */
    ai_assist_used: z.boolean(),
    version: z.string().min(1).max(40),
  })
  .strict();
export type Interpretation = z.infer<typeof interpretationSchema>;

/* ============================================================ assessment */

/**
 * The record_lead_assessment(p_business_id, p_lead_id, p_assessment) payload
 * (0134). One assessment = intent + completeness + dimension status + NBA.
 */
export const leadAssessmentWriteSchema = z
  .object({
    intent_state: z.enum(INTENT_STATES),
    intent_score: z.number().int().min(0).max(100),
    intent_categories: intentCategoryScoresSchema,
    intent_evidence: z.array(intentEvidenceItemSchema).max(40),
    intent_contradictions: z.array(intentEvidenceItemSchema).max(20),
    intent_confidence: unit,
    valid_until: isoDateTime.nullable(),
    goal: z.enum(GOAL_KEYS),
    qualification_completeness: unit,
    dimension_status: z.array(dimensionStatusEntrySchema).max(30),
    nba: nextBestActionSchema,
    engine_version: z.literal(QIE_ENGINE_VERSION),
    engine_mode: z.enum(ASSESSMENT_ENGINE_MODES),
    /** SHADOW: what the legacy selector chose (next question id / mode), for the diff. */
    legacy_decision: z
      .object({
        next_question_id: z.uuid().nullable(),
        agent_mode: z.string().max(40).nullable(),
        differs: z.boolean(),
        note: z.string().max(300).nullable(),
      })
      .strict()
      .nullable(),
    trigger_event: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.nba.intent_state !== a.intent_state || a.nba.intent_score !== a.intent_score || a.nba.current_goal !== a.goal) {
      ctx.addIssue({ code: "custom", path: ["nba"], message: "the NBA must agree with the assessment it is stored on" });
    }
    if (a.engine_mode === "LIVE" && a.legacy_decision !== null) {
      ctx.addIssue({ code: "custom", path: ["legacy_decision"], message: "legacy_decision is recorded in SHADOW only" });
    }
  });
export type LeadAssessmentWrite = z.infer<typeof leadAssessmentWriteSchema>;

/** The current assessment as the UI, Copilot and orchestrator read it. */
export type LeadAssessment = {
  id: string;
  leadId: string;
  intent: IntentAssessment;
  goal: GoalKey;
  completeness: number;
  dimensions: DimensionStatusEntry[];
  nba: NextBestAction;
  engineVersion: string;
  engineMode: AssessmentEngineMode;
  triggerEvent: string;
  createdAt: string;
};

/* ============================================================== QA / grade */

/** Pre-send question checks (§B.13). Existing codes are reused, not renamed. */
export const QA_CODES = [
  "QA_UNPLANNED_QUESTION",
  "QA_ASKS_KNOWN",
  "QA_OFF_PROFILE",
  "QA_FORBIDDEN_INTENT",
  "QA_PREMATURE",
  "QA_INTRUSIVE",
  "QA_GENERIC",
  "STYLE_MULTIPLE_QUESTIONS",
  "QA_FORM_LIKE",
  "TOO_LONG",
  "QA_CHANNEL",
  "QA_IGNORES_LEAD",
  "QA_QUESTION_FIRST",
  "QA_SHOULD_CLOSE",
  "QA_REPEAT",
] as const;
export type QaCode = (typeof QA_CODES)[number];

export type QaFinding = {
  code: QaCode;
  /** 1..13, the §B.13 check number. */
  check: number;
  severity: "REJECT" | "WARN";
  detail: string;
};

/** The /100 question grader weights (§C.4). Sum 100 (tested). */
export const QUESTION_GRADE_CRITERIA = {
  necessity: 15,
  notKnown: 15,
  stageFit: 10,
  intentFit: 10,
  friction: 10,
  channelNaturalness: 10,
  responsiveness: 10,
  specificity: 8,
  singleFocus: 7,
  progression: 5,
} as const;
export type QuestionGradeCriterion = keyof typeof QUESTION_GRADE_CRITERIA;

/** Any one of these grades the question 0. */
export const QUESTION_GRADE_CRITICAL_FAILURES = [
  "ASKS_KNOWN_DIMENSION",
  "ASKS_FORBIDDEN_INTENT",
  "MULTIPLE_QUESTIONS",
  "QUALIFIES_WHEN_BOOKING_READY",
  "PURSUES_NEGATIVE_OR_DISQUALIFIED",
] as const;
export type QuestionGradeCriticalFailure = (typeof QUESTION_GRADE_CRITICAL_FAILURES)[number];
export const QUESTION_GRADE_PASS = 80;

export type QuestionGrade = {
  total: number;
  criteria: Record<QuestionGradeCriterion, number>;
  criticalFailures: QuestionGradeCriticalFailure[];
  version: typeof QA_VERSION;
};

/* ========================================= turn accounting / orchestrator */

/**
 * Per-turn record written to conversation_agent_runs.decision_json.qi by the
 * orchestrator (§B.16). Tokens and cost come from the run's own columns
 * (input_tokens, output_tokens, estimated_cost_usd); this records what the
 * engine decided and whether the model call was avoided, so the read model can
 * report tokens per action and calls avoided.
 */
export const turnAccountingSchema = z
  .object({
    engine_mode: z.enum(QI_ENGINE_MODES),
    nba_action: z.enum(NBA_ACTIONS),
    nba_rule: z.enum(NBA_RULES),
    question_intent: questionIntentKeySchema.nullable(),
    /** The model composed the message. */
    model_called: z.boolean(),
    /** The NBA made a model call unnecessary and it was skipped. */
    model_call_avoided: z.boolean(),
    /** SHADOW: the agent acted on the legacy path; true when it differed from the NBA. */
    shadow_differs: z.boolean().nullable(),
    /** Tokens of the rendered NBA strategy block (budget: <= 150). */
    strategy_block_tokens: z.number().int().min(0).max(2000),
    /** Tokens spent by the AI assist inside interpret() this turn (answer_extraction). */
    interpretation_tokens: z.number().int().min(0),
    qa_findings: z.array(z.enum(QA_CODES)).max(15),
    /** 0..100 grade of the question sent, when one was sent. */
    question_grade: z.number().min(0).max(100).nullable(),
    engine_version: z.literal(QIE_ENGINE_VERSION),
  })
  .strict();
export type TurnAccounting = z.infer<typeof turnAccountingSchema>;

/** The NBA strategy block's token budget (§B.16). */
export const NBA_STRATEGY_BLOCK_MAX_TOKENS = 150;

/**
 * decision_json.qi on conversation_agent_runs: the NBA the turn ran against,
 * the interpretation of the inbound reply that triggered it (if any), and the
 * accounting. One key, so older runs without it read as "engine off".
 */
export const agentRunQiSchema = z
  .object({
    nba: nextBestActionSchema,
    interpretation: interpretationSchema.nullable(),
    accounting: turnAccountingSchema,
  })
  .strict();
export type AgentRunQi = z.infer<typeof agentRunQiSchema>;

/**
 * MessageFeatures v2 additions (learning/features.ts), written on every
 * outbound that the engine planned. Outcomes are joined at read time.
 */
export type QuestionMessageFeatures = {
  questionIntent: string | null;
  dimension: FactDimension | null;
  wordingFamily: string | null;
  /** 1-based position of this question in the conversation. */
  questionPosition: number | null;
  intentState: IntentState | null;
  goal: GoalKey | null;
  offerId: string | null;
  nbaAction: NbaAction | null;
  strategyVersion: typeof QIE_ENGINE_VERSION | null;
};

/* ========================================================== events / jobs */

/** New domain event types (the domain_events CHECK is a pattern; code-only). */
export const QI_DOMAIN_EVENTS = {
  /** Public, webhook-forwarded; emitted only when the state changes. Not in RESCORE_ON. */
  INTENT_CHANGED: "lead.intent_changed",
  /** Internal: from opportunities/service.ts; added to RESCORE_ON. */
  OPPORTUNITY_STAGE_CHANGED: "opportunity.stage_changed",
  /** Internal: a stored TIMEFRAME / NOT_NOW boundary was reached. */
  INTENT_DECAY_DUE: "intent.decay_due",
} as const;

/** New job types. */
export const QI_JOBS = {
  /** Cron every 6 h, batch-limited: re-assess leads whose valid_until has passed. */
  SWEEP: "intent.sweep",
} as const;

export const INTENT_SWEEP_BATCH_LIMIT = 200;

/** experiments.kind added by 0134. target_id = services.id, or the business id for workspace-wide. */
export const QUESTION_STRATEGY_EXPERIMENT_KIND = "QUESTION_STRATEGY" as const;

/* ============================================================ handover */

/** Handover reasons the NBA may use (a subset of the existing list; none added). */
export const NBA_HANDOVER_REASONS = [
  "QUALIFICATION_REVIEW",
  "LOW_CONFIDENCE",
  "HIGH_VALUE",
  "NO_NEXT_QUESTION",
  "READY_TO_BUY",
  "POLICY",
  "HUMAN_REQUESTED",
  "COMPLAINT",
] as const satisfies readonly HandoverReason[];
