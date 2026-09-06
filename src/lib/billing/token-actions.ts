"use server";

/**
 * Buying AI tokens.
 *
 * Two halves that never trust each other: this file *starts* a checkout and
 * records a PENDING purchase; the Stripe webhook is the only thing that ever
 * marks one PAID and credits the tokens. Nothing here grants an allowance,
 * because nothing here has seen any money.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { stripe } from "./stripe";
import { getTokenStatus, listTokenPurchases } from "./token-service";
import { isTokenPackKey, TOKEN_PACKS, type TokenPackKey } from "./tokens";

export type TokenCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const packSchema = z.object({
  packKey: z.string().refine(isTokenPackKey, "Unknown pack."),
});

/**
 * Starts a one-off Stripe checkout for a token pack.
 *
 * Prices are built with `price_data` rather than pre-created Price objects, so
 * a pack can be repriced in `tokens.ts` without anyone touching the Stripe
 * dashboard first. The amount Stripe charges is still Stripe's record; this
 * only proposes it.
 */
export async function startTokenTopUp(input: unknown): Promise<TokenCheckoutResult> {
  const parsed = packSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a top-up to continue." };

  // Buying spends money, so it is an owner action, not an admin one.
  const workspace = await requireRole("owner").catch(() => null);
  if (!workspace) {
    return { ok: false, error: "Only the workspace owner can buy AI tokens." };
  }

  const pack = TOKEN_PACKS[parsed.data.packKey as TokenPackKey];
  const admin = createAdminClient();

  const [{ data: subscription }, { data: profile }] = await Promise.all([
    admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
    admin.from("profiles").select("email").eq("id", workspace.userId).maybeSingle(),
  ]);

  // The purchase row exists before the session does, so a webhook that arrives
  // faster than this function returns still has something to attach to.
  const { data: purchase, error: purchaseError } = await admin
    .from("ai_token_purchases")
    .insert({
      business_id: workspace.businessId,
      pack_key: pack.key,
      tokens: pack.tokens,
      amount_minor: pack.amountMinor,
      currency: pack.currency,
      status: "PENDING",
      purchased_by: workspace.userId,
    })
    .select("id")
    .single();

  if (purchaseError || !purchase) {
    return { ok: false, error: "Could not start the purchase. Try again." };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pack.currency.toLowerCase(),
            unit_amount: pack.amountMinor,
            product_data: {
              name: `ClientTurn — ${pack.name}`,
              description: `${pack.tokens.toLocaleString("en-GB")} AI tokens`,
            },
          },
        },
      ],
      customer: subscription?.stripe_customer_id ?? undefined,
      customer_email: subscription?.stripe_customer_id
        ? undefined
        : (profile?.email ?? undefined),
      client_reference_id: workspace.businessId,
      // The webhook reads these back. `purchase_id` is what makes crediting
      // idempotent without having to match on amounts.
      metadata: {
        kind: "ai_tokens",
        business_id: workspace.businessId,
        purchase_id: purchase.id,
        pack_key: pack.key,
        tokens: String(pack.tokens),
      },
      payment_intent_data: {
        metadata: {
          kind: "ai_tokens",
          business_id: workspace.businessId,
          purchase_id: purchase.id,
        },
      },
      success_url: `${serverEnv.siteUrl}/app/settings?section=billing&topup=success`,
      cancel_url: `${serverEnv.siteUrl}/app/settings?section=billing&topup=cancelled`,
    });

    if (!session.url) {
      await admin
        .from("ai_token_purchases")
        .update({ status: "FAILED" })
        .eq("id", purchase.id);
      return { ok: false, error: "Could not start checkout. Try again." };
    }

    await admin
      .from("ai_token_purchases")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", purchase.id);

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.tokens_purchase_started",
      entityType: "ai_token_purchase",
      entityId: purchase.id,
      metadata: { packKey: pack.key, tokens: pack.tokens },
    });

    return { ok: true, url: session.url };
  } catch {
    await admin.from("ai_token_purchases").update({ status: "FAILED" }).eq("id", purchase.id);
    return { ok: false, error: "Could not start checkout. Try again." };
  }
}

/** Current allowance and recent top-ups, for the billing surface. */
export async function getTokenOverview() {
  const workspace = await requireRole("member");
  const [status, purchases] = await Promise.all([
    getTokenStatus(workspace.businessId),
    listTokenPurchases(workspace.businessId),
  ]);

  revalidatePath("/app/settings");
  return { status, purchases };
}
