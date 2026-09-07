"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import { getAffiliateAccount } from "./portal";
import { markNotificationsRead } from "./notifications";
import { isValidSlug, randomSuffix } from "./types";

/**
 * Promo codes and resource shortlists (V4 §31, §33).
 *
 * The promo-code rule worth stating plainly: **an affiliate never invents a
 * discount.** They pick an approved offer template, and the backend issues a
 * code carrying that template's terms. If affiliates could set
 * `discount_percent` themselves, the field would be a way to mint free
 * subscriptions, so it is not in any schema on this page.
 */

export type LinkActionResult =
  | { ok: true; message?: string; code?: string }
  | { ok: false; error: string };

async function requireActiveAffiliate() {
  const user = await getUser();
  const affiliate = await getAffiliateAccount();
  if (!user || !affiliate) return null;
  if (affiliate.status !== "ACTIVE") return null;
  return { user, affiliate };
}

/* ----------------------------------------------------------- promo codes -- */

const promoSchema = z.object({
  offerId: z.string().uuid(),
  /** Optional vanity suffix. The prefix is always the affiliate's own code. */
  suffix: z
    .string()
    .trim()
    .toUpperCase()
    .max(12)
    .optional()
    .default(""),
});

/**
 * Issues a promo code from an approved offer.
 *
 * The discount comes entirely from the offer row. The only thing the affiliate
 * influences is the visible string, and even that is prefixed with their own
 * referral code so a code cannot be made to impersonate another partner's.
 */
export async function requestPromoCode(input: unknown): Promise<LinkActionResult> {
  const context = await requireActiveAffiliate();
  if (!context) {
    return { ok: false, error: "Your affiliate account is not active." };
  }

  const parsed = promoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose an offer to create a code for." };

  const limit = await checkRateLimit(
    "affiliate:promo",
    clientIdentifier(await headers()),
  );
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts. Please try again shortly." };
  }

  const db = createAdminClient();

  // The offer must exist and be active *now*. An id from a stale page cannot
  // resurrect a withdrawn offer.
  const { data: offer } = await db
    .from("affiliate_promo_offers")
    .select(
      "id, name, description, discount_percent, discount_amount_minor, max_redemptions, valid_until, active",
    )
    .eq("id", parsed.data.offerId)
    .eq("active", true)
    .maybeSingle();

  if (!offer) return { ok: false, error: "That offer is no longer available." };

  const suffix =
    parsed.data.suffix.replace(/[^A-Z0-9]/g, "") || randomSuffix(4).toUpperCase();
  const code = `${context.affiliate.code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10)}${suffix}`;

  const { data: taken } = await db
    .from("affiliate_promo_codes")
    .select("id")
    .eq("code", code)
    .maybeSingle();

  if (taken) {
    return { ok: false, error: "That code already exists. Try a different suffix." };
  }

  const { data: created, error } = await db
    .from("affiliate_promo_codes")
    .insert({
      affiliate_id: context.affiliate.id,
      offer_id: offer.id,
      code,
      description: offer.name,
      // Copied from the offer, never from the request.
      discount_percent: offer.discount_percent,
      discount_amount_minor: offer.discount_amount_minor,
      max_redemptions: offer.max_redemptions,
      expires_at: offer.valid_until,
      status: "ACTIVE",
      created_by: context.user.id,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    return { ok: false, error: "The code could not be created. Try again." };
  }

  await recordAudit({
    businessId: null,
    actorUserId: context.user.id,
    actorType: "user",
    action: "affiliate.promo_code_created",
    entityType: "affiliate_promo_code",
    entityId: created.id,
    metadata: { offer: offer.name, code },
  });

  revalidatePath("/affiliates/app/links");
  return { ok: true, message: "Promo code created.", code };
}

/* -------------------------------------------------------------- link UTM -- */

const utmSchema = z.object({
  linkId: z.string().uuid(),
  utmSource: z.string().trim().max(60).optional().default(""),
  utmMedium: z.string().trim().max(60).optional().default(""),
  utmCampaign: z.string().trim().max(60).optional().default(""),
  utmTerm: z.string().trim().max(60).optional().default(""),
  utmContent: z.string().trim().max(60).optional().default(""),
});

/**
 * Updates a link's UTM parameters.
 *
 * UTM is analytics metadata and nothing else. It never affects which affiliate
 * a click is attributed to — that is decided by the link's own identity — so
 * this is a genuinely low-stakes write. Values are stripped to a conservative
 * character set so nothing here can smuggle a parameter into the redirect.
 */
