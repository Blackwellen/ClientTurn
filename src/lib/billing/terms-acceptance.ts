import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite } from "@/lib/supabase/write-result";
import { TERMS_VERSION } from "@/lib/marketing/terms-version";

/**
 * Stores that the Terms were accepted: which version, when, by whom, and from
 * where when that is known (8.10). Two sources:
 *
 *   signup   -- the terms checkbox, which signup already required but never
 *               recorded
 *   checkout -- Stripe Checkout's `consent_collection.terms_of_service`, the
 *               acceptance that authorises charging the card after the trial
 *
 * A checkout acceptance is keyed on the Checkout session, so the webhook and
 * the return-page sync can both record it without duplicating it; whichever
 * knows the IP (only the return page does) fills it in.
 */

function untyped(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** A plain IPv4/IPv6 literal or null -- never a string Postgres `inet` rejects. */
export function ipOrNull(value: string | null | undefined): string | null {
  const candidate = value?.split(",")[0]?.trim();
  if (!candidate) return null;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(candidate)) return candidate;
  if (/^[0-9a-f:]+$/i.test(candidate) && candidate.includes(":")) return candidate;
  return null;
}

export function requestOrigin(headers: Headers): { ip: string | null; userAgent: string | null } {
  return {
    ip: ipOrNull(headers.get("x-forwarded-for") ?? headers.get("x-real-ip")),
    userAgent: headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}

export async function recordTermsAcceptance(input: {
  businessId: string;
  userId: string | null;
  source: "signup" | "checkout";
  acceptedAt?: Date;
  ip?: string | null;
  userAgent?: string | null;
  stripeCheckoutSessionId?: string | null;
  termsVersion?: string;
}): Promise<void> {
  const admin = untyped();
  const insert = await admin.from("terms_acceptances").insert({
    business_id: input.businessId,
    user_id: input.userId,
    terms_version: input.termsVersion ?? TERMS_VERSION,
    source: input.source,
    accepted_at: (input.acceptedAt ?? new Date()).toISOString(),
    ip_address: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
  });

  if (insert.error?.code === "23505" && input.stripeCheckoutSessionId && input.ip) {
    // Already recorded by the other path; add the origin if it lacked one.
    assertWrite(
      await admin
        .from("terms_acceptances")
        .update({ ip_address: input.ip, user_agent: input.userAgent ?? null })
        .eq("stripe_checkout_session_id", input.stripeCheckoutSessionId)
        .is("ip_address", null),
      "terms acceptance: add origin",
      { businessId: input.businessId },
    );
    return;
  }

  assertWrite(insert, "terms acceptance: record", { businessId: input.businessId, source: input.source }, {
    ignoreCodes: ["23505"],
  });
}
