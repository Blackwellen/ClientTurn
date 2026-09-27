import "server-only";
import { submissionIdFromResourceName } from "@/lib/ingest/google-ads-ids";
import { randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveAccessToken, type OAuthConfig, type TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";
import { googleAdsCursorAfter } from "@/lib/integrations/providers/ingest-outcome";
import { ingestLead } from "@/lib/ingest/service";

/**
 * Google Ads — OAuth connect + Lead Form Extension polling.
 *
 * Docs consulted while building this (fetched live, not from training data):
 * - OAuth endpoints/scope: https://developers.google.com/google-ads/api/docs/oauth/overview
 *   and https://developers.google.com/google-ads/api/docs/oauth/internals
 *   (authorize: https://accounts.google.com/o/oauth2/v2/auth,
 *    token: https://oauth2.googleapis.com/token, scope: https://www.googleapis.com/auth/adwords)
 * - `lead_form_submission_data` resource/fields:
 *   https://developers.google.com/google-ads/api/fields/v21/lead_form_submission_data
 * - Developer tokens were sunset by Google on 2026-09-09: API access is now
 *   determined by the Google Cloud project behind the OAuth credentials (its
 *   access level -- Test/Basic/Standard -- set on that project's "Google Ads
 *   API Overview" page in Cloud Console), not by a token string. The
 *   `developer-token` header is still accepted for backward compatibility but
 *   is optional and ignored by Google's servers; Google has stated a future
 *   API version will reject it outright. `GOOGLE_ADS_DEVELOPER_TOKEN` is
 *   therefore no longer a real requirement here -- see `config()` below,
 *   which previously (wrongly, as of this date) refused to configure without
 *   one, permanently blocking the Connect button on every deployment that had
 *   real OAuth credentials but no separate token value.
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

// Google ships a new major version roughly every four months and sunsets the
// previous one about a year after its launch -- v21 (this constant's value
// until 2026-09-13) was sunset 2026-08-05 and had been returning 404 on every
// call since, confirmed live via `integration.reconnect_required` audit rows
// ("Could not list accessible Google Ads accounts (status 404)"). v25 is the
// newest generally-available version as of this date; bump per
// https://developers.google.com/google-ads/api/docs/sunset-dates rather than
// stepping to the next-oldest version, which resets the sunset clock for the
// shortest possible time before this has to be revisited again.
const API_VERSION = "v25";
const API_ROOT = `https://googleads.googleapis.com/${API_VERSION}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

function config(): OAuthConfig | null {
  const { clientId, clientSecret } = serverEnv.googleAds;
  if (!clientId || !clientSecret) return null;

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
    "content-type": "application/json",
  };
  // "Optional and ignored" (see header comment on API_VERSION) turned out to
  // mean omittable, not "blank is fine": sending an empty string produced a
  // 400 from `customers:listAccessibleCustomers` where omitting the header
  // entirely does not. Only send it when there's a real value.
  if (serverEnv.googleAds.developerToken) {
    headers["developer-token"] = serverEnv.googleAds.developerToken;
  }
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

async function identify(token: TokenResponse) {
  const response = await fetch(`${API_ROOT}/customers:listAccessibleCustomers`, {
    headers: authHeaders(token.accessToken),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Could not list accessible Google Ads accounts (status ${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as { resourceNames?: string[] };
  // Every account this sign-in can reach. The first is the default, but an
  // agency or a business with several accounts chooses in Settings rather
  // than being stuck with whichever Google listed first.
  const accessible = (json.resourceNames ?? [])
    .map((name) => name.split("/")[1])
    .filter((id): id is string => Boolean(id));
  const customerId = accessible[0] ?? null;

  return {
    externalAccountId: customerId,
    displayName: customerId ? `Google Ads account ${customerId}` : null,
    scopes: [SCOPE],
    config: { accessibleCustomerIds: accessible },
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

  // B12: the cursor used to advance to the newest submission seen even when a
  // row's insert had failed, so the next `> cursor` query never returned that
  // lead again — lost permanently. Now the first failure stops the walk, the
  // cursor is saved only up to the newest submission strictly before the
  // failed one (see googleAdsCursorAfter), and the error is thrown so the
  // poll job retries.
  const processed: (string | undefined)[] = [];
  let failure: { at: string | null; error: unknown } | null = null;

  for (const result of json.results ?? []) {
    const data = result.leadFormSubmissionData;
    if (!data?.resourceName) {
      processed.push(data?.submissionDateTime);
      continue;
    }

    try {
      await ingestSubmission(businessId, data);
    } catch (error) {
      failure = { at: data.submissionDateTime ?? null, error };
      break;
    }
    processed.push(data.submissionDateTime);
  }

  const cursorValue = googleAdsCursorAfter(
    since,
    processed,
    failure ? failure.at : undefined,
  );

  const { error: cursorError } = await admin.from("lead_source_cursors").upsert(
    {
      integration_id: integrationId,
      business_id: businessId,
      external_object_id: customerId,
      cursor_value: cursorValue,
      last_polled_at: new Date().toISOString(),
    },
    { onConflict: "integration_id" },
  );

  if (failure) throw failure.error;
  if (cursorError) {
    throw new Error(`Google Ads cursor could not be saved: ${cursorError.message}`);
  }
}

/**
 * One submission through the one intake path (design 03 §1). A database
 * failure throws (B12), so the walk above stops and the cursor holds before
 * this submission. A submission already ingested -- by an earlier poll, or by
 * the webhook route -- is a DUPLICATE or a MERGED touch, never a second lead.
 */
async function ingestSubmission(businessId: string, data: LeadFormSubmissionData): Promise<void> {
  const fields = data.leadFormSubmissionFields ?? [];
  const fullName = fieldValue(fields, "FULL_NAME");
  const firstName = fieldValue(fields, "FIRST_NAME") ?? fullName?.split(" ")[0] ?? null;
  const lastName =
    fieldValue(fields, "LAST_NAME") ??
    (fullName ? fullName.split(" ").slice(1).join(" ") || null : null);
  const phone = fieldValue(fields, "PHONE_NUMBER") ?? null;
  const email = fieldValue(fields, "EMAIL") ?? null;
  const postcode = fieldValue(fields, "POSTAL_CODE") ?? fieldValue(fields, "ZIP_CODE") ?? null;

  // The webhook identifies a submission by its bare `lead_id`; the search API
  // by `customers/{cid}/leadFormSubmissionData/{id}`. Recording the trailing id
  // for both means a submission seen by both paths is one touch, not two.
  if (!data.resourceName) return;
  const submissionId = submissionIdFromResourceName(data.resourceName);

  const result = await ingestLead(
    {
      businessId,
      source: {
        type: "AD_FORM",
        provider: "google_ads",
        providerRecordId: submissionId,
        formId: data.assetId != null ? String(data.assetId) : undefined,
        campaignId: data.campaignId != null ? String(data.campaignId) : undefined,
        adsetId: data.adGroupId != null ? String(data.adGroupId) : undefined,
        adId: data.creativeId != null ? String(data.creativeId) : undefined,
        // When the person submitted the form, not when we polled it.
        submittedAt: data.submissionDateTime,
        caller: { type: "SYSTEM", id: "google_ads_poller" },
      },
      person: {
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
        email: email ?? undefined,
        postcode: postcode ?? undefined,
      },
    },
    {
      externalId: `google_ads:${submissionId}`,
      process: { sourceName: "Google Ads Lead Form" },
    },
  );

  if (result.outcome === "INVALID") {
    console.warn("[google_ads] lead form submission had no usable contact point", {
      businessId,
      resourceName: data.resourceName,
      reasons: result.reasons,
    });
  }
}

/**
 * Provisions the key the lead-form webhook is verified with
 * (src/app/api/webhooks/google-ads/route.ts). Google does not issue one: the
 * advertiser pastes a key into the lead form's webhook settings, so ClientTurn
 * generates it here, once per integration, and keeps it server-side. A
 * reconnect keeps the existing key, so forms already configured keep working.
 */
async function afterConnect(params: { integrationId: string }): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_secrets")
    .select("webhook_secret")
    .eq("integration_id", params.integrationId)
    .maybeSingle();
  if (error) {
    console.error("[google_ads] webhook key lookup failed", error.message);
    return;
  }
  if (data?.webhook_secret) return;

  const { error: writeError } = await admin
    .from("integration_secrets")
    .update({ webhook_secret: randomBytes(24).toString("base64url") })
    .eq("integration_id", params.integrationId);
  // Non-fatal: polling works without the webhook, and reconnecting retries.
  if (writeError) console.error("[google_ads] webhook key could not be stored", writeError.message);
}

registerOAuthProvider("google_ads", { getConfig: config, identify, afterConnect });
registerLeadSourcePoller("google_ads", { poll });
