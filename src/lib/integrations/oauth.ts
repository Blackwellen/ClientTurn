import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import type { ProviderType } from "./catalog";
import { enqueue } from "@/lib/jobs/queue";
import { OAuthRefreshError, RECONNECT_REQUIRED } from "./oauth-health";
import { liveAccessToken, type LiveTokenOptions, type StoredSecret, type TokenRefreshPorts } from "./token-refresh-core";

export { OAuthRefreshError } from "./oauth-health";

/**
 * Shared OAuth2 authorization-code plumbing. Every workspace-connected
 * provider (Google Ads, TikTok, LinkedIn, Slack, Zoho) uses the same shape:
 * build an authorize URL with a CSRF state token, verify that state on
 * callback, exchange the code, store the result.
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
  /**
   * Salesforce's Connected App / External Client App platform mandates PKCE
   * on every authorization-code flow, with no per-app opt-out — the setting
   * in Salesforce's own UI is checked and disabled, next to "To change this
   * required setting, contact Support." When set, `createOAuthState` mints a
   * code_verifier and stores it alongside the state row, `buildAuthorizeUrl`
   * sends its S256 challenge, and `exchangeCodeForToken` sends the verifier
   * back on token exchange. Every other provider leaves this unset and is
   * unaffected — the column is simply null on their state rows.
   */
  usePkce?: boolean;
};

function redirectUri(provider: ProviderType): string {
  return `${serverEnv.siteUrl}/api/integrations/${provider}/callback`;
}

export async function createOAuthState(
  provider: ProviderType,
  businessId: string,
  userId: string,
  config?: OAuthConfig,
): Promise<{ state: string; codeVerifier: string | null }> {
  const state = randomBytes(24).toString("base64url");
  // RFC 7636 requires 43-128 characters from the unreserved URL-safe set;
  // 32 random bytes base64url-encoded is 43 characters.
  const codeVerifier = config?.usePkce ? randomBytes(32).toString("base64url") : null;
  const admin = createAdminClient();

  const { error } = await admin.from("integration_oauth_states").insert({
    state,
    provider_type: provider,
    business_id: businessId,
    user_id: userId,
    code_verifier: codeVerifier,
  });

  // This was previously unchecked: a failed insert still returned a
  // seemingly-valid state, sent the customer through the whole provider
  // consent screen, and only failed on the way back with no error anywhere
  // to explain why -- the callback simply couldn't find the row and refused
  // the whole connection as untrusted. Throwing here fails at the one point
  // where it can still be shown to the person clicking Connect, instead of
  // after they've re-authenticated with a third party for nothing.
  if (error) {
    console.error(
      `[oauth] Failed to persist OAuth state for ${provider} (business ${businessId}):`,
      error,
    );
    throw new Error(`Could not start the ${provider} connection. Try again in a moment.`);
  }

  return { state, codeVerifier };
}

