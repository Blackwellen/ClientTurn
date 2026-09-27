/**
 * Buying voice (OD-2): a one-off minute pack, or the £11.99 dedicated-number
 * item added to the live subscription. The Stripe-calling core, with the
 * Stripe client INJECTED so `tests/voice-checkout.test.ts` drives it with a
 * mock (no network, no Stripe objects created). Pure otherwise: no
 * `server-only`, no Supabase; the server wrapper (`voice-checkout.ts`) reads
 * the workspace and passes it in.
 *
 * Same guarantees as the existing top-ups: nothing here grants anything. A
 * pack Checkout only proposes a purchase; the Stripe webhook
 * (`voice-webhook.ts`) credits minutes when the session is paid. The number
 * item is mirrored into grants by the subscription webhook
 * (`voice-subscription-sync.ts`).
 *
 * Stripe safety (CLAUDE.md): prices are pre-created TEST prices the owner
 * makes by hand (env `STRIPE_PRICE_VOICE_*`). A missing price id is refused
 * as integration-required, never worked around by creating one.
 */

import type Stripe from "stripe";
import {
  TRIAL_VOICE_PURCHASE_REFUSAL,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  voiceMinutePack,
  voicePurchaseAllowed,
} from "./plans.ts";
import { voiceItemsOf, type SubscriptionItemLike } from "./subscription-items.ts";

/** The parts of the Stripe SDK the voice purchases call. */
export type VoiceStripeClient = {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string; url: string | null }>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<{ id: string; status: string; items: { data: SubscriptionItemLike[] } }>;
  };
  subscriptionItems: {
    create(
      params: Stripe.SubscriptionItemCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string }>;
  };
};

export type VoicePriceConfig = {
  addonMonthly?: string | null;
  numberMonthly?: string | null;
  packs: Readonly<Record<number, string | null | undefined>>;
};

export type VoicePurchaseContext = {
  businessId: string;
  userId: string;
  /** Entitlement plan key (getEntitlements().plan): "trial" while trialling. */
  plan: string;
  /** getEntitlements().active: the subscription permits billable work. */
  active: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  customerEmail?: string;
  /** Site origin without a trailing slash. */
  site: string;
  termsPath: string;
  termsVersion: string;
};

/** Failure states map onto the route states every surface implements (CLAUDE.md). */
export type VoicePurchaseFailure = {
  ok: false;
  state: "invalid" | "plan-limit-reached" | "integration-required" | "error";
  error: string;
};

export type VoicePackCheckoutOutcome = { ok: true; url: string; sessionId: string } | VoicePurchaseFailure;
export type VoiceNumberOutcome =
  | { ok: true; changed: boolean; itemId: string | null }
  | VoicePurchaseFailure;

export const VOICE_PACK_METADATA_KIND = "voice_pack";
export const VOICE_NUMBER_METADATA_KIND = "voice_number";

const ENTERPRISE_REFUSAL = "Voice is part of your Enterprise contract. Contact your account manager to change it.";
const INACTIVE_REFUSAL = "Your subscription is not active, so voice cannot be bought. Update your billing details first.";

/** The rules both purchases share, before any Stripe call. */
function planGate(ctx: VoicePurchaseContext): VoicePurchaseFailure | null {
  if (!voicePurchaseAllowed(ctx.plan)) {
    return { ok: false, state: "plan-limit-reached", error: TRIAL_VOICE_PURCHASE_REFUSAL };
  }
  if (ctx.plan === "enterprise") return { ok: false, state: "plan-limit-reached", error: ENTERPRISE_REFUSAL };
  if (!ctx.active) return { ok: false, state: "plan-limit-reached", error: INACTIVE_REFUSAL };
  return null;
}

/**
 * Checkout terms for a minute pack: Checkout will not complete without the
 * terms box ticked (terms clause 9.9, as every top-up), and the rule sits by
 * the Pay button.
 */
