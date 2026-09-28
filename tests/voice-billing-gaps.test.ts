import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { carriedItems, downgradeSchedulePhases } from "../src/lib/billing/plan-change.ts";
import { voicePackRefund, type PackLedgerRow } from "../src/lib/voice/pack-refund.ts";
import { expireIncludedMinutes, grantIncludedPeriod, InMemoryMinuteStore, creditPackMinutes } from "../src/lib/voice/minutes-core.ts";
import { trialPlanItem, intervalOf } from "../src/lib/billing/end-trial.ts";

/**
 * The four voice billing gaps found after P2's first pass, each pinned:
 *   (a) a scheduled downgrade keeps the number item; only the Pro voice item goes;
 *   (b) a refunded voice pack claws back only its unused minutes (FIFO);
 *   (c) included minutes end with the Pro voice item;
 *   (d) end-trial picks the plan item by price, not items.data[0].
 */

const PLAN_PRO = "price_pro_m";
const PLAN_GROWTH = "price_growth_m";
const VOICE_ADDON = "price_voice_addon";
const VOICE_NUMBER = "price_voice_number";

describe("(a) scheduled downgrade keeps the number item and drops only the Pro voice item", () => {
  test("Pro with the voice item, downgrading to Growth: voice item kept this period, gone in the next", () => {
    const others = carriedItems({
      items: [
        { id: "si_plan", priceId: PLAN_PRO, quantity: 1 },
        { id: "si_voice", priceId: VOICE_ADDON, quantity: 1 },
      ],
      planItemId: "si_plan",
      proVoicePriceId: VOICE_ADDON,
      targetPlan: "growth",
    });
    assert.equal(others.droppedProVoice, true);
    const schedule = downgradeSchedulePhases({
      currentPriceId: PLAN_PRO,
      targetPriceId: PLAN_GROWTH,
      quantity: 1,
      currentPhaseStart: 100,
      currentPeriodEnd: 200,
      interval: "month",
      businessId: "b",
      otherItems: others,
    });
    assert.deepEqual(schedule.phases[0].items.map((i) => i.price), [PLAN_PRO, VOICE_ADDON]);
    assert.deepEqual(schedule.phases[1].items.map((i) => i.price), [PLAN_GROWTH]);
  });

  test("Growth with the £11.99 number, downgrading to Starter: the number carries over", () => {
    const others = carriedItems({
      items: [
        { id: "si_num", priceId: VOICE_NUMBER, quantity: 1 },
        { id: "si_plan", priceId: PLAN_GROWTH, quantity: 1 },
      ],
      planItemId: "si_plan",
      proVoicePriceId: VOICE_ADDON,
      targetPlan: "starter",
    });
    assert.equal(others.droppedProVoice, false);
    const schedule = downgradeSchedulePhases({
      currentPriceId: PLAN_GROWTH,
      targetPriceId: "price_starter_m",
      quantity: 1,
      currentPhaseStart: 100,
      currentPeriodEnd: 200,
      interval: "month",
      businessId: "b",
      otherItems: others,
    });
    assert.deepEqual(schedule.phases[1].items.map((i) => i.price), ["price_starter_m", VOICE_NUMBER]);
  });

  test("with no other items the schedule is exactly as before", () => {
    const schedule = downgradeSchedulePhases({ currentPriceId: PLAN_PRO, targetPriceId: PLAN_GROWTH, quantity: 1, currentPhaseStart: 1, currentPeriodEnd: 2, interval: "month", businessId: "b" });
    assert.equal(schedule.phases[0].items.length, 1);
    assert.equal(schedule.phases[1].items.length, 1);
  });
});

