import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { creditVoicePack } from "@/lib/voice/minutes";
import { recordTopUpTermsAcceptance } from "./terms-acceptance";
import { voiceMinutePack } from "./plans";
import { VOICE_ITEM_GRANT_KEYS, VOICE_PACK_GRANT_REASON } from "./subscription-items";
import { VOICE_PACK_METADATA_KIND } from "./voice-purchase";

/**
 * `checkout.session.completed` for a voice minute pack (Stripe TEST).
 *
 * Applied inline from the Stripe webhook after it has verified the signature
 * and written the `webhook_events` inbox row, exactly as the SMS/WhatsApp and
 * AI token top-ups are: no provider I/O, only database writes. Idempotent
 * twice over: the inbox rejects a replayed event id, and `creditVoicePack`
 * keys its ledger row on the Checkout session id, so a redelivery (even under
 * a new event id) credits once. Throws on a failed credit so the webhook marks
 * the event failed and Stripe's retry credits it.
 *
 * Nothing to do on `checkout.session.expired`: a pack has no PENDING row (the
 * ledger row is the purchase record), so an expired session left nothing
 * behind.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export async function applyVoicePackCheckout(event: Stripe.Event): Promise<void> {
  if (event.type !== "checkout.session.completed") return;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== VOICE_PACK_METADATA_KIND) return;
  // An async payment method still clearing is not money yet.
  if (session.payment_status !== "paid") return;

  const businessId = session.metadata?.business_id;
  const pack = voiceMinutePack(Number(session.metadata?.minutes));
  if (!businessId || !pack) {
    console.error("[stripe webhook] voice pack session without a valid business or pack", {
      eventId: event.id,
      sessionId: session.id,
    });
    return;
  }

  const result = await creditVoicePack({ businessId, minutes: pack.minutes, stripeRef: session.id });
  if (result !== "APPLIED" && result !== "REPLAY") {
    throw new Error(`voice pack credit not applied (${result})`);
  }

  await grantVoiceViaPack(businessId);
  // Terms clause 9.9 accepted at Checkout, stored with the session.
  await recordTopUpTermsAcceptance(session, businessId);
  await recordAudit({
    businessId,
    actorUserId: null,
    actorType: "provider",
    action: "billing.voice_pack_purchased",
    entityType: "voice_minute_pack",
    metadata: { minutes: pack.minutes, packKey: pack.key, sessionId: session.id, result, stripe_event: event.type },
  });
}

/**
 * `voice_sales_enabled` via a pack (Starter/Growth, or Pro without the item).
 * A live grant already switching voice on (the Pro item's, or an earlier
 * pack's) is left alone; otherwise the pack grant is written or revived.
 */
async function grantVoiceViaPack(businessId: string): Promise<void> {
  const client = db();
  const { data, error } = await client
    .from("business_entitlement_grants")
    .select("numeric_value, boolean_value, revoked_at, expires_at")
    .eq("business_id", businessId)
    .eq("entitlement_key", VOICE_ITEM_GRANT_KEYS.salesEnabled)
    .maybeSingle();
  if (error) throw new Error(`voice pack grant read: ${error.message}`);
  const row = data as {
    numeric_value: number | string | null;
    boolean_value: boolean | null;
    revoked_at: string | null;
    expires_at: string | null;
  } | null;
  const liveAndOn =
    row &&
    !row.revoked_at &&
    (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()) &&
    (row.numeric_value != null ? Number(row.numeric_value) > 0 : row.boolean_value === true);
  if (liveAndOn) return;

  const { error: upsertError } = await client.from("business_entitlement_grants").upsert(
    {
      business_id: businessId,
      entitlement_key: VOICE_ITEM_GRANT_KEYS.salesEnabled,
      numeric_value: 1,
      boolean_value: true,
      reason: VOICE_PACK_GRANT_REASON,
      expires_at: null,
      revoked_at: null,
    },
    { onConflict: "business_id,entitlement_key" },
  );
  if (upsertError) throw new Error(`voice pack grant: ${upsertError.message}`);
}
