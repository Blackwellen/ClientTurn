"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activatePendingInvites } from "./invites";
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

/** Only same-origin relative paths survive, so `?redirect=` cannot be a phishing hop. */
function safeRedirect(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/login") || value.startsWith("/signup")) return null;
  return value;
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

async function destinationForUser(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_members")
    .select("businesses(status)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const status = data?.businesses?.status;
  return status === "active" ? "/app" : "/onboarding";
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
    businessName: str(formData, "businessName"),
    email: str(formData, "email"),
    password: str(formData, "password"),
    terms: str(formData, "terms") || undefined,
  });

  if (!parsed.success) return firstIssue(parsed.error);
  const input = parsed.data;

  const throttled = await limited("auth:signup");
  if (throttled) return throttled;

  const supabase = await createClient();
  const origin = await originUrl();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      data: {
        first_name: input.firstName,
        last_name: input.lastName,
        business_name: input.businessName,
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

  let businessId: string | null = null;

  try {
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
      },
      { onConflict: "id" },
    );
    if (profileError) throw profileError;

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .insert({
        name: input.businessName,
        status: "onboarding",
        onboarding_step: "business",
        created_by: userId,
      })
      .select("id")
      .single();
    if (businessError || !business) throw businessError ?? new Error("business");
    businessId = business.id;

    const { error: memberError } = await admin.from("business_members").insert({
      business_id: businessId,
      user_id: userId,
      role: "owner",
      status: "active",
      accepted_at: new Date().toISOString(),
    });
    if (memberError) throw memberError;

    const { error: settingsError } = await admin
      .from("business_settings")
      .insert({ business_id: businessId });
    if (settingsError) throw settingsError;

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const { error: subscriptionError } = await admin
      .from("subscriptions")
      .insert({
        business_id: businessId,
        plan: "trial",
        status: "TRIALING",
        trial_ends_at: trialEndsAt.toISOString(),
        lead_limit: 25,
        user_limit: 1,
        whatsapp_enabled: false,
        campaigns_enabled: false,
        ai_assist_allowed: false,
      });
    if (subscriptionError) throw subscriptionError;
  } catch {
    // Never leave a half-built workspace behind. Cascades clear the child rows.
    if (businessId) {
      await admin.from("businesses").delete().eq("id", businessId);
    }
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    await recordAttribution(formData, userId);
  } catch {
    // Attribution must never block account creation.
  }

  revalidatePath("/", "layout");

  if (!signUpData.session) {
    return {
      ok: true,
      redirectTo: `/verify-email?email=${encodeURIComponent(input.email)}`,
    };
  }

  return { ok: true, redirectTo: "/onboarding" };
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

  const requested = safeRedirect(formData.get("redirect"));
  const destination = requested ?? (await destinationForUser(data.user.id));

  return { ok: true, redirectTo: destination };
}

export async function signOut(): Promise<AuthResult> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
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

  if (!user) {
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
