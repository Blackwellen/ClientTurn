import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkPlanReadiness,
  emptyPlan,
  mergePlanPatch,
  parsePlan,
  repairPlan,
  type SearchPlan,
} from "../src/lib/find-leads/plan.ts";
import {
  costBand,
  estimateRunCost,
  targetAffordableWithin,
} from "../src/lib/find-leads/cost-model.ts";

/**
 * The structured search plan and the cost model behind it.
 *
 * These two modules are the contract between parties that do not trust each
 * other: the browser, the language model proposing changes, and the worker
 * that spends real money. The tests below are about what must remain true when
 * one of them misbehaves — not about a particular plan producing a particular
 * number.
 */

function runnablePlan(): SearchPlan {
  return parsePlan({
    industries: ["Property management"],
    locations: [
      { country: "GB", city: "Bournemouth", radiusKm: 64, lat: 50.71, lon: -1.88, resolved: true },
    ],
    decisionMakerRoles: ["Property Manager"],
    targetVerifiedProspects: 200,
  }) as SearchPlan;
}

describe("plan schema", () => {
  test("an empty plan parses to safe defaults", () => {
    const plan = emptyPlan();
    assert.equal(plan.reviewMode, "HUMAN_REVIEW");
    assert.equal(plan.exclusions.optedOut, true);
    assert.equal(plan.exclusions.suppressed, true);
    assert.equal(plan.intent.required, false);
  });

  test("opt-out and suppression exclusions cannot be turned off", () => {
    // They are z.literal(true): a stored plan claiming otherwise does not parse.
    assert.equal(
      parsePlan({ ...emptyPlan(), exclusions: { ...emptyPlan().exclusions, optedOut: false } }),
      null,
    );
    assert.equal(
      parsePlan({ ...emptyPlan(), exclusions: { ...emptyPlan().exclusions, suppressed: false } }),
      null,
    );
  });

  test("targets and cost caps are bounded", () => {
    assert.equal(parsePlan({ targetVerifiedProspects: 0 }), null);
    assert.equal(parsePlan({ targetVerifiedProspects: 10_001 }), null);
    assert.equal(parsePlan({ maxProviderCostMinor: -1 }), null);
    assert.equal(parsePlan({ maxProviderCostMinor: 1_000_001 }), null);
  });

  test("repair drops invalid fields to defaults without widening a bound", () => {
    const repaired = repairPlan({
      industries: ["Roofing"],
      targetVerifiedProspects: 999_999, // out of bounds
      minimumGrade: "Z", // not a grade
    });

    assert.ok(repaired);
    assert.deepEqual(repaired.industries, ["Roofing"]);
    // Falls back to the default rather than being clamped to the maximum: a
    // model asking for a million prospects has not asked for 10,000.
    assert.equal(repaired.targetVerifiedProspects, 100);
    assert.equal(repaired.minimumGrade, "B");
  });

  test("repair refuses anything that is not an object", () => {
    for (const value of [null, undefined, "plan", 42, []]) {
      const result = repairPlan(value);
      if (Array.isArray(value)) continue;
      assert.equal(result, null, `${String(value)} should not repair`);
    }
  });
});

describe("plan readiness", () => {
  test("a complete plan is runnable", () => {
    assert.equal(checkPlanReadiness(runnablePlan()).ready, true);
  });

  test("an unresolved location blocks the run", () => {
    // This is the guard against "within 40 miles" silently becoming a text
    // match on a provider's free-text location field.
    const plan = runnablePlan();
    plan.locations[0].resolved = false;
    const readiness = checkPlanReadiness(plan);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.problems.includes("UNRESOLVED_LOCATION"));
  });

  test("missing industry, location or roles each block the run", () => {
    assert.ok(checkPlanReadiness({ ...runnablePlan(), industries: [] }).problems.includes("NO_INDUSTRY"));
    assert.ok(checkPlanReadiness({ ...runnablePlan(), locations: [] }).problems.includes("NO_LOCATION"));
    assert.ok(
      checkPlanReadiness({ ...runnablePlan(), decisionMakerRoles: [] }).problems.includes("NO_ROLES"),
    );
  });

  test("an inverted employee range is caught", () => {
    const plan = runnablePlan();
    plan.company = { ...plan.company, minEmployees: 500, maxEmployees: 5 };
    assert.ok(checkPlanReadiness(plan).problems.includes("INVALID_EMPLOYEE_RANGE"));
  });

  test("intent required with no categories is caught", () => {
    const plan = runnablePlan();
    plan.intent = { ...plan.intent, required: true, categories: [] };
    assert.ok(
      checkPlanReadiness(plan).problems.includes("INTENT_REQUIRED_WITHOUT_CATEGORIES"),
    );
  });
});

