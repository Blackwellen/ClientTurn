/**
 * The Qualification Intelligence test matrix (08 §C.4, brief §22).
 *
 *   7 profiles x 8 intent levels x 5 information states x 5 roles
 *     x 9 lead behaviours x 7 goals = 88,200 cases
 *
 * Every case runs the whole pure pipeline: resolveOffer -> facts / dimension
 * statuses -> interpret(reply) -> a deterministic intent reassessment ->
 * resolveGoal -> planNextBestAction. `checkInvariants` then asserts the §C.4
 * invariants on the result.
 *
 * `allPairsCases()` is a greedy pairwise covering array (every value of every
 * parameter meets every value of every other parameter at least once), which
 * is the default run; `allCases()` is the full product (MATRIX_FULL=1).
 *
 * The intent reassessment here is deliberately simple and local (the intent
 * engine is A1's intent.ts): a booking request makes a non-negative lead
 * BOOKING_READY, "not now" makes it NOT_NOW, and NEGATIVE always wins. That
 * mirrors the §B.4 precedence without depending on a module this matrix does
 * not own.
 */

import { classifyDeterministic } from "../../src/lib/agent/classification.ts";
import { resolveGoal } from "../../src/lib/qualification-intelligence/goals.ts";
import { interpret } from "../../src/lib/qualification-intelligence/interpret.ts";
import { planNextBestAction, pursues } from "../../src/lib/qualification-intelligence/nba.ts";
import { resolveOffer, type ResolvedOffer } from "../../src/lib/qualification-intelligence/offer-profile.ts";
import {
  GOAL_KEYS,
  IE_VERSION,
  type DimensionStatusEntry,
  type FactDimension,
  type GoalKey,
  type IntentAssessment,
  type IntentState,
  type NextBestAction,
  type OfferDisqualifier,
  type QiDimensionKey,
  type QualificationFact,
} from "../../src/lib/qualification-intelligence/types.ts";
import { MEDDPICC_ONLY_DIMENSIONS, PROBLEM_DIMENSIONS } from "../../src/lib/sales-library/motions.ts";
import type { SalesMotion } from "../../src/lib/sales-library/types.ts";

export const NOW = "2026-09-26T10:00:00.000Z";
const DAY_MS = 86_400_000;

/* ---------------------------------------------------------------- params */

export type Profile = {
  key: string;
  archetypeKey: string;
  motion: SalesMotion;
  incumbentTerms: string[];
  /** The confirmed value that trips this profile's disqualifier. */
  disqualifier: OfferDisqualifier;
  disqualifyingValue: string;
};

