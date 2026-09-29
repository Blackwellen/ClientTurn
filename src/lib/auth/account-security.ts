import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { activitySigningKey } from "./activity-proxy";
import { getUser } from "./session";
import {
  DEFAULT_WORKSPACE_SECURITY,
  PREV_ACTIVITY_HEADER,
  evaluateWorkspaceAccess,
  readActivity,
  signIdleExpiry,
  aalFromAccessToken,
  type AccessDecision,
  type Aal,
  type MfaState,
  type WorkspaceSecurityPolicy,
} from "./security-policy";

/**
 * Server side of the account security controls (security-policy.ts holds
 * the rules). `requireWorkspace()` calls `enforceWorkspaceSecurity`, so every
 * app page, Server Action and service operation that resolves a workspace is
 * covered; the few API routes that read the workspace directly use
 * `getSecureWorkspace()` in lib/auth/session.ts.
 */

export type VerifiedFactor = {
  id: string;
  friendlyName: string;
  createdAt: string;
  lastChallengedAt: string | null;
};

export type AccountMfa = MfaState & {
  userId: string;
  factors: VerifiedFactor[];
  lastSignInAt: string | null;
};

/**
 * The factor list comes from `auth.getUser()` (verified by Supabase); the
 * assurance level from the same session's access token, which that call has
 * just validated.
 */
export const getAccountMfa = cache(async (): Promise<AccountMfa | null> => {
  // The memoised, Supabase-verified user (one Auth round trip per request).
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();

  const factors: VerifiedFactor[] = (user.factors ?? [])
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name || "Authenticator app",
      createdAt: factor.created_at,
      lastChallengedAt: factor.last_challenged_at ?? null,
    }));

  const { data: sessionData } = await supabase.auth.getSession();
  const currentAal: Aal | null = aalFromAccessToken(sessionData.session?.access_token);

  return {
    userId: user.id,
    verifiedFactorCount: factors.length,
    currentAal,
    factors,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
});

type SettingsRow = {
  require_mfa: boolean | null;
  idle_timeout_minutes: number | null;
  audit_retention_months: number | null;
};

function toPolicy(row: SettingsRow | null): WorkspaceSecurityPolicy {
  if (!row) return { ...DEFAULT_WORKSPACE_SECURITY };
  return {
    requireMfa: Boolean(row.require_mfa),
    idleTimeoutMinutes: row.idle_timeout_minutes ?? null,
    auditRetentionMonths: row.audit_retention_months ?? DEFAULT_WORKSPACE_SECURITY.auditRetentionMonths,
  };
}

/**
 * The workspace's security settings (0180). Before that migration is applied
 * the table does not exist; that is read as "nothing configured" so the app
 * keeps working exactly as before, and `available` says so to Settings.
 */
export const loadWorkspaceSecurity = cache(
  async (businessId: string): Promise<{ policy: WorkspaceSecurityPolicy; available: boolean }> => {
    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("workspace_security_settings")
      .select("require_mfa, idle_timeout_minutes, audit_retention_months")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) {
      if (!isSchemaLag(error)) {
        console.error("[security] workspace security read failed", { businessId, code: error.code });
      }
      return { policy: { ...DEFAULT_WORKSPACE_SECURITY }, available: !isSchemaLag(error) };
    }
    return { policy: toPolicy(data as SettingsRow | null), available: true };
  },
);

export async function getWorkspaceSecurity(businessId: string): Promise<WorkspaceSecurityPolicy> {
  return (await loadWorkspaceSecurity(businessId)).policy;
}

/** Service-role read for jobs and admin surfaces (no session). */
export async function readWorkspaceSecurityAsService(businessId: string): Promise<WorkspaceSecurityPolicy> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("workspace_security_settings")
    .select("require_mfa, idle_timeout_minutes, audit_retention_months")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return { ...DEFAULT_WORKSPACE_SECURITY };
  return toPolicy(data as SettingsRow | null);
}

async function lastActivityMs(mfa: AccountMfa): Promise<number | null> {
  const key = activitySigningKey();
  if (!key) return null; // documented: no key, no idle enforcement
  const raw = (await headers()).get(PREV_ACTIVITY_HEADER);
  const fromCookie = readActivity(raw, mfa.userId, key);
  if (fromCookie !== null) return fromCookie;
  // No (valid) activity cookie: the session is at least as idle as its sign-in.
  const signedIn = mfa.lastSignInAt ? Date.parse(mfa.lastSignInAt) : NaN;
  return Number.isFinite(signedIn) ? signedIn : null;
}

export const evaluateCurrentAccess = cache(
  async (businessId: string): Promise<AccessDecision> => {
    const mfa = await getAccountMfa();
    if (!mfa) return { ok: true }; // requireUser has already handled signed-out
    const policy = await getWorkspaceSecurity(businessId);
    return evaluateWorkspaceAccess({
      mfa,
      policy,
      lastActivityMs: policy.idleTimeoutMinutes ? await lastActivityMs(mfa) : null,
      nowMs: Date.now(),
    });
  },
);

/** Where a refused request is sent. */
export async function securityRedirectFor(decision: AccessDecision): Promise<string | null> {
  if (decision.ok) return null;
  if (decision.reason === "mfa_verify") return "/mfa";
  if (decision.reason === "mfa_setup") return "/mfa?setup=1";
  const mfa = await getAccountMfa();
  const key = activitySigningKey();
  if (!mfa || !key) return "/login?reason=idle";
  const token = signIdleExpiry(mfa.userId, Date.now(), key);
  return `/auth/session-expired?t=${encodeURIComponent(token)}`;
}

/** Called by requireWorkspace(). Redirects when the member may not continue. */
export async function enforceWorkspaceSecurity(businessId: string): Promise<void> {
  const decision = await evaluateCurrentAccess(businessId);
  const target = await securityRedirectFor(decision);
  if (target) redirect(target);
}
