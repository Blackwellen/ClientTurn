import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { entitlementSnapshot } from "@/lib/billing/lifecycle";

/**
 * Builds a new customer's workspace: profile, business, owner membership,
 * settings and the pre-trial subscription row.
 *
 * One implementation for both ways in — the email signup form and
 * "Continue with Google" — so the two can never provision different shapes of
 * account. Throws on any failure after removing the business it created
 * (cascades clear the child rows) and the profile; deleting the auth user is
 * left to the caller, which knows whether it created that user.
 */
export async function provisionCustomerWorkspace(input: {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  businessName: string;
}): Promise<{ businessId: string }> {
  const admin = createAdminClient();
  let businessId: string | null = null;

  try {
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: input.userId,
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
        // Setup opens with the guided first-Copilot step (Phase 8.3).
        onboarding_step: "copilot",
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (businessError || !business) throw businessError ?? new Error("business");
    businessId = business.id;

    const { error: memberError } = await admin.from("business_members").insert({
      business_id: businessId,
      user_id: input.userId,
      role: "owner",
      status: "active",
      accepted_at: new Date().toISOString(),
    });
    if (memberError) throw memberError;

    const { error: settingsError } = await admin
      .from("business_settings")
      .insert({ business_id: businessId });
    if (settingsError) throw settingsError;

    // No trial yet: the trial starts when Stripe confirms a verified card and
    // the terms were accepted at Checkout (8.10). Until then the workspace is
    // INCOMPLETE and every app route sends the owner to /start-trial. The
    // snapshot is the trial's, from the one TRIAL constant.
    const { error: subscriptionError } = await admin
      .from("subscriptions")
      .insert({
        business_id: businessId,
        plan: "trial",
        status: "INCOMPLETE",
        trial_ends_at: null,
        ...entitlementSnapshot("trial", true),
      });
    if (subscriptionError) throw subscriptionError;

    return { businessId };
  } catch (error) {
    // Never leave a half-built workspace behind.
    if (businessId) {
      await admin.from("businesses").delete().eq("id", businessId);
    }
    await admin.from("profiles").delete().eq("id", input.userId);
    throw error;
  }
}

/** Whether this person already belongs to any workspace (their own, or one they were invited to). */
export async function hasAnyMembership(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_members")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/** Ensures a profile row exists, without overwriting names someone already set. */
export async function ensureProfile(input: {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();
  if (existing) return;

  const { error } = await admin.from("profiles").insert({
    id: input.userId,
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
  });
  if (error) throw error;
}