export async function updateLinkUtm(input: unknown): Promise<LinkActionResult> {
  const context = await requireActiveAffiliate();
  if (!context) return { ok: false, error: "Your affiliate account is not active." };

  const parsed = utmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those UTM values are not valid." };

  const clean = (value: string) =>
    value.replace(/[^A-Za-z0-9._~-]/g, "").slice(0, 60) || null;

  // Scoped by affiliate_id as well as id: the id came from the browser.
  const { error } = await createAdminClient()
    .from("affiliate_links")
    .update({
      utm_source: clean(parsed.data.utmSource),
      utm_medium: clean(parsed.data.utmMedium),
      utm_campaign: clean(parsed.data.utmCampaign),
      utm_term: clean(parsed.data.utmTerm),
      utm_content: clean(parsed.data.utmContent),
    })
    .eq("id", parsed.data.linkId)
    .eq("affiliate_id", context.affiliate.id);

  if (error) return { ok: false, error: "The link could not be updated." };

  revalidatePath("/affiliates/app/links");
  return { ok: true, message: "Tracking parameters saved." };
}

/**
 * Attaches an approved promo code to a link.
 *
 * Both ids are proved to belong to the caller before either is trusted.
 */
export async function attachPromoCode(input: {
  linkId: string;
  promoCodeId: string | null;
}): Promise<LinkActionResult> {
  const context = await requireActiveAffiliate();
  if (!context) return { ok: false, error: "Your affiliate account is not active." };

  const parsed = z
    .object({
      linkId: z.string().uuid(),
      promoCodeId: z.string().uuid().nullable(),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, error: "That selection is not valid." };

  const db = createAdminClient();

  if (parsed.data.promoCodeId) {
    const { data: owned } = await db
      .from("affiliate_promo_codes")
      .select("id")
      .eq("id", parsed.data.promoCodeId)
      .eq("affiliate_id", context.affiliate.id)
      .maybeSingle();

    if (!owned) return { ok: false, error: "That promo code is not yours." };
  }

  const { error } = await db
    .from("affiliate_links")
    .update({ promo_code_id: parsed.data.promoCodeId })
    .eq("id", parsed.data.linkId)
    .eq("affiliate_id", context.affiliate.id);

  if (error) return { ok: false, error: "The link could not be updated." };

  revalidatePath("/affiliates/app/links");
  return { ok: true, message: "Promo code attached." };
}

/* --------------------------------------------------------- resource saves -- */

export async function toggleResourceSave(input: {
  resourceId: string;
  saved: boolean;
}): Promise<LinkActionResult> {
  const context = await requireActiveAffiliate();
  if (!context) return { ok: false, error: "Your affiliate account is not active." };

  const parsed = z
    .object({ resourceId: z.string().uuid(), saved: z.boolean() })
    .safeParse(input);

  if (!parsed.success) return { ok: false, error: "That resource is not valid." };

  const db = createAdminClient();

  if (parsed.data.saved) {
    // Published rows only — an id for a draft asset must not become a save.
    const { data: resource } = await db
      .from("affiliate_resources")
      .select("id")
      .eq("id", parsed.data.resourceId)
      .eq("status", "PUBLISHED")
      .maybeSingle();

    if (!resource) return { ok: false, error: "That resource is not available." };

    await db
      .from("affiliate_resource_saves")
      .upsert(
        { affiliate_id: context.affiliate.id, resource_id: resource.id },
        { onConflict: "affiliate_id,resource_id" },
      );
  } else {
    await db
      .from("affiliate_resource_saves")
      .delete()
      .eq("affiliate_id", context.affiliate.id)
      .eq("resource_id", parsed.data.resourceId);
  }

  revalidatePath("/affiliates/app/resources");
  return { ok: true, message: parsed.data.saved ? "Saved." : "Removed." };
}

/* --------------------------------------------------------- notifications -- */

export async function markAffiliateNotificationsRead(): Promise<LinkActionResult> {
  const user = await getUser();
  const affiliate = await getAffiliateAccount();
  if (!user || !affiliate) {
    return { ok: false, error: "You do not have an affiliate account." };
  }

  await markNotificationsRead(affiliate.id);
  revalidatePath("/affiliates/app");
  return { ok: true };
}

/* --------------------------------------------------------------- exports -- */

/** Re-exported for the links page, which validates a slug before submitting. */
export async function checkSlugAvailable(slug: string): Promise<boolean> {
  if (!isValidSlug(slug)) return false;

  const { data } = await createAdminClient()
    .from("affiliate_links")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  return !data;
}
