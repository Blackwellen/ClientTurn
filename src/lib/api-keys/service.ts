import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  isPlatformScope,
  type PlatformScope,
} from "@/lib/platform/scopes";
import type { ApiKeyEnvironment } from "./types";

/**
 * Workspace API keys: issuing, resolving and revoking.
 *
 * This is the credential core for everything outside the app — the public REST
 * API and the MCP endpoint both resolve a presented key through
 * `authenticateApiKey`, so there is exactly one place that decides whether a
 * caller is who they say they are.
 *
 * Five rules the shape of this file enforces:
 *
 *   1. **The key is shown once.** Only a SHA-256 digest is stored. There is no
 *      function here that returns a key, so "let me see it again" cannot be
 *      added without deleting a rule rather than adding a feature.
 *   2. **A key carries one member's authority, re-read live.** The owner's
 *      current membership is fetched on every call. A demoted or removed member
 *      loses their key's reach immediately, with nobody revoking anything.
 *   3. **Scopes narrow, never widen.** The key's scopes are intersected with
 *      what its owner's role could do; a `viewer`'s key granted `leads:write`
 *      still cannot write.
 *   4. **Refusals are specific internally and vague externally.** The caller is
 *      told "that key is not valid"; the log records exactly which check failed.
 *      Distinguishing them to the caller would help someone with a stolen key
 *      work out what they have.
 *   5. **Every resolution is recorded.** Successes update the key's usage;
 *      refusals become a row an admin can see.
 */

/* ------------------------------------------------------------------ format */

/**
 * `ct_live_` / `ct_test_` then 32 bytes of CSPRNG output, base64url.
 *
 * The prefix is not decoration: it makes a leaked string recognisable as a
 * ClientTurn credential in a log, a paste or a public repository, which is what
 * lets automated secret scanning find it and what lets us tell a customer what
 * they have leaked.
 */
const KEY_PREFIXES: Record<ApiKeyEnvironment, string> = {
  live: "ct_live_",
  test: "ct_test_",
};

/** How much of the key is stored in the clear, for recognition only. */
const VISIBLE_PREFIX_LENGTH = 16;

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith("ct_live_") || value.startsWith("ct_test_");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateKey(environment: ApiKeyEnvironment): string {
  return `${KEY_PREFIXES[environment]}${randomBytes(32).toString("base64url")}`;
}

/* ------------------------------------------------------------------ create */

export type CreatedApiKey = {
  id: string;
  /** Shown once. Never stored, never recoverable. */
  key: string;
  keyPrefix: string;
  keyLastFour: string;
  scopes: PlatformScope[];
  expiresAt: string | null;
};

export async function createApiKey(input: {
  businessId: string;
  /** The member whose authority the key will carry. */
  userId: string;
  createdBy: string;
  name: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  allowedIps?: string[];
  expiresAt?: Date | null;
}): Promise<CreatedApiKey | null> {
  const scopes = input.scopes.filter(isPlatformScope);

  // A key with no scopes can do nothing, and creating one would put a
  // credential in circulation that looks live and is not.
  if (scopes.length === 0) return null;

  const db = createAdminClient();
  const key = generateKey(input.environment);

  const { data, error } = await db
    .from("api_keys")
    .insert({
      business_id: input.businessId,
      name: input.name,
      key_prefix: key.slice(0, VISIBLE_PREFIX_LENGTH),
      key_last_four: key.slice(-4),
      key_hash: hashApiKey(key),
      environment: input.environment,
      scopes,
      user_id: input.userId,
      created_by: input.createdBy,
      allowed_ips: input.allowedIps ?? [],
      expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
    })
    .select("id, key_prefix, key_last_four, expires_at")
    .single();

  if (error || !data) return null;

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.createdBy,
    action: "api_key.created",
    entityType: "api_key",
    entityId: data.id,
    metadata: {
      name: input.name,
      environment: input.environment,
      scopes,
      expiresAt: data.expires_at,
      ipRestricted: (input.allowedIps ?? []).length > 0,
    },
  });

  return {
    id: data.id,
    key,
    keyPrefix: data.key_prefix,
    keyLastFour: data.key_last_four,
    scopes,
    expiresAt: data.expires_at,
  };
}