describe("(b) a refunded voice pack claws back only its unused minutes", () => {
  const packs: PackLedgerRow[] = [
    { kind: "PACK_PURCHASE", stripeRef: "pi_old", packDeltaSec: 6000, createdAt: "2026-09-01T00:00:00Z" },
    { kind: "PACK_PURCHASE", stripeRef: "pi_new", packDeltaSec: 15000, createdAt: "2026-09-10T00:00:00Z" },
  ];

  test("FIFO: the older pack is used first, so the newer one is still whole", () => {
    // 21,000 bought, 4,000 used: all of it from the older pack.
    const r = voicePackRefund({ ledger: packs, refundedRef: "pi_new", amountMinor: 11500, amountRefundedMinor: 11500, packRemainingSec: 17000 });
    assert.equal(r?.reverseSec, 15000);
  });

  test("never below what has been used: a partly used pack returns only its unused part", () => {
    const r = voicePackRefund({ ledger: packs, refundedRef: "pi_old", amountMinor: 4900, amountRefundedMinor: 4900, packRemainingSec: 17000 });
    assert.equal(r?.reverseSec, 2000);
  });

  test("never below zero, and a replayed refund reverses nothing more", () => {
    const empty = voicePackRefund({ ledger: packs, refundedRef: "pi_new", amountMinor: 11500, amountRefundedMinor: 11500, packRemainingSec: 0 });
    assert.equal(empty?.reverseSec, 0);
    const after: PackLedgerRow[] = [...packs, { kind: "PACK_REFUND", stripeRef: "pi_new", packDeltaSec: -15000, createdAt: "2026-09-12T00:00:00Z" }];
    const replay = voicePackRefund({ ledger: after, refundedRef: "pi_new", amountMinor: 11500, amountRefundedMinor: 11500, packRemainingSec: 2000 });
    assert.equal(replay?.reverseSec, 0);
    assert.equal(replay?.idempotencyKey, "voice:pack-refund:pi_new:11500");
  });

  test("a partial refund reverses its proportion of the unused minutes", () => {
    const r = voicePackRefund({ ledger: packs, refundedRef: "pi_new", amountMinor: 11500, amountRefundedMinor: 5750, packRemainingSec: 17000 });
    assert.equal(r?.reverseSec, 7500);
  });

  test("an unknown PaymentIntent is not a pack", () => {
    assert.equal(voicePackRefund({ ledger: packs, refundedRef: "pi_other", amountMinor: 1, amountRefundedMinor: 1, packRemainingSec: 1 }), null);
  });
});

describe("(c) included minutes end with the Pro voice item", () => {
  test("the included bucket goes to zero once; packs are untouched", async () => {
    const s = new InMemoryMinuteStore();
    await grantIncludedPeriod(s, { businessId: "b", includedMinutes: 200, periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z" });
    await creditPackMinutes(s, { businessId: "b", minutes: 100, idempotencyKey: "voice:pack:cs_1", stripeRef: "pi_1" });
    assert.equal(await expireIncludedMinutes(s, { businessId: "b", reason: "Pro voice item ended" }), "APPLIED");
    assert.equal(s.balanceOf("b").includedRemainingSec, 0);
    assert.equal(s.balanceOf("b").periodIncludedSec, 0);
    assert.equal(s.balanceOf("b").packRemainingSec, 6000);
    assert.equal(await expireIncludedMinutes(s, { businessId: "b", reason: "again" }), "NOTHING_TO_EXPIRE");
    assert.equal(s.ledger.filter((l) => l.kind === "PERIOD_EXPIRE").length, 1);
  });

  test("a Starter/Growth workspace with no included minutes has nothing to expire", async () => {
    const s = new InMemoryMinuteStore();
    assert.equal(await expireIncludedMinutes(s, { businessId: "b", reason: "x" }), "NOTHING_TO_EXPIRE");
  });
});

describe("(d) end-trial picks the plan item by price", () => {
  const priceIdFor = (plan: string, interval: string) => (interval === "month" ? `price_${plan}_m` : `price_${plan}_y`);
  const item = (id: string, price: string, interval: "month" | "year") =>
    ({ id, price: { id: price, recurring: { interval } } }) as unknown as Stripe.SubscriptionItem;

  test("a voice item listed first is not taken for the plan", () => {
    const items = [item("si_voice", VOICE_ADDON, "month"), item("si_plan", "price_pro_y", "year")];
    assert.equal(trialPlanItem(items, priceIdFor)?.id, "si_plan");
    assert.equal(intervalOf({ items: { data: items } } as unknown as Stripe.Subscription, priceIdFor), "year");
  });

  test("a single plan item still works, and no items is no plan", () => {
    assert.equal(trialPlanItem([item("si_plan", "price_growth_m", "month")], priceIdFor)?.id, "si_plan");
    assert.equal(trialPlanItem([], priceIdFor), null);
  });
});
