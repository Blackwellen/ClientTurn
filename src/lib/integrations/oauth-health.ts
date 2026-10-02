/**
 * OAuth refresh failures and cheap authenticated health pings (gap audit 15,
 * top-10 #9).
 *
 * Before this, "HEALTHY" for most connections meant "a token row exists", and
 * a revoked refresh token threw on every sync without ever changing the
 * connection's status. The Reconnect card already existed; nothing set the
 * state that shows it.
 *
 * Pure: no server-only import, so tests import it directly.
 */

/** Thrown by `refreshAccessToken` so callers can tell a revoked grant from a blip. */
export class OAuthRefreshError extends Error {
  readonly status: number;
  readonly oauthError: string | null;
  readonly needsReconnect: boolean;

  constructor(message: string, status: number, oauthError: string | null) {
    super(message);
    this.name = "OAuthRefreshError";
    this.status = status;
    this.oauthError = oauthError;
    this.needsReconnect = refreshNeedsReconnect(status, oauthError);
  }
}

/**
 * RFC 6749 §5.2: `invalid_grant` means the refresh token is revoked, expired
 * or was issued to another client; `invalid_client` / `unauthorized_client`
 * mean our app can no longer use it. None of these heal by retrying: a person
 * has to reconnect. A 5xx or a network failure is a blip.
 */
export function refreshNeedsReconnect(status: number, oauthError: string | null): boolean {
  const code = (oauthError ?? "").toLowerCase();
  if (
    code === "invalid_grant" ||
    code === "invalid_client" ||
    code === "unauthorized_client" ||
    code === "invalid_scope" ||
    code === "access_denied" ||
    code === "invalid_code"
  ) {
    return true;
  }
  // No error code but the token endpoint refused us outright.
  return status === 400 || status === 401 || status === 403;
}

/** The status, code and copy written to `integrations` on a dead grant. */
export const RECONNECT_REQUIRED = {
  status: "ACTION_REQUIRED" as const,
  code: "reconnect_required",
  message: "The provider no longer accepts this connection (access was revoked or expired). Reconnect it to resume syncing.",
};

export const SCOPE_OUTDATED = {
  status: "ACTION_REQUIRED" as const,
  code: "scope_outdated",
  message: "This connection was made before ClientTurn needed permission to update existing records. Reconnect it to grant the new permission; until then updates are refused rather than duplicated.",
};

/** Zoho: the scope every connection must hold since the UPDATE-scope fix. */
export const ZOHO_REQUIRED_SCOPE = "ZohoCRM.modules.leads.UPDATE";

/** A Zoho connection made before the fix stored scopes without UPDATE. */
export function zohoScopeOutdated(scopes: readonly string[] | null | undefined): boolean {
  if (!scopes || scopes.length === 0) return true;
  return !scopes.some((s) => s.trim() === ZOHO_REQUIRED_SCOPE);
}

/* ------------------------------------------------------------ calendly --- */

/**
 * The Calendly scopes ClientTurn asks for, one per endpoint it calls
 * (developer.calendly.com/docs/authentication/scopes, read 2026-09-30):
 *   users:read             GET /users/me (connect, health ping)
 *   event_types:read       GET /event_types, GET /event_type_available_times (availability)
 *   scheduled_events:read  the invitee.created / invitee.canceled webhook payloads
 *   webhooks:write         POST and DELETE /webhook_subscriptions (includes webhooks:read)
 * Calendly migrates a pre-scopes token to the app's configured scopes on its
 * next refresh, so the app must also have these switched on in Calendly's
 * developer console, or the grant stays narrower than this list.
 */
export const CALENDLY_SCOPES = ["users:read", "event_types:read", "scheduled_events:read", "webhooks:write"] as const;

export const CALENDLY_SCOPE_MISSING = {
  status: "ACTION_REQUIRED" as const,
  code: "scope_missing",
  message: "Reconnect Calendly to grant access: ClientTurn needs permission to read your event types and availability to offer real times.",
};

/**
 * Calendly's answer when a token lacks a scope: HTTP 403 with
 * `{ title: "Insufficient scope", required_scopes: [...] }`. A plain 403
 * without that shape is left to the generic rules.
 */
export function isInsufficientScope(status: number, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== "object") return false;
  const b = body as { title?: unknown; required_scopes?: unknown; message?: unknown };
  return (typeof b.title === "string" && /insufficient scope/i.test(b.title)) || Array.isArray(b.required_scopes);
}

/* ------------------------------------------------------------- pings --- */

export type PingSpec = { url: string; headers: Record<string, string> };

/**
 * One cheap authenticated GET per provider, chosen so it needs no scope
 * beyond what the connection already requests. Null = no safe cheap call
 * exists (the check falls back to token presence and says so).
 *
 * - Google Calendar: calendarList with maxResults=1 (calendar scope).
 * - Calendly: /users/me (any token).
 * - HubSpot: contacts?limit=1 (the contacts scope push needs anyway).
 * - Zoho: Leads?per_page=1 on the stored api_domain (leads.READ).
 * - Salesforce: /limits on the stored instance (api scope).
 * - Meta: /me?fields=id.
 * Google Ads, TikTok, LinkedIn Ads and WhatsApp Cloud need developer tokens
 * or account ids for any call, so they stay token-presence checks.
 */
export function pingSpec(
  provider: string,
  accessToken: string,
  context: { apiDomain?: string | null; instanceUrl?: string | null; calendlyOrganizationUri?: string | null } = {},
): PingSpec | null {
  const bearer = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
  switch (provider) {
    case "google_calendar":
      return {
        url: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
        headers: bearer,
      };
    case "calendly":
      // The event types of the connected organisation: proves the token AND
      // the event_types:read scope availability needs (/users/me passed on a
      // token that could not read availability, so the card said Healthy).
      if (context.calendlyOrganizationUri && /^https:\/\/api\.calendly\.com\/organizations\/[A-Za-z0-9-]+$/.test(context.calendlyOrganizationUri)) {
        return {
          url: `https://api.calendly.com/event_types?organization=${encodeURIComponent(context.calendlyOrganizationUri)}&count=1`,
          headers: bearer,
        };
      }
      return { url: "https://api.calendly.com/users/me", headers: bearer };
    case "hubspot":
      return { url: "https://api.hubapi.com/crm/v3/objects/contacts?limit=1", headers: bearer };
    case "zoho_crm":
      if (!context.apiDomain || !/^https:\/\/[a-z0-9.-]+$/i.test(context.apiDomain)) return null;
      return {
        url: `${context.apiDomain}/crm/v2/Leads?per_page=1`,
        headers: { authorization: `Zoho-oauthtoken ${accessToken}`, accept: "application/json" },
      };
    case "salesforce":
      if (!context.instanceUrl || !/^https:\/\/[a-z0-9.-]+$/i.test(context.instanceUrl)) return null;
      return { url: `${context.instanceUrl}/services/data/v59.0/limits`, headers: bearer };
    case "meta":
      return { url: "https://graph.facebook.com/v21.0/me?fields=id", headers: bearer };
    default:
      return null;
  }
}

export type PingVerdict = "ok" | "reconnect" | "degraded";

/** 401/403 means the provider no longer accepts the token; 5xx and 429 are blips. */
export function classifyPing(status: number): PingVerdict {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "reconnect";
  return "degraded";
}
