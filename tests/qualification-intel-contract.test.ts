import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ALWAYS_MATERIAL_DIMENSIONS,
  ASSESSMENT_ENGINE_MODES,
  BRIEF_DIMENSION_ALIASES,
  CATEGORY_SCORE_COMPONENT,
  CONVERSION_GOAL_TO_GOAL,
  customIntentKey,
  defaultEngineMode,
  FACT_SOURCES,
  FACT_STATES,
  GOAL_CLOSE_TARGET,
  GOAL_KEYS,
  GOAL_MOTIONS,
  INTENT_COMPONENT_CAPS,
  INTENT_STATES,
  interpretationSchema,
  intentSignalWriteSchema,
  leadAssessmentWriteSchema,
  MOTION_DEFAULT_GOAL,
  NBA_ACTION_NEEDS_MODEL,
  NBA_ACTIONS,
  NBA_VERSION,
  nextBestActionSchema,
  offerProfileSchema,
  parseOfferProfile,
  policyChangeOnlyNarrows,
  predicateSchema,
  QI_ADDED_DIMENSION_KEYS,
  QI_DIMENSION_KEYS,
  QIE_ENGINE_VERSION,
  QUALIFICATION_POLICY_KIND,
  qualificationFactWriteSchema,
  qualificationPolicySchema,
  QUESTION_GRADE_CRITERIA,
  QUESTION_STRATEGY_EXPERIMENT_KIND,
  resolveEngineMode,
  SALES_OVERRIDE_KINDS,
  SIGNAL_CATEGORIES,
  SIGNAL_POLARITIES,
  SIGNAL_SOURCES,
  SIGNAL_TYPE_CATEGORY,
  SIGNAL_TYPES,
  turnAccountingSchema,
  UNMAPPED_DIMENSION,
  type NextBestAction,
  type QualificationPolicy,
} from "../src/lib/qualification-intelligence/types.ts";
import { QUALIFICATION_DIMENSION_KEYS, SALES_MOTIONS } from "../src/lib/sales-library/types.ts";
import { QUALIFICATION_CATALOGUE } from "../src/lib/sales-library/qualification-dimensions.ts";
import { CONVERSION_GOAL_TYPES } from "../src/lib/business-profile/types.ts";
import { EXPERIMENT_KINDS } from "../src/lib/learning/experiments.ts";
import { OPPORTUNITY_CLOSE_TARGETS } from "../src/lib/opportunities/stages.ts";

/**
 * Phase 0 contract for the Qualification Intelligence & Intent Engine
 * (docs/revenue-engine/08-qualification-intelligence.md). The migration's
 * CHECK lists and the TypeScript enums are the same vocabulary; this holds
 * them equal so a value cannot exist on one side only.
 */

/* ------------------------------------------------------------- the SQL */

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const QI_FILE = readdirSync(MIGRATIONS).find((f) => /^\d{4,5}_qualification_intelligence\.sql$/.test(f));
assert.ok(QI_FILE, "the qualification_intelligence migration exists");
const SQL = readFileSync(path.join(MIGRATIONS, QI_FILE), "utf8").replace(/--.*$/gm, "");

/** The quoted values of `add constraint <name> check (... in ( ... ))`. */
function checkValues(constraint: string, sql = SQL): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  assert.ok(start >= 0, `constraint ${constraint} not found`);
  const end = sql.indexOf(";", start);
  const body = sql.slice(start, end);
  const list = body.match(/\bin\s*\(([\s\S]*?)\)/);
  assert.ok(list, `no in-list in ${constraint}`);
  return [...list[1].matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}

/** The inline `kind ... check (kind in (...))` of an older migration's create table. */
function inlineKindValues(file: string, table: string): string[] {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`create table ${table}`) >= 0 ? sql.indexOf(`create table ${table}`) : sql.indexOf(`create table if not exists ${table}`);
  assert.ok(start >= 0, `${table} not created in ${file}`);
  const body = sql.slice(start, sql.indexOf("\n);", start));
  const m = body.match(/check \(kind in \(([^)]*)\)\)/);
  assert.ok(m, `no kind check on ${table} in ${file}`);
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

