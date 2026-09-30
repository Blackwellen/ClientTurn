"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { attributeSignup } from "@/lib/affiliates/attribution";
import { recordTermsAcceptance, requestOrigin } from "@/lib/billing/terms-acceptance";
import { activatePendingInvites } from "./invites";
import { destinationForUser, sanitizeRedirectPath } from "./destination";
import { isRecoverySession } from "./recovery-session";
import { provisionCustomerWorkspace } from "./provision";
import { UNNAMED_WORKSPACE } from "./workspace-name";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import {
  attributionSchema,
  requestPasswordResetSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";
import type { z } from "zod";

export type AuthResult =
  | { ok: true; redirectTo?: string; message?: string }
  | { ok: false; error: string; field?: string };

const GENERIC_ERROR =
  "Something went wrong. Please try again, or contact support if it keeps happening.";

function firstIssue(error: z.ZodError): AuthResult {
  const issue = error.issues[0];
  return {
    ok: false,
    error: issue?.message ?? "Check the details you entered.",
    field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
  };
}

async function originUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

async function limited(
  key: "auth:signin" | "auth:signup" | "auth:reset",
): Promise<AuthResult | null> {
  const h = await headers();
  const result = await checkRateLimit(key, clientIdentifier(h));
  if (result.allowed) return null;
  return {
    ok: false,
    error: "Too many attempts. Please wait a few minutes and try again.",
  };
}

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function recordAttribution(form: FormData, userId: string) {
  const parsed = attributionSchema.safeParse({
    anonymousId: str(form, "anonymousId") || undefined,
    utmSource: str(form, "utmSource") || undefined,
    utmMedium: str(form, "utmMedium") || undefined,
    utmCampaign: str(form, "utmCampaign") || undefined,
    utmContent: str(form, "utmContent") || undefined,
    utmTerm: str(form, "utmTerm") || undefined,
    referrer: str(form, "referrer") || undefined,
    landingPath: str(form, "landingPath") || undefined,
  });

  if (!parsed.success || !parsed.data.anonymousId) return;
  const a = parsed.data;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("marketing_sessions")
    .select("id")
    .eq("anonymous_id", a.anonymousId!)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    utm_source: a.utmSource ?? null,
    utm_medium: a.utmMedium ?? null,
    utm_campaign: a.utmCampaign ?? null,
    utm_content: a.utmContent ?? null,
    utm_term: a.utmTerm ?? null,
    referrer: a.referrer ?? null,
    landing_path: a.landingPath ?? null,
    converted_user_id: userId,
    converted_at: new Date().toISOString(),
  };

  if (existing) {
    await admin
      .from("marketing_sessions")
      .update(payload)
      .eq("id", existing.id);
  } else {
    await admin
      .from("marketing_sessions")
      .insert({ anonymous_id: a.anonymousId!, ...payload });
  }
}

