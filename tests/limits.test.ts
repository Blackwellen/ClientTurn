import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dailyCapAllows,
  limitLevel,
  nextDailyReset,
  splitConsumption,
  upsellFor,
} from "../src/lib/billing/limits.ts";
import { enforcedDailyCap, PLATFORM_DAILY_CEILING, planDailyCaps } from "../src/lib/billing/usage-allocation.ts";
import {
  MESSAGE_CREDIT_BUNDLES,
  PLANS,
  SMS_CREDIT_BUNDLES,
  allowancesFor,
  planThatUnlocks,
  unlockPlanLabel,
} from "../src/lib/billing/plans.ts";

// Owner rule 2026-09-27: NO overage. The order is allowance, then prepaid
// credit, then refused. (The overage-within-cap cases that used to be here
// were removed with overage itself.)
describe("consumption order: allowance, then credit, then refused", () => {
  test("inside the allowance, nothing else is touched", () => {
    const split = splitConsumption({ quantity: 2, allowance: 250, usedThisPeriod: 100, creditBalance: 50 });
    assert.deepEqual([split.allowed, split.fromAllowance, split.fromCredits], [true, 2, 0]);
  });

  test("a message straddling the allowance uses the remainder, then credit", () => {
    const split = splitConsumption({ quantity: 3, allowance: 250, usedThisPeriod: 249, creditBalance: 50 });
    assert.deepEqual([split.fromAllowance, split.fromCredits, split.allowed], [1, 2, true]);
  });

  test("past the allowance, credit pays", () => {
    const split = splitConsumption({ quantity: 2, allowance: 10, usedThisPeriod: 10, creditBalance: 5 });
    assert.deepEqual([split.allowed, split.fromCredits], [true, 2]);
  });

  test("no credit: refused at the limit, whatever the plan", () => {
    const split = splitConsumption({ quantity: 1, allowance: 10, usedThisPeriod: 10, creditBalance: 0 });
    assert.deepEqual([split.allowed, split.refusal], [false, "LIMIT_REACHED"]);
  });

  test("never partially: a message the credit cannot fully cover does not go", () => {
    const split = splitConsumption({ quantity: 3, allowance: 10, usedThisPeriod: 10, creditBalance: 2 });
    assert.deepEqual([split.allowed, split.refusal], [false, "LIMIT_REACHED"]);
  });

  test("WhatsApp (no allowance) runs on credit alone", () => {
    assert.equal(splitConsumption({ quantity: 1, allowance: 0, usedThisPeriod: 0, creditBalance: 0 }).allowed, false);
    assert.equal(splitConsumption({ quantity: 1, allowance: 0, usedThisPeriod: 0, creditBalance: 1 }).allowed, true);
  });

  test("no plan carries an overage price any more", () => {
    for (const plan of ["trial", "starter", "growth", "pro", "enterprise"]) {
      const allowances = allowancesFor(plan) as Record<string, unknown>;
      assert.equal("smsOveragePence" in allowances, false, plan);
      assert.equal("whatsappOveragePence" in allowances, false, plan);
    }
  });
});

describe("daily caps", () => {
  test("a cap allows up to and including the cap, and 0 pauses the channel", () => {
    assert.equal(dailyCapAllows({ sentToday: 24, cap: 25 }), true);
    assert.equal(dailyCapAllows({ sentToday: 25, cap: 25 }), false);
    assert.equal(dailyCapAllows({ sentToday: 0, cap: 0 }), false);
  });

  test("a stored cap applies, clamped to the platform ceiling; none set = ceiling only", () => {
    assert.equal(enforcedDailyCap("sms", { sms: 30 }), 30);
    assert.equal(enforcedDailyCap("sms", { sms: 999_999 }), PLATFORM_DAILY_CEILING.sms);
    assert.equal(enforcedDailyCap("sms", {}), PLATFORM_DAILY_CEILING.sms);
    assert.equal(enforcedDailyCap("email", null), PLATFORM_DAILY_CEILING.email);
    assert.equal(enforcedDailyCap("whatsapp", { whatsapp: 0 }), 0);
  });

  test("plan daily caps are one definition", () => {
    assert.deepEqual(planDailyCaps(2000), { email: 100, sms: 25, whatsapp: 25 });
    assert.deepEqual(planDailyCaps(0), { email: 50, sms: 20, whatsapp: 20 });
  });

  test("the cap resets at the next UTC day", () => {
    const reset = nextDailyReset(new Date("2026-09-26T23:30:00Z"));
    assert.equal(reset.toISOString().slice(0, 10), "2026-09-27");
  });
});

describe("upsells are honest", () => {
  test("nothing below 80%", () => {
    assert.equal(upsellFor({ metric: "sms", plan: "starter", used: 199, limit: 250 }), null);
    assert.equal(limitLevel(199, 250), "ok");
  });

  test("at 80% and 100%, the next tier with its real limit and the SMS bundles", () => {
    const warn = upsellFor({ metric: "sms", plan: "starter", used: 200, limit: 250 });
    assert.equal(warn?.level, "warning");
    assert.equal(warn?.upgrade?.plan.id, "growth");
    assert.equal(warn?.upgrade?.newLimit, PLANS.growth.smsSegmentAllowance);
    assert.equal(warn?.topUps.every((bundle) => bundle.channel === "sms"), true);

    const reached = upsellFor({ metric: "sms", plan: "starter", used: 250, limit: 250 });
    assert.equal(reached?.level, "reached");
  });

  test("no upgrade is offered when the next tier would not raise the limit", () => {
    const offer = upsellFor({ metric: "leads", plan: "pro", used: 100_000, limit: 100_000 });
    assert.equal(offer?.upgrade, null);
  });

  test("advertised SMS bundles are exactly the purchasable ones", () => {
    const sms = MESSAGE_CREDIT_BUNDLES.filter((bundle) => bundle.channel === "sms");
    assert.deepEqual(
      sms.map((bundle) => [bundle.credits, bundle.priceGbp]),
      SMS_CREDIT_BUNDLES.map((bundle) => [bundle.credits, bundle.priceGbp]),
    );
    assert.equal(new Set(MESSAGE_CREDIT_BUNDLES.map((bundle) => bundle.key)).size, MESSAGE_CREDIT_BUNDLES.length);
  });

  test("locked features name the plan that actually unlocks them", () => {
    assert.equal(planThatUnlocks("whatsapp")?.id, "growth");
    assert.equal(planThatUnlocks("campaigns")?.id, "starter");
    assert.equal(unlockPlanLabel("whatsapp"), "Growth plan");
  });
});
