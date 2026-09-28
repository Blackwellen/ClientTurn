import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { expireVoiceIncludedMinutes, grantVoicePeriodMinutes } from "@/lib/voice/minutes";
import { VOICE_ADDON } from "./plans";
import {
  VOICE_ITEM_GRANT_KEYS,
  VOICE_PACK_GRANT_REASON,
  subscriptionEnded,
  voiceGrantChanges,
  voiceItemsOf,
  type VoicePriceIds,
} from "./subscription-items";

/**
 * Voice subscription items (OD-2) mirrored into `business_entitlement_grants`.
 *
 * Called from `applyStripeSubscription` after the plan mirror. No Stripe I/O:
 * only the subscription payload it was handed. Everything here is idempotent
 * (upserts on `(business_id, entitlement_key)`, conditional revocations, the
 * per-period minute grant keyed on the period), so a replayed webhook or the
 * Checkout return page racing it changes nothing. A failure is logged and
 * swallowed: the plan mirror must never fail because of voice.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export function voicePriceIds(): VoicePriceIds {
  const voice = serverEnv.stripe.prices.voice;
  return { addonMonthly: voice.addonMonthly ?? null, numberMonthly: voice.numberMonthly ?? null };
}

function iso(unix: number | null | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString() : null;
}

export async function syncVoiceItems(
  subscription: Stripe.Subscription,
  context: { businessId: string; deleted: boolean; eventId?: string },
): Promise<void> {
  try {
    await applyVoiceItems(subscription, context);
  } catch (error) {
    console.error("[stripe] voice item sync failed", {
      businessId: context.businessId,
      eventId: context.eventId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function applyVoiceItems(
  subscription: Stripe.Subscription,
  context: { businessId: string; deleted: boolean },
): Promise<void> {
  const prices = voicePriceIds();
  // No voice prices configured: nothing on any subscription can be a voice
  // item, and revoking would only churn rows. Nothing to do.
  if (!prices.addonMonthly && !prices.numberMonthly) return;

  const { businessId } = context;
  const items = voiceItemsOf(subscription.items?.data ?? [], prices);
  const ended = subscriptionEnded(subscription.status, context.deleted);
  const changes = voiceGrantChanges(items, { ended, includedMinutes: VOICE_ADDON.includedMinutes });
  const client = db();

  for (const grant of changes.upserts) {
    const { error } = await client.from("business_entitlement_grants").upsert(
      {
        business_id: businessId,
        entitlement_key: grant.entitlementKey,
        numeric_value: grant.numericValue,
        boolean_value: grant.booleanValue,
        reason: grant.reason,
        expires_at: null,
        revoked_at: null,
      },
      { onConflict: "business_id,entitlement_key" },
    );
    if (error) throw new Error(`voice grant ${grant.entitlementKey}: ${error.message}`);
  }

  if (changes.revokeKeys.length > 0) {
    await revokeItemGrants(client, businessId, changes.revokeKeys);
  }

  // No live Pro voice item (removed, or its scheduled end has passed): the
  // included minutes end with it. Idempotent per granted period; a no-op
  // when there are none (Starter/Growth never hold included minutes).
  if (!items.proVoice || ended) {
    const expired = await expireVoiceIncludedMinutes(businessId, "Pro voice item ended");
    if (expired !== "APPLIED" && expired !== "REPLAY" && expired !== "NOTHING_TO_EXPIRE") {
      console.error("[stripe] voice included minutes not expired", { businessId, result: expired });
    }
  }

  // The Pro item's included minutes for its current period. Only once the
  // subscription is actually paid for: trials never place live calls.
  // Idempotent per period (the ledger key carries the period start), so this
  // runs on every event and only the first for a new period moves minutes.
  const pro = ended ? null : items.proVoice;
  const periodStart = iso(pro?.periodStart);
  if (pro && periodStart && subscription.status === "active") {
    const result = await grantVoicePeriodMinutes({
      businessId,
      includedMinutes: VOICE_ADDON.includedMinutes,
      periodStart,
      periodEnd: iso(pro.periodEnd),
    });
    if (result !== "APPLIED" && result !== "REPLAY") {
      console.error("[stripe] voice period minutes not granted", { businessId, periodStart, result });
    }
  }
}

/**
 * Revokes item-sourced grants whose item is gone. Only grants written from a
 * Stripe item (`STRIPE_ITEM:%`) are touched: an admin grant or a pack grant is
 * not the subscription's to take away. `voice_sales_enabled` falls back to the
 * pack grant when the workspace has bought a minute pack, so removing the Pro
 * item does not switch off voice that packs still pay for.
 */
async function revokeItemGrants(client: SupabaseClient, businessId: string, keys: string[]): Promise<void> {
  const { data, error } = await client
    .from("business_entitlement_grants")
    .select("entitlement_key, reason")
    .eq("business_id", businessId)
    .in("entitlement_key", keys)
    .is("revoked_at", null)
    .like("reason", "STRIPE_ITEM:%");
  if (error) throw new Error(`voice grant read: ${error.message}`);
  const live = ((data ?? []) as { entitlement_key: string }[]).map((row) => row.entitlement_key);
  if (live.length === 0) return;

  let toRevoke = live;
  if (live.includes(VOICE_ITEM_GRANT_KEYS.salesEnabled) && (await packsHeld(client, businessId))) {
    const { error: packError } = await client
      .from("business_entitlement_grants")
      .update({ reason: VOICE_PACK_GRANT_REASON, numeric_value: 1, boolean_value: true })
      .eq("business_id", businessId)
      .eq("entitlement_key", VOICE_ITEM_GRANT_KEYS.salesEnabled)
      .like("reason", "STRIPE_ITEM:%");
    if (packError) throw new Error(`voice grant fallback: ${packError.message}`);
    toRevoke = live.filter((key) => key !== VOICE_ITEM_GRANT_KEYS.salesEnabled);
  }
  if (toRevoke.length === 0) return;

  const { error: revokeError } = await client
    .from("business_entitlement_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .in("entitlement_key", toRevoke)
    .is("revoked_at", null)
    .like("reason", "STRIPE_ITEM:%");
  if (revokeError) throw new Error(`voice grant revoke: ${revokeError.message}`);
}

async function packsHeld(client: SupabaseClient, businessId: string): Promise<boolean> {
  const { count, error } = await client
    .from("voice_minute_ledger")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("kind", "PACK_PURCHASE");
  // Unknown is treated as "no packs": the item grant is revoked, which is the
  // safe direction (a pack purchase re-grants on its own webhook).
  if (error) return false;
  return (count ?? 0) > 0;
}
