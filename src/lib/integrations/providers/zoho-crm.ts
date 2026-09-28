import "server-only";
import { crmCompanyField, existingCrmRecordId } from "@/lib/integrations/crm-pull/plan";
import { serverEnv } from "@/lib/env";
import { SCOPE_OUTDATED } from "@/lib/integrations/oauth-health";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getLiveAccessToken,
  markReconnectRequired,
  refreshAccessToken,
  type OAuthConfig,
  type TokenResponse,
} from "@/lib/integrations/oauth";
import {
  registerOAuthProvider,
  type OAuthCallbackHint,
} from "@/lib/integrations/providers/registry";
import {
  registerCrmProvider,
  type CrmEraseResult,
  type CrmLeadInput,
} from "@/lib/integrations/providers/crm-registry";
import type { CrmPullPage, CrmPulledRecord } from "@/lib/integrations/crm-pull/plan";

/**
 * Zoho CRM — CRM push destination via OAuth2 (Leads API).
 *
 * Docs consulted live while building this:
 * - OAuth overview: https://www.zoho.com/crm/developer/docs/api/v2/oauth-overview.html
 *   (authorize: https://accounts.zoho.com/oauth/v2/auth, `access_type=offline`
 *   + `prompt=consent` needed to receive a refresh token on every grant.)
 * - Multi-DC: https://www.zoho.com/crm/developer/docs/api/v6/multi-dc.html
 *   Zoho runs several regional data centers — as of the current API Console
 *   (verified live): US (default), EU, UK (its own DC, distinct from EU),
 *   AU, IN, JP, CN, CA and SA (Saudi Arabia), plus UAE and Singapore. Each
 *   has its own accounts server. The client_id stays the same across every
 *   DC once Multi DC is enabled on the API Console client. Zoho's console
 *   offers two ways to handle the client_secret across DCs: a per-DC secret
 *   (each DC issues its own), or a single "use the same OAuth credentials
 *   for all data centers" toggle that makes one client_secret valid on every
 *   enabled DC. This code supports both: `secretForLocation` returns a
 *   DC-specific `ZOHO_CLIENT_SECRET_<DC>` when one is configured, and falls
 *   back to the base `ZOHO_CLIENT_SECRET` otherwise — which is exactly right
 *   for shared-credential clients, and also means a DC code this platform
 *   doesn't have a dedicated env var for (or one Zoho adds later) still
 *   works as long as the shared-secret toggle is on. The authorize request
 *   always starts at the generic `accounts.zoho.com` regardless of where the
 *   user's org actually lives; once they sign in, Zoho appends `location`
 *   (e.g. `eu`, `uk`, `au`) and `accounts-server` (e.g.
 *   `https://accounts.zoho.eu`) to our redirect. The token exchange must
 *   then go to *that* accounts server — sending a token request built for
 *   the wrong accounts-server origin fails even with a valid secret.
 *   `dcConfig` builds the per-request `OAuthConfig` the exchange and every
 *   later refresh must use.
 * - Scopes: https://www.zoho.com/crm/developer/docs/api/v6/scopes.html
 *   (`ZohoCRM.modules.leads.CREATE` to create Leads, `READ` to look one back
 *   up, `UPDATE` to push a later change into the same Lead rather than
 *   creating a duplicate. Confirmed live: without `UPDATE`, Zoho's `PUT`
 *   returns 401 `OAUTH_SCOPE_MISMATCH`, `push()` below treats that as "the
 *   Lead may have been deleted" and falls through to creating a new one —
 *   so a missing `UPDATE` scope silently double-pushed every re-sync.)
 * - Create Lead: `POST {api_domain}/crm/v2/Leads`, body `{ "data": [...] }`,
 *   header `Authorization: Zoho-oauthtoken <access_token>`.
 *
 * THE REGIONAL API-DOMAIN QUIRK: the token/refresh response separately
 * carries an `api_domain` field (e.g. `https://www.zohoapis.eu`) that is the
 * only authoritative source for which host to call for CRM data — it is not
 * the same as `accounts-server` and must not be guessed from it. `identify()`
 * runs immediately after the token exchange but *before* the `integrations`
 * row exists (the generic OAuth callback calls `identify` first, then
 * `storeConnection`), so there is nowhere to persist it at that point.
 * `afterConnect` (which runs right after that row is created) is where both
 * `api_domain` and the resolved accounts-server/location are written to
 * `integration_secrets.extra`, so every later push and refresh reads them
 * straight from the database instead of re-deriving anything.
 */