function packTerms(ctx: VoicePurchaseContext): Pick<Stripe.Checkout.SessionCreateParams, "consent_collection" | "custom_text"> {
  return {
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        message: `I agree to the [ClientTurn Terms of Service](${ctx.site}${ctx.termsPath}), including clause 9.9: voice minutes are prepaid and non-refundable once any are used.`,
      },
      submit: {
        message: "Voice minute packs are prepaid and never expire. There is no overage: when minutes run out, calls stop until you top up.",
      },
    },
  };
}

/** One-off Checkout (mode "payment") for a voice minute pack. */
export async function createVoicePackCheckout(
  stripe: VoiceStripeClient,
  ctx: VoicePurchaseContext,
  prices: VoicePriceConfig,
  minutes: number,
): Promise<VoicePackCheckoutOutcome> {
  const pack = voiceMinutePack(minutes);
  if (!pack) return { ok: false, state: "invalid", error: "Choose a minute pack to continue." };

  const gate = planGate(ctx);
  if (gate) return gate;

  const priceId = prices.packs[pack.minutes];
  if (!priceId) {
    return {
      ok: false,
      state: "integration-required",
      error: "Voice minute packs are not set up for checkout yet. Contact support and we will set it up.",
    };
  }

  const metadata = {
    kind: VOICE_PACK_METADATA_KIND,
    business_id: ctx.businessId,
    user_id: ctx.userId,
    pack_key: pack.key,
    minutes: String(pack.minutes),
    terms_version: ctx.termsVersion,
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: ctx.stripeCustomerId ?? undefined,
      customer_email: ctx.stripeCustomerId ? undefined : ctx.customerEmail,
      client_reference_id: ctx.businessId,
      // A receipt for the history table: Stripe emails one and keeps it.
      invoice_creation: ctx.stripeCustomerId ? { enabled: true } : undefined,
      ...packTerms(ctx),
      // The webhook reads these back; `minutes` is what it credits, and the
      // session id is the idempotency reference (creditVoicePack).
      metadata,
      payment_intent_data: {
        metadata: { kind: VOICE_PACK_METADATA_KIND, business_id: ctx.businessId, pack_key: pack.key, minutes: String(pack.minutes) },
      },
      success_url: `${ctx.site}/app/settings?section=billing&voicepack=success`,
      cancel_url: `${ctx.site}/app/settings?section=billing&voicepack=cancelled`,
    });
    if (!session.url) return { ok: false, state: "error", error: "Could not start checkout. Try again." };
    return { ok: true, url: session.url, sessionId: session.id };
  } catch {
    return { ok: false, state: "error", error: "Could not start checkout. Try again." };
  }
}

const LIVE_STRIPE_STATUSES = new Set(["active", "past_due"]);

/**
 * Adds the £11.99 dedicated-number item to the live subscription, prorated
 * for the rest of the period. For Starter/Growth, and Pro without the voice
 * item (whose item already includes a number). Reads the subscription back
 * from Stripe (the source of truth) so a second click never adds a second
 * number, and passes an idempotency key tied to the current item set.
 */
export async function addVoiceNumberItem(
  stripe: VoiceStripeClient,
  ctx: VoicePurchaseContext,
  prices: VoicePriceConfig,
): Promise<VoiceNumberOutcome> {
  const gate = planGate(ctx);
  if (gate) return gate;

  const priceId = prices.numberMonthly;
  if (!priceId) {
    return {
      ok: false,
      state: "integration-required",
      error: "The dedicated number is not set up for checkout yet. Contact support and we will set it up.",
    };
  }
  if (!ctx.stripeSubscriptionId) {
    return { ok: false, state: "plan-limit-reached", error: "There is no live subscription to add the number to." };
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(ctx.stripeSubscriptionId);
    if (subscription.status === "trialing") {
      return { ok: false, state: "plan-limit-reached", error: TRIAL_VOICE_PURCHASE_REFUSAL };
    }
    if (!LIVE_STRIPE_STATUSES.has(subscription.status)) {
      return { ok: false, state: "plan-limit-reached", error: INACTIVE_REFUSAL };
    }

    const items = voiceItemsOf(subscription.items.data, prices);
    if (items.number) return { ok: true, changed: false, itemId: items.number.itemId };
    if (items.proVoice) {
      return { ok: false, state: "invalid", error: "Your Pro voice item already includes a dedicated number." };
    }

    // Guards a double click (same item set, same minute). The minute bucket
    // keeps a later re-add, after the number was removed, from replaying the
    // old response for Stripe's 24-hour idempotency window.
    const itemIds = `${subscription.items.data.map((item) => item.id).sort().join(",")}:${Math.floor(Date.now() / 60_000)}`;
    const created = await stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price: priceId,
        quantity: 1,
        proration_behavior: "create_prorations",
        metadata: { kind: VOICE_NUMBER_METADATA_KIND, business_id: ctx.businessId },
      },
      { idempotencyKey: `voice_number:${subscription.id}:${itemIds}` },
    );
    return { ok: true, changed: true, itemId: created.id };
  } catch {
    return { ok: false, state: "error", error: "Could not add the number. Try again or open the billing portal." };
  }
}

