import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  addVoiceNumberItem,
  createVoicePackCheckout,
  voicePurchaseState,
  type VoicePriceConfig,
  type VoicePurchaseContext,
  type VoiceStripeClient,
} from "../src/lib/billing/voice-purchase.ts";
import { TRIAL_VOICE_PURCHASE_REFUSAL, VOICE_MINUTE_PACKS } from "../src/lib/billing/plans.ts";

/**
 * Voice purchases against a MOCKED Stripe client (Stripe TEST mode model):
 * no network, no Stripe object is ever created. Asserts the price ids,
 * metadata and mode sent, the trial and missing-env refusals, and the number
 * item added with proration.
 */

type Call = { method: string; params: unknown; options?: unknown };

function mockStripe(subscription?: { id: string; status: string; items: { data: { id: string; price: { id: string } }[] } }) {
  const calls: Call[] = [];
  const client: VoiceStripeClient = {
    checkout: {
      sessions: {
        async create(params, options) {
          calls.push({ method: "checkout.sessions.create", params, options });
          return { id: "cs_test_123", url: "https://checkout.stripe.test/cs_test_123" };
        },
      },
    },
    subscriptions: {
      async retrieve(id) {
        calls.push({ method: "subscriptions.retrieve", params: id });
        if (!subscription) throw new Error("no such subscription");
        return subscription;
      },
    },
    subscriptionItems: {
      async create(params, options) {
        calls.push({ method: "subscriptionItems.create", params, options });
        return { id: "si_test_number" };
      },
    },
  };
  return { client, calls };
}

const PRICES: VoicePriceConfig = {
  addonMonthly: "price_test_voice_addon",
  numberMonthly: "price_test_voice_number",
  packs: { 100: "price_test_pack_100", 250: "price_test_pack_250", 500: "price_test_pack_500", 1000: "price_test_pack_1000" },
};

function ctx(overrides: Partial<VoicePurchaseContext> = {}): VoicePurchaseContext {
  return {
    businessId: "biz_1",
    userId: "user_1",
    plan: "growth",
    active: true,
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: "sub_test_1",
    site: "https://clientturn.test",
    termsPath: "/terms",
    termsVersion: "2026-09-27",
    ...overrides,
  };
}

describe("minute pack checkout", () => {
  for (const pack of VOICE_MINUTE_PACKS) {
    test(`${pack.minutes} minutes: one-off payment with the env price and voice_pack metadata`, async () => {
      const { client, calls } = mockStripe();
      const outcome = await createVoicePackCheckout(client, ctx(), PRICES, pack.minutes);
      assert.deepEqual(outcome, { ok: true, url: "https://checkout.stripe.test/cs_test_123", sessionId: "cs_test_123" });
      assert.equal(calls.length, 1);
      const params = calls[0].params as Stripe.Checkout.SessionCreateParams;
      assert.equal(params.mode, "payment");
      assert.deepEqual(params.line_items, [{ price: `price_test_pack_${pack.minutes}`, quantity: 1 }]);
      assert.equal(params.metadata?.kind, "voice_pack");
      assert.equal(params.metadata?.business_id, "biz_1");
      assert.equal(params.metadata?.minutes, String(pack.minutes));
      assert.equal(params.metadata?.pack_key, pack.key);
      assert.equal(params.payment_intent_data?.metadata?.kind, "voice_pack");
      assert.equal(params.customer, "cus_test_1");
      assert.equal(params.client_reference_id, "biz_1");
      assert.equal(params.consent_collection?.terms_of_service, "required");
      // Never price_data: the amount is the owner's pre-created TEST price.
      const lineItem: Stripe.Checkout.SessionCreateParams.LineItem | undefined = (calls[0].params as Stripe.Checkout.SessionCreateParams).line_items?.[0];
      assert.equal(lineItem?.price_data, undefined);
    });
  }

  test("refused in a trial, before any Stripe call", async () => {
    const { client, calls } = mockStripe();
    const outcome = await createVoicePackCheckout(client, ctx({ plan: "trial" }), PRICES, 100);
    assert.deepEqual(outcome, { ok: false, state: "plan-limit-reached", error: TRIAL_VOICE_PURCHASE_REFUSAL });
    assert.equal(calls.length, 0);
  });

  test("refused as integration-required when the price env is missing", async () => {
    const { client, calls } = mockStripe();
    const outcome = await createVoicePackCheckout(client, ctx(), { ...PRICES, packs: { ...PRICES.packs, 250: undefined } }, 250);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.state, "integration-required");
    assert.equal(calls.length, 0);
  });

  test("an unknown pack size is invalid", async () => {
    const { client, calls } = mockStripe();
    const outcome = await createVoicePackCheckout(client, ctx(), PRICES, 300);
    assert.equal(!outcome.ok && outcome.state, "invalid");
    assert.equal(calls.length, 0);
  });

  test("an inactive subscription is refused", async () => {
    const { client, calls } = mockStripe();
    const outcome = await createVoicePackCheckout(client, ctx({ active: false }), PRICES, 100);
    assert.equal(!outcome.ok && outcome.state, "plan-limit-reached");
    assert.equal(calls.length, 0);
  });

  test("a Stripe error is an error outcome, never thrown", async () => {
    const { client } = mockStripe();
    client.checkout.sessions.create = async () => {
      throw new Error("stripe down");
    };
    const outcome = await createVoicePackCheckout(client, ctx(), PRICES, 100);
    assert.equal(!outcome.ok && outcome.state, "error");
  });
});