const same = (a: readonly string[], b: readonly string[]) => assert.deepEqual([...a].sort(), [...b].sort());

describe("migration CHECK values equal the contract enums", () => {
  test("lead_intent_signals", () => {
    same(checkValues("lead_intent_signals_category_check"), SIGNAL_CATEGORIES);
    same(checkValues("lead_intent_signals_signal_type_check"), SIGNAL_TYPES);
    same(checkValues("lead_intent_signals_polarity_check"), SIGNAL_POLARITIES);
    same(checkValues("lead_intent_signals_source_check"), SIGNAL_SOURCES);
  });

  test("lead_qualification_facts", () => {
    same(checkValues("lead_qualification_facts_dimension_check"), [...QI_DIMENSION_KEYS, UNMAPPED_DIMENSION]);
    same(checkValues("lead_qualification_facts_state_check"), FACT_STATES);
    same(checkValues("lead_qualification_facts_source_check"), FACT_SOURCES);
  });

  test("lead_assessments", () => {
    same(checkValues("lead_assessments_intent_state_check"), INTENT_STATES);
    same(checkValues("lead_assessments_goal_check"), GOAL_KEYS);
    same(checkValues("lead_assessments_engine_mode_check"), ASSESSMENT_ENGINE_MODES);
  });

  test("leads and qualification_questions", () => {
    same(checkValues("leads_intent_state_check"), INTENT_STATES);
    same(checkValues("leads_next_action_check"), NBA_ACTIONS);
    same(checkValues("qualification_questions_dimension_key_check"), QI_DIMENSION_KEYS);
  });

  test("override kinds: every 0121 value kept, QUALIFICATION_POLICY added", () => {
    const before = inlineKindValues("0121_sales_intelligence.sql", "public.workspace_sales_overrides");
    const after = checkValues("workspace_sales_overrides_kind_check");
    for (const kind of before) assert.ok(after.includes(kind), `${kind} was dropped`);
    same(after, SALES_OVERRIDE_KINDS);
    assert.ok(after.includes(QUALIFICATION_POLICY_KIND));
  });

  test("experiment kinds: every 0131 value kept, QUESTION_STRATEGY added", () => {
    const before = inlineKindValues("0131_revenue_engine_gaps.sql", "public.experiments");
    const after = checkValues("experiments_kind_check");
    for (const kind of before) assert.ok(after.includes(kind), `${kind} was dropped`);
    same(after, [...new Set([...EXPERIMENT_KINDS, QUESTION_STRATEGY_EXPERIMENT_KIND])]);
  });

  test("every new table is RLS-forced, member-read, and cascades with the lead", () => {
    for (const table of ["lead_intent_signals", "lead_qualification_facts", "lead_assessments"]) {
      const body = SQL.slice(SQL.indexOf(`create table if not exists public.${table}`));
      const create = body.slice(0, body.indexOf("\n);"));
      assert.match(create, /business_id uuid not null references public\.businesses\(id\) on delete cascade/);
      assert.match(create, /lead_id uuid not null references public\.leads\(id\) on delete cascade/);
      assert.ok(SQL.includes(`'${table}'`), `${table} is not in the RLS loop`);
    }
    assert.match(SQL, /force row level security/);
    assert.match(SQL, /public\.is_business_member\(business_id\)/);
    assert.match(SQL, /grant execute on function public\.record_lead_assessment\(uuid, uuid, jsonb\)\s*to service_role/);
    assert.doesNotMatch(SQL, /grant (insert|update|delete)[^;]*to authenticated/);
  });

  test("anonymisation clears all three tables", () => {
    const fn = SQL.slice(SQL.indexOf("function public.qualification_intel_clear_on_anonymise"));
    for (const table of ["lead_intent_signals", "lead_qualification_facts", "lead_assessments"]) {
      assert.match(fn.slice(0, fn.indexOf("$$;")), new RegExp(`delete from public\\.${table}\\b`));
    }
    assert.match(SQL, /after update of anonymised_at on public\.leads/);
  });
});

