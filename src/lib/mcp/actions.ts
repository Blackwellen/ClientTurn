"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import {
  createClient,
  executeApproval,
  isMcpScope,
  refreshTokens,
  rejectApproval,
  revokeClient,
  issueConnectionKey,
} from "./provisioning";
import { MCP_SCOPES } from "./tools";

/**
 * Managing MCP connections from Settings → Connections.
 *
 * Every action here requires `admin`. Handing an external assistant a key to a
 * workspace is an administrative act, not a personal preference — and the
 * connection outlives the person who made it, which is exactly why a member
 * should not be able to create one on their own.
 */

export type McpActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

/**
 * Settings is one route with `?section=` (V3 IA); `/app/settings/connections`
 * no longer exists, so revalidating it refreshed nothing.
 */
const SETTINGS_PATH = "/app/settings";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ create */

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  scopes: z.array(z.string()).min(1).max(MCP_SCOPES.length),
});

export async function createMcpClientAction(input: unknown): Promise<
  McpActionResult<{
    clientId: string;
    oauthClientId: string;
    /** The bearer key the assistant is configured with. Shown once. */
    apiKey: string | null;
    scopes: string[];
  }>
> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Give the connection a name and at least one permission.");

  const unknown = parsed.data.scopes.filter((scope) => !isMcpScope(scope));
  if (unknown.length > 0) {
    return fail("One of those permissions is not a permission ClientTurn grants.");
  }

  const workspace = await requireRole("admin");

  const created = await createClient({
    businessId: workspace.businessId,
    userId: workspace.userId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    scopes: parsed.data.scopes,
  });

  if (!created) return fail("That connection could not be created.");

  revalidatePath(SETTINGS_PATH);

  // The key travels back exactly once, to be shown once. Only its digest is
  // stored, and there is no action that can retrieve it later.
  return {
    ok: true,
    data: {
      clientId: created.clientId,
      oauthClientId: created.oauthClientId,
      apiKey: created.apiKey,
      scopes: created.scopes,
    },
  };
}

/* ------------------------------------------------------------------ tokens */

const clientIdSchema = z.object({ clientId: z.string().uuid() });

/**
 * Issues a fresh bearer key for an existing connection, revoking the old one.
 *
 * Separate from creation so a customer can re-key a connection whose key
 * leaked without tearing down the connection. What it issues is a workspace
 * API key bound to the connection -- the credential an MCP client can hold as
 * a static header -- not a one-hour OAuth token no client would refresh.
 */
export async function issueMcpTokenAction(input: unknown): Promise<
  McpActionResult<{ apiKey: string }>
> {
  const parsed = clientIdSchema.safeParse(input);
  if (!parsed.success) return fail("That connection could not be found.");

  const workspace = await requireRole("admin");

  const issued = await issueConnectionKey({
    businessId: workspace.businessId,
    clientId: parsed.data.clientId,
    userId: workspace.userId,
  });

  if (!issued) return fail("That connection is not active, or has no permissions left.");

  revalidatePath(SETTINGS_PATH);

  return { ok: true, data: { apiKey: issued.key } };
}

/**
 * Rotates a refresh token.
 *
 * Called by the client itself rather than by a person, so it takes the token as
 * its only authority — that is what a refresh token is for. It deliberately
 * does *not* call `requireRole`: the presented token is the credential, and the
 * user's live role is re-checked on every actual tool call anyway.
 */
export async function refreshMcpTokenAction(input: unknown): Promise<
  McpActionResult<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>
> {
  const parsed = z.object({ refreshToken: z.string().min(20).max(200) }).safeParse(input);
  if (!parsed.success) return fail("That token could not be refreshed.");

  const tokens = await refreshTokens(parsed.data.refreshToken);

  // One message for every failure: expired, revoked, already used, never
  // existed. Distinguishing them would tell a holder of a stolen token which
  // one they have.
  if (!tokens) return fail("That token could not be refreshed.");

  return {
    ok: true,
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
    },
  };
}

/* -------------------------------------------------------------- revocation */

export async function revokeMcpClientAction(input: unknown): Promise<McpActionResult> {
  const parsed = clientIdSchema.safeParse(input);
  if (!parsed.success) return fail("That connection could not be found.");

  const workspace = await requireRole("admin");

  const revoked = await revokeClient({
    businessId: workspace.businessId,
    clientId: parsed.data.clientId,
    userId: workspace.userId,
  });

  if (!revoked) return fail("That connection could not be revoked.");

  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/* --------------------------------------------------------------- approvals */

const approvalSchema = z.object({ approvalId: z.string().uuid() });

export async function approveMcpRequestAction(input: unknown): Promise<McpActionResult> {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return fail("That request could not be found.");

  const workspace = await requireRole("admin");

  const result = await executeApproval({
    businessId: workspace.businessId,
    approvalId: parsed.data.approvalId,
    userId: workspace.userId,
  });

  revalidatePath(SETTINGS_PATH);
  return result.ok ? { ok: true } : fail(result.message);
}

export async function rejectMcpRequestAction(input: unknown): Promise<McpActionResult> {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return fail("That request could not be found.");

  const workspace = await requireRole("admin");

  const rejected = await rejectApproval({
    businessId: workspace.businessId,
    approvalId: parsed.data.approvalId,
    userId: workspace.userId,
  });

  if (!rejected) return fail("That request is no longer waiting for a decision.");

  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}
