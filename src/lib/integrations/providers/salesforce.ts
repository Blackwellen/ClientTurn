import "server-only";
import { crmCompanyField } from "@/lib/integrations/crm-pull/plan";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  refreshAccessToken,
  type OAuthConfig,
  type TokenResponse,
} from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import {
  CrmPartialPushError,
  registerCrmProvider,
  type CrmEraseResult,
  type CrmLeadInput,
  type CrmNoteInput,
  type CrmOpportunity,
} from "@/lib/integrations/providers/crm-registry";
import {
  salesforceCloseDate,
  salesforceStageName,
  type SalesforceStage,
} from "@/lib/opportunities/stages";
import {
  soqlDateTime,
  type CrmPullPage,
  type CrmPulledRecord,
} from "@/lib/integrations/crm-pull/plan";

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
 * Opportunity push (Phase 3.3, decision Q3): Salesforce Opportunities require a
 * `StageName` from each org's own customised picklist, so nothing is guessed --
 * the org's active `OpportunityStage` rows are read and the value chosen from
 * them (stages.ts `salesforceStageName`: first won stage for WON, first
 * closed-not-won for LOST, positional/label match for open stages). An org
 * with no matching stage fails the Opportunity write only; the Lead is kept.
 * Service context is still folded into the Lead's Description as before.
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
  const { accessToken, refreshToken, instanceUrl } = await getStoredCredential(integrationId);

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
    // Mandatory on the standard Lead object: the lead's own company, or an
    // explicit "Not provided" (never a made-up value) so the create does not
    // fail on a missing required field.
    Company: crmCompanyField(lead.company_name),
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

async function upsertLead(
  integrationId: string,
  oauthConfig: OAuthConfig,
  lead: CrmLeadInput,
  previousId: string | null,
): Promise<string> {
  const fields = leadFields(lead);

  const existingId =
    previousId ??
    (lead.email ? await findLeadIdByEmail(integrationId, oauthConfig, lead.email) : null);

  if (existingId) {
    const updated = await sfFetch(
      integrationId,
      oauthConfig,
      `/services/data/${API_VERSION}/sobjects/Lead/${existingId}`,
      { method: "PATCH", body: fields },
    );
    if (updated.ok) return existingId;
    // The previously recorded Lead may have been deleted or converted in
    // Salesforce since; fall through and create a new one rather than
    // failing the push outright.
  }

  const created = await sfFetch(
    integrationId,
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

  return json.id;
}

/**
 * The org's own active sales stages. StageName is a per-org picklist, so the
 * value is chosen from these (stages.ts `salesforceStageName`), never guessed.
 * `ApiName` is the picklist value StageName accepts; `MasterLabel` is the
 * fallback for an org whose API name is unavailable.
 */
async function loadOpportunityStages(
  integrationId: string,
  oauthConfig: OAuthConfig,
): Promise<SalesforceStage[]> {
  const soql =
    "SELECT ApiName, MasterLabel, IsClosed, IsWon, SortOrder FROM OpportunityStage WHERE IsActive = true";
  const result = await sfFetch(
    integrationId,
    oauthConfig,
    `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { method: "GET" },
  );
  if (!result.ok) {
    throw new Error(`Salesforce refused the stage list (status ${result.status}).`);
  }
  const records =
    (
      result.json as {
        records?: {
          ApiName?: string | null;
          MasterLabel: string;
          IsClosed: boolean;
          IsWon: boolean;
          SortOrder: number | null;
        }[];
      }
    ).records ?? [];
  return records.map((record) => ({
    label: record.ApiName || record.MasterLabel,
    isClosed: record.IsClosed,
    isWon: record.IsWon,
    sortOrder: record.SortOrder ?? 0,
  }));
}

/**
 * Opportunity create/update (decision Q3), replacing the documented gap.
 *
 * A standard Opportunity cannot reference a Lead, so the record is linked by
 * the id ClientTurn keeps (`crm_push_records.external_deal_id`) and says in
 * its Description which lead it came from. Its Name deliberately carries no
 * personal name: the data-rights erase path removes the Lead, and an
 * Opportunity named after the person would outlive it.
 */
async function upsertOpportunity(
  integrationId: string,
  oauthConfig: OAuthConfig,
  lead: CrmLeadInput,
  opportunity: CrmOpportunity,
  salesforceLeadId: string,
  previousId: string | null,
): Promise<string> {
  const stageName = salesforceStageName(
    opportunity.stage,
    opportunity.outcome,
    await loadOpportunityStages(integrationId, oauthConfig),
  );
  if (!stageName) {
    throw new Error("The Salesforce org has no active stage that matches this opportunity.");
  }

  const fields: Record<string, unknown> = {
    Name: `ClientTurn - ${lead.services?.name ?? "opportunity"}`.slice(0, 120),
    StageName: stageName,
    CloseDate: salesforceCloseDate(opportunity),
    LeadSource: "Client Turn",
    Description: [
      `ClientTurn lead ${lead.id} (Salesforce Lead ${salesforceLeadId}).`,
      opportunity.outcome !== "OPEN" && opportunity.outcomeReason
        ? `Closed ${opportunity.outcome.toLowerCase()}: ${opportunity.outcomeReason}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 32_000),
  };
  if (opportunity.value != null) fields.Amount = opportunity.value;

  if (previousId) {
    const updated = await sfFetch(
      integrationId,
      oauthConfig,
      `/services/data/${API_VERSION}/sobjects/Opportunity/${previousId}`,
      { method: "PATCH", body: fields },
    );
    if (updated.ok) return previousId;
  }

  const created = await sfFetch(
    integrationId,
    oauthConfig,
    `/services/data/${API_VERSION}/sobjects/Opportunity`,
    { method: "POST", body: fields },
  );
  const json = created.json as { id?: string; success?: boolean };
  if (!created.ok || !json.success || !json.id) {
    throw new Error(
      `Salesforce rejected the opportunity (status ${created.status}): ${JSON.stringify(json)}`,
    );
  }
  return json.id;
}