/* ------------------------------------------------------------ dimensions */

describe("dimension keys map to the library", () => {
  const library = new Set<string>(QUALIFICATION_DIMENSION_KEYS);
  const added = new Set<string>(QI_ADDED_DIMENSION_KEYS);

  test("26 keys: the whole library plus the six added ones, no duplicates", () => {
    assert.equal(QI_DIMENSION_KEYS.length, new Set(QI_DIMENSION_KEYS).size);
    for (const key of QUALIFICATION_DIMENSION_KEYS) assert.ok(QI_DIMENSION_KEYS.includes(key));
    for (const key of QI_ADDED_DIMENSION_KEYS) assert.ok(QI_DIMENSION_KEYS.includes(key));
    assert.equal(QI_DIMENSION_KEYS.length, 26);
  });

  test("every key is a library dimension (catalogue entry) or a pending library addition", () => {
    for (const key of QI_DIMENSION_KEYS) {
      const inLibrary = library.has(key) && key in QUALIFICATION_CATALOGUE;
      assert.ok(inLibrary || added.has(key), `${key} maps to nothing`);
    }
  });

  test("every brief alias and material dimension resolves to a key", () => {
    for (const [alias, key] of Object.entries(BRIEF_DIMENSION_ALIASES)) {
      assert.ok(QI_DIMENSION_KEYS.includes(key), `${alias} -> ${key}`);
    }
    for (const key of ALWAYS_MATERIAL_DIMENSIONS) assert.ok(library.has(key));
  });
});

/* ---------------------------------------------------------------- enums */

describe("enum maps are total and consistent", () => {
  test("every signal type has a category; CONTEXT scores somewhere", () => {
    for (const type of SIGNAL_TYPES) assert.ok(SIGNAL_CATEGORIES.includes(SIGNAL_TYPE_CATEGORY[type]));
    for (const cat of SIGNAL_CATEGORIES) assert.ok(CATEGORY_SCORE_COMPONENT[cat]);
  });

  test("intent component caps sum to 100", () => {
    assert.equal(Object.values(INTENT_COMPONENT_CAPS).reduce((a, b) => a + b, 0), 100);
  });

  test("grader weights sum to 100", () => {
    assert.equal(Object.values(QUESTION_GRADE_CRITERIA).reduce((a: number, b) => a + b, 0), 100);
  });

  test("goals: every conversion goal type and motion maps; close targets exist", () => {
    for (const type of CONVERSION_GOAL_TYPES) assert.ok(GOAL_KEYS.includes(CONVERSION_GOAL_TO_GOAL[type]));
    for (const motion of SALES_MOTIONS) {
      const goal = MOTION_DEFAULT_GOAL[motion];
      assert.ok(GOAL_KEYS.includes(goal));
      const motions = GOAL_MOTIONS[goal];
      assert.ok(motions.length === 0 || motions.includes(motion), `${motion} -> ${goal}`);
    }
    for (const goal of GOAL_KEYS) {
      const target = GOAL_CLOSE_TARGET[goal];
      assert.ok(target === null || OPPORTUNITY_CLOSE_TARGETS.includes(target));
    }
  });

  test("zero-token actions send no composed message", () => {
    for (const action of ["WAIT", "NO_ACTION", "DISQUALIFY", "ESCALATE"] as const) {
      assert.equal(NBA_ACTION_NEEDS_MODEL[action], false);
    }
  });

  test("engine mode: SHADOW until the gates pass, LIVE after, explicit value wins", () => {
    assert.equal(defaultEngineMode(false), "SHADOW");
    assert.equal(defaultEngineMode(true), "LIVE");
    assert.equal(resolveEngineMode("OFF", true), "OFF");
    assert.equal(resolveEngineMode(undefined, true), "LIVE");
  });
});