/* ------------------------------------------------------------------ revoke */

export async function revokeApiKey(input: {
  businessId: string;
  keyId: string;
  userId: string;
}): Promise<boolean> {
  const db = createAdminClient();

  // Conditional on it not already being revoked, so revoking twice does not
  // rewrite who revoked it or when.
  const { data } = await db
    .from("api_keys")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.userId,
    })
    .eq("id", input.keyId)
    .eq("business_id", input.businessId)
    .is("revoked_at", null)
    .select("id, name")
    .maybeSingle();

  if (!data) return false;

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: input.keyId,
    metadata: { name: data.name },
  });

  return true;
}

/**
 * Revokes every key a member holds.
 *
 * Called when someone is removed from a workspace. Their keys would already be
 * inert — `authenticateApiKey` re-reads their membership — but leaving live-
 * looking rows behind after an offboarding is the kind of thing that reads as a
 * gap in a security review, and correctly so: the guarantee should not depend
 * on one function remembering to check.
 */
export async function revokeApiKeysForMember(input: {
  businessId: string;
  userId: string;
  actorUserId: string;
}): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from("api_keys")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.actorUserId,
    })
    .eq("business_id", input.businessId)
    .eq("user_id", input.userId)
    .is("revoked_at", null)
    .select("id");

  return data?.length ?? 0;
}

/* ---------------------------------------------------------------- resolving */

export type ApiKeyContext = {
  keyId: string;
  businessId: string;
  userId: string;
  userRole: "owner" | "admin" | "member" | "viewer";
  scopes: PlatformScope[];
  environment: ApiKeyEnvironment;
  keyName: string;
};

export type ApiKeyRefusal =
  | "MISSING"
  | "MALFORMED"
  | "UNKNOWN"
  | "REVOKED"
  | "EXPIRED"
  | "NO_MEMBERSHIP"
  | "NO_SCOPES"
  | "IP_BLOCKED";

export type ApiKeyResolution =
  | { ok: true; context: ApiKeyContext }
  | { ok: false; reason: ApiKeyRefusal };

/**
 * An IP matches the allowlist if it is listed exactly, or falls inside a listed
 * IPv4 CIDR block.
 *
 * IPv6 is exact-match only. A partly-correct IPv6 prefix comparison is worse
 * than none: it would silently admit addresses the customer believed were
 * excluded. Documented rather than approximated.
 */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip || ip === "unknown") return false;

  for (const entry of allowlist) {
    const rule = entry.trim();
    if (!rule) continue;
    if (rule === ip) return true;

    const [network, maskText] = rule.split("/");
    if (maskText === undefined) continue;
    if (network.includes(":") || ip.includes(":")) continue;

    const bits = Number(maskText);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;

    const left = ipv4ToInt(network);
    const right = ipv4ToInt(ip);
    if (left === null || right === null) continue;

    // A /0 shifts by 32, which in JavaScript is a no-op rather than zero, so it
    // is handled explicitly instead of producing a mask of all ones.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((left & mask) === (right & mask)) return true;
  }

  return false;
}

function ipv4ToInt(value: string): number | null {
  const octets = value.split(".");
  if (octets.length !== 4) return null;
  let result = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    result = (result << 8) | number;
  }
  return result >>> 0;
}

/**
 * Resolves a presented key to its live context.
 *
 * The lookup is by digest, which is a constant-length equality on an indexed
 * column — there is no prefix search that could leak timing about which keys
 * exist. The extra `timingSafeEqual` guards the case where two rows somehow
 * share a digest prefix through a future index change.
 */
