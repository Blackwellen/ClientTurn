import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { hashToken } from "./gateway";
import { MCP_SCOPES, type McpScope } from "./tools";

/**
 * Issuing and revoking MCP connections (Programme §1).
 *
 * The gateway could authenticate a token but nothing could create one, so the
 * MCP server was unreachable: it validated credentials that had no way to exist.
 * This is the missing half.
 *
 * Four rules the shape of this file enforces:
 *
 *   1. **A secret is shown once.** Only its SHA-256 digest is stored, so a
 *      leaked database row cannot be replayed, and "show it again" is not a
 *      feature that can be added later without changing that.
 *   2. **A grant can never exceed the granting user's own permissions.** Scopes
 *      are the ceiling, and the gateway re-reads the user's *live* role on every
 *      call — so a token issued by an admin who is later demoted loses reach
 *      immediately, without anyone revoking anything.
 *   3. **Revocation is immediate and total.** Revoking a client revokes every
 *      token it holds in the same statement, rather than waiting for expiry.
 *   4. **Tokens are short-lived and refreshed.** An access token lasts an hour;
 *      the refresh token rotates on use, so a stolen refresh token is
 *      single-use and its reuse is detectable.
 */

/* -------------------------------------------------------------- lifetimes */

/** Short enough that a leaked access token is a small window, long enough that
 *  an assistant is not refreshing mid-conversation. */
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/** A connection a person set up should keep working for a month of normal use. */
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* ----------------------------------------------------------------- secrets */

/**
 * 32 bytes of CSPRNG output, base64url. Prefixed so a leaked string is
 * recognisable as a ClientTurn credential in a log or a paste — that is what
 * makes automated secret scanning able to find it.
 */
function generateSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/* ------------------------------------------------------------------ create */

export type CreatedClient = {
  clientId: string;
  oauthClientId: string;
  /** Shown once. Never stored, never recoverable. */
  clientSecret: string;
  scopes: McpScope[];
};

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/**
 * Registers a client and returns its credentials.
 *
 * The caller is responsible for having checked that the acting user may do this
 * — this module is reached through a server action that requires `admin`.
 */
export async function createClient(input: {
  businessId: string;
  userId: string;
  name: string;
  description?: string | null;
  scopes: string[];
  redirectUris?: string[];
}): Promise<CreatedClient | null> {
  const scopes = input.scopes.filter(isMcpScope);

  // A connection with no scopes can do nothing, and creating one would leave a
  // credential in circulation that looks live and is not.
  if (scopes.length === 0) return null;

  const db = createAdminClient();
  const oauthClientId = generateSecret("ct_client");
  const clientSecret = generateSecret("ct_secret");

  const { data: client } = await db
    .from("mcp_clients")
    .insert({
      business_id: input.businessId,
      name: input.name,
      description: input.description ?? null,
      oauth_client_id: oauthClientId,
      client_secret_hash: hashToken(clientSecret),
      redirect_uris: input.redirectUris ?? [],
      created_by: input.userId,
      status: "ACTIVE",
    })
    .select("id")
    .single();

  if (!client) return null;

  // Scopes are rows rather than an array column so each grant carries who
  // granted it and when, and so revoking one is a dated fact rather than an
  // edit that erases the previous state.
  await db.from("mcp_scopes").insert(
    scopes.map((scope) => ({
      business_id: input.businessId,
      client_id: client.id,
      scope,
      granted_by: input.userId,
    })),
  );

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "integration.connected",
    entityType: "mcp_client",
    entityId: client.id,
    metadata: { name: input.name, scopes, kind: "mcp" },
  });

  return {
    clientId: client.id,
    oauthClientId,
    clientSecret,
    scopes,
  };
}

/* ------------------------------------------------------------------ tokens */

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string[];
};

/**
 * Issues an access/refresh pair for a client, on one user's authority.
 *
 * The scopes written onto the token are the intersection of what the client was
 * granted and what is still live — a scope revoked since the last issue does
 * not come back on the next one.
 */
export async function issueTokens(input: {
  businessId: string;
  clientId: string;
  userId: string;
}): Promise<IssuedTokens | null> {
  const db = createAdminClient();

  const { data: client } = await db
    .from("mcp_clients")
    .select("id, status, business_id")
    .eq("id", input.clientId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!client || client.status !== "ACTIVE") return null;

  // The authorising user must still be an active member. Issuing a token for
  // someone who has left would create a credential with no live authority
  // behind it that the gateway would then have to refuse on every call.
  const { data: membership } = await db
    .from("business_members")
    .select("role, status")
    .eq("business_id", input.businessId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!membership || membership.status !== "active") return null;

  const { data: grants } = await db
    .from("mcp_scopes")
    .select("scope")
    .eq("client_id", input.clientId)
    .is("revoked_at", null);

  const scopes = (grants ?? []).map((row) => row.scope);
  if (scopes.length === 0) return null;

  const accessToken = generateSecret("ct_at");
  const refreshToken = generateSecret("ct_rt");
  const now = Date.now();

  await db.from("mcp_tokens").insert([
    {
      business_id: input.businessId,
      client_id: input.clientId,
      user_id: input.userId,
      token_hash: hashToken(accessToken),
      token_type: "ACCESS",
      scopes,
      expires_at: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
    },
    {
      business_id: input.businessId,
      client_id: input.clientId,
      user_id: input.userId,
      token_hash: hashToken(refreshToken),
      token_type: "REFRESH",
      scopes,
      expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
    },
  ]);

  await db
    .from("mcp_clients")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", input.clientId);

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scopes,
  };
}

