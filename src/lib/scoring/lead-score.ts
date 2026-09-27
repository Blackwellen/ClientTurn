/**
 * Lead scoring v2 (design doc 04 §2, brief §§16–19).
 *
 * Generalises `prospects/scoring.ts` from sourced prospects to every lead. The
 * same division of labour holds:
 *   * something else (the service layer, the classifier, a person) establishes
 *     FACTS: "a booking exists", "the role is a decision-maker", "the timeline
 *     is 30 days", each with a source and a confidence;
 *   * this module does the ARITHMETIC. Pure, deterministic and versioned, so the
 *     same facts always produce the same score, grade and sentence.
 *
 * Seven dimensions, weighted by the workspace's archetype × motion profile
 * (sales-library/motions.ts combineWeights) with optional workspace overrides.
 * With no archetype the shape is QUALIFICATION_DEFAULT (design 08 §B.14):
 * need 20, offer fit 20, intent 20, timing 15, commercial 10, decision access
 * 10, engagement 5. Archetype profiles keep their own shapes.
 *
 * ## ls-v2 (design 08 §B.14): one score, not two
 *
 *   * INTENT reads the intent engine's assessment (`intent_assessment`,
 *     intent score / 100) when there is one, instead of a MAX over booleans;
 *     the booleans stay allow-listed and are listed as evidence.
 *   * Every dimension reports a `status` taken from the facts, not the
 *     points: KNOWN_POSITIVE / KNOWN_NEGATIVE / UNKNOWN / CONFLICTING.
 *     UNKNOWN earns 0 points but is labelled unknown, lowers confidence and
 *     never triggers a veto; only a KNOWN_NEGATIVE fact caps.
 *   * Completeness (the share of the plan's required dimensions known, from
 *     the fact store) is carried on the result.
 *   * FIT and INTENT are disjoint: no FIT feature is an INTENT feature, and
 *     the intent engine reads only intent signals (tested).
 *
 * ## The feature allow-list (brief §87)
 *
 * Only features named in FEATURE_ALLOW_LIST are scored. Anything else is
 * rejected and reported back. Features that look like protected or
 * special-category data (age, sex, race, religion, health, sexuality, politics,
 * disability, …) are rejected with a distinct reason, so a caller that tried to
 * pass one finds out rather than having it silently vanish. Nothing here needs
 * raw personal data at all: names, emails and phone numbers are not features.
 *
 * ## Unknown is not zero-risk, it is zero-evidence
 *
 * A dimension with no facts scores nothing and is listed as missing. Weights are
 * never renormalised around the gaps: a lead known on two dimensions out of
 * seven must not grade A. The missing list is what the adaptive qualifier asks
 * about next, which is how a low-confidence score improves itself.
 *
 * Inside FIT the rule is per signal, not per dimension: FIT averages the
 * signals that have evidence, and an absent signal lowers FIT's confidence
 * and is listed as missing instead of counting as a zero.
 *
 * No `server-only`, no Supabase: persistence lives in scoring/service.ts.
 */

import { archetypeFor, SCORING_PROFILES } from "../sales-library/archetypes.ts";
import { combineWeights } from "../sales-library/motions.ts";
import {
  DEAL_SIZE_RANGES_GBP,
  LIBRARY_VERSION,
  SCORE_DIMENSIONS,
  type DealSizeBand,
  type DimensionWeights,
  type FitSignal,
  type SalesMotion,
  type ScoreDimension,
} from "../sales-library/types.ts";

/** Bump when a normaliser, a veto, a band or the combination rule changes. */
export const SCORING_VERSION = "ls-v2.2026.09";

/* ------------------------------------------------------------ features */

type FeatureKind = "boolean" | "unit" | "number" | "enum";

type FeatureSpec = {
  dimension: ScoreDimension;
  kind: FeatureKind;
  label: string;
  /** For enums: the accepted values. */
  values?: readonly string[];
};