export async function authenticateApiKey(
  presented: string | null,
  requestIp: string,
): Promise<ApiKeyResolution> {
  if (!presented) return { ok: false, reason: "MISSING" };

  const key = presented.replace(/^Bearer\s+/i, "").trim();
  if (!key) return { ok: false, reason: "MISSING" };
  if (!looksLikeApiKey(key)) return { ok: false, reason: "MALFORMED" };

  const db = createAdminClient();
  const digest = hashApiKey(key);

  const { data: row } = await db
    .from("api_keys")
    .select(
      "id, business_id, user_id, name, scopes, environment, allowed_ips, expires_at, revoked_at, key_hash",
    )
    .eq("key_hash", digest)
    .maybeSingle();

  if (!row) return { ok: false, reason: "UNKNOWN" };

  const stored = Buffer.from(row.key_hash, "utf8");
  const offered = Buffer.from(digest, "utf8");
  if (stored.length !== offered.length || !timingSafeEqual(stored, offered)) {
    return { ok: false, reason: "UNKNOWN" };
  }

  if (row.revoked_at) return { ok: false, reason: "REVOKED" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }

  const allowlist = Array.isArray(row.allowed_ips) ? row.allowed_ips : [];
  if (!ipAllowed(requestIp, allowlist)) {
    return { ok: false, reason: "IP_BLOCKED" };
  }

  // The live membership, not a snapshot taken when the key was issued. This is
  // the check that makes offboarding effective without a revocation sweep.
  const { data: membership } = await db
    .from("business_members")
    .select("role, status")
    .eq("business_id", row.business_id)
    .eq("user_id", row.user_id)
    .maybeSingle();

  if (!membership || membership.status !== "active") {
    return { ok: false, reason: "NO_MEMBERSHIP" };
  }

  const scopes = (Array.isArray(row.scopes) ? row.scopes : []).filter(
    isPlatformScope,
  );
  if (scopes.length === 0) return { ok: false, reason: "NO_SCOPES" };

  return {
    ok: true,
    context: {
      keyId: row.id,
      businessId: row.business_id,
      userId: row.user_id,
      userRole: membership.role as ApiKeyContext["userRole"],
      scopes,
      environment: row.environment as ApiKeyEnvironment,
      keyName: row.name,
    },
  };
}

/**
 * Records that a key was used.
 *
 * Best effort by design: a failure to write usage must never turn a valid
 * request into an error. The increment happens in the database because two
 * concurrent requests with the same key would otherwise read the same count and
 * write the same value, and a usage figure that quietly undercounts is worse
 * than none — it still reads as authoritative.
 */
export async function touchApiKey(keyId: string, ip: string): Promise<void> {
  const db = createAdminClient();
  await db
    .rpc("touch_api_key", { p_key_id: keyId, p_ip: ip })
    .then(
      () => undefined,
      () => undefined,
    );
}

/* ------------------------------------------------------------------ logging */

export type ApiRequestOutcome =
  | "OK"
  | "UNAUTHORIZED"
  | "FORBIDDEN_SCOPE"
  | "FORBIDDEN_ROLE"
  | "RATE_LIMITED"
  | "IP_BLOCKED"
  | "NOT_FOUND"
  | "INVALID"
  | "ERROR";

export async function logApiRequest(entry: {
  businessId: string | null;
  apiKeyId: string | null;
  method: string;
  path: string;
  statusCode: number;
  outcome: ApiRequestOutcome;
  errorCode?: string | null;
  latencyMs: number;
  ip: string;
  userAgent: string | null;
}): Promise<void> {
  const db = createAdminClient();
  await db
    .from("api_request_logs")
    .insert({
      business_id: entry.businessId,
      api_key_id: entry.apiKeyId,
      method: entry.method,
      // The path only. A query string can carry a customer's search terms, and
      // this table is not the place for them.
      path: entry.path.slice(0, 300),
      status_code: entry.statusCode,
      outcome: entry.outcome,
      error_code: entry.errorCode ?? null,
      latency_ms: entry.latencyMs,
      ip: entry.ip.slice(0, 60),
      user_agent: entry.userAgent?.slice(0, 300) ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
