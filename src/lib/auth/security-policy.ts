/**
 * Account security rules (enterprise security controls, 2026-09-29): two-factor
 * authentication, idle session timeout and audit-log retention.
 *
 * Pure. No `server-only`, no Supabase import, no `next/*` import: the proxy,
 * Server Components, Server Actions, the retention job and the tests all read
 * the same rules from here, so the decision cannot differ between the place
 * that enforces it and the place that tests it.
 *
 * Where each rule is enforced:
 *   - `evaluateWorkspaceAccess`  lib/auth/account-security.ts (requireWorkspace)
 *   - `evaluateAdminAccess`      lib/admin/guard.ts (requirePlatformAdmin)
 *   - activity cookie            lib/auth/activity-proxy.ts (proxy.ts)
 *   - audit retention            lib/jobs/handlers/audit-retention.ts
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/* ------------------------------------------------------------ two-factor --- */

/** Supabase authenticator assurance levels. aal2 = password plus a second factor. */
export type Aal = "aal1" | "aal2";

/** Narrows Supabase's open-ended level string to the two levels we act on. */
export function toAal(level: unknown): Aal | null {
  return level === "aal1" || level === "aal2" ? level : null;
}

/**
 * The `aal` claim of a Supabase access token. Only ever called on the token
 * of a session that `auth.getUser()` has just verified with Supabase in the
 * same request, so the claim is authentic; this only reads it. (Supabase's
 * own getAuthenticatorAssuranceLevel reads `session.user`, which logs an
 * insecure-use warning on every server request.)
 */
export function aalFromAccessToken(token: string | null | undefined): Aal | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aal?: unknown };
    return toAal(claims.aal);
  } catch {
    return null;
  }
}

export type MfaState = {
  /** Verified factors on the account (TOTP; Supabase counts only verified ones for AAL). */
  verifiedFactorCount: number;
  /** The level of the current session, read from the verified access token. */
  currentAal: Aal | null;
};

export type WorkspaceSecurityPolicy = {
  /** Owner setting: every member must have two-factor set up. */
  requireMfa: boolean;
  /** Owner setting: sign a member out after this many idle minutes. Null = off. */
  idleTimeoutMinutes: number | null;
  /** Owner setting, capped by plan. */
  auditRetentionMonths: number;
};

export const DEFAULT_WORKSPACE_SECURITY: WorkspaceSecurityPolicy = {
  requireMfa: false,
  idleTimeoutMinutes: null,
  auditRetentionMonths: 12,
};

export type AccessDecision =
  | { ok: true }
  | { ok: false; reason: "mfa_setup" | "mfa_verify" | "idle_timeout" };

/**
 * Whether a signed-in workspace member may use the app right now.
 *
 * Order matters:
 *  1. Anyone who has set up two-factor must have used it for this session,
 *     whether or not their workspace requires it. A factor that is enrolled
 *     but never asked for protects nothing.
 *  2. A workspace that requires two-factor sends a member without a factor
 *     to set one up.
 *  3. The idle timeout, when the owner has set one.
 */
export function evaluateWorkspaceAccess(input: {
  mfa: MfaState;
  policy: Pick<WorkspaceSecurityPolicy, "requireMfa" | "idleTimeoutMinutes">;
  /** Last request time from the signed activity cookie, or null if unknown. */
  lastActivityMs: number | null;
  nowMs: number;
}): AccessDecision {
  const { mfa, policy } = input;
  if (mfa.verifiedFactorCount > 0 && mfa.currentAal !== "aal2") {
    return { ok: false, reason: "mfa_verify" };
  }
  if (policy.requireMfa && mfa.verifiedFactorCount === 0) {
    return { ok: false, reason: "mfa_setup" };
  }
  if (isIdleExpired(policy.idleTimeoutMinutes, input.lastActivityMs, input.nowMs)) {
    return { ok: false, reason: "idle_timeout" };
  }
  return { ok: true };
}

/**
 * Platform administrators: two-factor is mandatory (CLAUDE.md resolved
 * conflict 4, internal review IR-06). No factor = set one up before /admin
 * opens; a factor not used this session = verify it.
 */
export function evaluateAdminAccess(mfa: MfaState): "ok" | "mfa_setup" | "mfa_verify" {
  if (mfa.verifiedFactorCount === 0) return "mfa_setup";
  if (mfa.currentAal !== "aal2") return "mfa_verify";
  return "ok";
}

/**
 * Whether a factor may be removed. A platform admin's last factor never can
 * be (that would reopen /admin to password-only, or lock the admin out on the
 * next sign-in); neither can a member's last factor in a workspace that
 * requires two-factor. Recovery for a lost device is an operator task, see
 * docs/security/MFA_AND_SESSIONS.md.
 */