const SCOPE =
  "ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.UPDATE";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.com";
const DEFAULT_ACCOUNTS_SERVER = "https://accounts.zoho.com";

/** `location` values Zoho may send, mapped to the env var holding that DC's
 *  own client_secret when this platform's Zoho client issues distinct
 *  secrets per DC. Any location with no dedicated override here — "us", an
 *  unlisted code (uk, ae, sg, sa, or a future DC), or one simply not
 *  configured — falls back to the base `ZOHO_CLIENT_SECRET`, which is
 *  correct both for the default DC and for a client using Zoho's "same OAuth
 *  credentials for all data centers" option. */
function secretForLocation(location: string | null): string | undefined {
  const dc = serverEnv.zohoCrm;
  const perDc: Record<string, string | undefined> = {
    eu: dc.clientSecretEu,
    in: dc.clientSecretIn,
    au: dc.clientSecretAu,
    jp: dc.clientSecretJp,
    cn: dc.clientSecretCn,
    ca: dc.clientSecretCa,
  };
  return perDc[(location ?? "").toLowerCase()] || dc.clientSecret;
}

/**
 * Builds the OAuthConfig for one specific data center. `accountsServer` is
 * the full origin Zoho gave us (e.g. `https://accounts.zoho.eu`); `location`
 * picks which secret pairs with it. Both are undefined only for the very
 * first, DC-unaware call (building the initial authorize URL), when the
 * base `.com` config is always correct because that is where every
 * authorization request starts regardless of the user's actual DC.
 */
function dcConfig(accountsServer: string | null, location: string | null): OAuthConfig | null {
  const { clientId } = serverEnv.zohoCrm;
  const clientSecret = secretForLocation(location);
  if (!clientId || !clientSecret) return null;

  const accountsOrigin = accountsServer || DEFAULT_ACCOUNTS_SERVER;

  return {
    authorizeUrl: `${DEFAULT_ACCOUNTS_SERVER}/oauth/v2/auth`,
    tokenUrl: `${accountsOrigin}/oauth/v2/token`,
    clientId,
    clientSecret,
    scope: SCOPE,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  };
}

