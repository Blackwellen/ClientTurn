import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextPlanFor, PLANS } from "../src/lib/billing/plans.ts";

describe("upgrade ladder", () => {
  test("each paid tier points at the next one up", () => {
    assert.equal(nextPlanFor("trial"), "starter");
    assert.equal(nextPlanFor("starter"), "growth");
    assert.equal(nextPlanFor("growth"), "pro");
    assert.equal(nextPlanFor("pro"), "enterprise");
  });

  test("the top tier has nothing to sell, so the card falls back to support", () => {
    assert.equal(nextPlanFor("enterprise"), null);
  });

  test("every self-serve target can actually be bought", () => {
    // `startPlanCheckout` only accepts these three, so any other self-serve
    // target the ladder produced would be an upsell that dead-ends.
    const purchasable = new Set(["starter", "growth", "pro"]);
    for (const plan of ["trial", "starter", "growth"] as const) {
      const target = nextPlanFor(plan);
      assert.ok(target && purchasable.has(target), `${plan} -> ${target}`);
      assert.equal(PLANS[target].selfServe, true);
      assert.notEqual(PLANS[target].monthlyPrice, null);
    }
  });

  test("Pro is a self-serve plan with a price", () => {
    assert.equal(PLANS.pro.selfServe, true);
    assert.equal(PLANS.pro.monthlyPrice, 399);
  });

  test("the only non-self-serve target is Enterprise", () => {
    for (const plan of ["trial", "starter", "growth", "pro"] as const) {
      const target = nextPlanFor(plan);
      assert.ok(target);
      if (!PLANS[target].selfServe) assert.equal(target, "enterprise");
    }
  });

  test("an unrecognised plan shows no prompt rather than guessing", () => {
    assert.equal(nextPlanFor(""), null);
    assert.equal(nextPlanFor("legacy_2024"), null);
  });

  test("nobody is ever upgraded back to a trial", () => {
    for (const plan of ["trial", "starter", "growth", "pro", "enterprise"]) {
      assert.notEqual(nextPlanFor(plan), "trial");
    }
  });

  test("every target the ladder can return exists in the catalogue", () => {
    for (const plan of ["trial", "starter", "growth", "pro", "enterprise"]) {
      const target = nextPlanFor(plan);
      if (target) assert.ok(PLANS[target], `${target} is missing from PLANS`);
    }
  });

  test("the ladder never points a workspace at its own plan", () => {
    for (const plan of ["starter", "growth", "pro"] as const) {
      assert.notEqual(nextPlanFor(plan), plan);
    }
  });

  test("each step up is genuinely a larger allowance", () => {
    for (const plan of ["starter", "growth"] as const) {
      const target = nextPlanFor(plan);
      assert.ok(target && target !== "enterprise");
      assert.ok(
        PLANS[target].leadLimit > PLANS[plan].leadLimit,
        `${target} should allow more leads than ${plan}`,
      );
    }
  });
});
