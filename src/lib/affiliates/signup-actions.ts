"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";

/**
 * Partner account creation (V4 §29).
 *
 * Separate from customer `signUp` for one structural reason: a partner is not a
 * tenant. Customer signup provisions a business, a settings row, a trial
 * subscription and an owner membership — none of which a partner needs, and all
 * of which would leave an empty workspace behind for every person who only ever
 * wanted a referral link.
 *
 * So this creates exactly two things: the auth user and their profile. The
 * `affiliates` row is written at the end of onboarding, once there is an
 * application worth reviewing.
 *
 * It shares the credential store, the rate limiter and the enumeration
 * behaviour with customer signup, because those are properties of the account
 * system rather than of either door.
 */

export type PartnerSignUpResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string; field?: string };

const GENERIC_ERROR =
  "We could not create your account just now. Please try again.";

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(60),
  lastName: z.string().trim().min(1, "Enter your last name").max(60),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your email address")
    .email("Enter a valid email address")
    .max(160),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(128)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number")
    .regex(/[^A-Za-z0-9]/, "Include a special character"),
  terms: z.literal("on", {
    message: "Accept the terms to continue",
  }),
});

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function originUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export async function signUpPartner(
  _previous: PartnerSignUpResult | null,
  formData: FormData,
): Promise<PartnerSignUpResult> {
  const parsed = schema.safeParse({
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    email: str(formData, "email"),
    password: str(formData, "password"),
    terms: str(formData, "terms") || undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Please check the form and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  const input = parsed.data;

  const limit = await checkRateLimit(
    "auth:signup",
    clientIdentifier(await headers()),
  );
  if (!limit.allowed) {
    return {
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    };
  }

  const supabase = await createClient();
  const origin = await originUrl();

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      // Verification lands in partner onboarding. The callback derives the
      // door from that path, so an expired link returns to the partner
      // sign-in rather than the customer one.
      emailRedirectTo: `${origin}/auth/callback?next=/affiliates/onboarding`,
      data: { first_name: input.firstName, last_name: input.lastName },
    },
  });

  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("rate")) {
      return { ok: false, error: "Too many attempts. Try again in a minute." };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  const verifyPath = `/affiliates/verify-email?email=${encodeURIComponent(input.email)}`;

  // Supabase returns an obfuscated user for an already-registered address
  // rather than an error. Saying so would leak which emails have accounts, so
  // this takes the same path as a real signup and lets the (unsent)
  // confirmation email be the only signal.
  const alreadyRegistered =
    Array.isArray(data.user.identities) && data.user.identities.length === 0;
  if (alreadyRegistered) return { ok: true, redirectTo: verifyPath };

  const admin = createAdminClient();
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: data.user.id,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    // Nothing half-built is left behind: without a profile the account is not
    // usable, and a partner has no workspace rows to unpick.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/", "layout");

  // A confirmed session means email confirmation is switched off, so there is
  // nothing to wait for and onboarding can start immediately.
  return {
    ok: true,
    redirectTo: data.session ? "/affiliates/onboarding" : verifyPath,
  };
}