const FIT_FEATURES: Record<FitSignal, FeatureSpec> = {
  industry_match: { dimension: "FIT", kind: "unit", label: "industry fit" },
  company_size_match: { dimension: "FIT", kind: "unit", label: "company size" },
  geography_match: { dimension: "FIT", kind: "unit", label: "location" },
  service_match: { dimension: "FIT", kind: "unit", label: "service match" },
  incorporated: { dimension: "FIT", kind: "boolean", label: "incorporated company" },
  tech_stack_match: { dimension: "FIT", kind: "unit", label: "technology fit" },
  property_type_match: { dimension: "FIT", kind: "unit", label: "property type" },
  revenue_band_match: { dimension: "FIT", kind: "unit", label: "revenue band" },
  growth_signal: { dimension: "FIT", kind: "unit", label: "growth signal" },
  website_present: { dimension: "FIT", kind: "boolean", label: "website" },
};

export const ROLE_AUTHORITY_VALUES = [
  "DECISION_MAKER",
  "INFLUENCER",
  "USER",
  "GATEKEEPER",
  "UNKNOWN",
] as const;

export const QUALIFICATION_STATE_VALUES = ["PENDING", "QUALIFIED", "REVIEW", "NOT_QUALIFIED"] as const;

/**
 * The complete set of things a score may depend on. Adding a feature is a
 * deliberate, reviewed change here, never a new key arriving in a payload.
 */
export const FEATURE_ALLOW_LIST = {
  ...FIT_FEATURES,
  // INTENT
  inbound_enquiry: { dimension: "INTENT", kind: "boolean", label: "enquired themselves" },
  positive_reply: { dimension: "INTENT", kind: "boolean", label: "positive reply" },
  booking_intent: { dimension: "INTENT", kind: "boolean", label: "asked to book" },
  pricing_requested: { dimension: "INTENT", kind: "boolean", label: "asked about pricing" },
  intent_signal_strength: { dimension: "INTENT", kind: "unit", label: "buying-intent signal" },
  // The intent engine's score / 100 (qualification-intelligence/intent.ts).
  // When present it IS the INTENT dimension; the booleans become evidence.
  intent_assessment: { dimension: "INTENT", kind: "unit", label: "intent assessment" },
  not_interested: { dimension: "INTENT", kind: "boolean", label: "said not interested" },
  // NEED
  need_stated: { dimension: "NEED", kind: "boolean", label: "stated need" },
  qualification_state: {
    dimension: "NEED",
    kind: "enum",
    label: "qualification result",
    values: QUALIFICATION_STATE_VALUES,
  },
  answers_met_ratio: { dimension: "NEED", kind: "unit", label: "qualification answers met" },
  // COMMERCIAL
  estimated_value_gbp: { dimension: "COMMERCIAL", kind: "number", label: "estimated value" },
  budget_confirmed: { dimension: "COMMERCIAL", kind: "boolean", label: "budget" },
  // DECISION_ACCESS
  role_authority: {
    dimension: "DECISION_ACCESS",
    kind: "enum",
    label: "role authority",
    values: ROLE_AUTHORITY_VALUES,
  },
  authority_confirmed: { dimension: "DECISION_ACCESS", kind: "boolean", label: "decision authority" },
  stakeholder_count: { dimension: "DECISION_ACCESS", kind: "number", label: "stakeholders known" },
  // TIMING
  timeline_days: { dimension: "TIMING", kind: "number", label: "timeline" },
  urgent: { dimension: "TIMING", kind: "boolean", label: "urgency" },
  not_now: { dimension: "TIMING", kind: "boolean", label: "asked to wait" },
  booking_scheduled: { dimension: "TIMING", kind: "boolean", label: "booking scheduled" },
  // ENGAGEMENT
  replied: { dimension: "ENGAGEMENT", kind: "boolean", label: "replied" },
  inbound_message_count: { dimension: "ENGAGEMENT", kind: "number", label: "messages from them" },
  days_since_last_inbound: { dimension: "ENGAGEMENT", kind: "number", label: "recency of last reply" },
  booking_made: { dimension: "ENGAGEMENT", kind: "boolean", label: "booked" },
  no_show: { dimension: "ENGAGEMENT", kind: "boolean", label: "missed a booking" },
  opted_out: { dimension: "ENGAGEMENT", kind: "boolean", label: "opted out" },
} as const satisfies Record<string, FeatureSpec>;