export async function signUp(
  _prev: AuthResult | null,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse({
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    email: str(formData, "email"),
    password: str(formData, "password"),
    terms: str(formData, "terms") || undefined,
  });

  if (!parsed.success) return firstIssue(parsed.error);
  const input = parsed.data;

  const throttled = await limited("auth:signup");
  if (throttled) return throttled;

  // The plan picked on /pricing rides along to the trial checkout, where it is
  // pre-selected (8.29). An allow-list, not a pass-through: it lands in a URL.
  const pickedPlan = str(formData, "plan");
  const trialPath = ["starter", "growth", "pro"].includes(pickedPlan)
    ? `/start-trial?plan=${pickedPlan}`
    : "/start-trial";

  const supabase = await createClient();
  const origin = await originUrl();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(trialPath)}`,
      data: {
        first_name: input.firstName,
        last_name: input.lastName,
      },
    },
  });

  if (signUpError || !signUpData.user) {
    if (signUpError?.message?.toLowerCase().includes("rate")) {
      return { ok: false, error: "Too many attempts. Try again in a minute." };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  const userId = signUpData.user.id;
  const admin = createAdminClient();

  // Supabase returns an obfuscated user for an already-registered email rather
  // than an error. Detecting it here would leak enumeration, so we treat it as
  // a normal signup and let the (unsent) confirmation email be the only signal.
  const alreadyRegistered =
    Array.isArray(signUpData.user.identities) &&
    signUpData.user.identities.length === 0;

  if (alreadyRegistered) {
    return { ok: true, redirectTo: `/verify-email?email=${encodeURIComponent(input.email)}` };
  }

  let businessId: string;
  try {
    ({ businessId } = await provisionCustomerWorkspace({
      userId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      // Named by the owner in onboarding's first step (8.29).
      businessName: UNNAMED_WORKSPACE,
    }));
  } catch {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    // The terms box was required above but never recorded; it is now. Not
    // fatal to signup: the acceptance that authorises a charge is taken again
    // at Checkout and recorded there, keyed on the session.
    const requester = requestOrigin(await headers());
    await recordTermsAcceptance({
      businessId,
      userId,
      source: "signup",
      ip: requester.ip,
      userAgent: requester.userAgent,
    });
  } catch (error) {
    console.error("[signup] terms acceptance not recorded", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await recordAttribution(formData, userId);
  } catch {
    // Attribution must never block account creation.
  }

  try {
    // Credits the workspace to whichever partner's link was clicked last, if
    // any. Runs after the workspace exists so an affiliate is never shown a
    // referral for an account that failed to provision, and swallows its own
    // errors for the same reason as the marketing attribution above.
    // The referral carried in the URL (`ct_ref`) covers a visitor who did not
    // accept cookies; the consented cookie is read inside.
    await attributeSignup({ userId, businessId, referralToken: str(formData, "ct_ref") || null });
  } catch {
    // Referral credit must never block account creation either.
  }

  revalidatePath("/", "layout");

  if (!signUpData.session) {
    return {
      ok: true,
      redirectTo: `/verify-email?email=${encodeURIComponent(input.email)}`,
    };
  }

  // Card and terms first (8.10); onboarding follows once Stripe confirms.
  return { ok: true, redirectTo: trialPath };
}

export async function signIn(
  _prev: AuthResult | null,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = signInSchema.safeParse({
    email: str(formData, "email"),
    password: str(formData, "password"),
  });

  if (!parsed.success) return firstIssue(parsed.error);

  const throttled = await limited("auth:signin");
  if (throttled) return throttled;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("email not confirmed")) {
      return {
        ok: false,
        error:
          "Confirm your email address before signing in. Check your inbox for the link.",
      };
    }
    return { ok: false, error: "That email and password do not match." };
  }

  // An invitee whose membership is still pending has no workspace until this
  // runs, so it must happen before the destination is resolved.
  await activatePendingInvites(
    data.user.id,
    data.user.email,
    Boolean(data.user.email_confirmed_at),
  );

  revalidatePath("/", "layout");

  const requested = sanitizeRedirectPath(formData.get("redirect"));
  const destination = requested ?? (await destinationForUser(data.user.id));

  // An account with an authenticator is only half signed in (AAL1) until the
  // code is entered. requireWorkspace() would send them to /mfa anyway; going
  // there directly saves a hop and keeps the destination.
  if ((data.user.factors ?? []).some((factor) => factor.status === "verified")) {
    return { ok: true, redirectTo: `/mfa?next=${encodeURIComponent(destination)}` };
  }

  return { ok: true, redirectTo: destination };
}

/**
 * The sign-in surfaces a sign-out is allowed to land on.
 *
 * The product has three separate front doors -- `/login` for customers,
 * `/admin/login` for platform operators, `/affiliates/login` for partners -- and
 * signing out has to return you to the one you came in through. Landing a
 * partner on the customer login tells them to go somewhere they have no account
 * for.
 *
 * An allow-list rather than a same-origin check: this value decides where a
 * just-signed-out person is sent, so it is never a free-form path.
 */
const SIGN_OUT_DESTINATIONS = [
  "/login",
  "/admin/login",
  "/affiliates/login",
] as const;

export type SignOutDestination = (typeof SIGN_OUT_DESTINATIONS)[number];

export async function signOut(destination?: SignOutDestination): Promise<AuthResult> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");

  // Fails closed to the customer login if anything unrecognised arrives.
  redirect(
    destination && SIGN_OUT_DESTINATIONS.includes(destination)
      ? destination
      : "/login",
  );
}

export async function requestPasswordReset(
  _prev: AuthResult | null,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = requestPasswordResetSchema.safeParse({
    email: str(formData, "email"),
  });

  if (!parsed.success) return firstIssue(parsed.error);

  const throttled = await limited("auth:reset");

  if (throttled) return throttled;


  const supabase = await createClient();
  const origin = await originUrl();

  // The result is deliberately ignored: the response must be identical whether
  // or not the address is registered.
  await supabase.auth
    .resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    })
    .catch(() => undefined);

  return {
    ok: true,
    message:
      "If an account exists for that address, a reset link is on its way.",
  };
}

export async function updatePassword(
  _prev: AuthResult | null,
  formData: FormData,
): Promise<AuthResult> {
  const parsed = updatePasswordSchema.safeParse({
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
  });

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // getUser() verified the token with Supabase; its claims say how the
  // session was created. Only the emailed reset link's own session may set a
  // password here: any other signed-in session changes it in Settings, which
  // asks for the current password (recovery-session.ts).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!user || !isRecoverySession(session?.access_token)) {
    return {
      ok: false,
      error:
        "This reset link has expired. Request a new one and try again.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("different from the old")) {
      return {
        ok: false,
        error: "Choose a password you have not used before.",
        field: "password",
      };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  await supabase.auth.signOut();
  revalidatePath("/", "layout");

  return { ok: true, redirectTo: "/login?reset=1" };
}
