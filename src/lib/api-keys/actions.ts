"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { PLATFORM_SCOPES, isPlatformScope, roleMeets } from "@/lib/platform/scopes";
import { createApiKey, revokeApiKey } from "./service";
import { expiryToDate, isAllowedIpEntry } from "./types";

/**
 * Creating and revoking workspace API keys.
 *
 * Every action requires `admin`. Handing out a credential that can read a
 * workspace's leads is an administrative act — and the key outlives the session
 * that made it, which is exactly why a member should not be able to mint one
 * for themselves.
 *
 * The key carries the *acting admin's* authority, not a chosen member's. Being
 * able to issue a credential on someone else's behalf would make it possible to
 * borrow an owner's reach without an owner ever agreeing to it.
 */

export type ApiKeyActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  environment: z.enum(["live", "test"]).default("live"),
  scopes: z.array(z.string()).min(1).max(PLATFORM_SCOPES.length),
  expiry: z.string().trim().max(10).default("90"),
  allowedIps: z.array(z.string().trim().max(64)).max(20).default([]),
});

export async function createApiKeyAction(input: unknown): Promise<
  ApiKeyActionResult<{
    id: string;
    key: string;
    name: string;
    scopes: string[];
    expiresAt: string | null;
  }>
> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Give the key a name and at least one permission.");
  }

  const unknownScopes = parsed.data.scopes.filter((scope) => !isPlatformScope(scope));
  if (unknownScopes.length > 0) {
    return fail("One of those permissions is not a permission ClientTurn grants.");
  }

  const badIps = parsed.data.allowedIps.filter(
    (entry) => entry.length > 0 && !isAllowedIpEntry(entry),
  );
  if (badIps.length > 0) {
    return fail(`"${badIps[0]}" is not a valid IP address or range.`);
  }

  const workspace = await requireRole("admin");

  // A key cannot outrank the person holding it, so a write scope needs at least
  // `member`. An admin always clears this; the check is here so the rule is
  // stated at the point of issue rather than only discovered at call time.
  const writeScopes = parsed.data.scopes.filter((scope) => scope.endsWith(":write"));
  if (writeScopes.length > 0 && !roleMeets(workspace.role, "member")) {
    return fail("Your role cannot grant write access.");
  }

  const created = await createApiKey({
    businessId: workspace.businessId,
    userId: workspace.userId,
    createdBy: workspace.userId,
    name: parsed.data.name,
    environment: parsed.data.environment,
    scopes: parsed.data.scopes,
    allowedIps: parsed.data.allowedIps.filter(Boolean),
    expiresAt: expiryToDate(parsed.data.expiry),
  });

  if (!created) return fail("That key could not be created.");

  revalidatePath("/app/settings");

  // The key travels back exactly once, to be shown once. Nothing stores it, and
  // there is no action that can retrieve it later.
  return {
    ok: true,
    data: {
      id: created.id,
      key: created.key,
      name: parsed.data.name,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
    },
  };
}

const revokeSchema = z.object({ keyId: z.string().uuid() });

export async function revokeApiKeyAction(
  input: unknown,
): Promise<ApiKeyActionResult> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return fail("That key could not be found.");

  const workspace = await requireRole("admin");

  const revoked = await revokeApiKey({
    businessId: workspace.businessId,
    keyId: parsed.data.keyId,
    userId: workspace.userId,
  });

  if (!revoked) return fail("That key is already revoked.");

  revalidatePath("/app/settings");
  return { ok: true };
}
