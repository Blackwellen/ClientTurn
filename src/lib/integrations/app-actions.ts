"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sealSecret } from "@/lib/security/secret-box";
import {
  AUTH_METHODS,
  AUTH_METHOD_KEYS,
  connectorFor,
  statusFor,
  type AuthMethod,
  type ConnectorStatus,
} from "./apps";

export type AppInstall = {
  id: string;
  appKey: string;
  active: boolean;
  authMethod: AuthMethod;
  label: string | null;
  sourceId: string | null;
  lastReceivedAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  rotatedAt: string | null;
  status: ConnectorStatus;
};

export async function listAppInstalls(): Promise<AppInstall[]> {
  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data, error } = await db
    .from("workspace_app_installs")
    .select(
      "id,app_key,active,auth_method,label,source_id,last_received_at,last_failure_at,last_failure_reason,rotated_at",
    )
    .eq("business_id", workspace.businessId);

  if (error) throw new Error("Could not load installed apps.");

  return (data ?? []).map((row) => {
    const shape = {
      active: row.active,
      lastReceivedAt: row.last_received_at,
      lastFailureAt: row.last_failure_at,
    };
    return {
      id: row.id,
      appKey: row.app_key,
      active: row.active,
      authMethod: row.auth_method as AuthMethod,
      label: row.label,
      sourceId: row.source_id,
      lastReceivedAt: row.last_received_at,
      lastFailureAt: row.last_failure_at,
      lastFailureReason: row.last_failure_reason,
      rotatedAt: row.rotated_at,
      status: statusFor(shape),
    };
  });
}

/** A cryptographically strong secret for the "generate one for me" button,
 *  so nobody is nudged into inventing a memorable one by hand. */
export async function generateConnectorSecret(): Promise<string> {
  await requireRole("admin");
  return randomBytes(32).toString("base64url");
}

const installSchema = z.object({
  app: z.string().min(1).max(60),
  authMethod: z.enum(AUTH_METHOD_KEYS as [AuthMethod, ...AuthMethod[]]),
  credentials: z.record(z.string(), z.string()),
  label: z.string().max(60).optional(),
  sourceId: z.string().max(40).optional(),
});

/**
 * Validates the submitted credentials against the field set the chosen
 * authentication method *declares*, rather than against a hardcoded "secret"
 * field. An unknown key is rejected rather than ignored: silently dropping a
 * field the caller believed it had configured is how a connection ends up
 * quietly weaker than the person who set it up thinks it is.
 */
function validateCredentials(
  method: AuthMethod,
  submitted: Record<string, string>,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const fields = AUTH_METHODS[method].fields;
  const known = new Set(fields.map((f) => f.key));

  for (const key of Object.keys(submitted)) {
    if (!known.has(key)) {
      return { ok: false, error: "Unexpected credential field submitted." };
    }
  }

  const value: Record<string, string> = {};

  for (const field of fields) {
    const raw = (submitted[field.key] ?? "").trim();

    if (!raw) {
      if (field.required) return { ok: false, error: `${field.label} is required.` };
      continue;
    }
    if (field.minLength && raw.length < field.minLength) {
      return {
        ok: false,
        error: `${field.label} must be at least ${field.minLength} characters.`,
      };
    }
    if (field.maxLength && raw.length > field.maxLength) {
      return {
        ok: false,
        error: `${field.label} must be ${field.maxLength} characters or fewer.`,
      };
    }
    // A header name reaches an HTTP header lookup, so it is constrained to
    // token characters rather than trusted as free text.
    if (field.key === "header_name" && !/^[a-z0-9-]+$/.test(raw.toLowerCase())) {
      return {
        ok: false,
        error: "Header name may only contain letters, digits and hyphens.",
      };
    }

    value[field.key] = field.key === "header_name" ? raw.toLowerCase() : raw;
  }

  return { ok: true, value };
}

export async function installWorkspaceApp(input: unknown) {
  const parsed = installSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the connection details and retry." };

  const connector = connectorFor(parsed.data.app);
  if (!connector) return { error: "Unknown connector." };
  if (!connector.authMethods.includes(parsed.data.authMethod)) {
    return { error: "This connector does not support that authentication method." };
  }

  const credentials = validateCredentials(
    parsed.data.authMethod,
    parsed.data.credentials,
  );
  if (!credentials.ok) return { error: credentials.error };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  let sealed: string;
  try {
    sealed = sealSecret(JSON.stringify(credentials.value));
  } catch {
    return {
      error: "Credential encryption must be configured before installing apps.",
    };
  }

  const { data, error } = await db
    .from("workspace_app_installs")
    .upsert(
      {
        business_id: workspace.businessId,
        app_key: connector.id,
        auth_method: parsed.data.authMethod,
        credentials_ciphertext: sealed,
        // 0045's single-secret column is still the one the ingest route reads
        // for HMAC installs, so it is kept in step rather than orphaned.
        secret_ciphertext:
          parsed.data.authMethod === "hmac_sha256"
            ? sealSecret(credentials.value.signing_secret)
            : sealed,
        label: parsed.data.label?.trim() || null,
        source_id: parsed.data.sourceId?.trim() || null,
        installed_by: workspace.userId,
        active: true,
        rotated_at: new Date().toISOString(),
        // Rotating invalidates the history: a rejection recorded against the
        // previous credential says nothing about the new one.
        last_failure_at: null,
        last_failure_reason: null,
      },
      { onConflict: "business_id,app_key" },
    )
    .select("id")
    .single();

  return error ? { error: "App installation failed. Please retry." } : { id: data.id };
}

export async function uninstallWorkspaceApp(id: unknown) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { error: "Invalid installation." };

  const workspace = await requireRole("admin");
  const { error } = await createAdminClient()
    .from("workspace_app_installs")
    .update({ active: false })
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId);

  return error ? { error: "Could not uninstall app." } : { ok: true };
}