/* ------------------------------------------------------------ zod schemas */

const now = new Date().toISOString();
const later = new Date(Date.now() + 86_400_000).toISOString();

function signal(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: randomUUID(),
    category: "EXPLICIT",
    signal_type: "BOOKING_REQUEST",
    polarity: "POSITIVE",
    strength: 0.9,
    confidence: 0.95,
    source: "REPLY",
    source_ref: randomUUID(),
    observed_at: now,
    half_life_hours: 120,
    reason: "Asked 'can we book a call Thursday?'",
    evidence_excerpt: "can we book a call Thursday?",
    dedupe_key: "reply:abc:BOOKING_REQUEST",
    rule_version: "sig-1",
    ...overrides,
  };
}

function nba(overrides: Partial<NextBestAction> = {}): Record<string, unknown> {
  return {
    current_goal: "B_BOOK_MEETING",
    intent_state: "BOOKING_READY",
    intent_score: 78,
    known_dimensions: [
      { dimension: "USE_CASE", state: "CONFIRMED" },
      { dimension: "COMPANY_SIZE", state: "INFERRED" },
    ],
    unknown_required_dimensions: ["TIMING"],
    next_action: "CTA_BOOK",
    question_intent: null,
    reason: "Lead asked to book; threshold met. Booking is not slowed by an optional question.",
    rule: "R7_BOOKING_READY",
    expected_information_gain: 0,
    qualification_score: 71,
    qualification_completeness: 0.67,
    engine_verdict: "PENDING",
    confidence: 0.82,
    handover_reason: null,
    resume_at: null,
    suppress: false,
    model_call_required: true,
    question_value: null,
    alternatives: [{ action: "ASK", intent: "TIMING.START_WINDOW", value: 0.31 }],
    engine_version: NBA_VERSION,
    ...overrides,
  };
}

describe("intent signal schema", () => {
  test("accepts a valid signal", () => {
    assert.ok(intentSignalWriteSchema.safeParse(signal()).success);
    assert.ok(intentSignalWriteSchema.safeParse(signal({ category: "EXPLICIT", signal_type: "NOT_NOW", polarity: "NEGATIVE", resume_at: later })).success);
  });

  test("rejects wrong category, polarity, ranges, lengths and misplaced resume_at", () => {
    for (const bad of [
      signal({ category: "CONVERSATIONAL" }),
      signal({ polarity: "NEGATIVE" }),
      signal({ signal_type: "NOT_INTERESTED", polarity: "POSITIVE" }),
      signal({ strength: 1.2 }),
      signal({ confidence: -0.1 }),
      signal({ reason: "x".repeat(201) }),
      signal({ evidence_excerpt: "x".repeat(241) }),
      signal({ resume_at: later }),
      signal({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      signal({ signal_type: "PAGE_VIEW" }),
      signal({ lead_id: "not-a-uuid" }),
    ]) {
      assert.equal(intentSignalWriteSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 120));
    }
  });
});

describe("qualification fact schema", () => {
  const fact = (o: Record<string, unknown> = {}) => ({
    lead_id: randomUUID(),
    dimension: "COMPANY_SIZE",
    value: "40 staff",
    value_normalised: "40",
    state: "CONFIRMED",
    source: "REPLY",
    confidence: 0.95,
    observed_at: now,
    ...o,
  });

  test("accepts confirmed, AI-inferred and unmapped custom facts", () => {
    assert.ok(qualificationFactWriteSchema.safeParse(fact()).success);
    assert.ok(qualificationFactWriteSchema.safeParse(fact({ source: "AI_ASSIST", state: "INFERRED", confidence: 0.9 })).success);
    const qid = randomUUID();
    assert.ok(
      qualificationFactWriteSchema.safeParse(fact({ dimension: "UNMAPPED", question_id: qid, question_intent_key: customIntentKey(qid) })).success,
    );
    assert.ok(qualificationFactWriteSchema.safeParse(fact({ dimension: "OUTCOME", question_intent_key: "OUTCOME.PRIMARY_GOAL" })).success);
  });

  test("rejects AI-confirmed facts, low-confidence AI facts, UNKNOWN state and bad keys", () => {
    for (const bad of [
      fact({ source: "AI_ASSIST", state: "CONFIRMED" }),
      fact({ source: "AI_ASSIST", state: "INFERRED", confidence: 0.6 }),
      fact({ state: "UNKNOWN" }),
      fact({ dimension: "UNMAPPED" }),
      fact({ dimension: "SHOE_SIZE" }),
      fact({ question_intent_key: "timing.start" }),
      fact({ value: "" }),
      fact({ value: "x".repeat(501) }),
    ]) {
      assert.equal(qualificationFactWriteSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 120));
    }
  });
});

