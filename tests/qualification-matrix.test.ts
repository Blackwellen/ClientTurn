import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  BEHAVIOURS,
  FULL_CASE_COUNT,
  INFORMATION,
  INTENT_LEVELS,
  PROFILES,
  ROLES,
  allCases,
  allPairsCases,
  allPairsIndices,
  checkInvariants,
  runCase,
  type MatrixCase,
  type Violation,
} from "./qualification-intel/matrix.ts";
import { GOAL_KEYS, nextBestActionSchema } from "../src/lib/qualification-intelligence/types.ts";

const FULL = process.env.MATRIX_FULL === "1";

function run(cases: Iterable<MatrixCase>) {
  const violations: (Violation & { case: string })[] = [];
  const byInvariant: Record<string, number> = {};
  const actions: Record<string, number> = {};
  let count = 0;
  for (const c of cases) {
    count += 1;
    const result = runCase(c);
    actions[result.nba.next_action] = (actions[result.nba.next_action] ?? 0) + 1;
    for (const v of checkInvariants(c, result)) {
      byInvariant[v.invariant] = (byInvariant[v.invariant] ?? 0) + 1;
      if (violations.length < 20) {
        violations.push({ ...v, case: `${c.profile.key}/${c.intent}/${c.information}/${c.role}/${c.behaviour}/${c.goal}` });
      }
    }
  }
  return { count, violations, byInvariant, actions };
}

describe("qualification matrix: shape", () => {
  test("the full matrix is 7 x 8 x 5 x 5 x 9 x 7 = 88,200 cases", () => {
    assert.equal(PROFILES.length, 7);
    assert.equal(INTENT_LEVELS.length, 8);
    assert.equal(INFORMATION.length, 5);
    assert.equal(ROLES.length, 5);
    assert.equal(BEHAVIOURS.length, 9);
    assert.equal(GOAL_KEYS.length, 7);
    assert.equal(FULL_CASE_COUNT, 88_200);
  });

  test("the all-pairs subset covers every pair of parameter values", () => {
    const rows = allPairsIndices();
    const sizes = [7, 8, 5, 5, 9, 7];
    for (let p = 0; p < sizes.length; p++) {
      for (let q = p + 1; q < sizes.length; q++) {
        const seen = new Set(rows.map((r) => `${r[p]}:${r[q]}`));
        assert.equal(seen.size, sizes[p] * sizes[q], `pair (${p}, ${q}) not fully covered`);
      }
    }
    assert.ok(rows.length < 200, `all-pairs should be small, got ${rows.length}`);
  });
});

describe("qualification matrix: §C.4 invariants", () => {
  test(`${FULL ? "full matrix" : "all-pairs subset"}: no invariant is violated`, () => {
    const { count, violations, byInvariant, actions } = run(FULL ? allCases() : allPairsCases());
    // Surfaces in the test output: how many cases ran and what the engine chose.
    console.log(`[qualification-matrix] ${count} cases; actions ${JSON.stringify(actions)}`);
    assert.deepEqual(byInvariant, {}, `violations: ${JSON.stringify(violations, null, 1)}`);
    assert.ok(count >= (FULL ? FULL_CASE_COUNT : 60));
  });

  test("a seeded sample of the full product also holds (2,000 cases)", () => {
    const all = [...allCases()];
    let seed = 20260926;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const sample: MatrixCase[] = [];
    for (let i = 0; i < 2_000; i++) sample.push(all[next() % all.length]);
    const { byInvariant, violations } = run(sample);
    assert.deepEqual(byInvariant, {}, JSON.stringify(violations, null, 1));
  });

  test("every NBA the matrix produces validates against the contract", () => {
    for (const c of allPairsCases().slice(0, 40)) {
      assert.doesNotThrow(() => nextBestActionSchema.parse(runCase(c).nba));
    }
  });

  test("deterministic: the same case gives the same NBA", () => {
    for (const c of allPairsCases().slice(0, 25)) {
      assert.deepEqual(runCase(c).nba, runCase(c).nba);
    }
  });
});

describe("qualification matrix: behaviour differs by industry, offer and goal", () => {
  const base = (profileIndex: number, goal: MatrixCase["goal"]): MatrixCase => ({
    profile: PROFILES[profileIndex],
    intent: "medium",
    information: "empty",
    role: "unknown",
    behaviour: "one_word",
    goal,
  });

  test("the first question differs across business types", () => {
    const asked = new Set(PROFILES.map((_, i) => runCase(base(i, "B_BOOK_MEETING")).nba.question_intent?.key ?? "none"));
    assert.ok(asked.size >= 4, `only ${[...asked].join(", ")}`);
  });

  test("the close action differs by goal once the threshold is met", () => {
    const closeFor = (goal: MatrixCase["goal"]) => runCase({ ...base(1, goal), information: "threshold", role: "decision_maker" }).nba.next_action;
    assert.equal(closeFor("B_BOOK_MEETING"), "CTA_BOOK");
    assert.equal(closeFor("C_DIRECT_SALE"), "CTA_CHECKOUT");
    assert.equal(closeFor("D_SIGNUP_TRIAL"), "CTA_SIGNUP");
    assert.equal(closeFor("A_QUALIFY_ONLY"), "ESCALATE");
    // Owner decision 2026-09-27: goal E closes with a booked meeting (was ESCALATE).
    assert.equal(closeFor("E_HUMAN_CLOSER"), "CTA_BOOK");
  });

  test("the roofer is never asked about authority, stakeholders or budget", () => {
    for (const c of allPairsCases().filter((x) => x.profile.key === "roofer")) {
      const q = runCase(c).nba.question_intent;
      if (q) assert.ok(!["AUTHORITY", "STAKEHOLDERS", "BUDGET", "DECISION_PROCESS"].includes(q.dimension), q.key);
    }
  });
});
