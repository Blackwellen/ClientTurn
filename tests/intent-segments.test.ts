import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SEGMENT_PRESETS,
  conditionSummary,
  evaluateSegment,
  intentSegmentSchema,
  parseSegment,
  segmentSummary,
  segmentTypes,
  unsatisfiableTypes,
  type IntentSegment,
  type SegmentEvidence,
} from "../src/lib/find-leads/intent-segments.ts";
import { INTENT_CATALOGUE } from "../src/lib/find-leads/intent-catalogue.ts";
import {
  emptyPlan,
  mergePlanPatch,
  parsePlan,
  planSummaryLines,
  planWantsIntent,
  signalsLabel,
  type SearchPlan,
} from "../src/lib/find-leads/plan.ts";
import { intentWantsFor, requestedEvidenceKinds, signalKindForPlan } from "../src/lib/find-leads/signals.ts";

/**
 * Combination segments: "raised funds in the last 90 days AND hiring a
 * marketing role". What must stay true: AND / OR and recency evaluate
 * exactly; a role function narrows; a type with no source can never match;
 * the sentence a customer reads is the segment; and every plan saved before
 * segments existed parses to the same search.
 */

const NOW = new Date("2026-09-27T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const funding = INTENT_CATALOGUE.filter((e) => e.group === "FUNDING" && e.sources.length > 0).map((e) => e.id);

const RAISED_AND_MARKETING: IntentSegment = {
  version: 1,
  op: "ALL",
  conditions: [
    { types: funding, withinDays: 90, roleFunction: null },
    { types: ["HIRING_ROLE"], withinDays: 90, roleFunction: "MARKETING" },
  ],
};

describe("evaluation", () => {
  test("AND needs every condition, inside its window", () => {
    const evidence: SegmentEvidence[] = [
      { intentType: "CAPITAL_RAISED", roleFunction: null, observedAt: ago(30) },
      { intentType: "HIRING_ROLE", roleFunction: "MARKETING", observedAt: ago(5) },
    ];
    const verdict = evaluateSegment(RAISED_AND_MARKETING, evidence, NOW);
    assert.equal(verdict.matched, true);
    assert.deepEqual(verdict.conditions.map((c) => c.matched), [true, true]);

    // Funding too old: the AND fails.
    assert.equal(
      evaluateSegment(RAISED_AND_MARKETING, [{ ...evidence[0], observedAt: ago(120) }, evidence[1]], NOW).matched,
      false,
    );
  });

  test("a role function narrows: an engineering vacancy is not a marketing one", () => {
    const evidence: SegmentEvidence[] = [
      { intentType: "SERIES_A", roleFunction: null, observedAt: ago(10) },
      { intentType: "HIRING_ROLE", roleFunction: "ENGINEERING", observedAt: ago(10) },
    ];
    assert.equal(evaluateSegment(RAISED_AND_MARKETING, evidence, NOW).matched, false);
  });

  test("OR needs any condition; nothing matches with no evidence", () => {
    const or: IntentSegment = { ...RAISED_AND_MARKETING, op: "ANY" };
    assert.equal(evaluateSegment(or, [{ intentType: "SEED_ROUND", roleFunction: null, observedAt: ago(1) }], NOW).matched, true);
    assert.equal(evaluateSegment(or, [], NOW).matched, false);
    assert.equal(evaluateSegment(RAISED_AND_MARKETING, [], NOW).matched, false);
  });

  test("new Head of Growth in the last 60 days", () => {
    const segment: IntentSegment = {
      version: 1,
      op: "ALL",
      conditions: [{ types: ["SENIOR_HIRE_HEAD_OF"], withinDays: 60, roleFunction: "MARKETING" }],
    };
    assert.equal(evaluateSegment(segment, [{ intentType: "SENIOR_HIRE_HEAD_OF", roleFunction: "MARKETING", observedAt: ago(59) }], NOW).matched, true);
    assert.equal(evaluateSegment(segment, [{ intentType: "SENIOR_HIRE_HEAD_OF", roleFunction: "MARKETING", observedAt: ago(61) }], NOW).matched, false);
    assert.equal(evaluateSegment(segment, [{ intentType: "SENIOR_HIRE_HEAD_OF", roleFunction: "SALES", observedAt: ago(5) }], NOW).matched, false);
    // Untyped evidence (a keyword mention) never satisfies a condition.
    assert.equal(evaluateSegment(segment, [{ intentType: null, roleFunction: null, observedAt: ago(1) }], NOW).matched, false);
  });

  test("a type with no lawful source is flagged, and never matches", () => {
    const impossible: IntentSegment = {
      version: 1,
      op: "ALL",
      conditions: [{ types: ["VISITED_YOUR_WEBSITE"], withinDays: 30, roleFunction: null }],
    };
    assert.deepEqual(unsatisfiableTypes(impossible), ["VISITED_YOUR_WEBSITE"]);
    assert.deepEqual(unsatisfiableTypes(RAISED_AND_MARKETING), []);
  });
});

describe("plain-English summaries", () => {
  test("the segment reads as one sentence", () => {
    assert.equal(
      segmentSummary(RAISED_AND_MARKETING),
      "Raised funds or changed ownership in the last 90 days AND hiring for a specific role (marketing and growth) in the last 90 days",
    );
    assert.equal(
      conditionSummary({ types: ["SENIOR_HIRE_HEAD_OF"], withinDays: 60, roleFunction: "MARKETING" }),
      "new Head of (marketing and growth) in the last 60 days",
    );
    assert.match(segmentSummary({ ...RAISED_AND_MARKETING, op: "ANY" }), / OR /);
    assert.equal(segmentSummary(null), "No combination");
  });

  test("every preset is a valid segment with a summary", () => {
    for (const preset of SEGMENT_PRESETS) {
      assert.ok(parseSegment(preset.segment), preset.name);
      assert.ok(segmentSummary(preset.segment).length > 20, preset.name);
      assert.deepEqual(unsatisfiableTypes(preset.segment), [], preset.name);
    }
  });
});

describe("schema and plan", () => {
  test("bounds are enforced", () => {
    assert.equal(parseSegment({ op: "ALL", conditions: [] }), null);
    assert.equal(parseSegment({ conditions: [{ types: ["NOT_A_TYPE"] }] }), null);
    assert.equal(parseSegment({ conditions: [{ types: ["REBRAND"], withinDays: 400 }] }), null);
    const parsed = intentSegmentSchema.parse({ conditions: [{ types: ["REBRAND"] }] });
    assert.deepEqual(parsed, { version: 1, op: "ALL", conditions: [{ types: ["REBRAND"], withinDays: 90, roleFunction: null }] });
  });

  test("a plan saved before segments and catalogue types parses to the same search", () => {
    const old = {
      version: 1,
      industries: ["Marketing agencies"],
      intent: { categories: ["New funding"], freshnessDays: 30, required: true },
      signals: { fundingFilings: true, hiringRoles: ["Head of Marketing"], technologies: [], leadershipChanges: false, recentlyIncorporated: false, officeMoves: false },
    };
    const plan = parsePlan(old)!;
    assert.ok(plan);
    assert.equal(plan.segment, null);
    assert.deepEqual(plan.signals.intentTypes, []);
    assert.deepEqual(plan.signals.roleFunctions, []);
    assert.equal(plan.signals.fundingFilings, true);
    // It asks for exactly the kinds it always did.
    assert.deepEqual(requestedEvidenceKinds(plan), ["FUNDING", "HIRING"]);
    assert.deepEqual(intentWantsFor(plan, []).types, []);
    assert.equal(signalKindForPlan(plan), "FUNDING");
    // An empty plan is unchanged apart from the new, empty fields.
    assert.equal(emptyPlan().segment, null);
    assert.equal(planWantsIntent(emptyPlan()), false);
  });

  test("a segment on the plan drives what is fetched, the summary and the kind", () => {
    const plan = parsePlan({ segment: RAISED_AND_MARKETING }) as SearchPlan;
    assert.ok(planWantsIntent(plan));
    const wants = intentWantsFor(plan, []);
    for (const id of segmentTypes(RAISED_AND_MARKETING)) assert.ok(wants.types.includes(id), id);
    assert.deepEqual(wants.roleFunctions, ["MARKETING"]);
    assert.ok(wants.kinds.includes("FUNDING") && wants.kinds.includes("HIRING"));
    assert.equal(signalKindForPlan(plan), "FUNDING");
    assert.ok(planSummaryLines(plan).some((line) => line.label === "Combination" && / AND /.test(line.value)));
  });

  test("an un-narrowed hiring condition wants every function", () => {
    const plan = parsePlan({
      segment: {
        op: "ANY",
        conditions: [
          { types: ["HIRING_ROLE"], roleFunction: "MARKETING" },
          { types: ["SENIOR_HIRE_C_LEVEL"], roleFunction: null },
        ],
      },
    }) as SearchPlan;
    assert.deepEqual(intentWantsFor(plan, []).roleFunctions, []);
  });

  test("catalogue types on the plan are labelled and fetched; unavailable ones are not fetched", () => {
    const plan = parsePlan({ signals: { intentTypes: ["SERIES_A", "PERSONAL_JOB_CHANGE"], roleFunctions: [] } }) as SearchPlan;
    assert.ok(signalsLabel(plan.signals).some((line) => line.includes("Series A")));
    assert.deepEqual(intentWantsFor(plan, []).types, ["SERIES_A"]);
  });

  test("the agent can set and clear a segment; a malformed one is dropped", () => {
    const set = mergePlanPatch(emptyPlan(), { segment: RAISED_AND_MARKETING });
    assert.equal(set.changed, true);
    assert.equal(set.plan.segment?.conditions.length, 2);
    const cleared = mergePlanPatch(set.plan, { segment: null });
    assert.equal(cleared.plan.segment, null);
    const bad = mergePlanPatch(set.plan, { segment: { conditions: [{ types: ["NOPE"] }] } });
    assert.equal(bad.changed, false);
    assert.equal(bad.plan.segment?.conditions.length, 2);
  });
});
