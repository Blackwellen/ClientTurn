import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clampCookieDays,
  parseCookie,
  REFERRAL_COOKIE_NAME,
  serialiseCookie,
  visitorHash as hashVisitor,
  type ReferralCookie,
} from "./attribution-core";

export {
  clampCookieDays,
  looksAutomated,
  MAX_COOKIE_DAYS,
  REFERRAL_COOKIE_NAME,
  type ReferralCookie,
} from "./attribution-core";

/**
 * Referral attribution (V4 §31).
 *
 * Last-touch within a window: the most recent affiliate link a visitor clicked
 * before signing up gets the credit, provided that click is still inside the
 * plan's cookie window.
 *
 * Three rules the implementation holds, in order of how much money they save:
 *
 * 1. **One attribution per business, ever.** The partial unique index on
 *    `affiliate_attributions (business_id)` makes a second one impossible at
 *    the storage layer, so a race between two signup paths cannot pay twice.
 * 2. **No self-referral.** An affiliate signing up through their own link earns
 *    nothing. Checked against `affiliates.user_id`, never against anything the
 *    browser sent.
 * 3. **No raw IPs.** A visitor is a salted hash. The salt is a server secret,
 *    so the stored value cannot be reversed into an address.
 *
 * The signing and hashing themselves live in `attribution-core.ts`, which has
 * no `server-only` import and is directly tested.
 */

function cookieSecret(): string {
  const key =
    process.env.AFFILIATE_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing AFFILIATE_COOKIE_SECRET for referral signing");
  return key;
}

export function visitorHash(ip: string, userAgent: string): string {
  return hashVisitor(cookieSecret(), ip, userAgent);
}

export function signReferralCookie(value: ReferralCookie): string {
  return serialiseCookie(cookieSecret(), value);
}

export async function writeReferralCookie(
  value: ReferralCookie,
  windowDays: number,
): Promise<void> {
  const days = clampCookieDays(windowDays);
  const store = await cookies();
  store.set(REFERRAL_COOKIE_NAME, signReferralCookie(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: days * 24 * 60 * 60,
  });
}

export async function readReferralCookie(): Promise<ReferralCookie | null> {
  const store = await cookies();
  return parseCookie(cookieSecret(), store.get(REFERRAL_COOKIE_NAME)?.value);
}

export async function clearReferralCookie(): Promise<void> {
  const store = await cookies();
  store.set(REFERRAL_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

/**
 * Credits a new workspace to the affiliate whose link the signer-up last
 * clicked, if any.
 *
 * Called after the workspace exists and never before: an attribution row
 * pointing at a business that failed to provision would show an affiliate a
 * referral they did not get. Every failure path here is silent by design —
 * attribution must never be able to block account creation.
 */
export async function attributeSignup(input: {
  userId: string;
  businessId: string;
}): Promise<void> {
  const cookie = await readReferralCookie();
  if (!cookie) return;

  const db = createAdminClient();

  const { data: affiliate } = await db
    .from("affiliates")
    .select("id, user_id, status")
    .eq("id", cookie.affiliateId)
    .maybeSingle();

  // A suspended or still-pending partner earns nothing, even from a click that
  // landed while they were active.
  if (!affiliate || affiliate.status !== "ACTIVE") {
    await clearReferralCookie();
    return;
  }

  // Self-referral. Recorded as rejected rather than dropped, so the reason is
  // there if the affiliate asks why a signup they made did not count.
  if (affiliate.user_id === input.userId) {
    await db.from("affiliate_attributions").insert({
      affiliate_id: affiliate.id,
      link_id: cookie.linkId,
      business_id: null,
      user_id: input.userId,
      clicked_at: cookie.clickedAt,
      rejected_reason: "SELF_REFERRAL",
    });
    await clearReferralCookie();
    return;
  }

  const { data: attribution, error } = await db
    .from("affiliate_attributions")
    .insert({
      affiliate_id: affiliate.id,
      link_id: cookie.linkId,
      business_id: input.businessId,
      user_id: input.userId,
      attribution_model: "LAST_TOUCH",
      clicked_at: cookie.clickedAt,
      expires_at: cookie.expiresAt,
    })
    .select("id")
    .maybeSingle();

  // The unique index rejects a second attribution for the same business. That
  // is the intended outcome, not an error worth surfacing.
  if (error || !attribution) {
    await clearReferralCookie();
    return;
  }

  await db.from("affiliate_referrals").insert({
    affiliate_id: affiliate.id,
    business_id: input.businessId,
    attribution_id: attribution.id,
    status: "SIGNED_UP",
    signup_at: new Date().toISOString(),
    attribution_expires_at: cookie.expiresAt,
  });

  if (cookie.linkId) {
    await db.rpc("increment_affiliate_link_signup", { p_link_id: cookie.linkId });
  }

  await clearReferralCookie();
}
