import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeExperimentResult, type ArmOutcomes, type ExperimentVariant } from "../src/lib/learning/experiments.ts";
import {
  assertPromotionAllowed,
  AutoPromotionRefused,
  decidePromotion,
  promotionRecord,
  rollbackRecord,
  sensitiveFieldsOf,
  servedArm,
  twoProportionPValue,
  type PromotionInput,
} from "../src/lib/learning/promotion.ts";

const VARIANTS: ExperimentVariant[] = [
  { key: "A", label: "Control" },
  { key: "B", label: "Shorter follow-up", templates: { "0": "Hi {first_name}, did you get a chance to look at times for a quick call this week?" } },
];

function arms(a: [number, number], b: [number, number]): ArmOutcomes[] {
  return [
    { arm: "A", leads: a[0], wins: 0, bookings: a[1], positiveReplies: 0, optOuts: 0 },
    { arm: "B", leads: b[0], wins: 0, bookings: b[1], positiveReplies: 0, optOuts: 0 },
  ];
}

function input(outcomes: ArmOutcomes[], over: Partial<PromotionInput> = {}): PromotionInput {
  return {
    kind: "WARM_FOLLOW_UP",
    status: "RUNNING",
    promotedArm: null,
    variants: VARIANTS,
    metric: "BOOKING",
    minSamplePerArm: 100,
    arms: outcomes,
    result: computeExperimentResult({ metric: "BOOKING", minSamplePerArm: 100, arms: outcomes }),
    autoPromote: false,
    ...over,
  };
}

// A clear, significant win: 10% vs 20% on 400 per arm.
const STRONG = arms([400, 40], [400, 80]);

describe("significance", () => {
  test("two-proportion z-test matches a known value", () => {
    // 80/400 vs 40/400: pooled 0.15, se = 0.02525, z = 3.96, two-sided p = 7.5e-5.
    const p = twoProportionPValue({ x: 80, n: 400 }, { x: 40, n: 400 });
    assert.ok(p > 0.00006 && p < 0.00009, `p = ${p}`);
    // 55/500 vs 40/500: z = 1.59, p = 0.112 (not significant at 0.05).
    const q = twoProportionPValue({ x: 55, n: 500 }, { x: 40, n: 500 });
    assert.ok(q > 0.10 && q < 0.125, `p = ${q}`);
  });
  test("no evidence at all gives p = 1", () => {
    assert.equal(twoProportionPValue({ x: 0, n: 100 }, { x: 0, n: 100 }), 1);
    assert.equal(twoProportionPValue({ x: 1, n: 0 }, { x: 0, n: 100 }), 1);
  });
});

describe("sample-size gates", () => {
  test("below the minimum per arm: HOLD, however big the gap", () => {
    const d = decidePromotion(input(arms([99, 5], [99, 50]), { autoPromote: true }));
    assert.equal(d.action, "HOLD");
    assert.match(d.reasons[0], /at least 100 leads/);
  });
  test("a minimum below the 0131 floor is raised to 100", () => {
    const d = decidePromotion(input(arms([60, 3], [60, 30]), { minSamplePerArm: 10, autoPromote: true }));
    assert.equal(d.action, "HOLD");
  });
  test("no credible winner: HOLD", () => {
    const d = decidePromotion(input(arms([400, 40], [400, 44]), { autoPromote: true }));
    assert.equal(d.action, "HOLD");
  });
  test("not running or already promoted: HOLD", () => {
    assert.equal(decidePromotion(input(STRONG, { status: "STOPPED" })).action, "HOLD");
    assert.equal(decidePromotion(input(STRONG, { promotedArm: "B" })).action, "HOLD");
  });
  test("a variant that raises opt-outs cannot be promoted", () => {
    const harmful: ArmOutcomes[] = [
      { arm: "A", leads: 400, wins: 0, bookings: 40, positiveReplies: 0, optOuts: 2 },
      { arm: "B", leads: 400, wins: 0, bookings: 80, positiveReplies: 0, optOuts: 40 },
    ];
    assert.equal(decidePromotion(input(harmful, { autoPromote: true })).action, "HOLD");
  });
});

