import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  FEATURE_ALLOW_LIST,
  PROTECTED_FEATURE_PATTERN,
  SCORING_VERSION,
  gradeForLeadScore,
  scoreLead,
  screenFacts,
  type LeadFact,
} from "../src/lib/scoring/lead-score.ts";
import { deriveTags, LEAD_TAGS, TAG_RULES, TAG_RULE_VERSION, type TagLifecycle } from "../src/lib/scoring/tags.ts";
import { LIBRARY_VERSION, SCORE_DIMENSIONS } from "../src/lib/sales-library/types.ts";

const strongB2BFacts: LeadFact[] = [
  { feature: "company_size_match", value: 1, source: "enrichment" },
  { feature: "tech_stack_match", value: 1, source: "enrichment" },
  { feature: "industry_match", value: 1, source: "enrichment" },
  { feature: "growth_signal", value: 1, source: "enrichment" },
  { feature: "inbound_enquiry", value: true, source: "lead.origin" },
  { feature: "booking_intent", value: true, source: "reply_classification" },
  { feature: "need_stated", value: true, source: "qualification_answers" },
  { feature: "estimated_value_gbp", value: 20_000, source: "lead.estimated_value" },
  { feature: "budget_confirmed", value: true, source: "qualification_answers" },
  { feature: "role_authority", value: "DECISION_MAKER", source: "prospect.role" },
  { feature: "timeline_days", value: 10, source: "qualification_answers" },
  { feature: "replied", value: true, source: "messages" },
  { feature: "inbound_message_count", value: 4, source: "messages" },
  { feature: "days_since_last_inbound", value: 1, source: "messages" },
];

const lifecycle = (overrides: Partial<TagLifecycle> = {}): TagLifecycle => ({
  status: "RESPONDED",
  optedOut: false,
  humanTakeover: false,
  latestBookingStatus: null,
  latestBookingStartsAt: null,
  lastInboundAt: null,
  lastOutboundAt: null,
  ...overrides,
});

