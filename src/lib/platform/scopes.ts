/**
 * The one list of permissions ClientTurn grants to anything outside the app.
 *
 * An MCP connection, a workspace API key and a webhook subscription all draw
 * from this list, because they are three doors into the same building. Keeping
 * a separate list per door is how a scope ends up meaning one thing over HTTP
 * and something slightly wider over MCP — which is a security bug that reads
 * like a typo.
 *
 * Pure: no `server-only`, no Supabase. Settings renders these, tests assert
 * them, and the gateway enforces them, all from here.
 *
 * The scopes are named after what they let you do, not after tables. Something
 * granted `leads:read` cannot discover that `contact_permissions` exists.
 */

export const PLATFORM_SCOPES = [
  "leads:read",
  "leads:write",
  "prospects:read",
  "prospects:write",
  "campaigns:read",
  "campaigns:write",
  "analytics:read",
  "business:read",
] as const;

export type PlatformScope = (typeof PLATFORM_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<PlatformScope, string> = {
  "leads:read": "Read your leads and their conversations",
  "leads:write": "Create and update leads",
  "prospects:read": "Read sourced prospects and their scores",
  "prospects:write": "Approve prospects and start sourcing",
  "campaigns:read": "Read campaign performance",
  "campaigns:write": "Change and launch campaigns",
  "analytics:read": "Read your metrics",
  "business:read": "Read your business profile and status",
};

export function isPlatformScope(value: string): value is PlatformScope {
  return (PLATFORM_SCOPES as readonly string[]).includes(value);
}

/**
 * A write scope implies nothing about reading, and that is deliberate: a key
 * granted only `leads:write` can change a lead it already knows the id of and
 * cannot enumerate the workspace. Callers that need both ask for both.
 */
export function isWriteScope(scope: string): boolean {
  return scope.endsWith(":write");
}

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export type WorkspaceRole = "viewer" | "member" | "admin" | "owner";

/**
 * Whether a role meets a minimum. Used at call time rather than only at grant
 * time, everywhere: a credential issued while someone was an admin must stop
 * reaching admin-only capabilities the moment they are demoted.
 */
export function roleMeets(role: string, minimum: string): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}
