"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getEntitlements } from "@/lib/billing/entitlements";
import { grantStepUp, hasStepUp } from "@/lib/admin/step-up";
import { getActiveWorkspace, requireRole } from "./session";
import { sanitizeRedirectPath } from "./destination";
import { getWorkspaceSecurity } from "./account-security";
import {
  aalFromAccessToken,
  canRemoveFactor,
  parseAuditRetention,
  parseIdleTimeout,
  parseTotpCode,
  qrCodeDataUrl,
} from "./security-policy";

/**
 * Two-factor (Supabase Auth MFA, TOTP) and session controls for the signed-in
 * person, used by /mfa, /admin/mfa, Settings -> Security and the admin
 * security page. Every step runs on the server with the caller's own session;
 * the browser never talks to the factors API directly.
 *
 * Every enrolment, removal and failed code is written to the audit log
 * (platform admins with actorType "platform_admin").
 */

export type MfaResult =
  | { ok: true; redirectTo?: string; message?: string }
  | { ok: false; error: string };

export type EnrolmentResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string };

type Surface = "app" | "admin";

const surfaceSchema = z.enum(["app", "admin"]);
const uuid = z.string().uuid();

const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";
const BAD_CODE =
  "That code did not match. Enter the current 6-digit code from your authenticator app, and check your device's clock is set automatically.";

async function context() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("platform_role")
    .eq("id", user.id)
    .maybeSingle();
  const isPlatformAdmin = profile?.platform_role === "platform_admin";

  // Non-enforcing read: this code runs for people who are mid-way through
  // two-factor, so it must not bounce them back to /mfa.
  const workspace = await getActiveWorkspace();
  const { data: sessionData } = await supabase.auth.getSession();

  const verified = (user.factors ?? []).filter((factor) => factor.status === "verified");
  const unverified = (user.factors ?? []).filter(
    (factor) => factor.status !== "verified" && factor.factor_type === "totp",
  );

  return {
    supabase,
    user,
    isPlatformAdmin,
    businessId: workspace?.businessId ?? null,
    currentAal: aalFromAccessToken(sessionData.session?.access_token),
    verified,
    unverified,
  };
}

type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

function audit(
  ctx: Ctx,
  surface: Surface,
  action:
    | "security.mfa_enrolment_started"
    | "security.mfa_enrolled"
    | "security.mfa_enrolment_failed"
    | "security.mfa_unenrolled"
    | "security.mfa_unenrol_refused"
    | "security.mfa_verified"
    | "security.mfa_challenge_failed"
    | "security.sessions_revoked",
  metadata: Record<string, unknown> = {},
) {
  const asAdmin = surface === "admin" && ctx.isPlatformAdmin;
  return recordAudit({
    businessId: asAdmin ? null : ctx.businessId,
    actorUserId: ctx.user.id,
    actorType: asAdmin ? "platform_admin" : "user",
    action,
    entityType: "user",
    entityId: ctx.user.id,
    metadata: { surface, ...metadata },
  });
}

async function limited(userId: string): Promise<boolean> {
  const result = await checkRateLimit("auth:mfa", userId);
  return !result.allowed;
}

function landing(surface: Surface, next: unknown): string {
  if (surface === "admin") return "/admin";
  return sanitizeRedirectPath(next) ?? "/app";
}

/* ------------------------------------------------------------- enrolment --- */

export async function startTotpEnrolment(surfaceInput: string): Promise<EnrolmentResult> {
  const surface = surfaceSchema.safeParse(surfaceInput);
  if (!surface.success) return { ok: false, error: "Not permitted." };
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (await limited(ctx.user.id)) return { ok: false, error: TOO_MANY };

  // Adding a second authenticator is itself a security change: it needs the
  // session that proved the first one.
  if (ctx.verified.length > 0 && ctx.currentAal !== "aal2") {
    return { ok: false, error: "Verify your existing authenticator first, then add another." };
  }
  if (ctx.verified.length >= 5) {
    return { ok: false, error: "You already have five authenticators. Remove one before adding another." };
  }

  // An abandoned set-up leaves an unverified factor behind; clear it so the
  // new one is the only pending one.
  for (const stale of ctx.unverified) {
    await ctx.supabase.auth.mfa.unenroll({ factorId: stale.id }).catch(() => undefined);
  }

  const label = `Authenticator ${ctx.verified.length + 1} (${new Date().toISOString().slice(0, 10)})`;
  const { data, error } = await ctx.supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: label,
    issuer: "ClientTurn",
  });
  if (error || !data) {
    console.error("[mfa] enroll failed", { code: error?.code, status: error?.status });
    return {
      ok: false,
      error: "Two-factor set-up is not available right now. Try again shortly.",
    };
  }

  const qrCode = qrCodeDataUrl(data.totp.qr_code);
  if (!qrCode) return { ok: false, error: "Two-factor set-up is not available right now." };

  await audit(ctx, surface.data, "security.mfa_enrolment_started", { factor_id: data.id });
  return { ok: true, factorId: data.id, qrCode, secret: data.totp.secret };
}