export type FeatureKey = keyof typeof FEATURE_ALLOW_LIST;

/** The features FIT may read (and only these). */
export const FIT_FEATURE_KEYS = Object.keys(FIT_FEATURES) as FitSignal[];

/** The features INTENT may read. Disjoint from FIT_FEATURE_KEYS (tested). */
export const INTENT_FEATURE_KEYS = (Object.keys(FEATURE_ALLOW_LIST) as FeatureKey[]).filter(
  (key) => FEATURE_ALLOW_LIST[key].dimension === "INTENT",
);

/**
 * The brief's §13 shape (design 08 §B.14), used when the workspace has no
 * archetype. FIT is "offer fit". Sums to 100.
 */
export const QUALIFICATION_DEFAULT_PROFILE: { key: string; weights: DimensionWeights; fitSignals: FitSignal[] } = {
  key: "QUALIFICATION_DEFAULT",
  weights: { FIT: 20, INTENT: 20, NEED: 20, COMMERCIAL: 10, DECISION_ACCESS: 10, TIMING: 15, ENGAGEMENT: 5 },
  fitSignals: [...SCORING_PROFILES.DEFAULT_B2B.fitSignals],
};

/** Per-dimension status, from facts rather than points (§B.14). */
export const DIMENSION_SCORE_STATUSES = ["KNOWN_POSITIVE", "KNOWN_NEGATIVE", "UNKNOWN", "CONFLICTING"] as const;
export type DimensionScoreStatus = (typeof DIMENSION_SCORE_STATUSES)[number];

/**
 * Protected characteristics (Equality Act 2010) and UK GDPR Art. 9/10 special
 * categories, plus common proxies. Matched against the *feature key*, so a
 * caller cannot smuggle one in under a new name like `customer_age_band`.
 */
export const PROTECTED_FEATURE_PATTERN =
  /(^|_)(age|dob|birth|born|gender|sex|sexual|orientation|lgbt|trans|pregnan|maternity|marital|married|civil_partner|race|racial|ethnic|ethnicity|colour|color|nationality|national_origin|religio|faith|belief|health|medical|disab|illness|diagnos|politic|party|union|trade_union|genetic|biometric|criminal|conviction)/i;

export type LeadFact = {
  feature: string;
  value: unknown;
  /** Where the fact came from: "lead", "booking", "reply_classification", … */
  source: string;
  observedAt?: string | null;
  /** 0..1. Defaults to 1 (a stored fact, e.g. a booking row). */
  confidence?: number;
};

export type RejectedFact = {
  feature: string;
  reason: "PROTECTED_CHARACTERISTIC" | "NOT_ALLOW_LISTED" | "INVALID_VALUE";
};

export type EvidenceItem = {
  feature: FeatureKey;
  label: string;
  value: string | number | boolean;
  source: string;
  observedAt: string | null;
  confidence: number;
};

export type DimensionResult = {
  dimension: ScoreDimension;
  /** Points earned, 0..max. */
  score: number;
  /** The dimension's weight. */
  max: number;
  evidence: EvidenceItem[];
  missing: FeatureKey[];
  confidence: number;
  /** From the facts, not the points. UNKNOWN is not KNOWN_NEGATIVE. */
  status: DimensionScoreStatus;
};

export type LeadGrade = "A" | "B" | "C" | "D";