describe("lead score engine", () => {
  test("versions are stamped", () => {
    const result = scoreLead({ facts: [] });
    assert.equal(result.scoringVersion, SCORING_VERSION);
    assert.equal(result.libraryVersion, LIBRARY_VERSION);
  });

  test("weights sum to 100 and every dimension is reported", () => {
    const result = scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS" });
    assert.equal(SCORE_DIMENSIONS.reduce((s, d) => s + result.weights[d], 0), 100);
    assert.deepEqual(result.dimensions.map((d) => d.dimension), [...SCORE_DIMENSIONS]);
    for (const d of result.dimensions) {
      assert.ok(d.score >= 0 && d.score <= d.max, `${d.dimension} ${d.score}/${d.max}`);
      assert.ok(d.confidence >= 0 && d.confidence <= 1);
    }
  });

  test("a strong lead grades A with a grounded explanation", () => {
    const result = scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS", motion: "BOOK_MEETING_B2B" });
    assert.equal(result.grade, "A", `total ${result.total}`);
    assert.ok(result.total >= 80);
    assert.match(result.why, /^Graded A \(\d+\/100\)\./);
    assert.ok(result.confidence > 0.8);
  });

  test("deterministic: the same facts give the same result, in any order", () => {
    const a = scoreLead({ facts: strongB2BFacts, archetypeKey: "MSP" });
    const b = scoreLead({ facts: [...strongB2BFacts].reverse(), archetypeKey: "MSP" });
    assert.deepEqual(a, b);
  });

  test("an empty lead scores 0, grades D and reports what is missing", () => {
    const result = scoreLead({ facts: [], archetypeKey: "ROOFER" });
    assert.equal(result.total, 0);
    assert.equal(result.grade, "D");
    assert.equal(result.confidence, 0);
    const missing = result.missing.map((m) => m.feature);
    for (const feature of ["service_match", "geography_match", "property_type_match", "timeline_days", "budget_confirmed", "role_authority"]) {
      assert.ok(missing.includes(feature as never), `missing should list ${feature}`);
    }
    assert.match(result.why, /Unknown:/);
  });

  test("missing information is reported per dimension, not renormalised away", () => {
    const partial = scoreLead({
      facts: [
        { feature: "company_size_match", value: 1, source: "x" },
        { feature: "inbound_enquiry", value: true, source: "x" },
      ],
      archetypeKey: "B2B_SAAS",
    });
    const fit = partial.dimensions.find((d) => d.dimension === "FIT")!;
    // One of four fit signals known (engine-gaps, FIT averaging): FIT averages
    // the signals with evidence, so the one known signal scores in full, and
    // the three unknown ones cut confidence to a quarter and are listed.
    assert.equal(fit.score, fit.max);
    assert.equal(fit.confidence, 0.25);
    assert.deepEqual(fit.missing, ["tech_stack_match", "industry_match", "growth_signal"]);
    assert.ok(partial.grade !== "A" && partial.grade !== "B");
  });

  test("low-confidence facts count for less", () => {
    const sure = scoreLead({ facts: [{ feature: "positive_reply", value: true, source: "x", confidence: 1 }] });
    const unsure = scoreLead({ facts: [{ feature: "positive_reply", value: true, source: "x", confidence: 0.4 }] });
    assert.ok(sure.total > unsure.total);
  });

  test("opt-out and refusal cap intent, engagement and timing", () => {
    const optedOut = scoreLead({ facts: [...strongB2BFacts, { feature: "opted_out", value: true, source: "lead" }], archetypeKey: "B2B_SAAS" });
    for (const dim of ["INTENT", "ENGAGEMENT", "TIMING"] as const) {
      assert.equal(optedOut.dimensions.find((d) => d.dimension === dim)!.score, 0, dim);
    }
    assert.match(optedOut.why, /Opted out\./);

    const refused = scoreLead({ facts: [...strongB2BFacts, { feature: "not_interested", value: true, source: "reply" }], archetypeKey: "B2B_SAAS" });
    assert.equal(refused.dimensions.find((d) => d.dimension === "INTENT")!.score, 0);
    assert.ok(refused.total < scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS" }).total);
  });

  test("NOT_QUALIFIED caps need even when a need was stated", () => {
    const result = scoreLead({
      facts: [
        { feature: "need_stated", value: true, source: "x" },
        { feature: "qualification_state", value: "NOT_QUALIFIED", source: "x" },
      ],
    });
    const need = result.dimensions.find((d) => d.dimension === "NEED")!;
    assert.ok(need.score <= need.max * 0.2 + 1e-9);
  });

  test("archetype × motion changes the weights; workspace overrides apply", () => {
    const local = scoreLead({ facts: [], archetypeKey: "ROOFER", motion: "LOCAL_SERVICE" });
    const saas = scoreLead({ facts: [], archetypeKey: "B2B_SAAS", motion: "BOOK_MEETING_B2B" });
    assert.ok(local.weights.TIMING > saas.weights.TIMING);
    const overridden = scoreLead({ facts: [], archetypeKey: "B2B_SAAS", weightOverrides: { ENGAGEMENT: 40 } });
    assert.ok(overridden.weights.ENGAGEMENT > saas.weights.ENGAGEMENT);
    assert.equal(SCORE_DIMENSIONS.reduce((s, d) => s + overridden.weights[d], 0), 100);
  });

  test("unknown archetype falls back to the default profile", () => {
    const result = scoreLead({ facts: [], archetypeKey: "NOT_A_THING" });
    assert.equal(result.archetypeKey, null);
    assert.equal(SCORE_DIMENSIONS.reduce((s, d) => s + result.weights[d], 0), 100);
  });
});

describe("grade bands", () => {
  test("band edges", () => {
    assert.equal(gradeForLeadScore(100), "A");
    assert.equal(gradeForLeadScore(80), "A");
    assert.equal(gradeForLeadScore(79.99), "B");
    assert.equal(gradeForLeadScore(60), "B");
    assert.equal(gradeForLeadScore(59.99), "C");
    assert.equal(gradeForLeadScore(40), "C");
    assert.equal(gradeForLeadScore(39.99), "D");
    assert.equal(gradeForLeadScore(0), "D");
  });
});

describe("feature allow-list and protected characteristics", () => {
  const protectedFeatures = [
    "age", "age_band", "date_of_birth", "dob", "gender", "sex", "sexual_orientation", "ethnicity",
    "race", "religion", "religious_belief", "health", "medical_history", "disability", "disabled",
    "political_party", "political_opinion", "trade_union_member", "pregnancy", "marital_status",
    "nationality", "genetic_marker", "biometric_id", "criminal_record", "customer_age",
  ];

  test("no allow-listed feature looks like a protected characteristic", () => {
    for (const feature of Object.keys(FEATURE_ALLOW_LIST)) {
      assert.doesNotMatch(feature, PROTECTED_FEATURE_PATTERN, feature);
    }
  });

  test("protected inputs are rejected with a distinct reason and never scored", () => {
    const facts: LeadFact[] = protectedFeatures.map((feature) => ({ feature, value: 1, source: "test" }));
    const { clean, rejected } = screenFacts(facts);
    assert.equal(clean.length, 0);
    assert.equal(rejected.length, protectedFeatures.length);
    for (const r of rejected) assert.equal(r.reason, "PROTECTED_CHARACTERISTIC", r.feature);

    const baseline = scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS" });
    const withProtected = scoreLead({ facts: [...strongB2BFacts, ...facts], archetypeKey: "B2B_SAAS" });
    assert.equal(withProtected.total, baseline.total);
    assert.deepEqual(withProtected.dimensions, baseline.dimensions);
    assert.equal(withProtected.rejected.length, protectedFeatures.length);
  });

  test("anything not allow-listed, and ill-typed values, are rejected", () => {
    const { clean, rejected } = screenFacts([
      { feature: "favourite_car_brand", value: 1, source: "x" },
      { feature: "postcode", value: "SW1A 1AA", source: "x" },
      { feature: "timeline_days", value: "soon", source: "x" },
      { feature: "role_authority", value: "EMPEROR", source: "x" },
      { feature: "company_size_match", value: 0.5, source: "x" },
    ]);
    assert.deepEqual(clean.map((f) => f.feature), ["company_size_match"]);
    assert.deepEqual(
      rejected.map((r) => r.reason),
      ["NOT_ALLOW_LISTED", "NOT_ALLOW_LISTED", "INVALID_VALUE", "INVALID_VALUE"],
    );
  });

  test("unit values are clamped", () => {
    const { clean } = screenFacts([{ feature: "industry_match", value: 4.2, source: "x" }]);
    assert.equal(clean[0].value, 1);
  });
});

describe("tags", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  test("every rule targets a known tag, and every tag has a rule", () => {
    assert.deepEqual([...new Set(TAG_RULES.map((r) => r.tag))].sort(), [...LEAD_TAGS].sort());
    for (const rule of TAG_RULES) assert.ok(rule.condition.length > 10, rule.tag);
  });

  test("a strong lead is HOT, HIGH_FIT, HIGH_INTENT, BUDGET_CONFIRMED and DECISION_MAKER", () => {
    const score = scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS" });
    const tags = deriveTags({ score, lifecycle: lifecycle(), replyClassifications: ["BOOKING_INTENT"], now });
    const names = tags.map((t) => t.tag);
    for (const tag of ["HOT", "HIGH_FIT", "HIGH_INTENT", "BUDGET_CONFIRMED", "DECISION_MAKER"]) {
      assert.ok(names.includes(tag as never), `expected ${tag}, got ${names.join(",")}`);
    }
    assert.ok(!names.includes("NEEDS_INFO"));
    for (const t of tags) {
      assert.equal(t.ruleVersion, TAG_RULE_VERSION);
      assert.ok(t.reason.length > 0);
      assert.ok(t.confidence >= 0 && t.confidence <= 1);
    }
  });

  test("an empty lead NEEDS_INFO and is not HOT", () => {
    const score = scoreLead({ facts: [] });
    const names = deriveTags({ score, lifecycle: lifecycle(), replyClassifications: [], now }).map((t) => t.tag);
    assert.ok(names.includes("NEEDS_INFO"));
    assert.ok(!names.includes("HOT"));
  });

  test("opted out is tagged and is never HOT", () => {
    const score = scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS" });
    const names = deriveTags({ score, lifecycle: lifecycle({ optedOut: true }), replyClassifications: [], now }).map((t) => t.tag);
    assert.ok(names.includes("OPTED_OUT"));
    assert.ok(!names.includes("HOT"));
  });

  test("lifecycle and reply rules", () => {
    const score = scoreLead({ facts: [] });
    const tagsFor = (l: Partial<TagLifecycle>, replies: string[] = []) =>
      deriveTags({ score, lifecycle: lifecycle(l), replyClassifications: replies, now }).map((t) => t.tag);

    assert.ok(tagsFor({ latestBookingStatus: "scheduled" }).includes("BOOKED"));
    assert.ok(tagsFor({ latestBookingStatus: "no_show" }).includes("NO_SHOW"));
    assert.ok(tagsFor({}, ["NOT_NOW"]).includes("NOT_NOW"));
    assert.ok(!tagsFor({}, ["POSITIVE_INTEREST", "NOT_NOW"]).includes("NOT_NOW"), "only the latest reply counts");
    assert.ok(tagsFor({}, ["HUMAN_REQUEST"]).includes("NEEDS_HUMAN"));
    assert.ok(tagsFor({ humanTakeover: true }).includes("NEEDS_HUMAN"));
    assert.ok(tagsFor({}, ["REFERRAL_TO_OTHER_PERSON"]).includes("WRONG_PERSON"));

    const quiet = { lastInboundAt: "2026-09-01T10:00:00Z", lastOutboundAt: "2026-09-10T10:00:00Z" };
    assert.ok(tagsFor(quiet).includes("GONE_QUIET"));
    assert.ok(!tagsFor({ ...quiet, lastOutboundAt: "2026-09-22T10:00:00Z" }).includes("GONE_QUIET"), "under 7 days");
    assert.ok(!tagsFor({ ...quiet, latestBookingStatus: "scheduled" }).includes("GONE_QUIET"));
    assert.ok(!tagsFor({ ...quiet, status: "WON" }).includes("GONE_QUIET"));
  });

  test("ENTERPRISE_POTENTIAL from stakeholders or value", () => {
    const byPeople = scoreLead({ facts: [{ feature: "stakeholder_count", value: 4, source: "x" }] });
    const byValue = scoreLead({ facts: [{ feature: "estimated_value_gbp", value: 80_000, source: "x" }] });
    for (const score of [byPeople, byValue]) {
      const names = deriveTags({ score, lifecycle: lifecycle(), replyClassifications: [], now }).map((t) => t.tag);
      assert.ok(names.includes("ENTERPRISE_POTENTIAL"));
    }
  });

  test("deterministic", () => {
    const score = scoreLead({ facts: strongB2BFacts, archetypeKey: "MSP" });
    const ctx = { score, lifecycle: lifecycle(), replyClassifications: ["POSITIVE_INTEREST"], now };
    assert.deepEqual(deriveTags(ctx), deriveTags(ctx));
  });
});