export const PROFILES: readonly Profile[] = [
  {
    key: "roofer",
    archetypeKey: "ROOFER",
    motion: "LOCAL_SERVICE",
    incumbentTerms: ["roofer", "builder"],
    disqualifier: {
      dimension: "LOCATION",
      when: { op: "equals", dimension: "LOCATION", value: "OUTSIDE_AREA" },
      reason: "Outside the service area",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "OUTSIDE_AREA",
  },
  {
    key: "msp",
    archetypeKey: "MSP",
    motion: "BOOK_MEETING_B2B",
    incumbentTerms: ["it provider", "it support"],
    disqualifier: {
      dimension: "COMPANY_SIZE",
      when: { op: "lt", dimension: "COMPANY_SIZE", value: 2 },
      reason: "A sole trader is outside this offer",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "1",
  },
  {
    key: "b2b_saas",
    archetypeKey: "B2B_SAAS",
    motion: "SAAS_SELF_SERVE",
    incumbentTerms: ["tool", "platform"],
    disqualifier: {
      dimension: "COMPANY_SIZE",
      when: { op: "lt", dimension: "COMPANY_SIZE", value: 2 },
      reason: "A sole trader is outside this offer",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "1",
  },
  {
    key: "accounting",
    archetypeKey: "ACCOUNTING",
    motion: "BOOK_MEETING_B2B",
    incumbentTerms: ["accountant"],
    disqualifier: {
      dimension: "COMPANY_SIZE",
      when: { op: "lt", dimension: "COMPANY_SIZE", value: 2 },
      reason: "A sole trader is outside this offer",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "1",
  },
  {
    key: "ecommerce",
    archetypeKey: "ECOMMERCE",
    motion: "ECOMMERCE_DIRECT",
    incumbentTerms: ["brand", "shop"],
    disqualifier: {
      dimension: "PRODUCT_INTEREST",
      when: { op: "equals", dimension: "PRODUCT_INTEREST", value: "DISCONTINUED" },
      reason: "The product is discontinued",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "DISCONTINUED",
  },
  {
    key: "enterprise_saas",
    archetypeKey: "ENTERPRISE_SAAS",
    motion: "ENTERPRISE",
    incumbentTerms: ["vendor", "platform"],
    disqualifier: {
      dimension: "COMPANY_SIZE",
      when: { op: "lt", dimension: "COMPANY_SIZE", value: 2 },
      reason: "A sole trader is outside this offer",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "1",
  },
  {
    key: "web_studio",
    archetypeKey: "CREATIVE_WEB_STUDIO",
    motion: "DIRECT_B2B",
    incumbentTerms: ["web designer", "agency"],
    disqualifier: {
      dimension: "COMPANY_SIZE",
      when: { op: "lt", dimension: "COMPANY_SIZE", value: 2 },
      reason: "A sole trader is outside this offer",
      reviewInstead: false,
      suppress: false,
    },
    disqualifyingValue: "1",
  },
];

export const INTENT_LEVELS = ["none", "weak", "medium", "strong", "explicit", "contradictory", "stale", "negative"] as const;
export const INFORMATION = ["empty", "partial", "threshold", "conflicting", "stale"] as const;
export const ROLES = ["decision_maker", "influencer", "end_user", "unknown", "disqualified"] as const;
export const BEHAVIOURS = [
  "asks_price",
  "asks_to_book",
  "one_word",
  "deflects",
  "objection",
  "not_now",
  "off_topic",
  "asks_question",
  "silent",
] as const;

export type IntentLevel = (typeof INTENT_LEVELS)[number];
export type Information = (typeof INFORMATION)[number];
export type Role = (typeof ROLES)[number];
export type Behaviour = (typeof BEHAVIOURS)[number];

export type MatrixCase = {
  profile: Profile;
  intent: IntentLevel;
  information: Information;
  role: Role;
  behaviour: Behaviour;
  goal: GoalKey;
};

const SIZES = [PROFILES.length, INTENT_LEVELS.length, INFORMATION.length, ROLES.length, BEHAVIOURS.length, GOAL_KEYS.length] as const;

function caseOf(index: readonly number[]): MatrixCase {
  return {
    profile: PROFILES[index[0]],
    intent: INTENT_LEVELS[index[1]],
    information: INFORMATION[index[2]],
    role: ROLES[index[3]],
    behaviour: BEHAVIOURS[index[4]],
    goal: GOAL_KEYS[index[5]],
  };
}

export const FULL_CASE_COUNT = SIZES.reduce((a, b) => a * b, 1);

/** Every case: 88,200. */
export function* allCases(): Generator<MatrixCase> {
  const index = SIZES.map(() => 0);
  for (let n = 0; n < FULL_CASE_COUNT; n++) {
    yield caseOf(index);
    for (let p = SIZES.length - 1; p >= 0; p--) {
      index[p] += 1;
      if (index[p] < SIZES[p]) break;
      index[p] = 0;
    }
  }
}

/**
 * A greedy pairwise covering array. Deterministic: each row starts from the
 * first uncovered pair and fills the other parameters with the value that
 * covers the most uncovered pairs (ties to the lowest value).
 */
export function allPairsIndices(): number[][] {
  const P = SIZES.length;
  const pairKey = (p: number, a: number, q: number, b: number) => `${p}:${a}|${q}:${b}`;
  const uncovered = new Set<string>();
  for (let p = 0; p < P; p++) for (let q = p + 1; q < P; q++) for (let a = 0; a < SIZES[p]; a++) for (let b = 0; b < SIZES[q]; b++) uncovered.add(pairKey(p, a, q, b));
  const rows: number[][] = [];
  while (uncovered.size > 0) {
    const [first] = uncovered;
    const [left, right] = first.split("|");
    const [p0, a0] = left.split(":").map(Number);
    const [q0, b0] = right.split(":").map(Number);
    const row: (number | null)[] = SIZES.map(() => null);
    row[p0] = a0;
    row[q0] = b0;
    for (let p = 0; p < P; p++) {
      if (row[p] !== null) continue;
      let bestValue = 0;
      let bestGain = -1;
      for (let v = 0; v < SIZES[p]; v++) {
        let gain = 0;
        for (let q = 0; q < P; q++) {
          if (q === p || row[q] === null) continue;
          const key = p < q ? pairKey(p, v, q, row[q]!) : pairKey(q, row[q]!, p, v);
          if (uncovered.has(key)) gain++;
        }
        if (gain > bestGain) {
          bestGain = gain;
          bestValue = v;
        }
      }
      row[p] = bestValue;
    }
    const full = row as number[];
    for (let p = 0; p < P; p++) for (let q = p + 1; q < P; q++) uncovered.delete(pairKey(p, full[p], q, full[q]));
    rows.push(full);
  }
  return rows;
}

export function allPairsCases(): MatrixCase[] {
  return allPairsIndices().map(caseOf);
}

/* -------------------------------------------------------------- fixtures */

let factSeq = 0;
function uuidFor(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export const LEAD_ID = "11111111-1111-4111-8111-111111111111";
export const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

export function fact(
  dimension: FactDimension,
  value: string,
  state: QualificationFact["state"],
  extra: Partial<QualificationFact> = {},
): QualificationFact {
  factSeq += 1;
  return {
    id: uuidFor(factSeq),
    leadId: LEAD_ID,
    serviceId: null,
    dimension,
    value,
    valueNormalised: value,
    state,
    source: state === "CONFIRMED" ? "ANSWER" : "ENRICHMENT",
    sourceRef: null,
    questionId: null,
    questionIntentKey: null,
    confidence: state === "CONFIRMED" ? 1 : 0.85,
    observedAt: new Date(Date.parse(NOW) - DAY_MS).toISOString(),
    validUntil: null,
    verifiedAt: null,
    setBy: null,
    supersededAt: null,
    ...extra,
  };
}

export function intentFixture(state: IntentState, score: number, extra: Partial<IntentAssessment> = {}): IntentAssessment {
  return {
    state,
    score,
    categories: { EXPLICIT: 0, BEHAVIOURAL: 0, CONVERSATIONAL: 0, RECENCY: 0, CONSISTENCY: 0 },
    evidence: [],
    contradictions: [],
    confidence: state === "NO_DETECTED_INTENT" ? 0.25 : 0.7,
    validUntil: null,
    resumeAt: null,
    version: IE_VERSION,
    ...extra,
  };
}

/** A representative value per dimension, for confirmed-fact fixtures. */
const SAMPLE_VALUE: Partial<Record<QiDimensionKey, string>> = {
  COMPANY_SIZE: "45",
  TEAM_SIZE: "12",
  TIMING: "30",
  LOCATION: "BH1 1AA",
  BUDGET: "5000",
  AUTHORITY: "DECISION_MAKER",
  CURRENT_SOLUTION: "EXTERNAL_PROVIDER",
};

function intentFor(level: IntentLevel, goal: GoalKey): IntentAssessment {
  switch (level) {
    case "none":
      return intentFixture("NO_DETECTED_INTENT", 0);
    case "weak":
      return intentFixture("LOW", 15);
    case "medium":
      return intentFixture("MEDIUM", 55);
    case "strong":
      return intentFixture("HIGH", 78);
    case "explicit":
      return goal === "C_DIRECT_SALE" || goal === "D_SIGNUP_TRIAL" ? intentFixture("PURCHASE_READY", 82) : intentFixture("BOOKING_READY", 80);
    case "contradictory":
      return intentFixture("NEGATIVE", 10, {
        contradictions: [
          {
            signal_id: uuidFor(900_001),
            signal_type: "CONVERTING_PAGE_PRICING",
            category: "BEHAVIOURAL",
            polarity: "POSITIVE",
            decayed_strength: 0.8,
            reason: "Converted on the pricing page",
            observed_at: new Date(Date.parse(NOW) - 2 * DAY_MS).toISOString(),
          },
        ],
      });
    case "stale":
      return intentFixture("LOW", 12, { validUntil: new Date(Date.parse(NOW) - DAY_MS).toISOString() });
    case "negative":
      return intentFixture("NEGATIVE", 0);
  }
}

const REPLIES: Record<Behaviour, string | null> = {
  asks_price: "How much does it cost?",
  asks_to_book: "Can we book a call for Thursday?",
  one_word: "ok",
  deflects: "not sure, why do you need to know",
  objection: "Honestly it seems a bit expensive for us",
  not_now: "Not right now, maybe get back to me in 3 months",
  off_topic: "Loved your post about the football last week",
  asks_question: "Do you work with companies in Manchester?",
  silent: null,
};

const resolvedCache = new Map<string, ResolvedOffer>();
function resolvedFor(profile: Profile): ResolvedOffer {
  let resolved = resolvedCache.get(profile.key);
  if (!resolved) {
    resolved = resolveOffer({
      archetypeKey: profile.archetypeKey,
      workspaceMotion: profile.motion,
      workspacePolicy: { disqualifiers: [profile.disqualifier] },
    });
    resolvedCache.set(profile.key, resolved);
  }
  return resolved;
}

function entry(dimension: FactDimension, status: DimensionStatusEntry["status"], ids: string[], resolved: ResolvedOffer, stale = false): DimensionStatusEntry {
  const required = dimension !== "UNMAPPED" && (resolved.threshold.allOf.includes(dimension) || resolved.requiredDimensions.includes(dimension));
  const material =
    dimension !== "UNMAPPED" &&
    (["BUDGET", "AUTHORITY"].includes(dimension) || resolved.requiredDimensions.includes(dimension) || resolved.disqualifiers.some((d) => d.dimension === dimension));
  return { dimension, status, fact_ids: ids.slice(0, 10), material, required, stale };
}

/** Facts and dimension statuses for one (profile, information, role). */
export function stateFor(profile: Profile, information: Information, role: Role): { facts: QualificationFact[]; dimensions: DimensionStatusEntry[] } {
  const resolved = resolvedFor(profile);
  const facts: QualificationFact[] = [];
  const dims = new Map<FactDimension, DimensionStatusEntry>();
  const confirm = (dimension: QiDimensionKey, value?: string) => {
    // One live fact per dimension: a later answer supersedes (facts.ts merges for real).
    for (let i = facts.length - 1; i >= 0; i--) if (facts[i].dimension === dimension) facts.splice(i, 1);
    const f = fact(dimension, value ?? SAMPLE_VALUE[dimension] ?? `${dimension.toLowerCase()} answer`, "CONFIRMED");
    facts.push(f);
    dims.set(dimension, entry(dimension, "CONFIRMED", [f.id], resolved));
  };

  const thresholdDims = [...resolved.threshold.allOf, ...resolved.threshold.anyOf.slice(0, 1)];
  switch (information) {
    case "empty":
      break;
    case "partial":
      confirm(resolved.plan[0]);
      break;
    case "threshold":
      for (const d of thresholdDims) confirm(d);
      break;
    case "conflicting": {
      for (const d of thresholdDims) confirm(d);
      const target = thresholdDims[0];
      const a = fact(target, "first answer", "CONFLICTING");
      const b = fact(target, "second answer", "CONFLICTING");
      facts.push(a, b);
      dims.set(target, entry(target, "CONFLICTING", [a.id, b.id], resolved));
      break;
    }
    case "stale": {
      confirm(resolved.plan[0]);
      const t = fact("TIMING", "next month", "INFERRED", {
        valueNormalised: "45",
        observedAt: new Date(Date.parse(NOW) - 120 * DAY_MS).toISOString(),
        validUntil: new Date(Date.parse(NOW) - 30 * DAY_MS).toISOString(),
      });
      facts.push(t);
      dims.set("TIMING", entry("TIMING", "INFERRED", [t.id], resolved, true));
      break;
    }
  }

  switch (role) {
    case "decision_maker":
      confirm("AUTHORITY", "DECISION_MAKER");
      break;
    case "influencer":
      confirm("AUTHORITY", "NOT_DECISION_MAKER");
      break;
    case "end_user": {
      const f = fact("AUTHORITY", "INFLUENCER", "INFERRED");
      facts.push(f);
      dims.set("AUTHORITY", entry("AUTHORITY", "INFERRED", [f.id], resolved));
      break;
    }
    case "unknown":
      break;
    case "disqualified":
      confirm(profile.disqualifier.dimension, profile.disqualifyingValue);
      break;
  }

  // Every threshold / required dimension appears, UNKNOWN when nothing is known.
  for (const d of [...thresholdDims, ...resolved.requiredDimensions]) {
    if (!dims.has(d)) dims.set(d, entry(d, "UNKNOWN", [], resolved));
  }
  return { facts, dimensions: [...dims.values()] };
}

/** The local reassessment (see the file header). */
function reassess(intent: IntentAssessment, behaviour: Behaviour): IntentAssessment {
  if (intent.state === "NEGATIVE") return intent;
  if (behaviour === "asks_to_book") return intentFixture("BOOKING_READY", Math.max(intent.score, 72));
  if (behaviour === "not_now") {
    return intentFixture("NOT_NOW", Math.min(intent.score, 25), { resumeAt: new Date(Date.parse(NOW) + 90 * DAY_MS).toISOString() });
  }
  return intent;
}

export type CaseResult = {
  nba: NextBestAction;
  resolved: ResolvedOffer;
  dimensions: DimensionStatusEntry[];
  staleDimensions: Set<FactDimension>;
  confirmedDisqualifier: boolean;
};

/** Runs one case through the pure pipeline. */
export function runCase(c: MatrixCase): CaseResult {
  const resolved = resolvedFor(c.profile);
  const { facts, dimensions } = stateFor(c.profile, c.information, c.role);
  const reply = REPLIES[c.behaviour];
  const interpretation =
    reply === null
      ? null
      : interpret(reply, {
          messageId: MESSAGE_ID,
          now: NOW,
          dimensions,
          context: { incumbentTerms: c.profile.incumbentTerms },
        });
  const intent = reassess(intentFor(c.intent, c.goal), c.behaviour);
  const binding = reply ? classifyDeterministic(reply) : null;
  const goal = resolveGoal({ motion: resolved.motion, offerGoal: c.goal, intentState: intent.state });
  const stage = interpretation ? (c.information === "empty" ? "ENGAGED" : "QUALIFYING") : c.information === "empty" ? "NEW" : "ENGAGED";

  const { nba, input } = planNextBestAction({
    now: NOW,
    channel: "email",
    stage,
    resolved,
    goal,
    intent,
    dimensions,
    facts,
    engineVerdict: "PENDING",
    qualificationScore: 50,
    suppressed: false,
    interpretation,
    bindingVerdict: binding?.binding ? binding.intent : null,
    policy: { disqualifiers: [c.profile.disqualifier] },
    checkoutAllowed: true,
    bookingScheduled: false,
    dealValueGbp: null,
  });
  return {
    nba,
    resolved,
    dimensions: input.dimensions,
    staleDimensions: new Set(dimensions.filter((d) => d.stale).map((d) => d.dimension)),
    confirmedDisqualifier: c.role === "disqualified",
  };
}

/* ------------------------------------------------------------ invariants */

export type Violation = { invariant: string; detail: string };

/** The §C.4 invariants. Empty = the case passes. */
export function checkInvariants(c: MatrixCase, r: CaseResult): Violation[] {
  const v: Violation[] = [];
  const n = r.nba;
  const q = n.question_intent;
  const statusOf = (d: FactDimension) => r.dimensions.find((x) => x.dimension === d);
  const known = (d: FactDimension) => {
    const s = statusOf(d);
    return !!s && !s.stale && (s.status === "CONFIRMED" || s.status === "INFERRED");
  };

  // 1. Never asks a CONFIRMED dimension (a stale one is re-verified, never re-asked blind).
  if (q && q.dimension !== "UNMAPPED") {
    const s = statusOf(q.dimension);
    if (s && s.status === "CONFIRMED" && !s.stale) v.push({ invariant: "never-asks-confirmed", detail: `${q.key} on CONFIRMED ${q.dimension}` });
  }
  // 2. NEGATIVE => no ASK / CTA (nor any other pursuit).
  if (n.intent_state === "NEGATIVE" && pursues(n.next_action)) v.push({ invariant: "negative-not-pursued", detail: n.next_action });
  // 3. BOOKING_READY + goal B => CTA_BOOK, or at most one gating question, or a stop.
  if (n.intent_state === "BOOKING_READY" && n.current_goal === "B_BOOK_MEETING") {
    const gating = new Set<FactDimension>([...r.resolved.gatingDimensions, ...r.resolved.requiredDimensions, c.profile.disqualifier.dimension]);
    const allowed = ["CTA_BOOK", "ESCALATE", "DISQUALIFY", "NO_ACTION"].includes(n.next_action) || (n.next_action === "ASK" && n.rule === "R3_DISQUALIFIED");
    if (!allowed) v.push({ invariant: "booking-ready-books", detail: `${n.next_action} (${n.rule})` });
    if (n.next_action === "CTA_BOOK" && q && !gating.has(q.dimension)) v.push({ invariant: "booking-ready-books", detail: `non-gating question ${q.key}` });
  }
  // 4. A confirmed disqualifier => no pursuit.
  if (r.confirmedDisqualifier && pursues(n.next_action)) v.push({ invariant: "disqualified-not-pursued", detail: `${n.next_action} (${n.rule})` });
  // 5. No MEDDPICC-only dimensions on LOCAL_SERVICE.
  if (r.resolved.motion === "LOCAL_SERVICE" && q && q.dimension !== "UNMAPPED" && MEDDPICC_ONLY_DIMENSIONS.includes(q.dimension)) {
    v.push({ invariant: "no-meddpicc-on-local", detail: q.key });
  }
  // 6. No BUDGET before a problem dimension.
  if (q && q.dimension === "BUDGET" && !PROBLEM_DIMENSIONS.some((d) => known(d))) v.push({ invariant: "no-budget-before-problem", detail: q.key });
  // 7. Stale TIMING => VERIFY, not a blind re-ask.
  if (q && q.dimension === "TIMING" && r.staleDimensions.has("TIMING") && q.purpose !== "VERIFY") {
    v.push({ invariant: "stale-timing-verified", detail: `${q.key} (${q.purpose})` });
  }
  // 8. One primary question per turn.
  if (q && (q.rendering.match(/\?/g) ?? []).length > 1) v.push({ invariant: "one-question", detail: q.rendering });
  // 9. A question is carried only by an asking action or a CTA_BOOK gate.
  if (q && !["ASK", "ANSWER_AND_ASK", "CTA_BOOK"].includes(n.next_action)) v.push({ invariant: "question-only-when-asking", detail: n.next_action });
  return v;
}
