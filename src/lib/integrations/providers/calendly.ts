import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveAccessToken, type OAuthConfig, type TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { CALENDLY_SCOPES } from "@/lib/integrations/oauth-health";

/**
 * Calendly — booking-source integration via OAuth2. Sends the customer's
 * Calendly link to qualified leads (elsewhere) and, here, turns an
 * `invitee.created` / `invitee.canceled` webhook into a row in `bookings` via
 * the existing provider-agnostic `booking.sync` job
 * (`src/lib/jobs/handlers/booking-sync.ts`).
 *
 * Docs consulted while building this (developer.calendly.com/api-docs), and
 * confirmed live against a real Calendly OAuth app created 2026-09-13:
 * - OAuth: authorize at `https://auth.calendly.com/oauth/authorize`, token at
 *   `https://auth.calendly.com/oauth/token`, standard authorization-code
 *   grant. UPDATED 2026-09-30: Calendly now has scoped permissions
 *   (developer.calendly.com/docs/authentication/scopes). The authorize URL
 *   takes a space-separated `scope`; we request CALENDLY_SCOPES
 *   (oauth-health.ts), one per endpoint called. A pre-scopes token is
 *   migrated to the app's console-configured scopes on its next refresh, so
 *   the app in Calendly's developer console must list the same scopes.
 * - Identify: `GET /users/me` returns `{ resource: { uri, name,
 *   current_organization, ... } }`. `current_organization` is the
 *   organization URI needed to scope the webhook subscription below.
 * - Webhook subscriptions: `POST /webhook_subscriptions` with
 *   `{ url, events, organization, scope: "organization" }`, bearer-authed
 *   with the connecting user's own access token. CORRECTED after live
 *   verification against developer.calendly.com/api-docs/overview/webhooks/webhook-signatures:
 *   Calendly does NOT return a signing key on this response for an OAuth 2.0
 *   app. Instead "a webhook signing key will automatically be generated for
 *   all webhooks related to your application" at OAuth-app-creation time —
 *   one key for the whole app, shown once in the developer console, shared by
 *   every workspace's subscriptions. (The per-subscription caller-supplied
 *   signing key documented elsewhere applies only to personal-access-token
 *   auth, which this integration does not use.) So verification uses the one
 *   platform-wide `CALENDLY_WEBHOOK_SIGNING_KEY`, the same shape as
 *   `TWILIO_AUTH_TOKEN` — not a per-integration secret.
 * - Deleting a subscription: `DELETE /webhook_subscriptions/{uuid}`.
 *
 * THE INTEGRATION-ID-IN-THE-URL DESIGN: the generic OAuth callback
 * (`src/app/api/integrations/[provider]/callback/route.ts`) calls
 * `adapter.identify(token)` *before* the `integrations` row exists, so
 * `identify()` has no integration id to build a per-workspace webhook URL
 * from. Rather than have this one provider reach into the shared
 * state/storeConnection plumbing to thread a business id through earlier
 * (the path Zoho's adapter comment explicitly avoided for its own lazy
 * api_domain lookup, for the same reason), the registry now supports an
 * optional `afterConnect` hook that runs immediately after the row is
 * created — see `providers/registry.ts`. The webhook URL carries the new
 * `integrationId` as a query param (`?iid=…`); the inbound route still
 * verifies the signature with that integration's own stored key before
 * trusting the param for anything, per this provider's own webhook route.
 */

const AUTH_URL = "https://auth.calendly.com/oauth/authorize";
const TOKEN_URL = "https://auth.calendly.com/oauth/token";
const API_ROOT = "https://api.calendly.com";

/** Calendly's OAuth client, for the refresh-aware token accessor (getLiveAccessToken). */
export function calendlyOAuthConfig(): OAuthConfig | null {
  return config();
}

function config(): OAuthConfig | null {
  const { clientId, clientSecret } = serverEnv.calendly;
  if (!clientId || !clientSecret) return null;

  return {
    authorizeUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    // Exactly the scopes the endpoints we call need (oauth-health.ts
    // CALENDLY_SCOPES). Calendly added scoped permissions after this was
    // first built with scope ""; a token refreshed since then carries only
    // the app's configured scopes, which lacked event_types:read (2026-09-30).
    scope: CALENDLY_SCOPES.join(" "),
  };
}