describe("what the search agent may change", () => {
  test("it can set targeting fields", () => {
    const { plan, changed } = mergePlanPatch(emptyPlan(), {
      industries: ["Facilities management"],
      decisionMakerRoles: ["Facilities Manager"],
    });
    assert.equal(changed, true);
    assert.deepEqual(plan.industries, ["Facilities management"]);
  });

  test("it cannot raise the spend ceiling", () => {
    // The budget is the customer's decision and the engine's to enforce. A
    // model that returns a bigger cap must be ignored, not obeyed.
    const before = emptyPlan();
    const { plan } = mergePlanPatch(before, { maxProviderCostMinor: 999_999 });
    assert.equal(plan.maxProviderCostMinor, before.maxProviderCostMinor);
  });

  test("it cannot switch a plan to auto-contact", () => {
    // Deciding to email strangers without review is a human's accountability.
    const { plan } = mergePlanPatch(emptyPlan(), { reviewMode: "AUTO_CONTACT" });
    assert.equal(plan.reviewMode, "HUMAN_REVIEW");
  });

  test("it cannot drop the opt-out or suppression exclusions", () => {
    const { plan } = mergePlanPatch(emptyPlan(), {
      exclusions: { optedOut: false, suppressed: false, competitors: ["Rival Roofing"] },
    });
    // The competitor it did supply is kept; the two it may not touch are not.
    assert.equal(plan.exclusions.optedOut, true);
    assert.equal(plan.exclusions.suppressed, true);
    assert.deepEqual(plan.exclusions.competitors, ["Rival Roofing"]);
  });

  test("unknown fields are dropped, never persisted", () => {
    const { plan } = mergePlanPatch(emptyPlan(), {
      somethingInvented: true,
      __proto__: { polluted: true },
    } as Record<string, unknown>);
    assert.equal("somethingInvented" in plan, false);
    assert.equal(
      (plan as unknown as Record<string, unknown>).polluted,
      undefined,
    );
  });

  test("a patch that fails validation leaves the plan untouched", () => {
    const before = emptyPlan();
    const { plan, changed } = mergePlanPatch(before, { industries: "not-an-array" });
    assert.equal(changed, false);
    assert.deepEqual(plan.industries, before.industries);
  });

  test("nested company and intent patches merge rather than replace", () => {
    const before = parsePlan({
      ...emptyPlan(),
      company: { ...emptyPlan().company, minEmployees: 5 },
    }) as SearchPlan;

    const { plan } = mergePlanPatch(before, { company: { maxEmployees: 100 } });
    assert.equal(plan.company.minEmployees, 5, "the existing bound was lost");
    assert.equal(plan.company.maxEmployees, 100);
  });
});

describe("cost model", () => {
  test("cost scales with the target and is never negative", () => {
    assert.equal(estimateRunCost(0).totalMinor, 0);
    const small = estimateRunCost(10).totalMinor;
    const large = estimateRunCost(100).totalMinor;
    assert.ok(large > small, "a larger target must cost more");
    assert.ok(small > 0);
  });

  test("the estimate and the affordable-target inverse agree", () => {
    // The panel quotes one and the worker reserves against the other; if they
    // disagreed a run would start that its own budget could not fund.
    const budget = 5_000;
    const affordable = targetAffordableWithin(budget);
    assert.ok(estimateRunCost(affordable).totalMinor <= budget);
    assert.ok(estimateRunCost(affordable + 1).totalMinor > budget);
  });

  test("nothing is affordable within no budget", () => {
    assert.equal(targetAffordableWithin(0), 0);
    assert.equal(targetAffordableWithin(-100), 0);
  });

  test("skipping intent makes a run cheaper", () => {
    const withIntent = estimateRunCost(100, {}, { intentEnabled: true }).totalMinor;
    const without = estimateRunCost(100, {}, { intentEnabled: false }).totalMinor;
    assert.ok(without < withIntent);
  });

  test("enrichment is priced above discovery, so the waterfall order pays off", () => {
    const estimate = estimateRunCost(100);
    assert.ok(
      estimate.callsByCapability.COMPANY_SEARCH >
        estimate.callsByCapability.COMPANY_ENRICHMENT,
      "cheap discovery must touch more records than expensive enrichment",
    );
  });

  test("cost bands escalate, and exceeding the plan needs overage to be offered", () => {
    assert.equal(costBand(100, 1000, false), "WITHIN_PLAN");
    assert.equal(costBand(900, 1000, false), "NEAR_LIMIT");
    assert.equal(costBand(2000, 1000, false), "EXCEEDS_PLAN");
    assert.equal(costBand(2000, 1000, true), "REQUIRES_OVERAGE");
    assert.equal(costBand(100, 0, false), "EXCEEDS_PLAN");
  });
});