describe("dedicated number item", () => {
  const live = (items: { id: string; price: { id: string } }[], status = "active") => ({ id: "sub_test_1", status, items: { data: items } });

  test("added to the live subscription with proration and the number price", async () => {
    const { client, calls } = mockStripe(live([{ id: "si_plan", price: { id: "price_test_growth" } }]));
    const outcome = await addVoiceNumberItem(client, ctx(), PRICES);
    assert.deepEqual(outcome, { ok: true, changed: true, itemId: "si_test_number" });
    const create = calls.find((call) => call.method === "subscriptionItems.create");
    assert.ok(create);
    const params = create.params as Stripe.SubscriptionItemCreateParams;
    assert.equal(params.subscription, "sub_test_1");
    assert.equal(params.price, "price_test_voice_number");
    assert.equal(params.quantity, 1);
    assert.equal(params.proration_behavior, "create_prorations");
    assert.equal((params.metadata as Record<string, string> | undefined)?.kind, "voice_number");
    assert.match((create.options as { idempotencyKey: string }).idempotencyKey, /^voice_number:sub_test_1:si_plan:\d+$/);
  });

  test("refused in a trial (plan key) before any Stripe call", async () => {
    const { client, calls } = mockStripe(live([]));
    const outcome = await addVoiceNumberItem(client, ctx({ plan: "trial" }), PRICES);
    assert.deepEqual(outcome, { ok: false, state: "plan-limit-reached", error: TRIAL_VOICE_PURCHASE_REFUSAL });
    assert.equal(calls.length, 0);
  });

  test("refused when Stripe says the subscription is still trialing", async () => {
    const { client, calls } = mockStripe(live([{ id: "si_plan", price: { id: "price_test_growth" } }], "trialing"));
    const outcome = await addVoiceNumberItem(client, ctx(), PRICES);
    assert.equal(!outcome.ok && outcome.error, TRIAL_VOICE_PURCHASE_REFUSAL);
    assert.equal(calls.some((call) => call.method === "subscriptionItems.create"), false);
  });

  test("refused as integration-required when the number price env is missing", async () => {
    const { client, calls } = mockStripe(live([]));
    const outcome = await addVoiceNumberItem(client, ctx(), { ...PRICES, numberMonthly: null });
    assert.equal(!outcome.ok && outcome.state, "integration-required");
    assert.equal(calls.length, 0);
  });

  test("not added twice", async () => {
    const { client, calls } = mockStripe(
      live([
        { id: "si_num", price: { id: "price_test_voice_number" } },
        { id: "si_plan", price: { id: "price_test_growth" } },
      ]),
    );
    const outcome = await addVoiceNumberItem(client, ctx(), PRICES);
    assert.deepEqual(outcome, { ok: true, changed: false, itemId: "si_num" });
    assert.equal(calls.some((call) => call.method === "subscriptionItems.create"), false);
  });

  test("Pro with the voice item already has a number", async () => {
    const { client, calls } = mockStripe(
      live([
        { id: "si_plan", price: { id: "price_test_pro" } },
        { id: "si_voice", price: { id: "price_test_voice_addon" } },
      ]),
    );
    const outcome = await addVoiceNumberItem(client, ctx({ plan: "pro" }), PRICES);
    assert.equal(!outcome.ok && outcome.state, "invalid");
    assert.equal(calls.some((call) => call.method === "subscriptionItems.create"), false);
  });

  test("no subscription on record is refused without a Stripe call", async () => {
    const { client, calls } = mockStripe();
    const outcome = await addVoiceNumberItem(client, ctx({ stripeSubscriptionId: null }), PRICES);
    assert.equal(!outcome.ok && outcome.state, "plan-limit-reached");
    assert.equal(calls.length, 0);
  });
});

describe("voicePurchaseState (what the Settings panel offers)", () => {
  const base = { plan: "growth", active: true, isOwner: true, proVoiceItem: false, numberItem: false, prices: PRICES };

  test("a Growth owner can buy packs and add the number", () => {
    const state = voicePurchaseState(base);
    assert.equal(state.canBuyPacks, true);
    assert.equal(state.canAddNumber, true);
    assert.equal(state.numberMonthlyGbp, 11.99);
    assert.deepEqual(state.packs.map((pack) => pack.available), [true, true, true, true]);
  });

  test("a trial sees the trial refusal", () => {
    const state = voicePurchaseState({ ...base, plan: "trial" });
    assert.equal(state.canBuyPacks, false);
    assert.equal(state.packsBlockedReason, TRIAL_VOICE_PURCHASE_REFUSAL);
    assert.equal(state.canAddNumber, false);
  });

  test("a non-owner cannot buy", () => {
    const state = voicePurchaseState({ ...base, isOwner: false });
    assert.equal(state.canBuyPacks, false);
    assert.equal(state.canAddNumber, false);
  });

  test("Pro with the voice item: number included", () => {
    const state = voicePurchaseState({ ...base, plan: "pro", proVoiceItem: true });
    assert.equal(state.numberState, "included");
    assert.equal(state.canAddNumber, false);
    assert.equal(state.canBuyPacks, true);
  });

  test("missing prices are integration-required", () => {
    const state = voicePurchaseState({ ...base, prices: { packs: {} } });
    assert.equal(state.packsState, "integration-required");
    assert.equal(state.numberState, "integration-required");
  });
});