async function push(params: {
  integrationId: string;
  lead: CrmLeadInput;
  linkedExternalId?: string | null;
}): Promise<{ externalContactId: string; externalDealId?: string | null }> {
  const oauthConfig = config();
  if (!oauthConfig) {
    throw new Error("Salesforce is not configured on this platform.");
  }

  const admin = createAdminClient();
  const { data: existingRecord } = await admin
    .from("crm_push_records")
    .select("external_contact_id, external_deal_id")
    .eq("business_id", params.lead.business_id)
    .eq("lead_id", params.lead.id)
    .eq("provider_type", "salesforce")
    .maybeSingle();

  const leadId = await upsertLead(
    params.integrationId,
    oauthConfig,
    params.lead,
    // A Lead pulled from Salesforce is updated in place, not re-created.
    existingRecord?.external_contact_id ?? params.linkedExternalId ?? null,
  );

  if (!params.lead.opportunity) return { externalContactId: leadId };

  try {
    const opportunityId = await upsertOpportunity(
      params.integrationId,
      oauthConfig,
      params.lead,
      params.lead.opportunity,
      leadId,
      existingRecord?.external_deal_id ?? null,
    );
    return { externalContactId: leadId, externalDealId: opportunityId };
  } catch (error) {
    // The Lead exists in the org whether or not the Opportunity does; keep its
    // id so the retry updates it instead of creating a duplicate.
    throw new CrmPartialPushError(
      error instanceof Error ? error.message : "The opportunity could not be written.",
      { externalContactId: leadId, externalDealId: existingRecord?.external_deal_id ?? null },
      { cause: error },
    );
  }
}

/**
 * The handoff brief as a Task on the Lead (Phase 3.4). A Task is the one
 * activity every org has with `WhoId` pointing at a Lead; Status is left to
 * the org's default because its picklist is customisable too.
 */
async function pushNote(params: CrmNoteInput): Promise<{ externalNoteId: string }> {
  const oauthConfig = config();
  if (!oauthConfig) throw new Error("Salesforce is not configured on this platform.");
  const created = await sfFetch(
    params.integrationId,
    oauthConfig,
    `/services/data/${API_VERSION}/sobjects/Task`,
    {
      method: "POST",
      body: {
        WhoId: params.externalContactId,
        Subject: "ClientTurn handoff brief",
        Description: params.body.slice(0, 32_000),
        ActivityDate: new Date().toISOString().slice(0, 10),
      },
    },
  );
  const json = created.json as { id?: string };
  if (!created.ok || !json.id) {
    throw new Error(`Salesforce rejected the note (status ${created.status}).`);
  }
  return { externalNoteId: json.id };
}

registerOAuthProvider("salesforce", { getConfig: config, identify });
/**
 * Salesforce's REST delete moves the Lead to the Recycle Bin, from which it is
 * purged after 15 days (or sooner if the org empties it). Reported as that,
 * never as "deleted".
 */