export function canRemoveFactor(input: {
  verifiedFactorCount: number;
  isPlatformAdmin: boolean;
  workspaceRequiresMfa: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (input.verifiedFactorCount > 1) return { ok: true };
  if (input.isPlatformAdmin) {
    return {
      ok: false,
      error:
        "Platform administrators must keep two-factor on. Add another authenticator first, then remove this one.",
    };
  }
  if (input.workspaceRequiresMfa) {
    return {
      ok: false,
      error:
        "Your workspace requires two-factor. Add another authenticator first, then remove this one.",
    };
  }
  return { ok: true };
}

/** A six-digit authenticator code, spaces tolerated. */
export function parseTotpCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Supabase returns the enrolment QR code as an SVG. Recent versions already
 * prefix it as a data URL; older ones return raw markup. Only an SVG data URL
 * is ever rendered, and only as an <img> source (never as HTML).
 */
export function qrCodeDataUrl(qr: string): string | null {
  if (qr.startsWith("data:image/svg+xml")) return qr;
  if (qr.trimStart().startsWith("<svg")) {
    return `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
  }
  return null;
}

/* ------------------------------------------------------------- idle timeout --- */

/** Minutes an owner may choose. Null (off) is always allowed. */
export const IDLE_TIMEOUT_OPTIONS = [15, 30, 60, 120, 240, 480, 720] as const;

export function parseIdleTimeout(value: unknown): number | null | undefined {
  if (value === null || value === "" || value === "off" || value === undefined) return null;
  const minutes = typeof value === "number" ? value : Number(value);
  return (IDLE_TIMEOUT_OPTIONS as readonly number[]).includes(minutes) ? minutes : undefined;
}

export function isIdleExpired(
  idleTimeoutMinutes: number | null,
  lastActivityMs: number | null,
  nowMs: number,
): boolean {
  if (!idleTimeoutMinutes || lastActivityMs === null) return false;
  return nowMs - lastActivityMs > idleTimeoutMinutes * 60_000;
}

/** httpOnly cookie holding the signed time of the member's last request. */
export const ACTIVITY_COOKIE = "ct_activity";
/**
 * Request header the proxy sets to the cookie value it received, before it
 * refreshes the cookie. Always overwritten or removed by the proxy, so a
 * client cannot supply it.
 */
export const PREV_ACTIVITY_HEADER = "x-ct-prev-activity";
/** The activity cookie outlives any idle window an owner can choose. */
export const ACTIVITY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
/** How long the signed "you have been idle" hand-off to the sign-out route lives. */
export const IDLE_EXPIRY_TOKEN_TTL_MS = 2 * 60 * 1000;

function hmac(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `<userId>.<ms>.<sig>`: bound to the user, so another account's cookie is worthless. */
export function signActivity(userId: string, atMs: number, key: string): string {
  const payload = `${userId}.${Math.floor(atMs)}`;
  return `${payload}.${hmac(key, `ct-activity:${payload}`)}`;
}

export function readActivity(raw: string | null | undefined, userId: string, key: string): number | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [cookieUser, atRaw, signature] = parts;
  if (cookieUser !== userId) return null;
  if (!safeEqual(signature, hmac(key, `ct-activity:${cookieUser}.${atRaw}`))) return null;
  const at = Number(atRaw);
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** Signed proof, minted by requireWorkspace, that this user's session went idle. */
export function signIdleExpiry(userId: string, atMs: number, key: string): string {
  const at = String(Math.floor(atMs));
  return `${at}.${hmac(key, `ct-idle-expired:${userId}.${at}`)}`;
}

export function verifyIdleExpiry(
  token: string | null | undefined,
  userId: string,
  nowMs: number,
  key: string,
): boolean {
  if (!token) return false;
  const [atRaw, signature, extra] = token.split(".");
  if (!atRaw || !signature || extra !== undefined) return false;
  if (!safeEqual(signature, hmac(key, `ct-idle-expired:${userId}.${atRaw}`))) return false;
  const at = Number(atRaw);
  return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at <= IDLE_EXPIRY_TOKEN_TTL_MS;
}

/** Paths whose requests count as activity (and carry the previous value). */
export function isActivityTrackedPath(pathname: string): boolean {
  if (pathname === "/app" || pathname.startsWith("/app/")) return true;
  if (!pathname.startsWith("/api/")) return false;
  // Machine traffic never counts as a person being active.
  return !(
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/v1") ||
    pathname.startsWith("/api/mcp") ||
    pathname.startsWith("/api/voice") ||
    pathname.startsWith("/api/apps") ||
    pathname.startsWith("/api/marketing")
  );
}

/* --------------------------------------------------------- audit retention --- */

/** The period the Privacy Policy states (IR-09) and the default for every workspace. */
export const AUDIT_RETENTION_DEFAULT_MONTHS = 12;
export const AUDIT_RETENTION_OPTIONS = [6, 12, 24, 36, 60, 84] as const;

/**
 * The longest an owner may keep audit history, by plan. Longer retention is
 * an Enterprise contract term; every other plan keeps the stated 12 months.
 */
export const AUDIT_RETENTION_PLAN_CAP_MONTHS: Record<string, number> = {
  trial: 12,
  starter: 12,
  growth: 12,
  pro: 24,
  enterprise: 84,
};

export function auditRetentionCapMonths(plan: string | null | undefined): number {
  return AUDIT_RETENTION_PLAN_CAP_MONTHS[plan ?? ""] ?? AUDIT_RETENTION_DEFAULT_MONTHS;
}

/** What the retention job applies: the owner's choice, never above the plan cap. */
export function effectiveAuditRetentionMonths(
  configured: number | null | undefined,
  plan: string | null | undefined,
): number {
  const cap = auditRetentionCapMonths(plan);
  const chosen =
    typeof configured === "number" && (AUDIT_RETENTION_OPTIONS as readonly number[]).includes(configured)
      ? configured
      : AUDIT_RETENTION_DEFAULT_MONTHS;
  return Math.min(chosen, cap);
}

export function parseAuditRetention(value: unknown, plan: string | null | undefined): number | undefined {
  const months = typeof value === "number" ? value : Number(value);
  if (!(AUDIT_RETENTION_OPTIONS as readonly number[]).includes(months)) return undefined;
  return months <= auditRetentionCapMonths(plan) ? months : undefined;
}

/** Rows created before this instant are past retention. Calendar months, UTC. */
export function auditRetentionCutoff(months: number, now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/* ----------------------------------------------------------------- display --- */

/** "Chrome on Windows" from a user-agent string. Display only. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "an unknown system";
  return `${browser} on ${os}`;
}