describe("ls-v2: one qualification score (design 08 §B.14)", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  test("with no archetype the brief's QUALIFICATION_DEFAULT shape applies", () => {
    const result = scoreLead({ facts: [], archetypeKey: "NOT_A_THING" });
    assert.equal(result.profileKey, "QUALIFICATION_DEFAULT");
    assert.equal(result.weights.NEED, 20);
    assert.equal(result.weights.TIMING, 15);
    // An archetype keeps its own shape.
    assert.notEqual(scoreLead({ facts: [], archetypeKey: "B2B_SAAS" }).profileKey, "QUALIFICATION_DEFAULT");
  });

  test("the intent assessment IS the INTENT dimension; the booleans become evidence", () => {
    const result = scoreLead({
      facts: [
        { feature: "booking_intent", value: true, source: "reply_classification" },
        { feature: "intent_assessment", value: 0.2, source: "intent_assessment", confidence: 0.7 },
      ],
    });
    const intent = result.dimensions.find((d) => d.dimension === "INTENT")!;
    assert.equal(intent.score, Math.round(intent.max * 0.2 * 100) / 100);
    assert.equal(intent.confidence, 0.7);
    assert.ok(intent.evidence.some((e) => e.feature === "booking_intent"), "the boolean is still explained");
    // Without it, the boolean MAX applies as before.
    const legacy = scoreLead({ facts: [{ feature: "booking_intent", value: true, source: "reply_classification" }] });
    assert.equal(legacy.dimensions.find((d) => d.dimension === "INTENT")!.score, legacy.dimensions.find((d) => d.dimension === "INTENT")!.max);
  });

  test("every dimension reports a status from the facts", () => {
    const result = scoreLead({ facts: strongB2BFacts, archetypeKey: "B2B_SAAS" });
    for (const d of result.dimensions) assert.ok(["KNOWN_POSITIVE", "KNOWN_NEGATIVE", "UNKNOWN", "CONFLICTING"].includes(d.status), d.dimension);
    assert.ok(result.dimensions.every((d) => d.status === "KNOWN_POSITIVE"));
    const empty = scoreLead({ facts: [] });
    assert.ok(empty.dimensions.every((d) => d.status === "UNKNOWN"), "nothing known is UNKNOWN, never KNOWN_NEGATIVE");
  });

  test("tags read the intent state when the engine ran", () => {
    const score = scoreLead({ facts: [] });
    const tags = (intentState: string | null, replies: string[] = []) =>
      deriveTags({ score, lifecycle: lifecycle(), replyClassifications: replies, now, intentState }).map((t) => t.tag);
    assert.ok(tags("BOOKING_READY").includes("HIGH_INTENT"));
    assert.ok(!tags("NEGATIVE").includes("HIGH_INTENT"));
    assert.ok(tags("NOT_NOW").includes("NOT_NOW"));
    // The engine lifted an old NOT_NOW: the latest classification no longer tags it.
    assert.ok(!tags("MEDIUM", ["NOT_NOW"]).includes("NOT_NOW"));
    // No engine: unchanged behaviour.
    assert.ok(tags(null, ["NOT_NOW"]).includes("NOT_NOW"));
    assert.match(TAG_RULE_VERSION, /^lt-v2/);
  });
});
