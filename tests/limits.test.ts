import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dailyCapAllows,
  limitLevel,
  nextDailyReset,
  overageCostMinor,
  splitConsumption,
  upsellFor,
  type OverageSettings,
} from "../src/lib/billing/limits.ts";
import { enforcedDailyCap, PLATFORM_DAILY_CEILING, planDailyCaps } from "../src/lib/billing/usage-allocation.ts";
import {
  MESSAGE_CREDIT_BUNDLES,
  PLANS,
  SMS_OVERAGE_BUNDLES,
  allowancesFor,
  planThatUnlocks,
  unlockPlanLabel,
} from "../src/lib/billing/plans.ts";

const OFF: OverageSettings = { enabled: false, capMinor: 0, spentMinor: 0, unitPricePence: 9 };

describe("consumption order: allowance, then credit, then overage", () => {
  test("inside the allowance, nothing else is touched", () => {
    const split = splitConsumption({ quantity: 2, allowance: 250, usedThisPeriod: 100, creditBalance: 50, overage: OFF });
    assert.deepEqual(
      [split.allowed, split.fromAllowance, split.fromCredits, split.fromOverage],
      [true, 2, 0, 0],
    );
  });

  test("a message straddling the allowance uses the remainder, then credit", () => {
    const split = splitConsumption({ quantity: 3, allowance: 250, usedThisPeriod: 249, creditBalance: 50, overage: OFF });
    assert.deepEqual([split.fromAllowance, split.fromCredits, split.fromOverage, split.allowed], [1, 2, 0, true]);
  });

  test("credit before overage, even when overage is on", () => {
    const split = splitConsumption({
      quantity: 2,
      allowance: 10,
      usedThisPeriod: 10,
      creditBalance: 5,
      overage: { enabled: true, capMinor: 1000, spentMinor: 0, unitPricePence: 9 },
    });
    assert.deepEqual([split.fromCredits, split.fromOverage, split.overageMinor], [2, 0, 0]);
  });

  test("overage only within the cap, and never partially", () => {
    const within = splitConsumption({
      quantity: 3,
      allowance: 10,
      usedThisPeriod: 10,
      creditBalance: 1,
      overage: { enabled: true, capMinor: 100, spentMinor: 80, unitPricePence: 9 },
    });
    assert.deepEqual([within.allowed, within.fromCredits, within.fromOverage, within.overageMinor], [true, 1, 2, 18]);

    const over = splitConsumption({
      quantity: 3,
      allowance: 10,
      usedThisPeriod: 10,
      creditBalance: 0,
      overage: { enabled: true, capMinor: 100, spentMinor: 80, unitPricePence: 9 },
    });
    assert.deepEqual([over.allowed, over.refusal, over.fromOverage], [false, "OVERAGE_CAP_REACHED", 0]);
  });

  test("no credit and overage off: refused at the limit", () => {
    const split = splitConsumption({ quantity: 1, allowance: 10, usedThisPeriod: 10, creditBalance: 0, overage: OFF });
    assert.deepEqual([split.allowed, split.refusal], [false, "LIMIT_REACHED"]);
  });

  test("a plan with no overage price refuses even with overage switched on", () => {
    const split = splitConsumption({
      quantity: 1,
      allowance: 0,
      usedThisPeriod: 0,
      creditBalance: 0,
      overage: { enabled: true, capMinor: 5000, spentMinor: 0, unitPricePence: null },
    });
    assert.equal(split.refusal, "LIMIT_REACHED");
  });

  test("overage cost rounds up per message", () => {
    assert.equal(overageCostMinor(3, 7.5), 23);
    assert.equal(overageCostMinor(0, 9), 0);
  });

  test("the trial has no overage: nothing is billed before the first invoice", () => {
    assert.equal(allowancesFor("trial").smsOveragePence, null);
    assert.equal(allowancesFor("trial").whatsappOveragePence, null);
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
      SMS_OVERAGE_BUNDLES.map((bundle) => [bundle.credits, bundle.priceGbp]),
    );
    assert.equal(new Set(MESSAGE_CREDIT_BUNDLES.map((bundle) => bundle.key)).size, MESSAGE_CREDIT_BUNDLES.length);
  });

  test("locked features name the plan that actually unlocks them", () => {
    assert.equal(planThatUnlocks("whatsapp")?.id, "growth");
    assert.equal(planThatUnlocks("campaigns")?.id, "starter");
    assert.equal(unlockPlanLabel("whatsapp"), "Growth plan");
  });
});