export type LeadScoreInput = {
  facts: LeadFact[];
  archetypeKey?: string | null;
  motion?: SalesMotion | null;
  /** From workspace_sales_overrides (kind SCORING_WEIGHTS); replaces named dimensions. */
  weightOverrides?: Partial<DimensionWeights> | null;
  /**
   * Score dimensions a CONFLICTING qualification fact sits in (fact store,
   * qualification-intelligence/facts.ts). Reported as CONFLICTING; the
   * service does not pass the conflicting value as a fact.
   */
  conflictingDimensions?: ScoreDimension[] | null;
  /** Qualification completeness 0..1 from the fact store, carried through. */
  completeness?: number | null;
};

export type LeadScoreResult = {
  total: number;
  grade: LeadGrade;
  dimensions: DimensionResult[];
  missing: { dimension: ScoreDimension; feature: FeatureKey }[];
  confidence: number;
  why: string;
  weights: DimensionWeights;
  archetypeKey: string | null;
  motion: SalesMotion | null;
  rejected: RejectedFact[];
  scoringVersion: string;
  libraryVersion: string;
  /** The profile the weights came from (an archetype profile or QUALIFICATION_DEFAULT). */
  profileKey: string;
  /** Qualification completeness 0..1, or null when the fact store was not consulted. */
  completeness: number | null;
};

/* ------------------------------------------------------------ validation */

type CleanFact = {
  feature: FeatureKey;
  value: string | number | boolean;
  source: string;
  observedAt: string | null;
  confidence: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isAllowListed(feature: string): feature is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_ALLOW_LIST, feature);
}

/**
 * Splits facts into the scoreable and the rejected. The protected check runs
 * first, so a protected-looking key is reported as such even if someone later
 * adds it to the allow-list by mistake (the test suite also guards that).
 */
export function screenFacts(facts: LeadFact[]): { clean: CleanFact[]; rejected: RejectedFact[] } {
  const clean: CleanFact[] = [];
  const rejected: RejectedFact[] = [];

  for (const fact of facts) {
    const feature = String(fact.feature ?? "");
    if (PROTECTED_FEATURE_PATTERN.test(feature)) {
      rejected.push({ feature, reason: "PROTECTED_CHARACTERISTIC" });
      continue;
    }
    if (!isAllowListed(feature)) {
      rejected.push({ feature, reason: "NOT_ALLOW_LISTED" });
      continue;
    }
    const spec: FeatureSpec = FEATURE_ALLOW_LIST[feature];
    const value = fact.value;
    let ok = false;
    if (spec.kind === "boolean") ok = typeof value === "boolean";
    else if (spec.kind === "unit" || spec.kind === "number")
      ok = typeof value === "number" && Number.isFinite(value);
    else if (spec.kind === "enum") ok = typeof value === "string" && (spec.values ?? []).includes(value);

    if (!ok) {
      rejected.push({ feature, reason: "INVALID_VALUE" });
      continue;
    }
    clean.push({
      feature,
      value: spec.kind === "unit" ? clamp01(value as number) : (value as string | number | boolean),
      source: String(fact.source ?? "unknown").slice(0, 80),
      observedAt: fact.observedAt ?? null,
      confidence: fact.confidence === undefined ? 1 : clamp01(fact.confidence),
    });
  }

  return { clean, rejected };
}

/* ------------------------------------------------------------ normalisers */

