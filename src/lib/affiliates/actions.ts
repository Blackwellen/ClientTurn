"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import { getAffiliate } from "./queries";
import {
  hasPayoutDetails,
  validateDraft,
  type OnboardingDraft,
} from "./onboarding";
import {
  ALLOWED_DESTINATIONS,
  codeCandidate,
  isAllowedDestination,
  isValidSlug,
  randomSuffix,
} from "./types";

/**
 * Affiliate portal writes (V4 §29-35).
 *
 * Two rules hold across every function here:
 *
 * 1. The affiliate is resolved from the session via `getAffiliate()`, which is
 *    an RLS-scoped read. No function accepts an affiliate id from the caller —
 *    a partner cannot act as another partner by editing a form field.
 * 2. Nothing an affiliate submits decides money. Status, commission plan,
 *    commission amounts and payouts are all platform-controlled and none of
 *    them is writable from this file.
 */

export type AffiliateActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/* ----------------------------------------------------------------- apply -- */

/**
 * Submits a completed onboarding draft as an application.
 *
 * The whole draft is re-validated here with the same pure rules the wizard
 * used, because the wizard runs in a browser: a resumed draft or a hand-edited
 * request must not be able to create a partner with an empty audience field,
 * which is the one field a reviewer actually reads.
 *
 * Like `applyToProgramme`, this always lands as APPLIED and never sets the
 * commission plan from the payload — an applicant does not choose their rate.
 */
export async function completeOnboarding(
  draft: OnboardingDraft,
): Promise<AffiliateActionResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "Sign in again to finish your application." };
  }

  const problems = validateDraft(draft);
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const limit = await checkRateLimit(
    "affiliate:apply",
    clientIdentifier(await headers()),
  );
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const db = createAdminClient();

  const { data: existing } = await db
    .from("affiliates")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error:
        existing.status === "REJECTED"
          ? "This account has already been reviewed. Contact us if something has changed."
          : "You already have a partner account.",
    };
  }

  const code = await allocateCode(draft.displayName);
  if (!code) {
    return { ok: false, error: "We could not create your referral code. Try again." };
  }

  const { data: plan } = await db
    .from("affiliate_commission_plans")
    .select("id")
    .eq("is_default", true)
    .eq("active", true)
    .maybeSingle();

  const { data: created, error } = await db
    .from("affiliates")
    .insert({
      user_id: user.id,
      code,
      display_name: draft.displayName.trim(),
      company_name: draft.companyName.trim() || null,
      website_url: draft.websiteUrl.trim() || null,
      contact_email: draft.contactEmail.trim().toLowerCase(),
      country: draft.country.trim() || null,
      // The audience size is kept with the description rather than in its own
      // column: it is context for a human reviewer, not something we query on.
      audience_description: draft.audienceSize.trim()
        ? `${draft.audienceDescription.trim()}

Audience size: ${draft.audienceSize.trim()}`
        : draft.audienceDescription.trim(),
      promotion_methods: draft.promotionMethods,
      status: "APPLIED",
      commission_plan_id: plan?.id ?? null,
      payment_profile_json: hasPayoutDetails(draft)
        ? {
            method: draft.payoutMethod,
            account_name: draft.payoutAccountName.trim(),
            reference: draft.payoutReference.trim(),
            updated_at: new Date().toISOString(),
          }
        : {},
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    return { ok: false, error: "Your application could not be saved. Try again." };
  }

  await recordAudit({
    businessId: null,
    actorUserId: user.id,
    actorType: "user",
    action: "affiliate.applied",
    entityType: "affiliate",
    entityId: created.id,
  });

  revalidatePath("/affiliates", "layout");
  return { ok: true, message: "Application received." };
}

/**
 * Finds a free referral code.
 *
 * The unique index on `affiliates.code` is the real guarantee; this only avoids
 * handing the user an error for a collision it can resolve itself.
 */
async function allocateCode(displayName: string): Promise<string | null> {
  const db = createAdminClient();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate =
      attempt === 0
        ? codeCandidate(displayName)
        : codeCandidate(displayName, randomSuffix());

    const { data } = await db
      .from("affiliates")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();

    if (!data) return candidate;
  }

  return null;
}

