import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_STEPS,
  STEP_META,
  nextStep,
  previousStep,
  stepIndex,
  isOnboardingStep,
  type OnboardingStep,
} from "../src/lib/onboarding/steps.ts";
import { NEW_LEAD_SEQUENCE } from "../src/lib/automation/defaults.ts";
import { findUnknownMergeFields } from "../src/lib/automation/scheduler.ts";

describe("onboarding steps", () => {
  test("every step has copy", () => {
    for (const step of ONBOARDING_STEPS) {
      assert.ok(STEP_META[step]?.title, `${step} has no title`);
      assert.ok(STEP_META[step]?.description, `${step} has no description`);
    }
  });

  test("the five wizard steps are all represented", () => {
    for (const step of ["business", "connect_leads", "follow_up", "qualify_book", "test_go_live"]) {
      assert.ok(isOnboardingStep(step), `${step} is not a step`);
    }
  });

  test("qualify & book comes immediately before test & go live", () => {
    assert.equal(nextStep("qualify_book"), "test_go_live");
    assert.equal(previousStep("test_go_live"), "qualify_book");
  });

  test("the sequence is linear and terminates", () => {
    let step: OnboardingStep = ONBOARDING_STEPS[0];
    const seen = new Set<string>([step]);
    for (;;) {
      const next = nextStep(step);
      if (next === null) break;
      assert.ok(!seen.has(next), `cycle at ${next}`);
      assert.equal(stepIndex(next), stepIndex(step) + 1);
      seen.add(next);
      step = next;
    }
    assert.equal(step, "test_go_live");
    assert.equal(seen.size, ONBOARDING_STEPS.length);
  });

  test("an unknown step falls back to the first rather than throwing", () => {
    assert.equal(stepIndex("not-a-step"), 0);
    assert.equal(isOnboardingStep("not-a-step"), false);
  });
});

describe("default follow-up sequence", () => {
  test("uses only supported merge fields, so it is publishable", () => {
    for (const step of NEW_LEAD_SEQUENCE) {
      assert.deepEqual(
        findUnknownMergeFields(step.template),
        [],
        `step ${step.position} uses an unknown merge field`,
      );
    }
  });

  test("follows the bible cadence: immediate, 10m, 2h, 1d, 3d", () => {
    assert.deepEqual(
      NEW_LEAD_SEQUENCE.map((s) => s.delaySeconds),
      [0, 600, 7200, 86400, 259200],
    );
  });

  test("the first step is immediate, which is the whole product promise", () => {
    assert.equal(NEW_LEAD_SEQUENCE[0].delaySeconds, 0);
  });

  test("positions are contiguous from zero", () => {
    NEW_LEAD_SEQUENCE.forEach((step, index) => {
      assert.equal(step.position, index);
    });
  });

  test("every step has a non-empty template", () => {
    for (const step of NEW_LEAD_SEQUENCE) {
      assert.ok(step.template.trim().length > 10);
    }
  });
});
