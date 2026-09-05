import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { getLiveAccessToken, type OAuthConfig } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";

/**
 * TikTok for Business (Marketing API). Docs: business-api.tiktok.com/portal —
 * confirmed authorize/token/advertiser endpoints below via TikTok's official
 * SDK reference (github.com/tiktok/tiktok-business-api-sdk, js_sdk/docs/
 * AuthenticationApi.md) and third-party integration docs (redpointglobal.com/
 * bpd/tiktok-api), since the interactive docs portal at
 * business-api.tiktok.com/portal/docs is a client-rendered SPA that returns no
 * fetchable HTML.
 *
 * Lead delivery: TikTok's Marketing API does support a lead-notification
 * webhook subscription, but every reachable source describes it only via the
 * *generic* TikTok-for-Developers webhook framework (developers.tiktok.com/
 * doc/webhooks-*, `Tiktok-Signature: t=...,s=...` header), and none confirms
 * that mechanism applies to Marketing-API lead ads specifically, nor gives the
 * subscription-registration endpoint for it. This codebase's own schema
 * (see supabase/migrations/0016_extra_providers.sql, `lead_source_cursors`)
 * already treats TikTok as a polling source alongside Google/Microsoft Ads,
 * which is the safer, verifiable choice here — so this adapter polls rather
 * than guessing at an unconfirmed webhook contract.
 */

const AUTHORIZE_URL = "https://business-api.tiktok.com/portal/auth";
const TOKEN_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/";
const ADVERTISER_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/";

/**
 * ASSUMPTION — could not be confirmed from a fetchable source. Every guide
 * describes downloading instant-form leads from Ads Manager UI or via a CRM
 * partner integration, but none gave the exact polling endpoint path/params
 * for the raw Marketing API. `page/lead/get` follows the `/open_api/v1.3/`
 * naming convention used by every other endpoint above and by TikTok's own
 * `page/get` (page/creative asset) family, but must be verified against a
 * live sandbox app — with real TIKTOK_APP_ID/TIKTOK_APP_SECRET credentials,
 * which are unset in this environment — before this integration is offered
 * to a customer. Until then this poller fails soft: a bad path 404s, the
 * catch in lead-source-poll.ts marks the integration ACTION_REQUIRED, and no
 * lead is silently dropped or fabricated.
 */
const LEADS_URL = "https://business-api.tiktok.com/open_api/v1.3/page/lead/get/";

type TikTokFieldDatum = { name?: string; value?: string };
type TikTokLead = {
  lead_id?: string;
  create_time?: string;
  page_id?: string;
  page_name?: string;
  form_id?: string;
  form_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  field_data?: TikTokFieldDatum[];
};

function config(): OAuthConfig | null {
  const { appId, appSecret } = serverEnv.tiktokAds;
  if (!appId || !appSecret) return null;
  return {
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    clientId: appId,
    clientSecret: appSecret,
    // TikTok for Business scopes are fixed at app-review time in the
    // developer portal, not requested via an authorize-URL `scope` param —
    // the shared plumbing still sets one, which TikTok ignores.
    scope: "",
    // TikTok's documented authorize URL takes `app_id`, not the shared
    // plumbing's `client_id`; both are sent, TikTok reads the one it knows.
    extraAuthorizeParams: { app_id: appId },
  };
}

async function fetchAdvertiser(
  accessToken: string,
): Promise<{ id: string | null; name: string | null }> {
  const cfg = config();
  if (!cfg) return { id: null, name: null };

  const url = new URL(ADVERTISER_URL);
  url.searchParams.set("app_id", cfg.clientId);
  url.searchParams.set("secret", cfg.clientSecret);

  const response = await fetch(url, {
    headers: { "Access-Token": accessToken },
  });
  const json = (await response.json().catch(() => null)) as {
    data?: { list?: Array<{ advertiser_id?: string; advertiser_name?: string }> };
  } | null;

  const advertiser = json?.data?.list?.[0];
  return {
    id: advertiser?.advertiser_id ?? null,
    name: advertiser?.advertiser_name ?? null,
  };
}

registerOAuthProvider("tiktok_ads", {
  getConfig: config,
  async identify(token) {
    const advertiser = await fetchAdvertiser(token.accessToken);
    return {
      externalAccountId: advertiser.id,
      displayName: advertiser.name,
      scopes: [],
    };
  },
});

function fieldValue(fields: TikTokFieldDatum[] | undefined, ...names: string[]): string | undefined {
  if (!fields) return undefined;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return fields.find((field) => field.name && wanted.has(field.name.toLowerCase()))?.value;
}

async function ingestLead(businessId: string, lead: TikTokLead): Promise<void> {
  if (!lead.lead_id) return;

  const admin = createAdminClient();
  const externalId = `tiktok:${lead.lead_id}`;

  const firstName = fieldValue(lead.field_data, "first_name", "name");
  const lastName = fieldValue(lead.field_data, "last_name");
  const phone = fieldValue(lead.field_data, "phone_number", "phone");
  const email = fieldValue(lead.field_data, "email");

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      business_id: businessId,
      external_id: externalId,
      first_name: firstName ?? null,
      last_name: lastName ?? null,
      phone: phone ?? null,
      email: email ?? null,
      status: "NEW",
    })
    .select("id")
    .single();

  // Unique violation on (business_id, external_id) means this lead was
  // already ingested by a previous poll — not an error.
  if (error?.code === "23505" || !created) return;
  if (error) throw error;

  await enqueue(
    "lead.process",
    {
      leadId: created.id,
      source: {
        provider: "tiktok_ads",
        pageId: lead.page_id,
        pageName: lead.page_name,
        formId: lead.form_id,
        formName: lead.form_name,
        campaignId: lead.campaign_id,
        campaignName: lead.campaign_name,
        adId: lead.ad_id,
        adName: lead.ad_name,
      },
    },
    { businessId, idempotencyKey: `lead.process:${externalId}` },
  );
}

registerLeadSourcePoller("tiktok_ads", {
  async poll({ integrationId, businessId }) {
    const cfg = config();
    if (!cfg) throw new Error("TikTok Ads is not configured on this platform.");

    const admin = createAdminClient();
    const accessToken = await getLiveAccessToken(integrationId, cfg);

    const { data: integration } = await admin
      .from("integrations")
      .select("external_account_id")
      .eq("id", integrationId)
      .maybeSingle();
    const advertiserId = integration?.external_account_id;
    if (!advertiserId) throw new Error("No TikTok advertiser is linked to this integration.");

    const { data: cursor } = await admin
      .from("lead_source_cursors")
      .select("cursor_value")
      .eq("integration_id", integrationId)
      .maybeSingle();

    const url = new URL(LEADS_URL);
    url.searchParams.set("advertiser_id", advertiserId);
    if (cursor?.cursor_value) url.searchParams.set("start_time", cursor.cursor_value);

    const response = await fetch(url, {
      headers: { "Access-Token": accessToken },
    });
    if (!response.ok) {
      throw new Error(`TikTok lead poll failed with status ${response.status}.`);
    }

    const json = (await response.json().catch(() => null)) as {
      data?: { leads?: TikTokLead[] };
    } | null;
    const leads = json?.data?.leads ?? [];

    for (const lead of leads) {
      await ingestLead(businessId, lead);
    }

    const latest = leads
      .map((lead) => lead.create_time)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    if (latest) {
      await admin.from("lead_source_cursors").upsert(
        {
          integration_id: integrationId,
          business_id: businessId,
          external_object_id: advertiserId,
          cursor_value: latest,
          last_polled_at: new Date().toISOString(),
        },
        { onConflict: "integration_id" },
      );
    }
  },
});