/** How strongly one fact supports its dimension, 0..1, before confidence. */
function strength(fact: CleanFact, dealBand: DealSizeBand | null): number | null {
  const v = fact.value;
  switch (fact.feature) {
    case "role_authority":
      return (
        { DECISION_MAKER: 1, INFLUENCER: 0.6, USER: 0.4, GATEKEEPER: 0.2, UNKNOWN: null } as Record<
          string,
          number | null
        >
      )[v as string];
    case "qualification_state":
      return ({ QUALIFIED: 1, REVIEW: 0.5, NOT_QUALIFIED: 0, PENDING: null } as Record<string, number | null>)[
        v as string
      ];
    case "estimated_value_gbp": {
      const amount = v as number;
      if (amount <= 0) return null;
      if (!dealBand) return 0.5;
      const floor = DEAL_SIZE_RANGES_GBP[dealBand].min;
      // At or above the archetype's typical band is full value; below it scales
      // down, but a small real deal is never worth nothing.
      return floor <= 0 ? 1 : Math.max(0.3, Math.min(1, amount / floor));
    }
    case "stakeholder_count": {
      const n = v as number;
      if (n <= 0) return null;
      return n >= 2 ? 0.7 : 0.5;
    }
    case "timeline_days": {
      const days = v as number;
      if (days < 0) return null;
      if (days <= 14) return 1;
      if (days <= 30) return 0.9;
      if (days <= 90) return 0.7;
      if (days <= 180) return 0.4;
      return 0.2;
    }
    case "inbound_message_count": {
      const n = v as number;
      if (n <= 0) return 0;
      if (n === 1) return 0.5;
      if (n === 2) return 0.7;
      return 0.9;
    }
    case "days_since_last_inbound": {
      const days = v as number;
      if (days < 0) return null;
      if (days <= 2) return 1;
      if (days <= 7) return 0.7;
      if (days <= 30) return 0.4;
      return 0.1;
    }
    case "inbound_enquiry":
      return v ? 0.7 : 0;
    case "positive_reply":
      return v ? 0.8 : 0;
    case "pricing_requested":
      return v ? 0.75 : 0;
    case "replied":
      return v ? 0.6 : 0;
    // Negative facts are vetoes, handled separately; they add no positive strength.
    case "not_interested":
    case "not_now":
    case "no_show":
    case "opted_out":
      return null;
    default: {
      // Generic booleans and units.
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "number") return clamp01(v);
      return null;
    }
  }
}

/**
 * Negative facts cap dimensions rather than subtract, so one refusal cannot be
 * outweighed by an old positive signal, and so the explanation can name it.
 */
const VETOES: { feature: FeatureKey; caps: Partial<Record<ScoreDimension, number>> }[] = [
  { feature: "opted_out", caps: { INTENT: 0, ENGAGEMENT: 0, TIMING: 0 } },
  { feature: "not_interested", caps: { INTENT: 0, TIMING: 0.1 } },
  { feature: "not_now", caps: { TIMING: 0.2 } },
  { feature: "no_show", caps: { ENGAGEMENT: 0.3 } },
];

/** Qualification rules failing caps NEED: they were asked and did not meet it. */
const NOT_QUALIFIED_NEED_CAP = 0.2;

type DimensionRule = {
  /** MEAN averages the expected features that have evidence (FIT only);
   *  missing ones lower confidence and are listed, not scored as 0.
   *  MAX takes the strongest present evidence. */
  combine: "MEAN" | "MAX";
  expected: FeatureKey[];
  /** EACH: every absent expected feature is reported missing.
   *  IF_EMPTY: reported only when the dimension has no evidence at all. */
  missingMode: "EACH" | "IF_EMPTY";
};

function rulesFor(fitSignals: FitSignal[]): Record<ScoreDimension, DimensionRule> {
  return {
    FIT: { combine: "MEAN", expected: fitSignals, missingMode: "EACH" },
    INTENT: {
      combine: "MAX",
      expected: ["inbound_enquiry", "positive_reply", "booking_intent", "intent_signal_strength"],
      missingMode: "IF_EMPTY",
    },
    NEED: { combine: "MAX", expected: ["need_stated", "qualification_state"], missingMode: "EACH" },
    COMMERCIAL: { combine: "MAX", expected: ["estimated_value_gbp", "budget_confirmed"], missingMode: "EACH" },
    DECISION_ACCESS: { combine: "MAX", expected: ["role_authority", "authority_confirmed"], missingMode: "EACH" },
    TIMING: { combine: "MAX", expected: ["timeline_days", "urgent", "booking_scheduled"], missingMode: "IF_EMPTY" },
    ENGAGEMENT: {
      combine: "MAX",
      expected: ["replied", "inbound_message_count", "days_since_last_inbound"],
      missingMode: "IF_EMPTY",
    },
  };
}