/* ----------------------------------------------------------------- links -- */

const linkSchema = z.object({
  label: z.string().trim().min(2).max(60),
  slug: z.string().trim().toLowerCase().max(40).optional(),
  destinationPath: z.string().trim().max(60),
  campaignId: z.string().uuid().optional(),
  utmSource: z.string().trim().max(60).optional(),
  utmMedium: z.string().trim().max(60).optional(),
  utmCampaign: z.string().trim().max(60).optional(),
});

export async function createLink(input: unknown): Promise<AffiliateActionResult> {
  const affiliate = await requireActiveAffiliate();
  if ("error" in affiliate) return affiliate;

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Give the link a name and choose where it lands." };
  }

  if (!isAllowedDestination(parsed.data.destinationPath)) {
    // Not a validation nicety: an affiliate-chosen destination that is not on
    // the fixed list would turn a link carrying our brand into an open redirect.
    return {
      ok: false,
      error: `Choose one of: ${ALLOWED_DESTINATIONS.map((entry) => entry.label).join(", ")}.`,
    };
  }

  const db = createAdminClient();

  const slug = parsed.data.slug
    ? parsed.data.slug
    : `${affiliate.code}-${randomSuffix(5)}`;

  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: "Use 3-40 lowercase letters, numbers or hyphens for the link address.",
    };
  }

  const { data: taken } = await db
    .from("affiliate_links")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (taken) {
    return { ok: false, error: "That link address is already in use. Pick another." };
  }

  // A campaign id from the form is only trusted after it is proved to belong
  // to this affiliate. Otherwise a partner could file links under someone
  // else's campaign and read its name back out.
  let campaignId: string | null = null;
  if (parsed.data.campaignId) {
    const { data: campaign } = await db
      .from("affiliate_campaigns")
      .select("id")
      .eq("id", parsed.data.campaignId)
      .eq("affiliate_id", affiliate.id)
      .maybeSingle();
    if (!campaign) return { ok: false, error: "That campaign no longer exists." };
    campaignId = campaign.id;
  }

  const { data: created, error } = await db
    .from("affiliate_links")
    .insert({
      affiliate_id: affiliate.id,
      campaign_id: campaignId,
      label: parsed.data.label,
      slug,
      destination_path: parsed.data.destinationPath,
      utm_source: parsed.data.utmSource || "affiliate",
      utm_medium: parsed.data.utmMedium || "referral",
      utm_campaign: parsed.data.utmCampaign || null,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    return { ok: false, error: "The link could not be created. Try again." };
  }

  await recordAudit({
    businessId: null,
    actorUserId: affiliate.userId,
    actorType: "user",
    action: "affiliate.link_created",
    entityType: "affiliate_link",
    entityId: created.id,
  });

  revalidatePath("/affiliates/app/links");
  return { ok: true, message: "Link created." };
}

export async function setLinkArchived(input: {
  linkId: string;
  archived: boolean;
}): Promise<AffiliateActionResult> {
  const affiliate = await requireActiveAffiliate();
  if ("error" in affiliate) return affiliate;

  const parsed = z
    .object({ linkId: z.string().uuid(), archived: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That link is not valid." };

  // Scoped by affiliate_id as well as id: the id alone came from the browser.
  const { error } = await createAdminClient()
    .from("affiliate_links")
    .update({ archived: parsed.data.archived })
    .eq("id", parsed.data.linkId)
    .eq("affiliate_id", affiliate.id);

  if (error) return { ok: false, error: "The link could not be updated." };

  revalidatePath("/affiliates/app/links");
  return {
    ok: true,
    message: parsed.data.archived ? "Link archived." : "Link restored.",
  };
}

const campaignSchema = z.object({ name: z.string().trim().min(2).max(60) });

export async function createCampaign(input: unknown): Promise<AffiliateActionResult> {
  const affiliate = await requireActiveAffiliate();
  if ("error" in affiliate) return affiliate;

  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the campaign a name." };

  const { error } = await createAdminClient()
    .from("affiliate_campaigns")
    .insert({ affiliate_id: affiliate.id, name: parsed.data.name });

  if (error) {
    return {
      ok: false,
      error: "You already have a campaign with that name.",
    };
  }

  revalidatePath("/affiliates/app/links");
  return { ok: true, message: "Campaign created." };
}

/* --------------------------------------------------------------- profile -- */

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  contactEmail: z.string().trim().toLowerCase().email().max(160),
  companyName: z.string().trim().max(120).optional(),
  websiteUrl: z.string().trim().max(300).optional(),
  country: z.string().trim().max(60).optional(),
});

