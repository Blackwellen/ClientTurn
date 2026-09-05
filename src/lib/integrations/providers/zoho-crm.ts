import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getLiveAccessToken,
  refreshAccessToken,
  type OAuthConfig,
  type TokenResponse,
} from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerCrmProvider, type CrmLeadInput } from "@/lib/integrations/providers/crm-registry";

/**
 * Zoho CRM — CRM push destination via OAuth2 (Leads API).
 *
 * Docs consulted live while building this:
 * - OAuth overview: https://www.zoho.com/crm/developer/docs/api/v2/oauth-overview.html
 *   (authorize: https://accounts.zoho.com/oauth/v2/auth, token:
 *   https://accounts.zoho.com/oauth/v2/token, `access_type=offline` +
 *   `prompt=consent` needed to receive a refresh token on every grant.)
 * - Multi-DC: https://www.zoho.com/crm/developer/docs/api/v6/multi-dc.html
 *   Zoho runs several regional data centers (zohoapis.com/.eu/.in/.com.au/.jp/
 *   .com.cn/.ca) with matching accounts servers. A client (client_id/secret) is
 *   registered in exactly one DC's API console and can only authorize accounts
 *   in that same DC — there is no cross-DC token issuance. This platform
 *   registers one Zoho app (in the `.com` DC, matching `accounts.zoho.com`
 *   below), so only customers whose Zoho org is also on the `.com` DC can
 *   complete this connection; others see the token exchange fail.
 * - Scopes: https://www.zoho.com/crm/developer/docs/api/v6/scopes.html
 *   (`ZohoCRM.modules.leads.CREATE` to create Leads; also request
 *   `ZohoCRM.modules.leads.READ` so we can look a lead back up to update it.)
 * - Create Lead: `POST {api_domain}/crm/v2/Leads`, body `{ "data": [...] }`,
 *   header `Authorization: Zoho-oauthtoken <access_token>`.
 *
 * THE REGIONAL API-DOMAIN QUIRK: the token/refresh response carries an
 * `api_domain` field (e.g. `https://www.zohoapis.com`) that is the only
 * authoritative source for which regional host to call — it must not be
 * guessed from the accounts URL. `identify()` runs immediately after the
 * token exchange but *before* the `integrations` row exists (the generic
 * OAuth callback calls `identify` first, then `storeConnection`), so there is
 * nowhere to persist `api_domain` at that point. Rather than change the
 * shared callback/storeConnection plumbing for one provider, `push()` derives
 * it lazily: the first push for an integration forces one refresh-token
 * exchange (which returns `api_domain` again) purely to read that field, then
 * caches it in `integration_secrets.extra.api_domain` so every later push
 * reads it straight from the database.
 */

const SCOPE = "ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.READ";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.com";

function config(): OAuthConfig | null {
  const { clientId, clientSecret } = serverEnv.zohoCrm;
  if (!clientId || !clientSecret) return null;

  return {
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    clientId,
    clientSecret,
    scope: SCOPE,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  };
}

type ZohoOrgResponse = { org?: Array<{ id?: string; company_name?: string }> };

