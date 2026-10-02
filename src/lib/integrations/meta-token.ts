import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { markReconnectRequired } from "@/lib/integrations/oauth";
import { maintainMetaToken, type MetaDebugInfo, type MetaMaintenanceResult, type MetaTokenPorts } from "./meta-token-core";

/**
 * The Supabase and Graph API wiring of `maintainMetaToken` (meta-token-core.ts).
 * Tokens travel only to graph.facebook.com and the secrets table; nothing here
 * logs one.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export function metaTokenPorts(): MetaTokenPorts | null {
  const appId = serverEnv.meta?.appId;
  const appSecret = serverEnv.meta?.appSecret;
  if (!appId || !appSecret) return null;
  const admin = createAdminClient();

  async function readExtra(integrationId: string): Promise<Record<string, unknown>> {
    const { data } = await admin.from("integration_secrets").select("extra").eq("integration_id", integrationId).maybeSingle();
    return ((data?.extra ?? {}) as Record<string, unknown>) ?? {};
  }

  return {
    now: () => Date.now(),
    async read(integrationId) {
      const { data } = await admin
        .from("integration_secrets")
        .select("access_token, token_expires_at")
        .eq("integration_id", integrationId)
        .maybeSingle();
      return data ?? null;
    },
    async debug(accessToken): Promise<MetaDebugInfo> {
      const url = new URL(`${GRAPH}/debug_token`);
      url.searchParams.set("input_token", accessToken);
      url.searchParams.set("access_token", `${appId}|${appSecret}`);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Meta debug_token answered ${response.status}.`);
      const json = (await response.json().catch(() => null)) as {
        data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; error?: { code?: number } };
      } | null;
      const d = json?.data;
      if (!d || typeof d.is_valid !== "boolean") throw new Error("Meta debug_token returned no verdict.");
      return {
        isValid: d.is_valid,
        expiresAt: typeof d.expires_at === "number" ? d.expires_at : null,
        dataAccessExpiresAt: typeof d.data_access_expires_at === "number" ? d.data_access_expires_at : null,
        errorCode: typeof d.error?.code === "number" ? d.error.code : null,
      };
    },
    async exchange(accessToken) {
      const url = new URL(`${GRAPH}/oauth/access_token`);
      url.searchParams.set("grant_type", "fb_exchange_token");
      url.searchParams.set("client_id", appId);
      url.searchParams.set("client_secret", appSecret);
      url.searchParams.set("fb_exchange_token", accessToken);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Meta token extension answered ${response.status}.`);
      const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error("Meta token extension returned no token.");
      return { accessToken: json.access_token, expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : null };
    },
    async swap(integrationId, expectedAccessToken, next) {
      const { data, error } = await admin
        .from("integration_secrets")
        .update(next)
        .eq("integration_id", integrationId)
        .eq("access_token", expectedAccessToken)
        .select("integration_id");
      if (error) throw new Error(`Could not store the extended Meta token: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async record(integrationId, expectedAccessToken, facts) {
      const extra = await readExtra(integrationId);
      await admin
        .from("integration_secrets")
        .update({
          token_expires_at: facts.token_expires_at,
          extra: { ...extra, meta_token_checked_at: facts.checked_at, meta_data_access_expires_at: facts.data_access_expires_at } as never,
        })
        .eq("integration_id", integrationId)
        .eq("access_token", expectedAccessToken);
    },
    markReconnect: (integrationId, reason) => markReconnectRequired(integrationId, reason),
  };
}

/** One connection's daily Meta check. Null when Meta is not configured on this platform. */
export async function runMetaTokenCheck(integrationId: string): Promise<MetaMaintenanceResult | null> {
  const ports = metaTokenPorts();
  if (!ports) return null;
  return maintainMetaToken(ports, integrationId);
}
