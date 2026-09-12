import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  refreshAccessToken,
  type OAuthConfig,
  type TokenResponse,
} from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerCrmProvider, type CrmLeadInput } from "@/lib/integrations/providers/crm-registry";

/**
 * Salesforce — CRM push destination via OAuth2 (Lead object, REST API).
 *
 * Based on Salesforce's long-standing, versioned public REST API contract
 * (OAuth 2.0 web server flow, `sobjects`/SOQL `query` endpoints under
 * `/services/data/vNN.0/`). Pinned to API version 59.0 (Winter '24) — a
 * version this old is guaranteed to remain live under Salesforce's API
 * deprecation policy (minimum multi-year support window per version), so a
 * customer's org will not suddenly reject calls after a Salesforce release.
 *
 * KNOWN LIMITATION — single login host: the authorize/token endpoints are
 * hardcoded to `login.salesforce.com`, which resolves production and
 * Developer Edition orgs correctly but does **not** resolve Sandbox orgs
 * (those live under `test.salesforce.com`). This mirrors the same class of
 * constraint Zoho CRM has here (single regional data-center) — supporting
 * sandboxes would need a second registered Connected App and a picker in the
 * connect UI, deferred until a customer actually needs it.
 *
 * KNOWN LIMITATION — no Opportunity push: unlike HubSpot's Deal object,
 * Salesforce Opportunities require a `StageName` value drawn from each org's
 * own customized sales-stage picklist. There is no value we could guess that
 * is safe across every customer's org — an unrecognized StageName fails the
 * whole create. Deal-equivalent context (service, average value) is folded
 * into the Lead's Description field instead, the same choice already made
 * for Zoho CRM here for the same reason.
 *
 * Salesforce access tokens carry no fixed `expires_in` in the token response
 * (session lifetime is governed by the org's session-timeout policy, not a
 * token TTL), so `getLiveAccessToken`'s proactive refresh never fires for
 * this provider. Instead `pushWithRefresh` below refreshes reactively: it
 * retries exactly once after a 401, which is what Salesforce returns for an
 * expired/invalidated session (`INVALID_SESSION_ID`).
 */

const API_VERSION = "v59.0";
const AUTHORIZE_URL = "https://login.salesforce.com/services/oauth2/authorize";
const TOKEN_URL = "https://login.salesforce.com/services/oauth2/token";
// `refresh_token` in the scope list is what makes Salesforce issue a refresh
// token on the initial grant; `api` is the REST-access scope Lead push needs.
const SCOPE = "api refresh_token";

function config(): OAuthConfig | null {
  const { clientId, clientSecret } = serverEnv.salesforce;
  if (!clientId || !clientSecret) return null;

  return {
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    scope: SCOPE,
    // Mandatory on this platform's Connected Apps as of the org tested
    // against (2026-09) — see the shared PKCE support in oauth.ts.
    usePkce: true,
  };
}

type SalesforceIdentity = {
  organization_id?: string;
  username?: string;
  display_name?: string;
};

async function identify(token: TokenResponse) {
  const instanceUrl = typeof token.raw.instance_url === "string" ? token.raw.instance_url : null;
  const identityUrl = typeof token.raw.id === "string" ? token.raw.id : null;

  let organizationId: string | null = null;
  let displayName: string | null = null;

  if (identityUrl) {
    const response = await fetch(identityUrl, {
      headers: { Authorization: `Bearer ${token.accessToken}`, accept: "application/json" },
    }).catch(() => null);

    if (response?.ok) {
      const identity = (await response.json().catch(() => ({}))) as SalesforceIdentity;
      organizationId = identity.organization_id ?? null;
      displayName = identity.display_name || identity.username || null;
    }

    // The identity URL is `.../id/{organizationId}/{userId}` — fall back to
    // parsing it directly if the identity call above failed or the org chose
    // not to expose organization_id (org-level "who can view field" policies
    // can restrict identity payload fields).
    if (!organizationId) {
      const segments = identityUrl.split("/");
      organizationId = segments.length >= 2 ? segments[segments.length - 2] : null;
    }
  }

  return {
    externalAccountId: organizationId,
    displayName: displayName ?? (organizationId ? `Salesforce org ${organizationId}` : null),
    scopes:
      typeof token.raw.scope === "string" ? token.raw.scope.split(" ") : SCOPE.split(" "),
    // Non-secret: every push needs the org's own API host, which Salesforce
    // only ever hands back at token-exchange/refresh time, never guessable
    // from the login host. Stored on `integrations.config`, never the secret
    // table — see the ProviderIdentity.config contract in registry.ts.
    config: instanceUrl ? { instanceUrl } : undefined,
  };
}