describe("offer profile and policy schemas", () => {
  test("accepts a full offer profile and {}", () => {
    const profile = {
      pricingModel: "RETAINER",
      averageDealValue: 24000,
      billing: "RECURRING",
      cycleComplexity: "CONSIDERED",
      customerType: "B2B",
      targetCustomer: { sizes: ["10-49", "50-249"], sicPrefixes: ["62", "70.22"], roles: ["Operations Director"] },
      geography: { postcodePrefixes: ["M", "SK", "WA1"] },
      disqualifiers: [
        { dimension: "COMPANY_SIZE", when: { op: "lt", dimension: "COMPANY_SIZE", value: 5 }, reason: "Below the minimum team size" },
      ],
      goal: "B_BOOK_MEETING",
      motion: "BOOK_MEETING_B2B",
      requiredDimensions: ["COMPANY_SIZE", "TIMING"],
      forbiddenQuestionIntents: ["BUDGET.RANGE"],
      thresholds: { booking: { minIntentState: "MEDIUM", minCompleteness: 0.5 } },
      handoffRules: [{ when: { op: "gt", dimension: "BUDGET", value: 100000 }, reason: "HIGH_VALUE" }],
    };
    const parsed = offerProfileSchema.safeParse(profile);
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.deepEqual(parseOfferProfile({}), { profile: {}, valid: true });
    assert.deepEqual(parseOfferProfile(null), { profile: {}, valid: true });
  });

  test("rejects unknown keys and bad values, and falls back to {}", () => {
    for (const bad of [
      { pricingModel: "FREE" },
      { unknownField: 1 },
      { goal: "Z_WIN" },
      { requiredDimensions: ["SHOE_SIZE"] },
      { forbiddenQuestionIntents: ["custom:" + randomUUID()] },
      { disqualifiers: [{ dimension: "BUDGET", when: { op: "between" }, reason: "x" }] },
    ]) {
      assert.equal(offerProfileSchema.safeParse(bad).success, false, JSON.stringify(bad));
      assert.deepEqual(parseOfferProfile(bad), { profile: {}, valid: false });
    }
  });

  test("predicates nest and reject garbage", () => {
    assert.ok(
      predicateSchema.safeParse({
        op: "all",
        of: [{ op: "known", dimension: "PROBLEM" }, { op: "not", of: { op: "intentIn", states: ["NEGATIVE"] } }],
      }).success,
    );
    assert.equal(predicateSchema.safeParse({ op: "eval", code: "1" }).success, false);
  });

  test("policy schema and the narrow-only rule", () => {
    const base: QualificationPolicy = { engineMode: "SHADOW", forbiddenQuestionIntents: ["BUDGET.RANGE"], maxAutonomy: "AUTO_REPLY" };
    assert.ok(qualificationPolicySchema.safeParse(base).success);
    assert.equal(qualificationPolicySchema.safeParse({ engineMode: "ON" }).success, false);
    assert.ok(policyChangeOnlyNarrows(base, { ...base, forbiddenQuestionIntents: ["BUDGET.RANGE", "AUTHORITY.ROLE"] }));
    assert.ok(policyChangeOnlyNarrows(base, { ...base, requiredDimensions: ["COMPANY_SIZE"], maxAutonomy: "SUGGEST_ONLY" }));
    assert.equal(policyChangeOnlyNarrows(base, { ...base, forbiddenQuestionIntents: [] }), false);
    assert.equal(policyChangeOnlyNarrows(base, { ...base, engineMode: "LIVE" }), false);
    assert.equal(policyChangeOnlyNarrows({ ...base, maxAutonomy: "SUGGEST_ONLY" }, { ...base, maxAutonomy: "AUTO_REPLY" }), false);
    assert.equal(policyChangeOnlyNarrows(base, { ...base, thresholds: { booking: { minCompleteness: 0.1 } } }), false);
  });
});