async function erase(params: {
  integrationId: string;
  externalContactId: string;
  externalDealId?: string | null;
}): Promise<CrmEraseResult> {
  const oauthConfig = config();
  if (!oauthConfig) {
    throw new Error("Salesforce is not configured on this platform.");
  }
  const result = await sfFetch(
    params.integrationId,
    oauthConfig,
    `/services/data/${API_VERSION}/sobjects/Lead/${params.externalContactId}`,
    { method: "DELETE" },
  );
  if (result.status !== 404 && !result.ok) {
    throw new Error(`Salesforce refused the delete (status ${result.status}).`);
  }
  const lead =
    result.status === 404
      ? "Salesforce has no Lead with the recorded id."
      : "Lead moved to the Salesforce Recycle Bin, which purges it after 15 days unless restored.";

  // The Opportunity ClientTurn created for this lead (upsertOpportunity). Its
  // Description names the lead it came from, so it goes too. A failure here is
  // reported with the id rather than thrown: the Lead is already gone.
  let deal = "";
  if (params.externalDealId) {
    const opp = await sfFetch(
      params.integrationId,
      oauthConfig,
      `/services/data/${API_VERSION}/sobjects/Opportunity/${params.externalDealId}`,
      { method: "DELETE" },
    ).catch(() => null);
    deal =
      opp && opp.ok
        ? " The Opportunity ClientTurn created was moved to the Recycle Bin too."
        : opp && opp.status === 404
          ? " The Opportunity ClientTurn created no longer exists."
          : ` The Opportunity ClientTurn created (${params.externalDealId}) could not be removed; delete it in Salesforce by hand.`;
  }

  return {
    outcome: result.status === 404 ? "NOT_FOUND" : "RECYCLED",
    detail: `${lead}${deal}`,
  };
}

/**
 * The opt-in inbound sync (brief §29): unconverted Leads modified at or after
 * `since`, oldest first, by SOQL. `Owner.Email` resolves through the
 * polymorphic Owner (a queue owner has no email and maps to nobody). Paging
 * follows `nextRecordsUrl`. The API quota is per org per day, so a 403
 * REQUEST_LIMIT_EXCEEDED (or a 429) stops the run and keeps the cursor.
 */
type SalesforcePullRow = {
  Id: string;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
  Phone?: string | null;
  MobilePhone?: string | null;
  Company?: string | null;
  Title?: string | null;
  PostalCode?: string | null;
  CreatedDate?: string | null;
  LastModifiedDate?: string | null;
  Owner?: { Email?: string | null } | null;
};

async function pull(params: {
  integrationId: string;
  since: string;
  pageToken: string | null;
  pageSize: number;
}): Promise<CrmPullPage> {
  const oauthConfig = config();
  if (!oauthConfig) {
    throw new Error("Salesforce is not configured on this platform.");
  }

  const limit = Math.min(Math.max(params.pageSize, 1), 200);
  const soql =
    "SELECT Id, FirstName, LastName, Email, Phone, MobilePhone, Company, Title, PostalCode, " +
    "CreatedDate, LastModifiedDate, Owner.Email FROM Lead " +
    `WHERE IsConverted = false AND LastModifiedDate >= ${soqlDateTime(params.since)} ` +
    `ORDER BY LastModifiedDate ASC, Id ASC LIMIT ${limit}`;

  // A continuation is Salesforce's own relative URL; only ever one of ours.
  const path =
    params.pageToken && params.pageToken.startsWith(`/services/data/${API_VERSION}/query/`)
      ? params.pageToken
      : `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;

  const result = await sfFetch(params.integrationId, oauthConfig, path, { method: "GET" });

  const limited =
    result.status === 429 ||
    (result.status === 403 && JSON.stringify(result.json).includes("REQUEST_LIMIT_EXCEEDED"));
  if (limited) return { records: [], nextPageToken: null, rateLimited: true };
  if (!result.ok) {
    throw new Error(`Salesforce refused the Lead query (status ${result.status}).`);
  }

  const json = result.json as { records?: SalesforcePullRow[]; nextRecordsUrl?: string | null };
  const records: CrmPulledRecord[] = (json.records ?? []).map((row) => ({
    externalId: row.Id,
    objectType: "lead",
    firstName: row.FirstName ?? null,
    lastName: row.LastName ?? null,
    email: row.Email ?? null,
    phone: row.MobilePhone || row.Phone || null,
    companyName: row.Company ?? null,
    roleTitle: row.Title ?? null,
    postcode: row.PostalCode ?? null,
    createdAt: row.CreatedDate ?? null,
    modifiedAt: row.LastModifiedDate ?? "",
    ownerEmail: row.Owner?.Email ?? null,
  }));

  return { records, nextPageToken: json.nextRecordsUrl ?? null };
}

registerCrmProvider("salesforce", { push, erase, pushNote, pull });
