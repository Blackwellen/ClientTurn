import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/session";
import { SCOPE_DESCRIPTIONS, type McpScope } from "./tools";

/**
 * What Settings → Connections shows about MCP.
 *
 * Everything here is scoped to the caller's workspace and reached through
 * `requireRole("admin")`. Nothing returns a secret or a token hash: the digest
 * is not a credential, but publishing it invites offline attack on a value the
 * customer believes is private, and there is no screen that needs it.
 */

export type McpConnection = {
  id: string;
  name: string;
  description: string | null;
  oauthClientId: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  scopes: { scope: string; label: string }[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Live access tokens. Zero means the connection exists but cannot yet call. */
  activeTokens: number;
  /** Calls in the last 7 days, so an idle connection is visible as idle. */
  recentCalls: number;
  /** Denials in the last 7 days: a connection being refused repeatedly is worth
   *  seeing, whether that is a misconfiguration or something worse. */
  recentDenials: number;
};

export type McpPendingApproval = {
  id: string;
  toolName: string;
  summary: string;
  connectionName: string | null;
  requestedAt: string;
  expiresAt: string;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function listMcpConnections(): Promise<McpConnection[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  const { data: clients } = await db
    .from("mcp_clients")
    .select("id, name, description, oauth_client_id, status, created_at, last_used_at")
    .eq("business_id", workspace.businessId)
    .order("created_at", { ascending: false });

  if (!clients?.length) return [];

  const ids = clients.map((row) => row.id);
  const now = new Date().toISOString();

  const [{ data: scopes }, { data: tokens }, { data: calls }] = await Promise.all([
    db
      .from("mcp_scopes")
      .select("client_id, scope")
      .in("client_id", ids)
      .is("revoked_at", null),
    db
      .from("mcp_tokens")
      .select("client_id")
      .in("client_id", ids)
      .eq("token_type", "ACCESS")
      .is("revoked_at", null)
      .gt("expires_at", now),
    db
      .from("mcp_audit_logs")
      .select("client_id, result")
      .in("client_id", ids)
      .gte("created_at", since),
  ]);

  const scopesByClient = new Map<string, { scope: string; label: string }[]>();
  for (const row of scopes ?? []) {
    const list = scopesByClient.get(row.client_id) ?? [];
    list.push({
      scope: row.scope,
      label: SCOPE_DESCRIPTIONS[row.scope as McpScope] ?? row.scope,
    });
    scopesByClient.set(row.client_id, list);
  }

  const tokenCount = new Map<string, number>();
  for (const row of tokens ?? []) {
    tokenCount.set(row.client_id, (tokenCount.get(row.client_id) ?? 0) + 1);
  }

  const callCount = new Map<string, number>();
  const denialCount = new Map<string, number>();
  for (const row of calls ?? []) {
    if (!row.client_id) continue;
    callCount.set(row.client_id, (callCount.get(row.client_id) ?? 0) + 1);
    if (row.result.startsWith("DENIED")) {
      denialCount.set(row.client_id, (denialCount.get(row.client_id) ?? 0) + 1);
    }
  }

  return clients.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    oauthClientId: row.oauth_client_id,
    status: row.status as McpConnection["status"],
    scopes: scopesByClient.get(row.id) ?? [],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    activeTokens: tokenCount.get(row.id) ?? 0,
    recentCalls: callCount.get(row.id) ?? 0,
    recentDenials: denialCount.get(row.id) ?? 0,
  }));
}

/**
 * Requests waiting for a person.
 *
 * Expired requests are excluded rather than shown greyed out: a stale approval
 * queue is one people stop reading, and an expired request cannot be acted on
 * anyway.
 */
export async function listMcpPendingApprovals(): Promise<McpPendingApproval[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data } = await db
    .from("mcp_approvals")
    .select("id, tool_name, summary, created_at, expires_at, client_id")
    .eq("business_id", workspace.businessId)
    .eq("status", "PENDING")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (!data?.length) return [];

  const clientIds = [...new Set(data.map((row) => row.client_id).filter(Boolean))];
  const names = new Map<string, string>();

  if (clientIds.length > 0) {
    const { data: clients } = await db
      .from("mcp_clients")
      .select("id, name")
      .in("id", clientIds as string[]);
    for (const client of clients ?? []) names.set(client.id, client.name);
  }

  return data.map((row) => ({
    id: row.id,
    toolName: row.tool_name,
    summary: row.summary,
    connectionName: row.client_id ? (names.get(row.client_id) ?? null) : null,
    requestedAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}
