/**
 * The credential an MCP connection hands to an assistant.
 *
 * Pure, so the naming and the "which credential works" rules are testable
 * without a database.
 *
 * ## Why a workspace API key and not the OAuth pair
 *
 * The connection dialog used to show a client secret. Nothing accepted it: the
 * gateway resolves either a workspace API key or an MCP access token, never a
 * client secret. The "New key" button then minted a one-hour access token, and
 * no MCP client (Claude, Codex, Gemini) performs a refresh exchange -- they
 * configure a static `Authorization: Bearer` header -- so the connection worked
 * for an hour and then stopped for no visible reason.
 *
 * A workspace API key is what those clients can hold. So a connection now
 * issues one, scoped to exactly the permissions ticked on the connection, bound
 * to it (`api_keys.mcp_client_id`, migration 0133), shown once, and revoked
 * with it.
 */

/** api_keys.name is capped at 80 characters by a check constraint. */
const API_KEY_NAME_MAX = 80;

/** The tag that ties a key to its connection even before 0133 is applied. */
export function mcpKeyTag(clientId: string): string {
  return `[mcp:${clientId}]`;
}

/**
 * "Claude on my laptop (MCP) [mcp:<id>]", trimmed to fit the column.
 *
 * The connection name leads so the Developer tab's key list reads naturally;
 * the tag trails so it is never the part that gets cut.
 */
export function mcpKeyName(connectionName: string, clientId: string): string {
  const tag = mcpKeyTag(clientId);
  const suffix = ` (MCP) ${tag}`;
  const room = Math.max(1, API_KEY_NAME_MAX - suffix.length);
  const base = connectionName.trim().replace(/\s+/g, " ") || "Assistant";
  const trimmed = base.length > room ? `${base.slice(0, room - 1).trimEnd()}…` : base;
  return `${trimmed}${suffix}`.slice(0, API_KEY_NAME_MAX);
}

/**
 * Whether a key bound to a connection may still be used.
 *
 * Revoking a connection revokes its key in the same action, but the gateway
 * checks the connection too, so a key row that was somehow missed is still
 * refused. An unbound key (created on the Developer tab) is not affected.
 */
export function boundKeyAllowed(connectionStatus: string | null | undefined): boolean {
  if (connectionStatus === undefined) return true;
  return connectionStatus === "ACTIVE";
}

/** The MCP server URL an assistant is configured with. */
export function mcpServerUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, "")}/api/mcp`;
}