function config(hint?: OAuthCallbackHint): OAuthConfig | null {
  if (!hint) return dcConfig(null, null);
  return dcConfig(
    hint.searchParams.get("accounts-server"),
    hint.searchParams.get("location"),
  );
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

/**
 * Persists what `afterConnect` learned about which data center this
 * integration lives in, so every later push and token refresh targets the
 * same one. A connection made before this fix existed has none of this in
 * `extra` — `ensureLiveApiDomain` below falls back to the base `.com` config
 * for those, which is exactly the (correct, if limited) behaviour they had
 * before.
 */
async function afterConnect(params: {
  integrationId: string;
  businessId: string;
  token: TokenResponse;
  searchParams: URLSearchParams;
}): Promise<void> {
  const apiDomain =
    typeof params.token.raw.api_domain === "string" && params.token.raw.api_domain
      ? params.token.raw.api_domain
      : DEFAULT_API_DOMAIN;
  const accountsServer = params.searchParams.get("accounts-server") || DEFAULT_ACCOUNTS_SERVER;
  const location = params.searchParams.get("location") || "us";

  const admin = createAdminClient();
  await admin
    .from("integration_secrets")
    .update({ extra: { api_domain: apiDomain, accounts_server: accountsServer, location } })
    .eq("integration_id", params.integrationId);
}

async function ensureLiveApiDomain(
  integrationId: string,
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
  const accountsServer = typeof extra.accounts_server === "string" ? extra.accounts_server : null;
  const location = typeof extra.location === "string" ? extra.location : null;
  const oauthConfig = dcConfig(accountsServer, location);
  if (!oauthConfig) {
    throw new Error(
      "Zoho CRM connection is on a data center this platform is not configured for; reconnect Zoho CRM.",
    );
  }

  const cachedDomain = extra.api_domain;

  if (typeof cachedDomain === "string" && cachedDomain) {
    const accessToken = await getLiveAccessToken(integrationId, oauthConfig);
    return { accessToken, apiDomain: cachedDomain };
  }

  if (!secret.refresh_token) {
    throw new Error("Zoho CRM connection is missing a refresh token; reconnect Zoho CRM.");
  }

  // A connection made before `afterConnect` learned to cache `api_domain`
  // directly: refresh once purely to learn it, then persist so every
  // subsequent push reads it straight from the row.
  const refreshed = await refreshAccessToken(oauthConfig, secret.refresh_token, { integrationId });
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
    // Required on a Zoho Lead: the lead's own company, never a placeholder
    // that reads like data.
    Company: crmCompanyField(lead.company_name),
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

/**
 * A Lead already in Zoho with this email, if any.
 *
 * `GET /crm/v2/Leads/search?email=` answers 204 with no body when nothing
 * matches. A failed search is thrown rather than read as "no match": creating
 * on an unknown answer is exactly how duplicates were made.
 */
async function findLeadByEmail(
  apiDomain: string,
  headers: Record<string, string>,
  email: string,
): Promise<string | null> {
  const url = new URL(`${apiDomain}/crm/v2/Leads/search`);
  url.searchParams.set("email", email);
  const response = await fetch(url.toString(), { headers });
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Zoho CRM refused the duplicate check (status ${response.status}).`);
  }
  const json = (await response.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
  return json.data?.[0]?.id ?? null;
}

async function push(params: {
  integrationId: string;
  lead: CrmLeadInput;
  linkedExternalId?: string | null;
}): Promise<{ externalContactId: string; externalDealId?: string | null }> {
  if (!serverEnv.zohoCrm.clientId) {
    throw new Error("Zoho CRM is not configured on this platform.");
  }

  const { accessToken, apiDomain } = await ensureLiveApiDomain(params.integrationId);

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

  // Our own push record, then the record the lead was pulled from, then --
  // only if neither exists -- a Lead already in Zoho with the same email.
  // Before this a lead imported *from* Zoho was created again on its first
  // push, and any lead whose record id was lost was duplicated.
  const known = existingCrmRecordId({
    recorded: existingRecord?.external_contact_id,
    linked: params.linkedExternalId,
  });
  const target =
    known ??
    (params.lead.email ? await findLeadByEmail(apiDomain, headers, params.lead.email) : null);

  if (target) {
    const updateResponse = await fetch(`${apiDomain}/crm/v2/Leads/${target}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ data: [fields] }),
    });
    if (updateResponse.ok) {
      return { externalContactId: target };
    }
    // A 401 is a scope problem (missing UPDATE), not a deleted record, and
    // creating would duplicate. Only a record that is genuinely gone falls
    // through to create.
    if (updateResponse.status !== 404 && updateResponse.status !== 400) {
      // A 401/403 here is the missing UPDATE scope on a connection made
      // before the scope fix: prompt a reconnect rather than failing quietly
      // on every sync (audit 15 #9).
      if (updateResponse.status === 401 || updateResponse.status === 403) {
        await markReconnectRequired(params.integrationId, String(updateResponse.status), SCOPE_OUTDATED);
      }
      throw new Error(
        `Zoho CRM refused the update of Lead ${target} (status ${updateResponse.status}).`,
      );
    }
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

registerOAuthProvider("zoho_crm", { getConfig: config, identify, afterConnect });
/**
 * Zoho CRM's delete moves the record to its Recycle Bin (kept for 60 days).
 * Reported as that, never as "deleted".
 */