export async function verifyTotpEnrolment(input: {
  surface: string;
  factorId: string;
  code: string;
  next?: string | null;
}): Promise<MfaResult> {
  const surface = surfaceSchema.safeParse(input.surface);
  const factorId = uuid.safeParse(input.factorId);
  const code = parseTotpCode(input.code);
  if (!surface.success || !factorId.success) return { ok: false, error: "Start the set-up again." };
  if (!code) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };

  const ctx = await context();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (await limited(ctx.user.id)) return { ok: false, error: TOO_MANY };
  if (!ctx.unverified.some((factor) => factor.id === factorId.data)) {
    return { ok: false, error: "That set-up has expired. Start again." };
  }

  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({
    factorId: factorId.data,
    code,
  });
  if (error) {
    await audit(ctx, surface.data, "security.mfa_enrolment_failed", { factor_id: factorId.data });
    return { ok: false, error: BAD_CODE };
  }

  await audit(ctx, surface.data, "security.mfa_enrolled", {
    factor_id: factorId.data,
    factors_after: ctx.verified.length + 1,
  });
  // A platform admin who has just entered their password and a fresh code
  // has completed step-up.
  if (surface.data === "admin" && ctx.isPlatformAdmin) await grantStepUp(ctx.user.id);

  revalidatePath("/", "layout");
  return { ok: true, redirectTo: landing(surface.data, input.next), message: "Two-factor is on." };
}

/* ------------------------------------------------------------ challenge --- */

export async function verifyTotpChallenge(input: {
  surface: string;
  code: string;
  factorId?: string | null;
  next?: string | null;
}): Promise<MfaResult> {
  const surface = surfaceSchema.safeParse(input.surface);
  const code = parseTotpCode(input.code);
  if (!surface.success) return { ok: false, error: "Not permitted." };
  if (!code) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };

  const ctx = await context();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (await limited(ctx.user.id)) return { ok: false, error: TOO_MANY };

  const factor =
    (input.factorId && ctx.verified.find((candidate) => candidate.id === input.factorId)) ||
    ctx.verified[0];
  if (!factor) return { ok: false, error: "Set up two-factor first." };

  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await audit(ctx, surface.data, "security.mfa_challenge_failed", { factor_id: factor.id });
    return { ok: false, error: BAD_CODE };
  }

  await audit(ctx, surface.data, "security.mfa_verified", { factor_id: factor.id });
  if (surface.data === "admin" && ctx.isPlatformAdmin) await grantStepUp(ctx.user.id);

  revalidatePath("/", "layout");
  return { ok: true, redirectTo: landing(surface.data, input.next) };
}

/* -------------------------------------------------------------- removal --- */