/**
 * Exchanges a refresh token for a new pair, rotating it.
 *
 * Rotation is the point: the presented refresh token is revoked as part of the
 * exchange, so it is single-use. If it is presented a second time it no longer
 * resolves — which is both the correct refusal and the signal that a copy of it
 * exists somewhere it should not.
 */
export async function refreshTokens(
  presented: string,
): Promise<IssuedTokens | null> {
  const db = createAdminClient();

  const { data: row } = await db
    .from("mcp_tokens")
    .select("id, business_id, client_id, user_id, expires_at, revoked_at")
    .eq("token_hash", hashToken(presented))
    .eq("token_type", "REFRESH")
    .maybeSingle();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  // Revoked before the new pair is issued, not after: a failure between the two
  // must leave the old token dead rather than leave two live refresh tokens.
  await db
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", row.id);

  return issueTokens({
    businessId: row.business_id,
    clientId: row.client_id,
    userId: row.user_id,
  });
}

/* --------------------------------------------------------------- revocation */

/**
 * Revokes a client and everything it holds.
 *
 * One statement per table rather than a cascade, so the tokens are dead the
 * moment this returns. A revocation that took effect at expiry would be a
 * revocation in name only.
 */
export async function revokeClient(input: {
  businessId: string;
  clientId: string;
  userId: string;
}): Promise<boolean> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  const { data: client } = await db
    .from("mcp_clients")
    .update({ status: "REVOKED", revoked_at: now, revoked_by: input.userId })
    .eq("id", input.clientId)
    .eq("business_id", input.businessId)
    .select("id, name")
    .maybeSingle();

  if (!client) return false;

  await db
    .from("mcp_tokens")
    .update({ revoked_at: now })
    .eq("client_id", input.clientId)
    .is("revoked_at", null);

  await db
    .from("mcp_scopes")
    .update({ revoked_at: now })
    .eq("client_id", input.clientId)
    .is("revoked_at", null);

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "integration.disconnected",
    entityType: "mcp_client",
    entityId: input.clientId,
    metadata: { name: client.name, kind: "mcp" },
  });

  return true;
}

/* --------------------------------------------------------------- approvals */

/**
 * Carries out an approved high-impact tool call.
 *
 * `mcp_approvals` had an `EXECUTED` state that nothing could reach: a person
 * could approve a request and nothing would happen. The approval row *is* the
 * confirmation — a person read the summary and said yes — which is why this is
 * the one path that may set `confirmed` on the service context.
 *
 * The status is claimed conditionally before the operation runs, so two people
 * approving at once execute it once.
 */
export async function executeApproval(input: {
  businessId: string;
  approvalId: string;
  userId: string;
}): Promise<{ ok: boolean; message: string }> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  const { data: claimed } = await db
    .from("mcp_approvals")
    .update({ status: "APPROVED", decided_by: input.userId, decided_at: now })
    .eq("id", input.approvalId)
    .eq("business_id", input.businessId)
    .eq("status", "PENDING")
    .select("id, tool_name, arguments_json, requested_by_user_id, expires_at")
    .maybeSingle();

  if (!claimed) {
    return { ok: false, message: "That request is no longer waiting for a decision." };
  }

  if (new Date(claimed.expires_at).getTime() <= Date.now()) {
    await db
      .from("mcp_approvals")
      .update({ status: "EXPIRED" })
      .eq("id", input.approvalId);
    return { ok: false, message: "That request expired before it was approved." };
  }

  const { runOperation, serviceOperation } = await import("@/lib/services");

  if (!serviceOperation(claimed.tool_name)) {
    await db
      .from("mcp_approvals")
      .update({
        status: "FAILED",
        execution_error: "The requested tool is no longer available.",
      })
      .eq("id", input.approvalId);
    return { ok: false, message: "That action is no longer available." };
  }

  // Run on the *approver's* authority, not the requester's. They are the person
  // who saw what was being asked for and agreed to it.
  const { data: membership } = await db
    .from("business_members")
    .select("role")
    .eq("business_id", input.businessId)
    .eq("user_id", input.userId)
    .maybeSingle();

  const result = await runOperation(
    claimed.tool_name,
    claimed.arguments_json ?? {},
    {
      businessId: input.businessId,
      userId: input.userId,
      role: (membership?.role ?? "viewer") as "owner" | "admin" | "member" | "viewer",
      caller: "MCP",
      confirmed: true,
      correlationId: input.approvalId,
      // The approval id doubles as the idempotency key: approving twice cannot
      // charge twice.
      idempotencyKey: input.approvalId,
    },
  );

  await db
    .from("mcp_approvals")
    .update(
      result.success
        ? { status: "EXECUTED", executed_at: new Date().toISOString() }
        : { status: "FAILED", execution_error: result.message.slice(0, 500) },
    )
    .eq("id", input.approvalId);

  return result.success
    ? { ok: true, message: "Done." }
    : { ok: false, message: result.message };
}

/** Marks a request refused. The action never runs and the client is told. */
export async function rejectApproval(input: {
  businessId: string;
  approvalId: string;
  userId: string;
}): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("mcp_approvals")
    .update({
      status: "REJECTED",
      decided_by: input.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", input.approvalId)
    .eq("business_id", input.businessId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}
