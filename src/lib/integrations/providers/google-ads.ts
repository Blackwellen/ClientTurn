import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { getLiveAccessToken, type OAuthConfig, type TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";

/**
 * Google Ads — OAuth connect + Lead Form Extension polling.
 *
 * Docs consulted while building this (fetched live, not from training data):
 * - OAuth endpoints/scope: https://developers.google.com/google-ads/api/docs/oauth/overview
 *   and https://developers.google.com/google-ads/api/docs/oauth/internals
 *   (authorize: https://accounts.google.com/o/oauth2/v2/auth,
 *    token: https://oauth2.googleapis.com/token, scope: https://www.googleapis.com/auth/adwords)
 * - `developer-token` header requirement: https://developers.google.com/google-ads/api/rest/auth
 * - `lead_form_submission_data` resource/fields:
 *   https://developers.google.com/google-ads/api/fields/v21/lead_form_submission_data
 *
 * Google also offers a per-lead-form webhook push
 * (https://developers.google.com/google-ads/webhook/docs/overview,
 * https://developers.google.com/google-ads/webhook/docs/implementation), verified by a
 * `google_key` the advertiser types into the lead-form asset's webhook settings inside the
 * Google Ads UI. That key is set per form, outside this app, with no callback through which our
 * connect flow could provision or learn it, so there is no way to map an inbound `google_key` to
 * one of our per-workspace integrations without an extra manual-pairing UI that is out of scope
 * here. GAQL polling is used instead — this matches the fallback path migration 0016 already
 * built (`lead_source_cursors`) for exactly this situation.
 */

const API_VERSION = "v21"; // Google ships monthly; bump per https://developers.google.com/google-ads/api/docs/release-notes
const API_ROOT = `https://googleads.googleapis.com/${API_VERSION}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

function config(): OAuthConfig | null {
  const { clientId, clientSecret, developerToken } = serverEnv.googleAds;
  if (!clientId || !clientSecret || !developerToken) return null;

  return {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId,
    clientSecret,
    scope: SCOPE,
    // access_type=offline + prompt=consent so Google reliably issues a refresh_token,
    // which it otherwise omits on a repeat consent from the same user.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  };
}

function authHeaders(accessToken: string, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": serverEnv.googleAds.developerToken ?? "",
    "content-type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

async function identify(token: TokenResponse) {
  const response = await fetch(`${API_ROOT}/customers:listAccessibleCustomers`, {
    headers: authHeaders(token.accessToken),
  });

  if (!response.ok) {
    throw new Error(`Could not list accessible Google Ads accounts (status ${response.status}).`);
  }

  const json = (await response.json()) as { resourceNames?: string[] };
  const resourceName = json.resourceNames?.[0] ?? null;
  const customerId = resourceName?.split("/")[1] ?? null;

  return {
    externalAccountId: customerId,
    displayName: customerId ? `Google Ads account ${customerId}` : null,
    scopes: [SCOPE],
  };
}

type LeadFormSubmissionField = { fieldType?: string; fieldValue?: string };

type LeadFormSubmissionData = {
  resourceName?: string;
  assetId?: string | number;
  campaignId?: string | number;
  adGroupId?: string | number;
  creativeId?: string | number;
  submissionDateTime?: string;
  leadFormSubmissionFields?: LeadFormSubmissionField[];
};

function fieldValue(fields: LeadFormSubmissionField[], type: string): string | undefined {
  return fields.find((field) => field.fieldType === type)?.fieldValue;
}

function toGoogleDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function poll({ integrationId, businessId }: { integrationId: string; businessId: string }) {
  const oauthConfig = config();
  if (!oauthConfig) throw new Error("Google Ads is not configured on this environment.");

  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("external_account_id")
    .eq("id", integrationId)
    .maybeSingle();

  const customerId = integration?.external_account_id;
  if (!customerId) throw new Error("This Google Ads connection has no linked customer id.");

  const accessToken = await getLiveAccessToken(integrationId, oauthConfig);

  const { data: cursor } = await admin
    .from("lead_source_cursors")
    .select("cursor_value")
    .eq("integration_id", integrationId)
    .maybeSingle();

  const since = cursor?.cursor_value ?? toGoogleDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // login-customer-id assumes the connected account itself owns the lead forms rather than
  // being accessed only through a manager (MCC) hierarchy — the common case for a single
  // small-business Google Ads account, which is who Client Turn is built for. A manager-managed
  // account may need a different login-customer-id than customerId; that is not resolvable from
  // OAuth identity alone and would need an account-picker UI, which is out of scope here.
  const query = `
    SELECT
      lead_form_submission_data.resource_name,
      lead_form_submission_data.asset_id,
      lead_form_submission_data.campaign_id,
      lead_form_submission_data.ad_group_id,
      lead_form_submission_data.creative_id,
      lead_form_submission_data.submission_date_time,
      lead_form_submission_data.lead_form_submission_fields
    FROM lead_form_submission_data
    WHERE lead_form_submission_data.submission_date_time > '${since}'
    ORDER BY lead_form_submission_data.submission_date_time ASC
  `.trim();

  const response = await fetch(`${API_ROOT}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: authHeaders(accessToken, customerId),
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Ads lead form query failed (status ${response.status}): ${body.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    results?: { leadFormSubmissionData?: LeadFormSubmissionData }[];
  };

  let maxSeen = since;

  for (const result of json.results ?? []) {
    const data = result.leadFormSubmissionData;
    if (!data?.resourceName) continue;

    const fields = data.leadFormSubmissionFields ?? [];
    const fullName = fieldValue(fields, "FULL_NAME");
    const firstName = fieldValue(fields, "FIRST_NAME") ?? fullName?.split(" ")[0] ?? null;
    const lastName =
      fieldValue(fields, "LAST_NAME") ??
      (fullName ? fullName.split(" ").slice(1).join(" ") || null : null);
    const phone = fieldValue(fields, "PHONE_NUMBER") ?? null;
    const email = fieldValue(fields, "EMAIL") ?? null;
    const postcode = fieldValue(fields, "POSTAL_CODE") ?? fieldValue(fields, "ZIP_CODE") ?? null;

    const externalId = `google_ads:${data.resourceName}`;

    const { data: inserted } = await admin
      .from("leads")
      .upsert(
        {
          business_id: businessId,
          external_id: externalId,
          first_name: firstName,
          last_name: lastName,
          phone,
          email,
          postcode,
        },
        { onConflict: "business_id,external_id", ignoreDuplicates: true },
      )
      .select("id");

    const leadId = inserted?.[0]?.id;
    if (leadId) {
      await enqueue(
        "lead.process",
        {
          leadId,
          source: {
            provider: "google_ads",
            formId: data.assetId != null ? String(data.assetId) : undefined,
            campaignId: data.campaignId != null ? String(data.campaignId) : undefined,
            adsetId: data.adGroupId != null ? String(data.adGroupId) : undefined,
            adId: data.creativeId != null ? String(data.creativeId) : undefined,
            sourceName: "Google Ads Lead Form",
          },
        },
        { businessId, idempotencyKey: `lead.process:${externalId}` },
      );
    }

    if (data.submissionDateTime && data.submissionDateTime > maxSeen) {
      maxSeen = data.submissionDateTime;
    }
  }

  await admin.from("lead_source_cursors").upsert(
    {
      integration_id: integrationId,
      business_id: businessId,
      external_object_id: customerId,
      cursor_value: maxSeen,
      last_polled_at: new Date().toISOString(),
    },
    { onConflict: "integration_id" },
  );
}

registerOAuthProvider("google_ads", { getConfig: config, identify });
registerLeadSourcePoller("google_ads", { poll });