export function buildAuthorizeUrl(
  provider: ProviderType,
  config: OAuthConfig,
  state: string,
  codeVerifier: string | null,
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  if (config.usePkce && codeVerifier) {
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export type VerifiedState = {
  businessId: string;
  userId: string;
  codeVerifier: string | null;
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
    .select("business_id, user_id, code_verifier")
    .maybeSingle();

  if (error || !data) return null;
  return {
    businessId: data.business_id,
    userId: data.user_id,
    codeVerifier: data.code_verifier ?? null,
  };
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
  codeVerifier: string | null,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (config.usePkce && codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

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

/**
 * A refresh the provider refused for good (`invalid_grant`, revoked client):
 * flips the connection to ACTION_REQUIRED, which is what shows the Reconnect
 * card and the app banner, and tells the workspace once per connection per
 * failure. Idempotent: an already-flagged connection is left as it is.
 */
export async function markReconnectRequired(
  integrationId: string,
  reason: string,
  copy: { code: string; message: string } = RECONNECT_REQUIRED,
): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("integrations")
    .select("id, business_id, provider_type, status, last_error_code")
    .eq("id", integrationId)
    .maybeSingle();
  if (!row || row.status === "DISCONNECTED") return;
  if (row.status === "ACTION_REQUIRED" && row.last_error_code === copy.code) return;

  const now = new Date().toISOString();
  await admin
    .from("integrations")
    .update({
      status: "ACTION_REQUIRED",
      last_error_at: now,
      last_error_code: copy.code,
      last_error_message: copy.message,
    })
    .eq("id", integrationId);

  try {
    await enqueue(
      "notification.send",
      {
        businessId: row.business_id,
        type: "integration_failure",
        severity: "error",
        title: `Reconnect ${row.provider_type.replace(/_/g, " ")}`,
        body: copy.message,
        entityType: "integration",
        entityId: integrationId,
        linkUrl: "/app/settings?section=connections",
      },
      {
        businessId: row.business_id,
        idempotencyKey: `notification.send:integration_reconnect:${integrationId}:${copy.code}:${reason}:${now.slice(0, 10)}`,
      },
    );
  } catch (error) {
    // The status flip above is what matters; the banner shows it regardless.
    console.error("[oauth] could not queue the reconnect notification", {
      integrationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
  /** Pass the connection's id so a dead grant flips it to Reconnect. */
  options: { integrationId?: string } = {},
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

  // Zoho answers a dead refresh token with HTTP 200 and `{"error": ...}`, so
  // an error field or a missing access token is a failure whatever the status.
  const oauthError = typeof json.error === "string" ? json.error : null;
  if (!response.ok || oauthError || typeof json.access_token !== "string" || !json.access_token) {
    const failure = new OAuthRefreshError(
      typeof json.error_description === "string"
        ? json.error_description
        : oauthError
          ? `Token refresh failed (${oauthError}).`
          : "Token refresh failed.",
      response.ok ? 400 : response.status,
      oauthError,
    );
    if (options.integrationId && failure.needsReconnect) {
      await markReconnectRequired(options.integrationId, failure.oauthError ?? String(failure.status));
    }
    throw failure;
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
  /** Non-secret provider facts — a Page id, a phone number id. Never a token. */
  config?: Record<string, unknown>;
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
        // Only written when the provider resolved something. An upsert with
        // `config: {}` on a reconnect would erase a Page id that is still
        // perfectly valid, and the send path would start reporting "not
        // connected" for a connection the customer can see is healthy.
        ...(params.config && Object.keys(params.config).length > 0
          ? { config: params.config as never }
          : {}),
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
 * if it expires within `windowMs` (default five minutes). Every path that calls
 * a provider goes through this rather than reading `access_token` directly, so
 * a refresh failure is caught in one place and surfaces as ACTION_REQUIRED.
 *
 * The rule itself (compare-and-swap on the refresh token, refresh-token
 * rotation, and reconnect only on a refused grant that nobody else has
 * replaced) is `liveAccessToken` in token-refresh-core.ts.
 */
export async function getLiveAccessToken(
  integrationId: string,
  config: OAuthConfig,
  options: LiveTokenOptions = {},
): Promise<string> {
  const result = await liveAccessToken(tokenRefreshPorts(config), integrationId, options);
  return result.accessToken;
}

/**
 * Marks a connection flagged "Reconnect" healthy again after the provider
 * accepted a refresh (the sweep's recovery pass). Only a reconnect flag is
 * cleared; a scope or configuration problem stays until it is fixed.
 */
export async function clearReconnectFlag(integrationId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .update({ status: "HEALTHY", last_error_at: null, last_error_code: null, last_error_message: null })
    .eq("id", integrationId)
    .eq("status", "ACTION_REQUIRED")
    .eq("last_error_code", RECONNECT_REQUIRED.code)
    .select("id");
  return (data ?? []).length > 0;
}

/** The Supabase and provider wiring of `liveAccessToken`. */
export function tokenRefreshPorts(config: OAuthConfig): TokenRefreshPorts {
  const admin = createAdminClient();
  return {
    now: () => Date.now(),
    async read(integrationId) {
      const { data } = await admin
        .from("integration_secrets")
        .select("access_token, refresh_token, token_expires_at")
        .eq("integration_id", integrationId)
        .maybeSingle();
      return (data as StoredSecret | null) ?? null;
    },
    // No integrationId here: the core decides whether a refused grant really
    // means "reconnect" (it may be a rotation race another worker won).
    refresh: (refreshToken) => refreshAccessToken(config, refreshToken),
    classify: (error) =>
      error instanceof OAuthRefreshError
        ? { needsReconnect: error.needsReconnect, oauthError: error.oauthError, status: error.status }
        : null,
    async swap(integrationId, expectedRefreshToken, next) {
      const { data, error } = await admin
        .from("integration_secrets")
        .update(next)
        .eq("integration_id", integrationId)
        .eq("refresh_token", expectedRefreshToken)
        .select("integration_id");
      if (error) throw new Error(`Could not store the refreshed token: ${error.message}`);
      return (data ?? []).length > 0;
    },
    markReconnect: (integrationId, reason) => markReconnectRequired(integrationId, reason),
  };
}
