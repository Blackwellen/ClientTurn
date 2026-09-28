import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { TERMS_PATH, TERMS_VERSION } from "@/lib/marketing/terms-version";
import { stripe } from "./stripe";
import { getEntitlements } from "./entitlements";
import { automaticTaxEnabled } from "./tax";
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
    automaticTax: automaticTaxEnabled(),
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

export type RemoveVoiceOutcome =
  | { ok: true; releaseNumberAt: string | null; keepsNumber: boolean }
  | { ok: false; error: string };

/**
 * OD-2 "remove voice": Pro without voice is £399. Deletes only the £100 voice
 * item, prorated (Stripe TEST keys only, env.ts). The included minutes end
 * with the item (the webhook's sync expires them); packs stay. The dedicated
 * number is kept to the end of the period, then released, unless the £11.99
 * number item is on the subscription. The owner is warned first (dialog) and
 * again by notification.
 */
export async function removeProVoice(workspace: Workspace): Promise<RemoveVoiceOutcome> {
  const { voiceRemovalPlan } = await import("./voice-line-items");
  const { data } = await db().from("subscriptions").select("plan, stripe_subscription_id").eq("business_id", workspace.businessId).maybeSingle();
  const row = data as { plan: string | null; stripe_subscription_id: string | null } | null;
  if (!row?.stripe_subscription_id) return { ok: false, error: "There is no live subscription to change." };
  const prices = voicePriceConfig();
  try {
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const plan = voiceRemovalPlan({
      plan: row.plan ?? "",
      items: subscription.items.data.map((i) => ({ id: i.id, priceId: i.price?.id ?? null, currentPeriodEnd: i.current_period_end ?? null })),
      voiceAddonPriceId: prices.addonMonthly ?? null,
      numberPriceId: prices.numberMonthly ?? null,
    });
    if (!plan.ok) {
      return { ok: false, error: plan.reason === "NO_VOICE_ITEM" ? "Your subscription has no voice item to remove." : "Voice can only be removed from a Pro subscription." };
    }
    await stripe.subscriptionItems.del(plan.itemId, { proration_behavior: "create_prorations" });
    if (plan.releaseNumberAt) {
      const { scheduleNumberRelease } = await import("@/lib/voice/runtime-core");
      const { serverVoiceDeps } = await import("@/lib/voice/server-deps");
      await scheduleNumberRelease(serverVoiceDeps(), { businessId: workspace.businessId, releaseAfter: plan.releaseNumberAt }).catch(() => null);
    }
    const { queueNotification } = await import("@/lib/jobs/handlers/shared");
    await queueNotification({
      businessId: workspace.businessId,
      type: "billing",
      severity: "info",
      title: "Voice removed from Pro",
      body: plan.keepsNumber
        ? "Your £100 voice item is removed and prorated. Your dedicated number stays on its own £11.99 item. Buy minute packs to keep calling."
        : `Your £100 voice item is removed and prorated. Your dedicated number is kept until ${plan.releaseNumberAt ? plan.releaseNumberAt.slice(0, 10) : "the end of the period"}, then released unless you add it for £11.99 a month.`,
      linkUrl: "/app/settings?section=voice&panel=budget",
      dedupeKey: `voice-removed:${workspace.businessId}:${plan.itemId}`,
    });
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.voice_removed",
      entityType: "subscription",
      metadata: { itemId: plan.itemId, releaseNumberAt: plan.releaseNumberAt, keepsNumber: plan.keepsNumber },
    });
    return { ok: true, releaseNumberAt: plan.releaseNumberAt, keepsNumber: plan.keepsNumber };
  } catch {
    return { ok: false, error: "Voice could not be removed. Try again or open the billing portal." };
  }
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
