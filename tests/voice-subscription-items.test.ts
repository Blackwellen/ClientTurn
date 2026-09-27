import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  selectPlanItem,
  stripeItemGrantReason,
  subscriptionEnded,
  voiceGrantChanges,
  voiceItemsOf,
  type SubscriptionItemLike,
} from "../src/lib/billing/subscription-items.ts";

/**
 * Stripe does not promise item order, so the plan item is chosen by price and
 * the voice items are matched by price id (OD-2). Pure: no Stripe, no network.
 */

const PLAN_PRICES: Record<string, string> = {
  price_starter_m: "starter",
  price_growth_m: "growth",
  price_pro_m: "pro",
  price_pro_y: "pro",
};
const planForPriceId = (priceId: string | null | undefined) => (priceId && PLAN_PRICES[priceId]) || "trial";
const VOICE = { addonMonthly: "price_voice_addon", numberMonthly: "price_voice_number" };

function item(id: string, priceId: string | null, start = 1_000, end = 2_000): SubscriptionItemLike {
  return { id, price: priceId ? { id: priceId } : null, current_period_start: start, current_period_end: end };
}

describe("selectPlanItem", () => {
  test("finds the plan item when it is not first", () => {
    const items = [item("si_num", "price_voice_number"), item("si_voice", "price_voice_addon"), item("si_plan", "price_pro_m")];
    assert.equal(selectPlanItem(items, planForPriceId, VOICE)?.id, "si_plan");
  });

  test("the plan item first still works", () => {
    const items = [item("si_plan", "price_growth_m"), item("si_num", "price_voice_number")];
    assert.equal(selectPlanItem(items, planForPriceId, VOICE)?.id, "si_plan");
  });

  test("only voice items: no plan item", () => {
    const items = [item("si_voice", "price_voice_addon"), item("si_num", "price_voice_number")];
    assert.equal(selectPlanItem(items, planForPriceId, VOICE), null);
  });

  test("unknown prices fall back to the first non-voice item, never a voice item", () => {
    const items = [item("si_num", "price_voice_number"), item("si_legacy", "price_legacy"), item("si_other", "price_other")];
    assert.equal(selectPlanItem(items, planForPriceId, VOICE)?.id, "si_legacy");
  });

  test("a mapped plan item wins over an earlier unknown price", () => {
    const items = [item("si_legacy", "price_legacy"), item("si_plan", "price_starter_m")];
    assert.equal(selectPlanItem(items, planForPriceId, VOICE)?.id, "si_plan");
  });

  test("empty or missing items", () => {
    assert.equal(selectPlanItem([], planForPriceId, VOICE), null);
    assert.equal(selectPlanItem(null, planForPriceId, VOICE), null);
    assert.equal(selectPlanItem(undefined, planForPriceId), null);
  });

  test("without voice price ids configured, behaves as a plain plan lookup", () => {
    const items = [item("si_x", "price_voice_number"), item("si_plan", "price_pro_y")];
    assert.equal(selectPlanItem(items, planForPriceId)?.id, "si_plan");
  });
});

describe("voiceItemsOf", () => {
  test("finds the Pro voice item and the number item with their periods", () => {
    const items = [item("si_plan", "price_pro_m"), item("si_voice", "price_voice_addon", 100, 200), item("si_num", "price_voice_number", 300, 400)];
    const found = voiceItemsOf(items, VOICE);
    assert.deepEqual(found.proVoice, { itemId: "si_voice", priceId: "price_voice_addon", periodStart: 100, periodEnd: 200 });
    assert.deepEqual(found.number, { itemId: "si_num", priceId: "price_voice_number", periodStart: 300, periodEnd: 400 });
  });

  test("the number item alone (Starter/Growth)", () => {
    const found = voiceItemsOf([item("si_plan", "price_starter_m"), item("si_num", "price_voice_number")], VOICE);
    assert.equal(found.proVoice, null);
    assert.equal(found.number?.itemId, "si_num");
  });

  test("unknown prices and empty items find nothing", () => {
    assert.deepEqual(voiceItemsOf([item("si_a", "price_legacy"), item("si_b", null)], VOICE), { proVoice: null, number: null });
    assert.deepEqual(voiceItemsOf([], VOICE), { proVoice: null, number: null });
    assert.deepEqual(voiceItemsOf(null, VOICE), { proVoice: null, number: null });
  });

  test("no voice prices configured: nothing is a voice item", () => {
    assert.deepEqual(voiceItemsOf([item("si_a", "price_voice_addon")], {}), { proVoice: null, number: null });
  });
});

describe("voiceGrantChanges", () => {
  const items = voiceItemsOf(
    [item("si_plan", "price_pro_m"), item("si_voice", "price_voice_addon"), item("si_num", "price_voice_number")],
    VOICE,
  );

  test("the Pro voice item grants voice, 200 minutes and the item flag; the number its flag", () => {
    const changes = voiceGrantChanges(items, { ended: false, includedMinutes: 200 });
    const byKey = Object.fromEntries(changes.upserts.map((grant) => [grant.entitlementKey, grant]));
    assert.equal(byKey.voice_sales_enabled.numericValue, 1);
    assert.equal(byKey.voice_sales_enabled.booleanValue, true);
    assert.equal(byKey.voice_minutes_included.numericValue, 200);
    assert.equal(byKey.voice_pro_item.booleanValue, true);
    assert.equal(byKey.voice_number_item.booleanValue, true);
    assert.equal(byKey.voice_sales_enabled.reason, stripeItemGrantReason("si_voice"));
    assert.equal(byKey.voice_number_item.reason, "STRIPE_ITEM:si_num");
    assert.deepEqual(changes.revokeKeys, []);
  });

  test("an item that disappears is revoked", () => {
    const numberOnly = voiceItemsOf([item("si_plan", "price_growth_m"), item("si_num", "price_voice_number")], VOICE);
    const changes = voiceGrantChanges(numberOnly, { ended: false, includedMinutes: 200 });
    assert.deepEqual(changes.upserts.map((grant) => grant.entitlementKey), ["voice_number_item"]);
    assert.deepEqual(changes.revokeKeys.sort(), ["voice_minutes_included", "voice_pro_item", "voice_sales_enabled"]);
  });

  test("a deleted subscription revokes everything and grants nothing", () => {
    const changes = voiceGrantChanges(items, { ended: true, includedMinutes: 200 });
    assert.deepEqual(changes.upserts, []);
    assert.equal(changes.revokeKeys.length, 4);
  });

  test("idempotent: the same items always give the same writes", () => {
    assert.deepEqual(
      voiceGrantChanges(items, { ended: false, includedMinutes: 200 }),
      voiceGrantChanges(items, { ended: false, includedMinutes: 200 }),
    );
  });

  test("subscriptionEnded", () => {
    assert.equal(subscriptionEnded("active", false), false);
    assert.equal(subscriptionEnded("past_due", false), false);
    assert.equal(subscriptionEnded("active", true), true);
    assert.equal(subscriptionEnded("canceled", false), true);
    assert.equal(subscriptionEnded("incomplete_expired", false), true);
  });
});