describe("default is suggest; auto needs opt-in and significance", () => {
  test("a significant winner is only SUGGESTED by default", () => {
    const d = decidePromotion(input(STRONG));
    assert.equal(d.action, "SUGGEST_PROMOTE");
    assert.equal(d.candidate, "B");
    assert.ok((d.pValue ?? 1) < 0.05);
  });
  test("with the opt-in, a significant non-sensitive winner may auto-promote", () => {
    assert.equal(decidePromotion(input(STRONG, { autoPromote: true })).action, "AUTO_PROMOTE");
  });
  test("a stricter alpha turns auto into suggest", () => {
    const d = decidePromotion(input(STRONG, { autoPromote: true, alpha: 0.00005 }));
    assert.equal(d.action, "SUGGEST_PROMOTE");
  });
  test("an unattended (AUTO) promotion is refused on a suggestion; a person may confirm it", () => {
    const d = decidePromotion(input(STRONG));
    assert.throws(() => assertPromotionAllowed(d, "AUTO"), AutoPromotionRefused);
    assert.equal(assertPromotionAllowed(d, "HUMAN"), "B");
  });
  test("HOLD is refused for everyone", () => {
    const d = decidePromotion(input(arms([50, 1], [50, 2])));
    assert.throws(() => assertPromotionAllowed(d, "HUMAN"), AutoPromotionRefused);
  });
});

describe("compliance-sensitive fields are never auto-promoted", () => {
  test("a voice opener experiment", () => {
    const d = decidePromotion(input(STRONG, { kind: "VOICE_OPENER", autoPromote: true }));
    assert.equal(d.action, "SUGGEST_PROMOTE");
    assert.deepEqual(d.sensitiveFields, ["opener", "disclosure"]);
    assert.throws(() => assertPromotionAllowed(d, "AUTO"), AutoPromotionRefused);
  });
  test("pricing wording in a variant", () => {
    const priced: ExperimentVariant[] = [VARIANTS[0], { key: "B", label: "Offer", templates: { "0": "We can do it for £450, 10% off this month." } }];
    const d = decidePromotion(input(STRONG, { variants: priced, autoPromote: true }));
    assert.equal(d.action, "SUGGEST_PROMOTE");
    assert.ok(d.sensitiveFields.includes("pricing"));
  });
  test("disclosure wording in a variant", () => {
    const disclosure: ExperimentVariant[] = [VARIANTS[0], { key: "B", label: "Disclosure", templates: { "0": "This is an automated assistant. Reply STOP to opt out." } }];
    assert.ok(sensitiveFieldsOf("WARM_FOLLOW_UP", disclosure).includes("disclosure"));
    assert.equal(decidePromotion(input(STRONG, { variants: disclosure, autoPromote: true })).action, "SUGGEST_PROMOTE");
  });
  test("a declared opener change", () => {
    const declared = [VARIANTS[0], { ...VARIANTS[1], changes: ["opener"] }];
    assert.deepEqual(sensitiveFieldsOf("WARM_FOLLOW_UP", declared), ["opener"]);
  });
  test("plain copy with no sensitive field is not flagged", () => {
    assert.deepEqual(sensitiveFieldsOf("WARM_FOLLOW_UP", VARIANTS), []);
  });
});

describe("history, rollback and serving", () => {
  test("promotion record keeps control, variant, version, sample, conversion and confidence", () => {
    const d = decidePromotion(input(STRONG));
    const rec = promotionRecord({ experimentId: "e1", version: 1, decision: d, decidedBy: "HUMAN", reason: "B books more", at: "2026-09-27T10:00:00Z" });
    assert.equal(rec.action, "PROMOTE");
    assert.equal(rec.arm, "B");
    assert.equal(rec.fromArm, "A");
    assert.equal(rec.version, 2);
    assert.deepEqual(rec.sampleByArm, { A: 400, B: 400 });
    assert.deepEqual(rec.conversionByArm, { A: 0.1, B: 0.2 });
    assert.ok(rec.pValue !== null && rec.pValue < 0.05);
  });
  test("rollback always returns to control, and needs something promoted", () => {
    const rec = rollbackRecord({ experimentId: "e1", version: 2, promotedArm: "B", reason: "Complaints", at: "2026-09-28T10:00:00Z" });
    assert.equal(rec.arm, "A");
    assert.equal(rec.fromArm, "B");
    assert.equal(rec.version, 3);
    assert.throws(() => rollbackRecord({ experimentId: "e1", version: 3, promotedArm: null, reason: "x", at: "2026-09-28T10:00:00Z" }));
  });
  test("a promoted experiment serves the winner to everyone, else the assigned arm", () => {
    assert.equal(servedArm("B", () => "HOLDOUT"), "B");
    assert.equal(servedArm(null, () => "A"), "A");
  });
});
