/**
 * The qualification fact store (design 08 §B.12, CD-5 / CD-8) and the one
 * qualification score's statuses and completeness (§B.14).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  qualificationFactWriteSchema,
  type QualificationFact,
  type QualificationFactWrite,
} from "../src/lib/qualification-intelligence/types.ts";
import {
  answerFactWrite,
  countsAsKnown,
  deriveDimensionStatuses,
  factValidUntil,
  isMaterialDimension,
  knownDimensions,
  leadFieldFactWrite,
  mergeFact,
  normaliseFactValue,
  qualificationCompleteness,
  verificationNeeded,
} from "../src/lib/qualification-intelligence/facts.ts";
import { conflictingScoreDimensions, factAnswers, needStatedFact } from "../src/lib/scoring/answer-features.ts";
import { QUALIFICATION_DEFAULT_PROFILE, SCORING_VERSION, scoreLead } from "../src/lib/scoring/lead-score.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const DAY = 86_400_000;
const LEAD = "33333333-3333-4333-8333-333333333333";
const Q1 = "44444444-4444-4444-8444-444444444444";
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

let seq = 0;
function fact(partial: Partial<QualificationFact> & Pick<QualificationFact, "dimension" | "value">): QualificationFact {
  seq += 1;
  return {
    id: `00000000-0000-4000-a000-${String(seq).padStart(12, "0")}`,
    leadId: LEAD,
    serviceId: null,
    valueNormalised: null,
    state: "CONFIRMED",
    source: "ANSWER",
    sourceRef: `ref-${seq}`,
    questionId: null,
    questionIntentKey: null,
    confidence: 1,
    observedAt: ago(DAY),
    validUntil: null,
    verifiedAt: null,
    setBy: null,
    supersededAt: null,
    ...partial,
  };
}

function write(partial: Partial<QualificationFactWrite> & Pick<QualificationFactWrite, "dimension" | "value">): QualificationFactWrite {
  seq += 1;
  return {
    lead_id: LEAD,
    service_id: null,
    value_normalised: null,
    state: "CONFIRMED",
    source: "ANSWER",
    source_ref: `w-${seq}`,
    question_id: null,
    question_intent_key: null,
    confidence: 1,
    observed_at: NOW.toISOString(),
    valid_until: null,
    verified_at: null,
    set_by: null,
    ...partial,
  };
}

describe("values and validity", () => {
  test("the same thing said two ways normalises the same", () => {
    assert.equal(normaliseFactValue("COMPANY_SIZE", "40 staff"), normaliseFactValue("COMPANY_SIZE", "about forty"));
    assert.equal(normaliseFactValue("BUDGET", "£5k"), normaliseFactValue("BUDGET", "5000"));
    assert.equal(normaliseFactValue("LOCATION", "SW1A 1AA"), normaliseFactValue("LOCATION", "sw1a"));
    assert.equal(normaliseFactValue("TIMING", "ASAP"), "days:7");
  });

  test("validity windows: TIMING stated + 14 d, BUDGET and AUTHORITY 180 d, CURRENT_SOLUTION 365 d, others none", () => {
    const at = NOW.toISOString();
    assert.equal(factValidUntil("BUDGET", at), new Date(NOW.getTime() + 180 * DAY).toISOString());
    assert.equal(factValidUntil("AUTHORITY", at), new Date(NOW.getTime() + 180 * DAY).toISOString());
    assert.equal(factValidUntil("CURRENT_SOLUTION", at), new Date(NOW.getTime() + 365 * DAY).toISOString());
    assert.equal(factValidUntil("PROBLEM", at), null);
    assert.equal(factValidUntil("TIMING", at, { statedDate: "2026-11-01" }), new Date(Date.parse("2026-11-01") + 14 * DAY).toISOString());
    assert.equal(factValidUntil("TIMING", at, { value: "in 2 weeks" }), new Date(NOW.getTime() + 28 * DAY).toISOString());
  });

  test("BUDGET and AUTHORITY are always material; LOCATION only under a service-area rule", () => {
    assert.equal(isMaterialDimension("BUDGET"), true);
    assert.equal(isMaterialDimension("AUTHORITY"), true);
    assert.equal(isMaterialDimension("LOCATION"), false);
    assert.equal(isMaterialDimension("LOCATION", { serviceAreaRule: true }), true);
    assert.equal(isMaterialDimension("COMPANY_SIZE", { requiredDimensions: ["COMPANY_SIZE"] }), true);
    assert.equal(isMaterialDimension("TIMING", { ruleDimensions: ["TIMING"] }), true);
  });
});

describe("merging a new fact (§B.12)", () => {
  test("the same source event twice is a no-op (a retried job)", () => {
    const existing = fact({ dimension: "TIMING", value: "next month", sourceRef: "m1" });
    const d = mergeFact([existing], write({ dimension: "TIMING", value: "next month", source_ref: "m1" }), NOW);
    assert.equal(d.action, "SKIP");
  });

  test("the lead's direct answer supersedes whatever was there, conflicts included", () => {
    const a = fact({ dimension: "COMPANY_SIZE", value: "10", state: "CONFLICTING", source: "FORM" });
    const b = fact({ dimension: "COMPANY_SIZE", value: "40", state: "CONFLICTING", source: "REPLY" });
    const d = mergeFact([a, b], write({ dimension: "COMPANY_SIZE", value: "40 staff", source: "ANSWER" }), NOW);
    assert.equal(d.action, "INSERT");
    assert.equal(d.state, "CONFIRMED");
    assert.deepEqual(d.supersede.sort(), [a.id, b.id].sort());
  });

  test("two confirmations that disagree are CONFLICTING", () => {
    const form = fact({ dimension: "COMPANY_SIZE", value: "10 people", source: "FORM" });
    const d = mergeFact([form], write({ dimension: "COMPANY_SIZE", value: "we're 40 staff", source: "REPLY" }), NOW);
    assert.equal(d.state, "CONFLICTING");
    assert.deepEqual(d.markConflicting, [form.id]);
  });

  test("agreeing confirmations are not a conflict", () => {
    const form = fact({ dimension: "COMPANY_SIZE", value: "40", source: "FORM" });
    const d = mergeFact([form], write({ dimension: "COMPANY_SIZE", value: "forty", source: "REPLY" }), NOW);
    assert.equal(d.action, "SKIP");
  });

  test("an inference never overrides a confirmation", () => {
    const confirmed = fact({ dimension: "LOCATION", value: "M1 1AA" });
    const d = mergeFact([confirmed], write({ dimension: "LOCATION", value: "LS1 4AP", state: "INFERRED", source: "ENRICHMENT", confidence: 0.8 }), NOW);
    assert.equal(d.action, "SKIP");
  });

  test("two sources' inferences that disagree are CONFLICTING", () => {
    const crm = fact({ dimension: "COMPANY_SIZE", value: "10", state: "INFERRED", source: "CRM", confidence: 0.9 });
    const d = mergeFact([crm], write({ dimension: "COMPANY_SIZE", value: "250", state: "INFERRED", source: "ENRICHMENT", confidence: 0.8 }), NOW);
    assert.equal(d.state, "CONFLICTING");
    assert.deepEqual(d.markConflicting, [crm.id]);
  });

  test("a newer reading from the same slot supersedes the older one", () => {
    const old = fact({ dimension: "LOCATION", value: "M1", state: "INFERRED", source: "LEAD_FIELD", confidence: 0.9 });
    const d = mergeFact([old], write({ dimension: "LOCATION", value: "LS1", state: "INFERRED", source: "LEAD_FIELD", confidence: 0.9 }), NOW);
    assert.equal(d.action, "INSERT");
    assert.equal(d.state, "INFERRED");
    assert.deepEqual(d.supersede, [old.id]);
  });

  test("the AI assist never confirms, never creates a conflict and never overrides (CLAUDE.md conflict 1)", () => {
    assert.equal(mergeFact([], write({ dimension: "BUDGET", value: "5k", source: "AI_ASSIST", state: "CONFIRMED", confidence: 0.99 }), NOW).action, "SKIP");
    assert.equal(mergeFact([], write({ dimension: "BUDGET", value: "5k", source: "AI_ASSIST", state: "INFERRED", confidence: 0.8 }), NOW).action, "SKIP");
    const ok = mergeFact([], write({ dimension: "BUDGET", value: "5k", source: "AI_ASSIST", state: "INFERRED", confidence: 0.9 }), NOW);
    assert.equal(ok.state, "INFERRED");
    const other = fact({ dimension: "BUDGET", value: "20000", state: "INFERRED", source: "CRM", confidence: 0.9 });
    assert.equal(mergeFact([other], write({ dimension: "BUDGET", value: "5k", source: "AI_ASSIST", state: "INFERRED", confidence: 0.95 }), NOW).action, "SKIP");
    // ... and a deterministic inference replaces an AI one.
    const ai = fact({ dimension: "BUDGET", value: "5k", state: "INFERRED", source: "AI_ASSIST", confidence: 0.9 });
    const d = mergeFact([ai], write({ dimension: "BUDGET", value: "20000", state: "INFERRED", source: "CRM", confidence: 0.9 }), NOW);
    assert.equal(d.state, "INFERRED");
    assert.deepEqual(d.supersede, [ai.id]);
  });

  test("the contract schema refuses an AI_ASSIST confirmation outright", () => {
    const parsed = qualificationFactWriteSchema.safeParse(write({ dimension: "BUDGET", value: "5k", source: "AI_ASSIST", state: "CONFIRMED" }));
    assert.equal(parsed.success, false);
  });

  test("a rejected inference is not re-made", () => {
    const rejected = fact({ dimension: "AUTHORITY", value: "decision maker", state: "REJECTED", source: "ENRICHMENT" });
    const d = mergeFact([rejected], write({ dimension: "AUTHORITY", value: "Decision maker", state: "INFERRED", source: "ENRICHMENT", confidence: 0.9 }), NOW);
    assert.equal(d.action, "SKIP");
  });

  test("stale facts are superseded by any new fact", () => {
    const stale = fact({ dimension: "BUDGET", value: "£5k", validUntil: ago(DAY) });
    const d = mergeFact([stale], write({ dimension: "BUDGET", value: "£8k", state: "INFERRED", source: "CRM", confidence: 0.9 }), NOW);
    assert.equal(d.action, "INSERT");
    assert.equal(d.state, "INFERRED");
    assert.deepEqual(d.supersede, [stale.id]);
  });
});

describe("derived dimension status: CONFIRMED / INFERRED / UNKNOWN / CONFLICTING", () => {
  const plan = ["PROBLEM", "TIMING", "BUDGET", "AUTHORITY", "COMPANY_SIZE"] as const;
  const facts = [
    fact({ dimension: "PROBLEM", value: "slow website" }),
    fact({ dimension: "BUDGET", value: "£5k", state: "INFERRED", source: "CRM", confidence: 0.9 }),
    fact({ dimension: "COMPANY_SIZE", value: "10", state: "CONFLICTING", source: "FORM" }),
    fact({ dimension: "COMPANY_SIZE", value: "40", state: "CONFLICTING", source: "REPLY" }),
    fact({ dimension: "AUTHORITY", value: "yes", validUntil: ago(DAY) }),
    fact({ dimension: "TIMING", value: "next week", supersededAt: ago(DAY) }),
  ];
  const statuses = deriveDimensionStatuses(facts, NOW, { planDimensions: [...plan], required: ["PROBLEM", "TIMING", "COMPANY_SIZE"] });
  const of = (d: string) => statuses.find((s) => s.dimension === d)!;

  test("UNKNOWN is derived (never stored) and every plan dimension is listed", () => {
    assert.deepEqual(statuses.map((s) => s.dimension), [...plan]);
    assert.equal(of("TIMING").status, "UNKNOWN");
    assert.deepEqual(of("TIMING").fact_ids, []);
  });

  test("CONFIRMED, INFERRED (material), CONFLICTING and stale last-known", () => {
    assert.equal(of("PROBLEM").status, "CONFIRMED");
    assert.equal(of("BUDGET").status, "INFERRED");
    assert.equal(of("BUDGET").material, true);
    assert.equal(of("COMPANY_SIZE").status, "CONFLICTING");
    assert.equal(of("COMPANY_SIZE").fact_ids.length, 2);
    assert.equal(of("AUTHORITY").status, "INFERRED");
    assert.equal(of("AUTHORITY").stale, true);
  });

  test("known for thresholds: CONFIRMED or a fresh non-material inference only", () => {
    assert.deepEqual(knownDimensions(statuses), ["PROBLEM"]);
    assert.equal(countsAsKnown(of("BUDGET")), false, "a material inference must be verified first");
    assert.equal(countsAsKnown(of("AUTHORITY")), false, "stale is not known");
  });

  test("what needs a VERIFY or a CLARIFY question", () => {
    const needs = verificationNeeded(statuses);
    assert.deepEqual(
      needs.map((n) => `${n.dimension}:${n.purpose}`).sort(),
      ["AUTHORITY:VERIFY", "BUDGET:VERIFY", "COMPANY_SIZE:CLARIFY"],
    );
  });

  test("completeness is the share of required dimensions known; UNKNOWN lowers it, it is not a negative", () => {
    assert.equal(qualificationCompleteness(statuses), 0.333);
    assert.equal(qualificationCompleteness([]), 1);
  });
});

describe("builders", () => {
  test("a stored answer mirrors as CONFIRMED; an AI-matched one as INFERRED, or nothing below 0.85", () => {
    const base = { leadId: LEAD, serviceId: null, questionId: Q1, dimension: "TIMING" as const, questionIntentKey: null, value: "in 2 weeks", answeredAt: NOW.toISOString() };
    const typed = answerFactWrite({ ...base, answerSource: "reply", confidence: null })!;
    assert.equal(typed.state, "CONFIRMED");
    assert.equal(typed.source, "ANSWER");
    assert.ok(qualificationFactWriteSchema.safeParse(typed).success);
    const ai = answerFactWrite({ ...base, answerSource: "reply", confidence: 0.9 })!;
    assert.equal(ai.state, "INFERRED");
    assert.equal(ai.source, "AI_ASSIST");
    assert.ok(qualificationFactWriteSchema.safeParse(ai).success);
    assert.equal(answerFactWrite({ ...base, answerSource: "ai_assist", confidence: 0.7 }), null);
  });

  test("a question with no dimension mirrors as UNMAPPED with its custom intent key", () => {
    const w = answerFactWrite({ leadId: LEAD, serviceId: null, questionId: Q1, dimension: null, questionIntentKey: null, value: "Blue", answerSource: "reply", confidence: null, answeredAt: NOW.toISOString() })!;
    assert.equal(w.dimension, "UNMAPPED");
    assert.equal(w.question_intent_key, `custom:${Q1}`);
    assert.ok(qualificationFactWriteSchema.safeParse(w).success);
  });

  test("a lead field is INFERRED", () => {
    const w = leadFieldFactWrite({ leadId: LEAD, serviceId: null, dimension: "LOCATION", value: "M1 1AA", observedAt: NOW.toISOString() })!;
    assert.equal(w.state, "INFERRED");
    assert.equal(w.source, "LEAD_FIELD");
    assert.ok(qualificationFactWriteSchema.safeParse(w).success);
    assert.equal(leadFieldFactWrite({ leadId: LEAD, serviceId: null, dimension: "LOCATION", value: "  ", observedAt: NOW.toISOString() }), null);
  });
});

describe("the one qualification score, ls-v2 (§B.14)", () => {
  test("versioned ls-v2, with the brief's default shape when there is no archetype", () => {
    assert.match(SCORING_VERSION, /^ls-v2/);
    const w = QUALIFICATION_DEFAULT_PROFILE.weights;
    assert.deepEqual([w.NEED, w.FIT, w.INTENT, w.TIMING, w.COMMERCIAL, w.DECISION_ACCESS, w.ENGAGEMENT], [20, 20, 20, 15, 10, 10, 5]);
    const result = scoreLead({ facts: [] });
    assert.equal(result.profileKey, "QUALIFICATION_DEFAULT");
    assert.deepEqual(result.weights, w);
  });

  test("UNKNOWN is not NEGATIVE: no evidence is UNKNOWN and caps nothing", () => {
    const unknown = scoreLead({ facts: [{ feature: "need_stated", value: true, source: "x" }] });
    const commercial = unknown.dimensions.find((d) => d.dimension === "COMMERCIAL")!;
    assert.equal(commercial.status, "UNKNOWN");
    const refused = scoreLead({
      facts: [
        { feature: "need_stated", value: true, source: "x" },
        { feature: "budget_confirmed", value: false, source: "x" },
      ],
    });
    assert.equal(refused.dimensions.find((d) => d.dimension === "COMMERCIAL")!.status, "KNOWN_NEGATIVE");
    assert.equal(unknown.dimensions.find((d) => d.dimension === "NEED")!.status, "KNOWN_POSITIVE");
    assert.equal(unknown.total, refused.total, "an unknown budget scores what a refused one does (0), but is labelled differently");
  });

  test("a veto is KNOWN_NEGATIVE; a conflicting fact is CONFLICTING and named in the why", () => {
    const vetoed = scoreLead({ facts: [{ feature: "opted_out", value: true, source: "lead" }] });
    assert.equal(vetoed.dimensions.find((d) => d.dimension === "INTENT")!.status, "KNOWN_NEGATIVE");
    const conflicted = scoreLead({ facts: [], conflictingDimensions: ["FIT"] });
    assert.equal(conflicted.dimensions.find((d) => d.dimension === "FIT")!.status, "CONFLICTING");
    assert.match(conflicted.why, /Conflicting: offer fit/);
  });

  test("completeness is carried through, clamped", () => {
    assert.equal(scoreLead({ facts: [], completeness: 0.6667 }).completeness, 0.667);
    assert.equal(scoreLead({ facts: [] }).completeness, null);
  });

  test("facts feed the score: confirmed counts, inferred counts less, conflicting and stale not at all", () => {
    const facts = [
      fact({ dimension: "TIMING", value: "in 2 weeks" }),
      fact({ dimension: "BUDGET", value: "£5k", state: "INFERRED", source: "CRM", confidence: 0.9 }),
      fact({ dimension: "AUTHORITY", value: "yes", state: "CONFLICTING" }),
      fact({ dimension: "STAKEHOLDERS", value: "3", validUntil: ago(DAY) }),
      fact({ dimension: "PROBLEM", value: "leads going cold" }),
    ];
    const answers = factAnswers(facts, NOW);
    assert.deepEqual(answers.map((a) => a.dimension).sort(), ["BUDGET", "PROBLEM", "TIMING"]);
    assert.equal(answers.find((a) => a.dimension === "BUDGET")!.confidence, 0.72);
    assert.deepEqual(conflictingScoreDimensions(facts), ["DECISION_ACCESS"]);
    assert.ok(needStatedFact(facts, NOW));
  });
});
