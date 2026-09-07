"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import { getAffiliateAccount } from "./portal";
import {
  NOTIFICATION_PREFS,
  RANGE_KEYS,
  resolveNotificationPrefs,
  resolvePreferences,
} from "./programme";
import {
  createDashboardLink,
  createOnboardingLink,
  ensureConnectAccount,
  refreshConnectState,
} from "./stripe-connect";
import { ALLOWED_DESTINATIONS, isAllowedDestination } from "./types";

/**
 * Affiliate settings writes (V4 §36).
 *
 * The rule that shapes every function here: **nothing an affiliate submits
 * decides money.** Their status, tier, commission plan, commission amounts,
 * balances and payout state are all platform-controlled, and none of them is
 * writable from this file. What an affiliate can change is who they are, how
 * to reach them, what they want to be told about, and how their own dashboard
 * defaults are set.
 *
 * The affiliate is resolved from the session on every call. No function takes
 * an affiliate id, so a partner cannot act as another partner by editing a
 * hidden field.
 */

export type SettingsResult =
  | { ok: true; message?: string; redirectUrl?: string }
  | { ok: false; error: string };

async function requireAffiliate() {
  const user = await getUser();
  const affiliate = await getAffiliateAccount();
  if (!user || !affiliate) return null;
  return { user, affiliate };
}

/* --------------------------------------------------------------- account -- */

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  contactEmail: z.string().trim().toLowerCase().email().max(160),
  companyName: z.string().trim().max(120).optional().default(""),
  websiteUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .default("")
    .refine(
      (value) => !value || /^https?:\/\/\S+\.\S+/.test(value),
      "Enter a full web address, starting with https://",
    ),
  country: z.string().trim().max(60).optional().default(""),
  timezone: z.string().trim().max(60).optional().default("Europe/London"),
  phone: z.string().trim().max(32).optional().default(""),
  preferredLanguage: z.string().trim().max(12).optional().default("en-GB"),
});

export async function updateAffiliateProfile(
  input: unknown,
): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check your details and try again.",
    };
  }

  // `code`, `status` and `tier` are absent by construction. The referral code
  // is immutable once issued because links already in circulation point at it.
  const { error } = await createAdminClient()
    .from("affiliates")
    .update({
      display_name: parsed.data.displayName,
      contact_email: parsed.data.contactEmail,
      company_name: parsed.data.companyName || null,
      website_url: parsed.data.websiteUrl || null,
      country: parsed.data.country || null,
      timezone: parsed.data.timezone || "Europe/London",
      phone: parsed.data.phone || null,
      preferred_language: parsed.data.preferredLanguage || "en-GB",
    })
    .eq("id", context.affiliate.id);

  if (error) return { ok: false, error: "Your details could not be saved." };

  await recordAudit({
    businessId: null,
    actorUserId: context.user.id,
    actorType: "user",
    action: "affiliate.profile_changed",
    entityType: "affiliate",
    entityId: context.affiliate.id,
  });

  revalidatePath("/affiliates/app/settings");
  return { ok: true, message: "Profile updated." };
}

/* -------------------------------------------------------- stripe connect -- */

/**
 * Starts or resumes Stripe Connect onboarding.
 *
 * Returns a URL for the caller to navigate to rather than redirecting here:
 * account links are single-use and expire in minutes, so they are minted on
 * click and never rendered into a page that might sit open.
 */
export async function startStripeOnboarding(): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };

  // A suspended partner does not get to set up payouts. Checked here rather
  // than only in the UI, because the UI is not a security boundary.
  if (context.affiliate.status !== "ACTIVE") {
    return {
      ok: false,
      error: "Your account needs to be active before you can set up payouts.",
    };
  }

  const limit = await checkRateLimit(
    "affiliate:connect",
    clientIdentifier(await headers()),
  );
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts. Please try again in a moment." };
  }

  try {
    const { accountId } = await ensureConnectAccount({
      affiliateId: context.affiliate.id,
      email: context.affiliate.contactEmail,
      country: context.affiliate.country,
      businessName: context.affiliate.companyName,
    });

    const origin = await siteOrigin();
    const url = await createOnboardingLink({ accountId, origin });

    revalidatePath("/affiliates/app/settings");
    return { ok: true, redirectUrl: url };
  } catch {
    return {
      ok: false,
      error: "We could not reach Stripe just now. Please try again shortly.",
    };
  }
}

/** A link into the affiliate's own Stripe dashboard. */
export async function openStripeDashboard(): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };
  if (!context.affiliate.hasConnectAccount) {
    return { ok: false, error: "Connect a Stripe account first." };
  }

  try {
    const db = createAdminClient();
    const { data } = await db
      .from("affiliates")
      .select("stripe_connect_account_id")
      .eq("id", context.affiliate.id)
      .maybeSingle();

    if (!data?.stripe_connect_account_id) {
      return { ok: false, error: "Connect a Stripe account first." };
    }

    const url = await createDashboardLink(data.stripe_connect_account_id);
    return { ok: true, redirectUrl: url };
  } catch {
    return { ok: false, error: "Stripe could not be reached. Try again shortly." };
  }
}