async function getStoredCredential(
  integrationId: string,
): Promise<{ accessToken: string; refreshToken: string | null; instanceUrl: string }> {
  const admin = createAdminClient();

  const [{ data: secret }, { data: integration }] = await Promise.all([
    admin
      .from("integration_secrets")
      .select("access_token, refresh_token")
      .eq("integration_id", integrationId)
      .maybeSingle(),
    admin.from("integrations").select("config").eq("id", integrationId).maybeSingle(),
  ]);

  if (!secret?.access_token) {
    throw new Error("No stored Salesforce credential for this integration.");
  }

  const instanceUrl = (integration?.config as Record<string, unknown> | null)?.instanceUrl;
  if (typeof instanceUrl !== "string" || !instanceUrl) {
    throw new Error("Salesforce connection is missing its org URL; reconnect Salesforce.");
  }

  return {
    accessToken: secret.access_token,
    refreshToken: secret.refresh_token,
    instanceUrl,
  };
}

async function persistRefreshedToken(integrationId: string, refreshed: TokenResponse) {
  const admin = createAdminClient();
  await admin
    .from("integration_secrets")
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
    })
    .eq("integration_id", integrationId);
}

/**
 * Calls Salesforce with the stored token; on a 401 (expired/invalidated
 * session — `INVALID_SESSION_ID`) refreshes once and retries once. A second
 * 401 after a fresh token is a real auth failure, not a stale-token race, so
 * it is left to surface as the CRM push failure it is.
 */
async function sfFetch(
  integrationId: string,
  oauthConfig: OAuthConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  let { accessToken, refreshToken, instanceUrl } = await getStoredCredential(integrationId);

  const call = (token: string) =>
    fetch(`${instanceUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let response = await call(accessToken);

  if (response.status === 401) {
    if (!refreshToken) {
      throw new Error("Salesforce session expired and there is no refresh token; reconnect Salesforce.");
    }
    const refreshed = await refreshAccessToken(oauthConfig, refreshToken);
    await persistRefreshedToken(integrationId, refreshed);
    response = await call(refreshed.accessToken);
  }

  // A 204 (No Content, returned by a successful Lead PATCH) has no JSON body.
  const json = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

function soqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findLeadIdByEmail(
  integrationId: string,
  oauthConfig: OAuthConfig,
  email: string,
): Promise<string | null> {
  const soql = `SELECT Id FROM Lead WHERE Email = '${soqlEscape(email)}' AND IsConverted = false LIMIT 1`;
  const result = await sfFetch(
    integrationId,
    oauthConfig,
    `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { method: "GET" },
  );
  if (!result.ok) return null;
  const records = (result.json as { records?: Array<{ Id: string }> }).records;
  return records?.[0]?.Id ?? null;
}

function leadFields(lead: CrmLeadInput): Record<string, string> {
  const fields: Record<string, string> = {
    LastName: lead.last_name || lead.first_name || "Unknown",
    // Mandatory on the standard Lead object. There is no reliable source for
    // a real company name at this point in the funnel (B2B leads name their
    // own company on the qualification form, which this adapter does not
    // currently receive), so a fixed placeholder is used rather than leaving
    // the create call failing on a missing-required-field error for every
    // single lead.
    Company: "Client Turn lead",
    LeadSource: "Client Turn",
  };
  if (lead.first_name) fields.FirstName = lead.first_name;
  if (lead.email) fields.Email = lead.email;
  if (lead.phone) fields.Phone = lead.phone;
  if (lead.postcode) fields.PostalCode = lead.postcode;
  if (lead.services?.average_value != null) {
    fields.Description = `Service: ${lead.services.name} (avg. value ${lead.services.average_value})`;
  }
  return fields;
}

async function push(params: {
  integrationId: string;
  lead: CrmLeadInput;
}): Promise<{ externalContactId: string; externalDealId?: string | null }> {
  const oauthConfig = config();
  if (!oauthConfig) {
    throw new Error("Salesforce is not configured on this platform.");
  }

  const admin = createAdminClient();
  const { data: existingRecord } = await admin
    .from("crm_push_records")
    .select("external_contact_id")
    .eq("business_id", params.lead.business_id)
    .eq("lead_id", params.lead.id)
    .eq("provider_type", "salesforce")
    .maybeSingle();

  const fields = leadFields(params.lead);

  const existingId =
    existingRecord?.external_contact_id ??
    (params.lead.email
      ? await findLeadIdByEmail(params.integrationId, oauthConfig, params.lead.email)
      : null);

  if (existingId) {
    const updated = await sfFetch(
      params.integrationId,
      oauthConfig,
      `/services/data/${API_VERSION}/sobjects/Lead/${existingId}`,
      { method: "PATCH", body: fields },
    );
    if (updated.ok) return { externalContactId: existingId };
    // The previously recorded Lead may have been deleted or converted in
    // Salesforce since; fall through and create a new one rather than
    // failing the push outright.
  }

  const created = await sfFetch(
    params.integrationId,
    oauthConfig,
    `/services/data/${API_VERSION}/sobjects/Lead`,
    { method: "POST", body: fields },
  );

  const json = created.json as { id?: string; success?: boolean; errors?: unknown };

  if (!created.ok || !json.success || !json.id) {
    throw new Error(
      `Salesforce rejected the lead (status ${created.status}): ${JSON.stringify(json)}`,
    );
  }

  return { externalContactId: json.id };
}

registerOAuthProvider("salesforce", { getConfig: config, identify });
registerCrmProvider("salesforce", { push });