type CalendlyUserResponse = {
  resource?: {
    uri?: string;
    name?: string;
    current_organization?: string;
  };
};

async function identify(token: TokenResponse) {
  const response = await fetch(`${API_ROOT}/users/me`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  }).catch(() => null);

  if (!response?.ok) {
    throw new Error("Could not verify the Calendly account after connecting.");
  }

  const json = (await response.json().catch(() => ({}))) as CalendlyUserResponse;
  const user = json.resource ?? {};
  const organizationUri = user.current_organization ?? null;

  if (!organizationUri) {
    throw new Error(
      "Calendly did not return an organization for this account, so a webhook subscription cannot be scoped.",
    );
  }

  return {
    externalAccountId: user.uri ?? null,
    displayName: user.name ?? null,
    scopes: [] as string[],
    // Non-secret: needed later to look a re-delivered webhook's payload back
    // to a workspace defensively, and by `afterConnect` below.
    config: { organizationUri },
  };
}

type WebhookSubscriptionResponse = {
  resource?: { uri?: string };
  uri?: string;
};

function webhookCallbackUrl(integrationId: string): string {
  return `${serverEnv.siteUrl}/api/webhooks/calendly?iid=${integrationId}`;
}

/**
 * Registers the organization-scoped webhook subscription and stores the
 * signing key Calendly mints for it. Runs once, right after the integration
 * row is created (see registry.ts). Throwing here fails the whole connect
 * attempt — a connection that "succeeded" but never registered a webhook
 * would silently never record a single booking.
 */
async function afterConnect(params: {
  integrationId: string;
  businessId: string;
  token: TokenResponse;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("id", params.integrationId)
    .maybeSingle();

  const organizationUri = (integration?.config as Record<string, unknown> | null)
    ?.organizationUri;
  if (typeof organizationUri !== "string" || !organizationUri) {
    throw new Error(
      "Missing Calendly organization on the new connection; cannot register a webhook subscription.",
    );
  }

  const response = await fetch(`${API_ROOT}/webhook_subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: webhookCallbackUrl(params.integrationId),
      events: ["invitee.created", "invitee.canceled"],
      organization: organizationUri,
      scope: "organization",
    }),
  });

  const json = (await response.json().catch(() => ({}))) as WebhookSubscriptionResponse;

  if (!response.ok) {
    throw new Error(
      `Calendly rejected the webhook subscription (status ${response.status}): ${JSON.stringify(json)}`,
    );
  }

  // See header comment: `resource` is the documented single-object wrapper;
  // a flat body is tolerated defensively in case this endpoint differs. There
  // is no signing key on this response for an OAuth app -- see header comment
  // -- only the subscription's own uri, kept so disconnect can delete it.
  const resource = json.resource ?? json;
  const subscriptionUri = resource.uri ?? null;

  if (!subscriptionUri) {
    throw new Error("Calendly did not return a webhook subscription id.");
  }

  const { error } = await admin
    .from("integration_secrets")
    .update({ extra: { webhook_subscription_uri: subscriptionUri } })
    .eq("integration_id", params.integrationId);

  if (error) throw error;
}

/**
 * Best-effort: deletes the Calendly-side webhook subscription before the
 * generic disconnect flow (`src/lib/settings/actions.ts`) clears
 * `integration_secrets`. Never blocks disconnect — a revoke failure is logged
 * and swallowed by the caller, because the customer's ability to disconnect a
 * provider from their own workspace must never depend on a third-party API
 * being reachable.
 */
export async function revokeCalendlyWebhook(integrationId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("extra")
    .eq("integration_id", integrationId)
    .maybeSingle();

  const extra = (secret?.extra ?? {}) as Record<string, unknown>;
  const subscriptionUri = extra.webhook_subscription_uri;
  if (typeof subscriptionUri !== "string" || !subscriptionUri) return;

  const oauthConfig = config();
  if (!oauthConfig) return;

  const accessToken = await getLiveAccessToken(integrationId, oauthConfig);

  await fetch(subscriptionUri, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

registerOAuthProvider("calendly", { getConfig: config, identify, afterConnect });