async function erase(params: {
  integrationId: string;
  externalContactId: string;
}): Promise<CrmEraseResult> {
  if (!serverEnv.zohoCrm.clientId) {
    throw new Error("Zoho CRM is not configured on this platform.");
  }
  const { accessToken, apiDomain } = await ensureLiveApiDomain(params.integrationId);
  const response = await fetch(`${apiDomain}/crm/v2/Leads/${params.externalContactId}`, {
    method: "DELETE",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const json = (await response.json().catch(() => ({}))) as {
    data?: Array<{ code?: string }>;
  };
  const code = json.data?.[0]?.code;
  if (response.status === 404 || code === "INVALID_DATA") {
    return { outcome: "NOT_FOUND", detail: "Zoho CRM has no Lead with the recorded id." };
  }
  if (!response.ok || code !== "SUCCESS") {
    throw new Error(`Zoho CRM refused the delete (status ${response.status}).`);
  }
  return {
    outcome: "RECYCLED",
    detail: "Lead moved to the Zoho CRM Recycle Bin, which keeps it for 60 days unless emptied.",
  };
}

/**
 * The opt-in inbound sync (brief §29): Leads modified since `since`, oldest
 * first. `GET /crm/v2/Leads?sort_by=Modified_Time&sort_order=asc` with the
 * `If-Modified-Since` header; 204 means nothing changed. The page token is the
 * next page number. Needs ZohoCRM.modules.leads.READ, which connect already
 * asks for. The Owner lookup carries the owner's email.
 */
type ZohoPullRow = {
  id: string;
  First_Name?: string | null;
  Last_Name?: string | null;
  Email?: string | null;
  Phone?: string | null;
  Mobile?: string | null;
  Company?: string | null;
  Designation?: string | null;
  Zip_Code?: string | null;
  Created_Time?: string | null;
  Modified_Time?: string | null;
  Owner?: { email?: string | null } | null;
};

async function pull(params: {
  integrationId: string;
  since: string;
  pageToken: string | null;
  pageSize: number;
}): Promise<CrmPullPage> {
  if (!serverEnv.zohoCrm.clientId) {
    throw new Error("Zoho CRM is not configured on this platform.");
  }
  const { accessToken, apiDomain } = await ensureLiveApiDomain(params.integrationId);

  const page = Math.max(1, Number.parseInt(params.pageToken ?? "1", 10) || 1);
  const url = new URL(`${apiDomain}/crm/v2/Leads`);
  url.searchParams.set(
    "fields",
    "First_Name,Last_Name,Email,Phone,Mobile,Company,Designation,Zip_Code,Created_Time,Modified_Time,Owner",
  );
  url.searchParams.set("sort_by", "Modified_Time");
  url.searchParams.set("sort_order", "asc");
  url.searchParams.set("per_page", String(Math.min(Math.max(params.pageSize, 1), 200)));
  url.searchParams.set("page", String(page));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      // Zoho wants ISO 8601 with an offset, second precision.
      "If-Modified-Since": new Date(params.since).toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    },
  });

  if (response.status === 204 || response.status === 304) return { records: [], nextPageToken: null };
  if (response.status === 429) return { records: [], nextPageToken: null, rateLimited: true };
  if (!response.ok) {
    throw new Error(`Zoho CRM refused the Leads read (status ${response.status}).`);
  }

  const json = (await response.json().catch(() => ({}))) as {
    data?: ZohoPullRow[];
    info?: { more_records?: boolean };
  };

  const records: CrmPulledRecord[] = (json.data ?? []).map((row) => ({
    externalId: String(row.id),
    objectType: "lead",
    firstName: row.First_Name ?? null,
    lastName: row.Last_Name ?? null,
    email: row.Email ?? null,
    phone: row.Mobile || row.Phone || null,
    companyName: row.Company ?? null,
    roleTitle: row.Designation ?? null,
    postcode: row.Zip_Code ?? null,
    createdAt: row.Created_Time ?? null,
    modifiedAt: row.Modified_Time ?? "",
    ownerEmail: row.Owner?.email ?? null,
  }));

  return { records, nextPageToken: json.info?.more_records ? String(page + 1) : null };
}

registerCrmProvider("zoho_crm", { push, erase, pull });