describe("NBA, interpretation, assessment and accounting schemas", () => {
  test("accepts the design's §B.9 example", () => {
    const parsed = nextBestActionSchema.safeParse(nba());
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  });

  test("accepts an ASK with its question intent", () => {
    const ask = nba({
      intent_state: "MEDIUM",
      next_action: "ASK",
      rule: "R9_ASK",
      question_intent: {
        key: "TIMING.START_WINDOW",
        dimension: "TIMING",
        purpose: "DISCOVER",
        question_id: null,
        wording_family: "timing.when_start",
        rendering: "When are you hoping to get started?",
      },
      expected_information_gain: 0.6,
    });
    assert.ok(nextBestActionSchema.safeParse(ask).success);
  });

  test("rejects inconsistent NBAs", () => {
    for (const bad of [
      nba({ next_action: "ASK", rule: "R9_ASK" }),
      nba({ next_action: "ESCALATE", rule: "R4_ESCALATE" }),
      nba({ handover_reason: "HIGH_VALUE" }),
      nba({ resume_at: later }),
      nba({ intent_state: "NEGATIVE" }),
      nba({ next_action: "LAUGH" as never }),
      nba({ intent_score: 101 }),
      nba({ engine_version: "nba-0" as never }),
      { ...nba(), extra: 1 },
    ]) {
      assert.equal(nextBestActionSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 160));
    }
    assert.ok(nextBestActionSchema.safeParse(nba({ next_action: "ESCALATE", rule: "R4_ESCALATE", handover_reason: "HIGH_VALUE", model_call_required: false })).success);
    assert.ok(nextBestActionSchema.safeParse(nba({ next_action: "WAIT", rule: "R6_NOT_NOW", intent_state: "NOT_NOW", resume_at: later, model_call_required: false })).success);
  });

  const interpretation = (o: Record<string, unknown> = {}) => ({
    message_id: randomUUID(),
    answered_question_id: null,
    answered_intent_key: "COMPANY_SIZE.STAFF_COUNT",
    completeness: "FULL",
    facts: [
      { dimension: "COMPANY_SIZE", value: "we're 40 staff", value_normalised: "40", state: "CONFIRMED", source: "REPLY", confidence: 0.95, question_id: null, question_intent_key: "COMPANY_SIZE.STAFF_COUNT", evidence_span: null },
      { dimension: "TIMING", value: "next month", value_normalised: null, state: "INFERRED", source: "AI_ASSIST", confidence: 0.9, question_id: null, question_intent_key: null, evidence_span: "next month" },
    ],
    signals: [{ signal_type: "TIMEFRAME", strength: 0.7, confidence: 0.9, reason: "Said 'next month'", evidence_excerpt: "next month", resume_at: null, stated_date: "2026-10-26" }],
    objections: [],
    lead_asked_question: false,
    requested_action: null,
    intent_delta: 12,
    close_instead: false,
    ai_assist_used: true,
    version: "int-1",
    ...o,
  });

  test("interpretation: accepts multi-dimension; rejects AI facts without a span or confirmed", () => {
    assert.ok(interpretationSchema.safeParse(interpretation()).success);
    const aiNoSpan = interpretation();
    (aiNoSpan.facts[1] as Record<string, unknown>).evidence_span = null;
    assert.equal(interpretationSchema.safeParse(aiNoSpan).success, false);
    const aiConfirmed = interpretation();
    (aiConfirmed.facts[1] as Record<string, unknown>).state = "CONFIRMED";
    assert.equal(interpretationSchema.safeParse(aiConfirmed).success, false);
    assert.equal(interpretationSchema.safeParse(interpretation({ completeness: "MOSTLY" })).success, false);
  });

  const assessment = (o: Record<string, unknown> = {}) => ({
    intent_state: "BOOKING_READY",
    intent_score: 78,
    intent_categories: { EXPLICIT: 33, BEHAVIOURAL: 0, CONVERSATIONAL: 25, RECENCY: 10, CONSISTENCY: 10 },
    intent_evidence: [
      { signal_id: randomUUID(), signal_type: "BOOKING_REQUEST", category: "EXPLICIT", polarity: "POSITIVE", decayed_strength: 0.94, reason: "Asked to book", observed_at: now },
    ],
    intent_contradictions: [],
    intent_confidence: 0.8,
    valid_until: later,
    goal: "B_BOOK_MEETING",
    qualification_completeness: 0.67,
    dimension_status: [{ dimension: "USE_CASE", status: "CONFIRMED", fact_ids: [randomUUID()], material: false, required: true }],
    nba: nba(),
    engine_version: QIE_ENGINE_VERSION,
    engine_mode: "SHADOW",
    legacy_decision: { next_question_id: randomUUID(), agent_mode: "QUALIFICATION", differs: true, note: null },
    trigger_event: "reply.classified:" + randomUUID(),
    ...o,
  });

  test("assessment: accepts; rejects disagreement with its NBA, caps and LIVE legacy", () => {
    const ok = leadAssessmentWriteSchema.safeParse(assessment());
    assert.ok(ok.success, ok.success ? "" : JSON.stringify(ok.error.issues));
    for (const bad of [
      assessment({ intent_state: "HIGH" }),
      assessment({ goal: "C_DIRECT_SALE" }),
      assessment({ intent_categories: { EXPLICIT: 40, BEHAVIOURAL: 0, CONVERSATIONAL: 25, RECENCY: 10, CONSISTENCY: 10 } }),
      assessment({ engine_mode: "LIVE" }),
      assessment({ engine_mode: "OFF", legacy_decision: null }),
      assessment({ engine_version: "old" }),
      assessment({ trigger_event: "" }),
    ]) {
      assert.equal(leadAssessmentWriteSchema.safeParse(bad).success, false);
    }
    assert.ok(leadAssessmentWriteSchema.safeParse(assessment({ engine_mode: "LIVE", legacy_decision: null })).success);
  });

  test("turn accounting", () => {
    const acc = {
      engine_mode: "LIVE",
      nba_action: "WAIT",
      nba_rule: "R6_NOT_NOW",
      question_intent: null,
      model_called: false,
      model_call_avoided: true,
      shadow_differs: null,
      strategy_block_tokens: 0,
      interpretation_tokens: 0,
      qa_findings: [],
      question_grade: null,
      engine_version: QIE_ENGINE_VERSION,
    };
    assert.ok(turnAccountingSchema.safeParse(acc).success);
    assert.equal(turnAccountingSchema.safeParse({ ...acc, qa_findings: ["QA_NOPE"] }).success, false);
    assert.equal(turnAccountingSchema.safeParse({ ...acc, strategy_block_tokens: -1 }).success, false);
  });
});
