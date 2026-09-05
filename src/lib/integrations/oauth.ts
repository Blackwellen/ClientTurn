import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import type { ProviderType } from "./catalog";

/**
 * Shared OAuth2 authorization-code plumbing. Every workspace-connected
 * provider (Google Ads, Microsoft Advertising, TikTok, LinkedIn, Slack, Zoho)
 * uses the same shape: build an authorize URL with a CSRF state token, verify
 * that state on callback, exchange the code, store the result.
 *
 * HubSpot is deliberately not built on this — it uses a customer-pasted
 * private-app token instead of a redirect flow.
 */

export type OAuthConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** Extra authorize-URL params a provider needs (e.g. Google's access_type). */
  extraAuthorizeParams?: Record<string, string>;
};

function redirectUri(provider: ProviderType): string {
  return `${serverEnv.siteUrl}/api/integrations/${provider}/callback`;
}

export async function createOAuthState(
  provider: ProviderType,
  businessId: string,
  userId: string,
): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const admin = createAdminClient();

  await admin.from("integration_oauth_states").insert({
    state,
    provider_type: provider,
    business_id: businessId,
    user_id: userId,
  });

  return state;
}

export function buildAuthorizeUrl(
  provider: ProviderType,
  config: OAuthConfig,
  state: string,
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export type VerifiedState = {
  businessId: string;
  userId: string;
};

/**
 * Consumes the state row so a callback can never be replayed. Returns null for
 * a missing, expired or already-used state — the caller must treat that as an
 * untrusted callback, not merely a stale one.
 */
export async function consumeOAuthState(
  provider: ProviderType,
  state: string,
): Promise<VerifiedState | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("integration_oauth_states")
    .delete()
    .eq("state", state)
    .eq("provider_type", provider)
    .gt("expires_at", new Date().toISOString())
    .select("business_id, user_id")
    .maybeSingle();

  if (error || !data) return null;
  return { businessId: data.business_id, userId: data.user_id };
}

export type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  raw: Record<string, unknown>;
};

export async function exchangeCodeForToken(
  provider: ProviderType,
  config: OAuthConfig,
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof json.error_description === "string"
        ? json.error_description
        : typeof json.error === "string"
          ? json.error
          : `Token exchange failed with status ${response.status}`,
    );
  }

  return {
    accessToken: String(json.access_token ?? ""),
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSeconds:
      typeof json.expires_in === "number" ? json.expires_in : null,
    raw: json,
  };
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof json.error_description === "string"
        ? json.error_description
        : "Token refresh failed.",
    );
  }

  return {
    accessToken: String(json.access_token ?? ""),
    // Some providers (Google) omit refresh_token on refresh; keep the old one.
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : refreshToken,
    expiresInSeconds:
      typeof json.expires_in === "number" ? json.expires_in : null,
    raw: json,
  };
}

/**
 * Persists a successful connection: the integration row plus its secret.
 * Upserts on (business_id, provider_type) so a reconnect replaces rather than
 * duplicates.
 */
export async function storeConnection(params: {
  businessId: string;
  userId: string;
  provider: ProviderType;
  externalAccountId: string | null;
  displayName: string | null;
  scopes: string[];
  token: TokenResponse;
}): Promise<{ integrationId: string }> {
  const admin = createAdminClient();

  const { data: integration, error } = await admin
    .from("integrations")
    .upsert(
      {
        business_id: params.businessId,
        provider_type: params.provider,
        status: "HEALTHY",
        external_account_id: params.externalAccountId,
        display_name: params.displayName,
        scopes: params.scopes,
        connected_by: params.userId,
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_code: null,
        last_error_message: null,
      },
      { onConflict: "business_id,provider_type" },
    )
    .select("id")
    .single();

  if (error || !integration) throw error ?? new Error("Could not save the connection.");

  const expiresAt = params.token.expiresInSeconds
    ? new Date(Date.now() + params.token.expiresInSeconds * 1000).toISOString()
    : null;

  const { error: secretError } = await admin.from("integration_secrets").upsert(
    {
      integration_id: integration.id,
      business_id: params.businessId,
      access_token: params.token.accessToken,
      refresh_token: params.token.refreshToken,
      token_expires_at: expiresAt,
    },
    { onConflict: "integration_id" },
  );
  if (secretError) throw secretError;

  return { integrationId: integration.id };
}

/**
 * Returns a live access token for a connected integration, refreshing it first
 * if it is expired or about to expire. Every job handler that calls a provider
 * goes through this rather than reading `access_token` directly, so a refresh
 * failure is caught in one place and surfaces as ACTION_REQUIRED.
 */
export async function getLiveAccessToken(
  integrationId: string,
  config: OAuthConfig,
): Promise<string> {
  const admin = createAdminClient();

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token, refresh_token, token_expires_at")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!secret?.access_token) {
    throw new Error("No stored credential for this integration.");
  }

  const expiresAt = secret.token_expires_at ? new Date(secret.token_expires_at) : null;
  const needsRefresh = expiresAt !== null && expiresAt.getTime() - Date.now() < 60_000;

  if (!needsRefresh || !secret.refresh_token) {
    return secret.access_token;
  }

  const refreshed = await refreshAccessToken(config, secret.refresh_token);

  await admin
    .from("integration_secrets")
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      token_expires_at: refreshed.expiresInSeconds
        ? new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString()
        : null,
    })
    .eq("integration_id", integrationId);

  return refreshed.accessToken;
}