export async function updateProfile(input: unknown): Promise<AffiliateActionResult> {
  const affiliate = await requireAffiliate();
  if ("error" in affiliate) return affiliate;

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check your name and email address." };
  }

  // `code` and `status` are absent by construction. The referral code is
  // immutable once issued -- links already in the wild point at it.
  const { error } = await createAdminClient()
    .from("affiliates")
    .update({
      display_name: parsed.data.displayName,
      contact_email: parsed.data.contactEmail,
      company_name: parsed.data.companyName || null,
      website_url: parsed.data.websiteUrl || null,
      country: parsed.data.country || null,
    })
    .eq("id", affiliate.id);

  if (error) return { ok: false, error: "Your details could not be saved." };

  revalidatePath("/affiliates/app/profile");
  return { ok: true, message: "Details saved." };
}

const paymentSchema = z.object({
  method: z.enum(["BANK_TRANSFER", "PAYPAL"]),
  accountName: z.string().trim().min(2).max(120),
  reference: z.string().trim().min(4).max(120),
});

/**
 * Stores where to send payouts.
 *
 * The stored shape is deliberately minimal: a method, a name and one reference
 * string. We do not hold sort codes or full account numbers — the payout run is
 * executed by a person against these details, and the less we store the less
 * there is to leak.
 */
export async function updatePaymentDetails(
  input: unknown,
): Promise<AffiliateActionResult> {
  const affiliate = await requireAffiliate();
  if ("error" in affiliate) return affiliate;

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter the account name and payment reference." };
  }

  const { error } = await createAdminClient()
    .from("affiliates")
    .update({
      payment_profile_json: {
        method: parsed.data.method,
        account_name: parsed.data.accountName,
        reference: parsed.data.reference,
        updated_at: new Date().toISOString(),
      },
    })
    .eq("id", affiliate.id);

  if (error) return { ok: false, error: "Your payment details could not be saved." };

  revalidatePath("/affiliates/app/payouts");
  revalidatePath("/affiliates/app/profile");
  return { ok: true, message: "Payment details saved." };
}

/* ---------------------------------------------------------------- guards -- */

type ResolvedAffiliate = { id: string; code: string; userId: string };

async function requireAffiliate(): Promise<
  ResolvedAffiliate | { ok: false; error: string }
> {
  const user = await getUser();
  const affiliate = await getAffiliate();
  if (!user || !affiliate) {
    return { ok: false, error: "You do not have an affiliate account." };
  }
  return { id: affiliate.id, code: affiliate.code, userId: user.id };
}

/**
 * As above, but also refuses a suspended or still-pending partner.
 *
 * Anything that creates something a stranger could click goes through this
 * rather than `requireAffiliate`: a suspended partner must not be able to put
 * new links into circulation while their account is under review.
 */
async function requireActiveAffiliate(): Promise<
  ResolvedAffiliate | { ok: false; error: string }
> {
  const affiliate = await getAffiliate();
  const user = await getUser();

  if (!user || !affiliate) {
    return { ok: false, error: "You do not have an affiliate account." };
  }
  if (affiliate.status !== "ACTIVE") {
    return {
      ok: false,
      error:
        affiliate.status === "APPLIED"
          ? "Your application is still being reviewed."
          : "Your affiliate account is not active.",
    };
  }
  return { id: affiliate.id, code: affiliate.code, userId: user.id };
}
