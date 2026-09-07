import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/session";
import { isPlatformScope, type PlatformScope } from "@/lib/platform/scopes";
import type { ApiKeyEnvironment, ApiKeyView } from "./types";

/**
 * What Settings → Developer shows about API keys.
 *
 * Everything is scoped to the caller's workspace and reached through
 * `requireRole("admin")`. Note what is never selected: `key_hash`. The digest is
 * not itself a credential, but returning it invites offline attack on a value
 * the customer believes is private, and no screen needs it. The database
 * withholds the column from browser roles as well, so this is a belt and the
 * grant is the braces.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function listApiKeys(): Promise<ApiKeyView[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data: keys } = await db
    .from("api_keys")
    .select(
      "id, name, key_prefix, key_last_four, environment, scopes, user_id, allowed_ips, expires_at, last_used_at, last_used_ip, request_count, revoked_at, created_at",
    )
    .eq("business_id", workspace.businessId)
    .order("created_at", { ascending: false });

  if (!keys?.length) return [];

  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const ids = keys.map((key) => key.id);
  const ownerIds = [...new Set(keys.map((key) => key.user_id))];

  const [{ data: profiles }, { data: logs }] = await Promise.all([
    db.from("profiles").select("id, first_name, last_name, email").in("id", ownerIds),
    db
      .from("api_request_logs")
      .select("api_key_id, outcome")
      .in("api_key_id", ids)
      .gte("created_at", since),
  ]);

  const names = new Map<string, string>();
  for (const profile of profiles ?? []) {
    const name = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    names.set(profile.id, name || profile.email || "A workspace member");
  }

  const requests = new Map<string, number>();
  const denials = new Map<string, number>();
  for (const log of logs ?? []) {
    if (!log.api_key_id) continue;
    requests.set(log.api_key_id, (requests.get(log.api_key_id) ?? 0) + 1);
    if (log.outcome !== "OK") {
      denials.set(log.api_key_id, (denials.get(log.api_key_id) ?? 0) + 1);
    }
  }

  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.key_prefix,
    keyLastFour: key.key_last_four,
    environment: key.environment as ApiKeyEnvironment,
    scopes: (Array.isArray(key.scopes) ? key.scopes : []).filter(
      isPlatformScope,
    ) as PlatformScope[],
    ownerName: names.get(key.user_id) ?? "A workspace member",
    ownerIsCaller: key.user_id === workspace.userId,
    allowedIps: Array.isArray(key.allowed_ips) ? key.allowed_ips : [],
    expiresAt: key.expires_at,
    lastUsedAt: key.last_used_at,
    lastUsedIp: key.last_used_ip,
    requestCount: Number(key.request_count ?? 0),
    revokedAt: key.revoked_at,
    createdAt: key.created_at,
    recentRequests: requests.get(key.id) ?? 0,
    recentDenials: denials.get(key.id) ?? 0,
  }));
}

export type ApiRequestLogRow = {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  outcome: string;
  keyName: string | null;
  latencyMs: number | null;
  createdAt: string;
};

/**
 * The most recent API calls, for the activity list.
 *
 * Capped at 50 and never paginated further. This is a "does it work, and is
 * anything being refused" panel, not a log explorer — a customer who needs the
 * whole history has the export.
 */
export async function recentApiRequests(): Promise<ApiRequestLogRow[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data } = await db
    .from("api_request_logs")
    .select("id, method, path, status_code, outcome, latency_ms, created_at, api_key_id")
    .eq("business_id", workspace.businessId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!data?.length) return [];

  const keyIds = [...new Set(data.map((row) => row.api_key_id).filter(Boolean))];
  const keyNames = new Map<string, string>();

  if (keyIds.length > 0) {
    const { data: keys } = await db
      .from("api_keys")
      .select("id, name")
      .in("id", keyIds as string[]);
    for (const key of keys ?? []) keyNames.set(key.id, key.name);
  }

  return data.map((row) => ({
    id: row.id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    outcome: row.outcome,
    keyName: row.api_key_id ? (keyNames.get(row.api_key_id) ?? null) : null,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  }));
}
