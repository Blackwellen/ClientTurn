import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aalFromAccessToken, evaluateAdminAccess, type Aal, type MfaState } from "@/lib/auth/security-policy";

export const ADMIN_LOGIN_PATH = "/admin/login";
/** Two-factor set-up or verification for operators (outside the ops shell). */
export const ADMIN_MFA_PATH = "/admin/mfa";

export type PlatformOperator = {
  id: string;
  email: string;
  name: string;
  /** For the Overview greeting; null when the profile has no first name. */
  firstName: string | null;
};

export type PlatformOperatorSession = {
  operator: PlatformOperator;
  mfa: MfaState;
};

/**
 * The only authority on platform-admin status is `profiles.platform_role` read
 * server-side with the caller's own session. No cookie flag, header, query
 * parameter or client value is ever consulted.
 *
 * This is the password-only view: it says who the operator is and how far
 * through two-factor their session is. Everything that grants access goes
 * through `getPlatformOperator` / `requirePlatformAdmin`, which also require
 * AAL2 (two-factor is mandatory for platform admins, IR-06).
 */
export const getPlatformOperatorSession = cache(
  async (): Promise<PlatformOperatorSession | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name, platform_role")
      .eq("id", user.id)
      .maybeSingle();

    if (!data || data.platform_role !== "platform_admin") return null;

    const name =
      [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
      data.email ||
      "Operator";

    const { data: sessionData } = await supabase.auth.getSession();
    const currentAal: Aal | null = aalFromAccessToken(sessionData.session?.access_token);
    const verifiedFactorCount = (user.factors ?? []).filter(
      (factor) => factor.status === "verified",
    ).length;

    return {
      operator: {
        id: data.id,
        email: data.email ?? user.email ?? "",
        name,
        firstName: data.first_name?.trim() || null,
      },
      mfa: { verifiedFactorCount, currentAal },
    };
  },
);

/** A platform admin whose session has passed two-factor, or null. */
export const getPlatformOperator = cache(
  async (): Promise<PlatformOperator | null> => {
    const session = await getPlatformOperatorSession();
    if (!session || evaluateAdminAccess(session.mfa) !== "ok") return null;
    return session.operator;
  },
);

/**
 * A signed-in customer who is not a platform admin is treated exactly like a
 * signed-out visitor, so /admin never confirms that it exists. An operator
 * who has not completed two-factor for this session is sent to set it up or
 * verify it; /admin never opens on a password alone.
 */
export async function requirePlatformAdmin(): Promise<PlatformOperator> {
  const session = await getPlatformOperatorSession();
  if (!session) redirect(ADMIN_LOGIN_PATH);
  if (evaluateAdminAccess(session.mfa) !== "ok") redirect(ADMIN_MFA_PATH);
  return session.operator;
}