/* ------------------------------------------------------------- UI state */

export type VoicePurchaseState = {
  /** A minute pack can be bought now. */
  canBuyPacks: boolean;
  /** Why not, in words for the owner (null when allowed). */
  packsBlockedReason: string | null;
  packsState: VoicePurchaseFailure["state"] | "ok";
  /** The dedicated-number item can be added now. */
  canAddNumber: boolean;
  numberBlockedReason: string | null;
  numberState: VoicePurchaseFailure["state"] | "ok" | "included" | "owned";
  numberMonthlyGbp: number;
  packs: { key: string; minutes: number; priceGbp: number; available: boolean }[];
};

/**
 * What the Settings voice panel may offer. Mirrors the server rules above;
 * the server re-checks every one of them, this only decides what to show.
 */
export function voicePurchaseState(input: {
  plan: string;
  active: boolean;
  isOwner: boolean;
  proVoiceItem: boolean;
  numberItem: boolean;
  prices: VoicePriceConfig;
}): VoicePurchaseState {
  const ctxGate = planGate({
    businessId: "",
    userId: "",
    plan: input.plan,
    active: input.active,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    site: "",
    termsPath: "",
    termsVersion: "",
  });
  const ownerGate: VoicePurchaseFailure | null = input.isOwner
    ? null
    : { ok: false, state: "plan-limit-reached", error: "Only the workspace owner can buy voice." };
  const gate = ctxGate ?? ownerGate;

  const packs = VOICE_MINUTE_PACKS.map((pack) => ({
    key: pack.key,
    minutes: pack.minutes,
    priceGbp: pack.priceGbp,
    available: !gate && Boolean(input.prices.packs[pack.minutes]),
  }));
  const anyPackPrice = packs.some((pack) => Boolean(input.prices.packs[pack.minutes]));
  const packsBlockedReason = gate
    ? gate.error
    : anyPackPrice
      ? null
      : "Voice minute packs are not set up for checkout yet. Contact support and we will set it up.";

  let numberState: VoicePurchaseState["numberState"] = "ok";
  let numberBlockedReason: string | null = null;
  if (gate) {
    numberState = gate.state;
    numberBlockedReason = gate.error;
  } else if (input.proVoiceItem) {
    numberState = "included";
    numberBlockedReason = "Your Pro voice item already includes a dedicated number.";
  } else if (input.numberItem) {
    numberState = "owned";
    numberBlockedReason = "Your dedicated number is already on your subscription.";
  } else if (!input.prices.numberMonthly) {
    numberState = "integration-required";
    numberBlockedReason = "The dedicated number is not set up for checkout yet. Contact support and we will set it up.";
  }

  return {
    canBuyPacks: !packsBlockedReason,
    packsBlockedReason,
    packsState: gate ? gate.state : anyPackPrice ? "ok" : "integration-required",
    canAddNumber: numberState === "ok",
    numberBlockedReason,
    numberState,
    numberMonthlyGbp: VOICE_NUMBER_MONTHLY_GBP,
    packs,
  };
}
