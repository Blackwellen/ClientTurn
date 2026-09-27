import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { TERMS_PATH, TERMS_VERSION } from "@/lib/marketing/terms-version";
import { stripe } from "./stripe";
import { getEntitlements } from "./entitlements";
import {
  addVoiceNumberItem,
  createVoicePackCheckout,
  voicePurchaseState,
  type VoiceNumberOutcome,
  type VoicePackCheckoutOutcome,
  type VoicePriceConfig,
  type VoicePurchaseContext,
  type VoicePurchaseState,
  type VoiceStripeClient,
} from "./voice-purchase";

/**
 * Server half of buying voice: reads the workspace (plan, subscription, owner
 * email), hands it to the injected-client core in `voice-purchase.ts` with the
 * real Stripe client (TEST keys only, `env.ts`), and audits. Owner checks
 * live in `voice-actions.ts`.
 */

type Workspace = { businessId: string; userId: string };

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export function voicePriceConfig(): VoicePriceConfig {
  const voice = serverEnv.stripe.prices.voice;
  return { addonMonthly: voice.addonMonthly ?? null, numberMonthly: voice.numberMonthly ?? null, packs: voice.packs };
}

const stripeClient = stripe as unknown as VoiceStripeClient;

async function contextFor(workspace: Workspace): Promise<VoicePurchaseContext> {
  const [entitlements, subscription, profile] = await Promise.all([
    getEntitlements(workspace.businessId),
    db()
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
    db().from("profiles").select("email").eq("id", workspace.userId).maybeSingle(),
  ]);
  if (subscription.error) throw new Error(`Could not read the subscription: ${subscription.error.message}`);
  const row = subscription.data as { stripe_customer_id: string | null; stripe_subscription_id: string | null } | null;
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    plan: entitlements.plan,
    active: entitlements.active,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
    customerEmail: (profile.data as { email?: string | null } | null)?.email ?? undefined,
    site: serverEnv.siteUrl.replace(/\/$/, ""),
    termsPath: TERMS_PATH,
    termsVersion: TERMS_VERSION,
  };
}

export async function startVoicePackCheckout(workspace: Workspace, minutes: number): Promise<VoicePackCheckoutOutcome> {
  let ctx: VoicePurchaseContext;
  try {
    ctx = await contextFor(workspace);
  } catch {
    return { ok: false, state: "error", error: "Could not check your plan. Try again." };
  }
  const outcome = await createVoicePackCheckout(stripeClient, ctx, voicePriceConfig(), minutes);
  if (outcome.ok) {
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.voice_pack_purchase_started",
      entityType: "voice_minute_pack",
      metadata: { minutes, sessionId: outcome.sessionId },
    });
  }
  return outcome;
}

export async function addVoiceNumber(workspace: Workspace): Promise<VoiceNumberOutcome> {
  let ctx: VoicePurchaseContext;
  try {
    ctx = await contextFor(workspace);
  } catch {
    return { ok: false, state: "error", error: "Could not check your plan. Try again." };
  }
  const outcome = await addVoiceNumberItem(stripeClient, ctx, voicePriceConfig());
  if (outcome.ok && outcome.changed) {
    // The grant (`voice_number_item`) is written by the
    // `customer.subscription.updated` webhook this change triggers.
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.voice_number_added",
      entityType: "subscription",
      metadata: { itemId: outcome.itemId },
    });
  }
  return outcome;
}

/**
 * What the Settings voice panel may offer, from the plan, the live
 * item-sourced grants and the configured prices. Never throws: a failed read
 * shows nothing as purchasable.
 */
export async function readVoicePurchaseState(input: {
  businessId: string;
  isOwner: boolean;
}): Promise<VoicePurchaseState> {
  const prices = voicePriceConfig();
  try {
    const [entitlements, grants] = await Promise.all([
      getEntitlements(input.businessId),
      db()
        .from("business_entitlement_grants")
        .select("entitlement_key")
        .eq("business_id", input.businessId)
        .in("entitlement_key", ["voice_pro_item", "voice_number_item"])
        .is("revoked_at", null),
    ]);
    if (grants.error) throw new Error(grants.error.message);
    const keys = new Set(((grants.data ?? []) as { entitlement_key: string }[]).map((row) => row.entitlement_key));
    return voicePurchaseState({
      plan: entitlements.plan,
      active: entitlements.active,
      isOwner: input.isOwner,
      proVoiceItem: keys.has("voice_pro_item"),
      numberItem: keys.has("voice_number_item"),
      prices,
    });
  } catch {
    const blocked = voicePurchaseState({
      plan: "trial",
      active: false,
      isOwner: input.isOwner,
      proVoiceItem: false,
      numberItem: false,
      prices,
    });
    const reason = "Could not check your plan. Try again.";
    return {
      ...blocked,
      packsState: "error",
      packsBlockedReason: reason,
      numberState: "error",
      numberBlockedReason: reason,
    };
  }
}