/** Pulls current account state from Stripe. Safe to call repeatedly. */
export async function syncStripeState(): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };

  const snapshot = await refreshConnectState(context.affiliate.id);
  revalidatePath("/affiliates/app/settings");
  revalidatePath("/affiliates/app/payouts");

  if (!snapshot) {
    return {
      ok: false,
      error: "We could not refresh your Stripe status. Your saved status is unchanged.",
    };
  }
  return { ok: true, message: "Stripe status refreshed." };
}

/* ------------------------------------------------------------------- tax -- */

const taxSchema = z.object({
  country: z.string().trim().min(2).max(60),
  entityType: z.enum(["INDIVIDUAL", "SOLE_TRADER", "COMPANY", "PARTNERSHIP"]),
  // Accepted, used to derive the last four, and then discarded. It is never
  // written to the database in full.
  identifier: z.string().trim().min(4).max(40),
});

/**
 * Records tax information.
 *
 * Only the country, the entity type and the **last four characters** of the
 * identifier are stored. The full value is used to compute that suffix and is
 * then dropped — it is never persisted, never logged and never returned.
 *
 * Status lands on SUBMITTED, not VERIFIED. An affiliate does not get to mark
 * their own compliance record as checked.
 */
export async function updateTaxInformation(
  input: unknown,
): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };

  const parsed = taxSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter your tax country, entity type and reference." };
  }

  const last4 = parsed.data.identifier
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(-4);

  const { error } = await createAdminClient()
    .from("affiliates")
    .update({
      tax_country: parsed.data.country,
      tax_entity_type: parsed.data.entityType,
      tax_identifier_last4: last4,
      tax_status: "SUBMITTED",
      tax_submitted_at: new Date().toISOString(),
    })
    .eq("id", context.affiliate.id);

  if (error) {
    return { ok: false, error: "Your tax information could not be saved." };
  }

  await recordAudit({
    businessId: null,
    actorUserId: context.user.id,
    actorType: "user",
    action: "affiliate.tax_info_changed",
    entityType: "affiliate",
    entityId: context.affiliate.id,
    // Country and entity type only. The identifier — even the last four — is
    // deliberately not in the audit metadata.
    metadata: { country: parsed.data.country, entityType: parsed.data.entityType },
  });

  revalidatePath("/affiliates/app/settings");
  revalidatePath("/affiliates/app/payouts");
  return { ok: true, message: "Tax information submitted." };
}

/* --------------------------------------------------------- notifications -- */

const notificationSchema = z.record(z.string(), z.boolean());

export async function updateNotificationPreferences(
  input: unknown,
): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };

  const parsed = notificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those preferences are not valid." };

  // Filtered against the known keys, so an extra field in the payload cannot
  // write arbitrary jsonb into the row.
  const allowed = new Set<string>(NOTIFICATION_PREFS.map((pref) => pref.key));
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (allowed.has(key)) next[key] = value;
  }

  const merged = resolveNotificationPrefs({
    ...context.affiliate.notificationPrefs,
    ...next,
  });

  const { error } = await createAdminClient()
    .from("affiliates")
    .update({ notification_prefs: merged })
    .eq("id", context.affiliate.id);

  if (error) return { ok: false, error: "Your preferences could not be saved." };

  await recordAudit({
    businessId: null,
    actorUserId: context.user.id,
    actorType: "user",
    action: "affiliate.notification_prefs_changed",
    entityType: "affiliate",
    entityId: context.affiliate.id,
  });

  revalidatePath("/affiliates/app/settings");
  return { ok: true, message: "Notification preferences saved." };
}

/* ----------------------------------------------------------- preferences -- */

const preferencesSchema = z.object({
  defaultRange: z.enum(RANGE_KEYS),
  defaultDestination: z.string().trim().max(60),
  resourceUpdates: z.boolean(),
});

export async function updateAffiliatePreferences(
  input: unknown,
): Promise<SettingsResult> {
  const context = await requireAffiliate();
  if (!context) return { ok: false, error: "You do not have an affiliate account." };

  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those preferences are not valid." };

  // The default landing page is a referral destination, so it goes through the
  // same allow-list as a link. Otherwise a preference field becomes a second,
  // unguarded way to aim a referral URL somewhere arbitrary.
  if (!isAllowedDestination(parsed.data.defaultDestination)) {
    return {
      ok: false,
      error: `Choose one of: ${ALLOWED_DESTINATIONS.map((entry) => entry.label).join(", ")}.`,
    };
  }

  const merged = resolvePreferences({
    ...context.affiliate.preferences,
    ...parsed.data,
  });

  const { error } = await createAdminClient()
    .from("affiliates")
    .update({ preferences: merged })
    .eq("id", context.affiliate.id);

  if (error) return { ok: false, error: "Your preferences could not be saved." };

  revalidatePath("/affiliates/app/settings");
  return { ok: true, message: "Preferences saved." };
}

/* --------------------------------------------------------------- helpers -- */

async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