async function identify(token: TokenResponse) {
  const apiDomain =
    typeof token.raw.api_domain === "string" && token.raw.api_domain
      ? token.raw.api_domain
      : DEFAULT_API_DOMAIN;

  const response = await fetch(`${apiDomain}/crm/v2/org`, {
    headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}` },
  }).catch(() => null);

  let externalAccountId: string | null = null;
  let displayName: string | null = null;

  if (response?.ok) {
    const json = (await response.json().catch(() => ({}))) as ZohoOrgResponse;
    const org = json.org?.[0];
    externalAccountId = org?.id ?? null;
    displayName = org?.company_name ?? null;
  }

  return {
    externalAccountId,
    displayName,
    scopes: SCOPE.split(","),
  };
}

async function ensureLiveApiDomain(
  integrationId: string,
  oauthConfig: OAuthConfig,
): Promise<{ accessToken: string; apiDomain: string }> {
  const admin = createAdminClient();
  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token, refresh_token, extra")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!secret?.access_token) {
    throw new Error("No stored Zoho CRM credential for this integration.");
  }

  const extra = (secret.extra ?? {}) as Record<string, unknown>;
  const cachedDomain = extra.api_domain;

  if (typeof cachedDomain === "string" && cachedDomain) {
    const accessToken = await getLiveAccessToken(integrationId, oauthConfig);
    return { accessToken, apiDomain: cachedDomain };
  }

  if (!secret.refresh_token) {
    throw new Error("Zoho CRM connection is missing a refresh token; reconnect Zoho CRM.");
  }

  // One-time cost per integration: refresh purely to learn `api_domain`, then
  // persist it so every subsequent push reads it straight from the row.
  const refreshed = await refreshAccessToken(oauthConfig, secret.refresh_token);
  const apiDomain =
    typeof refreshed.raw.api_domain === "string" && refreshed.raw.api_domain
      ? refreshed.raw.api_domain
      : DEFAULT_API_DOMAIN;

  await admin
    .from("integration_secrets")
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      token_expires_at: refreshed.expiresInSeconds
        ? new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString()
        : null,
      extra: { ...extra, api_domain: apiDomain },
    })
    .eq("integration_id", integrationId);

  return { accessToken: refreshed.accessToken, apiDomain };
}

function leadFields(lead: CrmLeadInput): Record<string, string> {
  const fields: Record<string, string> = {
    Last_Name: lead.last_name || lead.first_name || "Unknown",
    Company: "Client Turn lead",
    Lead_Source: "Client Turn",
  };
  if (lead.first_name) fields.First_Name = lead.first_name;
  if (lead.email) fields.Email = lead.email;
  if (lead.phone) fields.Phone = lead.phone;
  if (lead.postcode) fields.Zip_Code = lead.postcode;
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
    throw new Error("Zoho CRM is not configured on this platform.");
  }

  const { accessToken, apiDomain } = await ensureLiveApiDomain(params.integrationId, oauthConfig);

  const admin = createAdminClient();
  const { data: existingRecord } = await admin
    .from("crm_push_records")
    .select("external_contact_id")
    .eq("business_id", params.lead.business_id)
    .eq("lead_id", params.lead.id)
    .eq("provider_type", "zoho_crm")
    .maybeSingle();

  const fields = leadFields(params.lead);
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "content-type": "application/json",
  };

  if (existingRecord?.external_contact_id) {
    const updateResponse = await fetch(
      `${apiDomain}/crm/v2/Leads/${existingRecord.external_contact_id}`,
      { method: "PUT", headers, body: JSON.stringify({ data: [fields] }) },
    );
    if (updateResponse.ok) {
      return { externalContactId: existingRecord.external_contact_id };
    }
    // The previously recorded Lead may have been deleted or converted in
    // Zoho; fall through and create a new one rather than failing the push.
  }

  const createResponse = await fetch(`${apiDomain}/crm/v2/Leads`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: [fields] }),
  });

  const json = (await createResponse.json().catch(() => ({}))) as {
    data?: Array<{ code?: string; details?: { id?: string }; message?: string }>;
  };

  if (!createResponse.ok) {
    throw new Error(
      `Zoho CRM rejected the lead (status ${createResponse.status}): ${JSON.stringify(json)}`,
    );
  }

  const result = json.data?.[0];
  const leadId = result?.details?.id;
  if (!leadId || result?.code !== "SUCCESS") {
    throw new Error(`Zoho CRM did not confirm the lead was created: ${JSON.stringify(json)}`);
  }

  return { externalContactId: leadId };
}

registerOAuthProvider("zoho_crm", { getConfig: config, identify });
registerCrmProvider("zoho_crm", { push });