/* ------------------------------------------------------------ the engine */

/** Lead grade bands. Deliberately wider than the prospect bands (A+ ≥ 95):
 *  those gate outreach *spend* on sourced records; these rank live leads, most
 *  of which arrive with several dimensions still unknown. */
export function gradeForLeadScore(total: number): LeadGrade {
  if (total >= 80) return "A";
  if (total >= 60) return "B";
  if (total >= 40) return "C";
  return "D";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Strongest fact per feature (value × confidence), as in prospects/scoring.ts. */
function strongestPerFeature(facts: CleanFact[], band: DealSizeBand | null): Map<FeatureKey, CleanFact> {
  const out = new Map<FeatureKey, CleanFact>();
  for (const fact of facts) {
    const current = out.get(fact.feature);
    if (!current) {
      out.set(fact.feature, fact);
      continue;
    }
    const a = (strength(fact, band) ?? (fact.value === true ? 1 : 0)) * fact.confidence;
    const b = (strength(current, band) ?? (current.value === true ? 1 : 0)) * current.confidence;
    // Ties go to the later-observed fact (a newer reading wins), then to a
    // fixed order on source and value, so input order never changes the result.
    if (a !== b ? a > b : tieKey(fact) > tieKey(current)) {
      out.set(fact.feature, fact);
    }
  }
  return out;
}

function tieKey(fact: CleanFact): string {
  return `${fact.observedAt ?? ""}\u0000${fact.source}\u0000${String(fact.value)}\u0000${fact.confidence}`;
}

const FEATURE_ORDER = new Map(Object.keys(FEATURE_ALLOW_LIST).map((key, index) => [key, index]));

function byFeatureOrder(a: CleanFact, b: CleanFact): number {
  return (FEATURE_ORDER.get(a.feature) ?? 0) - (FEATURE_ORDER.get(b.feature) ?? 0);
}

function evidenceFor(fact: CleanFact): EvidenceItem {
  return {
    feature: fact.feature,
    label: FEATURE_ALLOW_LIST[fact.feature].label,
    value: fact.value,
    source: fact.source,
    observedAt: fact.observedAt,
    confidence: fact.confidence,
  };
}

export function scoreLead(input: LeadScoreInput): LeadScoreResult {
  const archetype = archetypeFor(input.archetypeKey ?? null);
  const profile = archetype?.scoringProfile ?? QUALIFICATION_DEFAULT_PROFILE;
  const band = archetype?.dealSizeBand ?? null;
  const motion = input.motion ?? archetype?.defaultMotions[0] ?? null;
  const weights = combineWeights(profile.weights, motion, input.weightOverrides ?? null);

  const { clean, rejected } = screenFacts(input.facts);
  const byFeature = strongestPerFeature(clean, band);
  const rules = rulesFor(profile.fitSignals);

  const dimensions: DimensionResult[] = SCORE_DIMENSIONS.map((dimension) => {
    const rule = rules[dimension];
    const max = weights[dimension];

    // Every present fact that belongs to this dimension (plus FIT signals the
    // profile lists), whether or not it is "expected".
    const present = [...byFeature.values()]
      .filter((fact) =>
        dimension === "FIT"
          ? rule.expected.includes(fact.feature)
          : FEATURE_ALLOW_LIST[fact.feature].dimension === dimension,
      )
      .sort(byFeatureOrder);

    let value = 0;
    let confidence = 0;

    if (rule.combine === "MEAN") {
      const expected = rule.expected.length || 1;
      let sum = 0;
      let confSum = 0;
      for (const fact of present) {
        sum += (strength(fact, band) ?? 0) * fact.confidence;
        confSum += fact.confidence;
      }
      // Averaged over the signals that HAVE evidence: a lead that simply lacks
      // enrichment is not a poor fit. What is missing lowers the confidence
      // (below) and is listed in `missing`, never scored as zero.
      value = present.length === 0 ? 0 : sum / present.length;
      // Coverage × average certainty: half the signals known at full certainty
      // is a 0.5-confidence fit score.
      confidence = present.length === 0 ? 0 : (present.length / expected) * (confSum / present.length);
    } else if (dimension === "INTENT" && byFeature.has("intent_assessment")) {
      // The intent engine already weighed strength, confidence, decay and
      // contradictions: its score is the dimension, and its confidence the
      // dimension's. The booleans stay listed as evidence.
      const assessment = byFeature.get("intent_assessment")!;
      value = clamp01(assessment.value as number);
      confidence = assessment.confidence;
    } else {
      let best = 0;
      let bestConfidence = 0;
      for (const fact of present) {
        const s = strength(fact, band);
        if (s === null) continue;
        const weighted = s * fact.confidence;
        if (weighted > best || (weighted === best && fact.confidence > bestConfidence)) {
          best = weighted;
          bestConfidence = fact.confidence;
        }
      }
      value = best;
      confidence = bestConfidence;
    }

    // Vetoes. Only a known negative fact caps; an unknown never does.
    let vetoed = false;
    for (const veto of VETOES) {
      const fact = byFeature.get(veto.feature);
      const cap = veto.caps[dimension];
      if (fact && fact.value === true && cap !== undefined) {
        vetoed = true;
        value = Math.min(value, cap);
        // A veto is itself strong evidence about the dimension.
        confidence = Math.max(confidence, fact.confidence);
        if (!present.includes(fact)) present.push(fact);
      }
    }
    if (dimension === "NEED" && byFeature.get("qualification_state")?.value === "NOT_QUALIFIED") {
      vetoed = true;
      value = Math.min(value, NOT_QUALIFIED_NEED_CAP);
    }

    const scoredPresent = present.filter((fact) => strength(fact, band) !== null || fact.value === true);
    const missing: FeatureKey[] =
      rule.missingMode === "EACH"
        ? rule.expected.filter((feature) => !byFeature.has(feature))
        : scoredPresent.length === 0
          ? [...rule.expected]
          : [];

    return {
      dimension,
      score: round2(max * clamp01(value)),
      max,
      evidence: present.map(evidenceFor),
      missing,
      confidence: round3(clamp01(confidence)),
      status: dimensionStatus({
        dimension,
        value,
        vetoed,
        present,
        conflicting: (input.conflictingDimensions ?? []).includes(dimension),
        band,
      }),
    };
  });

  const total = round2(Math.min(100, Math.max(0, dimensions.reduce((sum, d) => sum + d.score, 0))));
  const grade = gradeForLeadScore(total);
  const confidence = round3(dimensions.reduce((sum, d) => sum + d.confidence * d.max, 0) / 100);
  const missing = dimensions.flatMap((d) => d.missing.map((feature) => ({ dimension: d.dimension, feature })));

  return {
    total,
    grade,
    dimensions,
    missing,
    confidence,
    why: explain(dimensions, total, grade, byFeature),
    weights,
    archetypeKey: archetype?.key ?? null,
    motion,
    rejected: [...rejected].sort((a, b) => a.feature.localeCompare(b.feature) || a.reason.localeCompare(b.reason)),
    scoringVersion: SCORING_VERSION,
    libraryVersion: LIBRARY_VERSION,
    profileKey: profile.key,
    completeness:
      input.completeness === undefined || input.completeness === null ? null : round3(clamp01(input.completeness)),
  };
}

/** A fact that says something is *not* so (as opposed to not knowing). */
function isNegativeFact(fact: CleanFact): boolean {
  switch (fact.feature) {
    case "budget_confirmed":
    case "authority_confirmed":
    case "incorporated":
      return fact.value === false;
    case "qualification_state":
      return fact.value === "NOT_QUALIFIED";
    default:
      return FEATURE_ALLOW_LIST[fact.feature].dimension === "FIT" && fact.value === 0;
  }
}

/**
 * KNOWN_POSITIVE / KNOWN_NEGATIVE / UNKNOWN / CONFLICTING, from the facts:
 *   CONFLICTING    a conflicting qualification fact sits in the dimension;
 *   KNOWN_NEGATIVE a veto applied, or the evidence is weak and includes a
 *                  fact that says "no" (budget not confirmed, out of area,
 *                  not qualified), or FIT evidence averages below 0.3;
 *   KNOWN_POSITIVE any evidence with positive strength;
 *   UNKNOWN        otherwise: no evidence, or only absent-looking facts.
 */
function dimensionStatus(input: {
  dimension: ScoreDimension;
  value: number;
  vetoed: boolean;
  present: CleanFact[];
  conflicting: boolean;
  band: DealSizeBand | null;
}): DimensionScoreStatus {
  if (input.conflicting) return "CONFLICTING";
  if (input.vetoed) return "KNOWN_NEGATIVE";
  const scored = input.present.filter((fact) => strength(fact, input.band) !== null);
  if (scored.length === 0) return "UNKNOWN";
  if (input.dimension === "FIT" && input.value < 0.3) return "KNOWN_NEGATIVE";
  if (input.value < 0.3 && scored.some(isNegativeFact)) return "KNOWN_NEGATIVE";
  return input.value > 0 ? "KNOWN_POSITIVE" : "UNKNOWN";
}

const DIMENSION_WORDS: Record<ScoreDimension, string> = {
  // "Offer fit" (§B.14): computed against the offer's target customer.
  FIT: "offer fit",
  INTENT: "intent",
  NEED: "need",
  COMMERCIAL: "deal value",
  DECISION_ACCESS: "decision access",
  TIMING: "timing",
  ENGAGEMENT: "engagement",
};

/**
 * One grounded sentence, assembled from the result itself so it can never say
 * something the evidence does not support.
 */
function explain(
  dimensions: DimensionResult[],
  total: number,
  grade: LeadGrade,
  byFeature: Map<FeatureKey, CleanFact>,
): string {
  const ratio = (d: DimensionResult) => (d.max > 0 ? d.score / d.max : 0);
  const weighted = dimensions.filter((d) => d.max > 0);
  const strong = [...weighted].filter((d) => ratio(d) >= 0.6).sort((a, b) => b.score - a.score).slice(0, 2);
  const unknown = weighted.filter((d) => d.status === "UNKNOWN").sort((a, b) => b.max - a.max).slice(0, 2);
  const conflicting = weighted.filter((d) => d.status === "CONFLICTING").slice(0, 2);

  const parts = [`Graded ${grade} (${Math.round(total)}/100).`];
  if (byFeature.get("opted_out")?.value === true) parts.push("Opted out.");
  else if (byFeature.get("not_interested")?.value === true) parts.push("Said they are not interested.");
  if (strong.length > 0) parts.push(`Strongest: ${strong.map((d) => DIMENSION_WORDS[d.dimension]).join(" and ")}.`);
  if (unknown.length > 0) parts.push(`Unknown: ${unknown.map((d) => DIMENSION_WORDS[d.dimension]).join(" and ")}.`);
  if (conflicting.length > 0) parts.push(`Conflicting: ${conflicting.map((d) => DIMENSION_WORDS[d.dimension]).join(" and ")}.`);
  if (strong.length === 0 && unknown.length === 0 && conflicting.length === 0) parts.push("Evidence is mixed.");
  return parts.join(" ");
}

/** The value of one feature in a result's evidence, for rules that read it. */
export function evidenceValue(
  result: LeadScoreResult,
  feature: FeatureKey,
): string | number | boolean | undefined {
  for (const dimension of result.dimensions) {
    const item = dimension.evidence.find((entry) => entry.feature === feature);
    if (item) return item.value;
  }
  return undefined;
}

export function dimensionRatio(result: LeadScoreResult, dimension: ScoreDimension): number {
  const d = result.dimensions.find((entry) => entry.dimension === dimension);
  if (!d || d.max <= 0) return 0;
  return d.score / d.max;
}