export async function removeTotpFactor(input: {
  surface: string;
  factorId: string;
}): Promise<MfaResult> {
  const surface = surfaceSchema.safeParse(input.surface);
  const factorId = uuid.safeParse(input.factorId);
  if (!surface.success || !factorId.success) return { ok: false, error: "Not permitted." };

  const ctx = await context();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!ctx.verified.some((factor) => factor.id === factorId.data)) {
    return { ok: false, error: "That authenticator is not on your account." };
  }
  if (ctx.currentAal !== "aal2") {
    return { ok: false, error: "Verify two-factor for this session first." };
  }
  if (surface.data === "admin" && ctx.isPlatformAdmin && !(await hasStepUp(ctx.user.id))) {
    return { ok: false, error: "Confirm it is you (password and code) before changing two-factor." };
  }

  const workspaceRequiresMfa = ctx.businessId
    ? (await getWorkspaceSecurity(ctx.businessId)).requireMfa
    : false;
  const allowed = canRemoveFactor({
    verifiedFactorCount: ctx.verified.length,
    isPlatformAdmin: ctx.isPlatformAdmin,
    workspaceRequiresMfa,
  });
  if (!allowed.ok) {
    await audit(ctx, surface.data, "security.mfa_unenrol_refused", {
      factor_id: factorId.data,
      reason: ctx.isPlatformAdmin ? "platform_admin_last_factor" : "workspace_requires_mfa",
    });
    return { ok: false, error: allowed.error };
  }

  const { error } = await ctx.supabase.auth.mfa.unenroll({ factorId: factorId.data });
  if (error) {
    console.error("[mfa] unenroll failed", { code: error.code, status: error.status });
    return { ok: false, error: "That authenticator could not be removed. Try again." };
  }

  await audit(ctx, surface.data, "security.mfa_unenrolled", {
    factor_id: factorId.data,
    factors_after: ctx.verified.length - 1,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Authenticator removed." };
}

/* ------------------------------------------------------------- sessions --- */

export async function signOutSessions(input: {
  surface: string;
  scope: string;
}): Promise<MfaResult> {
  const surface = surfaceSchema.safeParse(input.surface);
  const scope = z.enum(["others", "global"]).safeParse(input.scope);
  if (!surface.success || !scope.success) return { ok: false, error: "Not permitted." };

  const ctx = await context();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };

  // Audit first: after a global sign-out the session that would write it is gone.
  await audit(ctx, surface.data, "security.sessions_revoked", { scope: scope.data });

  const { error } = await ctx.supabase.auth.signOut({ scope: scope.data });
  if (error) {
    console.error("[sessions] sign-out failed", { code: error.code, status: error.status });
    return { ok: false, error: "Could not sign those sessions out. Try again." };
  }

  if (scope.data === "global") {
    revalidatePath("/", "layout");
    return {
      ok: true,
      redirectTo:
        surface.data === "admin" ? "/admin/login" : "/login?reason=signed_out_everywhere",
    };
  }
  return { ok: true, message: "Every other session has been signed out." };
}

/* ------------------------------------------------------ workspace policy --- */

export async function saveWorkspaceSecurityPolicy(input: {
  requireMfa: boolean;
  idleTimeoutMinutes: number | null;
  auditRetentionMonths: number;
}): Promise<MfaResult> {
  let workspace;
  try {
    // Owner-only: this decides how every member signs in.
    workspace = await requireRole("owner");
  } catch {
    return { ok: false, error: "Only the workspace owner can change security settings." };
  }

  const entitlements = await getEntitlements(workspace.businessId);
  const idle = parseIdleTimeout(input.idleTimeoutMinutes);
  const retention = parseAuditRetention(input.auditRetentionMonths, entitlements.plan);
  if (idle === undefined) return { ok: false, error: "Choose one of the listed idle timeouts." };
  if (retention === undefined) {
    return { ok: false, error: "That audit retention period is not available on your plan." };
  }

  const ctx = await context();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (input.requireMfa && ctx.verified.length === 0) {
    return {
      ok: false,
      error: "Set up two-factor on your own account first, so requiring it cannot lock you out.",
    };
  }

  const before = await getWorkspaceSecurity(workspace.businessId);
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin.from("workspace_security_settings").upsert(
    {
      business_id: workspace.businessId,
      require_mfa: Boolean(input.requireMfa),
      idle_timeout_minutes: idle,
      audit_retention_months: retention,
      updated_by: workspace.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (error) {
    if (isSchemaLag(error)) {
      return {
        ok: false,
        error: "Workspace security settings are not switched on yet. Ask ClientTurn support to finish the set-up.",
      };
    }
    console.error("[security] policy save failed", { code: error.code });
    return { ok: false, error: "Could not save. Try again." };
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "security.policy_updated",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: {
      before: {
        require_mfa: before.requireMfa,
        idle_timeout_minutes: before.idleTimeoutMinutes,
        audit_retention_months: before.auditRetentionMonths,
      },
      after: {
        require_mfa: Boolean(input.requireMfa),
        idle_timeout_minutes: idle,
        audit_retention_months: retention,
      },
    },
  });

  revalidatePath("/app", "layout");
  return { ok: true, message: "Security settings saved." };
}
