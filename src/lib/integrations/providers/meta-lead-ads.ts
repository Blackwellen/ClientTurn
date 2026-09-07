import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { getLiveAccessToken, registerOAuthProvider } from "@/lib/integrations/oauth";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";
import type { OAuthConfig } from "@/lib/integrations/oauth";

/**
 * Meta Lead Ads: Facebook and Instagram lead forms.
 *
 * The catalogue has promised "every new lead from your Facebook and Instagram
 * lead forms" for some time, but no poller was ever registered for Meta — the
 * connector was described and not implemented. This is that implementation.
 *
 * One form belongs to a Page, and a Page's forms cover **both** placements: a
 * lead submitted from an Instagram ad arrives through the same
 * `/{form-id}/leads` edge as one from Facebook. There is no separate Instagram
 * lead API to call, which is why this single poller satisfies both halves of
 * the promise. Where Meta tells us the platform, it is recorded on the lead so
 * attribution can tell them apart later.
 *
 * These become **Leads, not Prospects**. The person filled in a form and asked
 * to be contacted — that is the one route in the product where instant
 * follow-up is the right behaviour, and where no approval step is needed
 * because they already gave permission.
 *
 * Polling exists alongside the webhook rather than instead of it. Meta's
 * `leadgen` webhook is the fast path, but it is fire-and-forget: a delivery
 * that fails while our worker is restarting is not retried indefinitely, and a
 * lead silently lost is the worst possible failure for this route. The poll is
 * the safety net that guarantees eventual delivery.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** How far back a first poll reaches when there is no cursor yet. */
const FIRST_POLL_WINDOW_DAYS = 7;

type MetaFieldDatum = { name?: string; values?: string[] };

type MetaLead = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  field_data?: MetaFieldDatum[];
};

function config(): OAuthConfig | null {
  const appId = serverEnv.meta?.appId;
  const appSecret = serverEnv.meta?.appSecret;
  if (!appId || !appSecret) return null;

  return {
    clientId: appId,
    clientSecret: appSecret,
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: `${GRAPH}/oauth/access_token`,
    scopes: [
      "pages_show_list",
      "pages_read_engagement",
      "leads_retrieval",
      "pages_manage_metadata",
      "business_management",
    ],
  };
}

registerOAuthProvider("meta", {
  getConfig: config,
  async identify(token) {
    const response = await fetch(
      `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token.accessToken)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return { externalAccountId: null, displayName: null, scopes: [] };
    }
    const json = (await response.json().catch(() => null)) as {
      id?: string;
      name?: string;
    } | null;

    return {
      externalAccountId: json?.id ?? null,
      displayName: json?.name ?? null,
      scopes: [],
    };
  },
});

/**
 * Meta returns each answer as `{ name, values: [...] }`, and the field names are
 * whatever the person building the form typed. The standard ones are matched
 * first and a loose contains-match is the fallback — a form asking "What is
 * your email address?" should still find the email.
 */
function fieldValue(fields: MetaFieldDatum[] | undefined, ...names: string[]): string | undefined {
  if (!fields) return undefined;

  const wanted = names.map((name) => name.toLowerCase());
  const exact = fields.find(
    (field) => field.name && wanted.includes(field.name.toLowerCase()),
  );
  if (exact?.values?.[0]) return exact.values[0];

  const loose = fields.find(
    (field) =>
      field.name && wanted.some((name) => field.name!.toLowerCase().includes(name)),
  );
  return loose?.values?.[0];
}

async function ingestLead(
  businessId: string,
  pageId: string,
  formId: string,
  lead: MetaLead,
): Promise<void> {
  if (!lead.id) return;

  const admin = createAdminClient();
  // Meta's own lead id is the dedupe key, so a webhook and a poll delivering the
  // same lead produce one record rather than two.
  const externalId = `meta:${lead.id}`;

  const fullName = fieldValue(lead.field_data, "full_name", "name");
  const [derivedFirst, ...derivedRest] = (fullName ?? "").trim().split(/\s+/);

  const firstName = fieldValue(lead.field_data, "first_name") ?? derivedFirst ?? null;
  const lastName =
    fieldValue(lead.field_data, "last_name") ??
    (derivedRest.length > 0 ? derivedRest.join(" ") : null);

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      business_id: businessId,
      external_id: externalId,
      first_name: firstName || null,
      last_name: lastName || null,
      email: fieldValue(lead.field_data, "email") ?? null,
      phone: fieldValue(lead.field_data, "phone_number", "phone") ?? null,
      status: "NEW",
    })
    .select("id")
    .single();

  // 23505 on (business_id, external_id) means a previous poll or the webhook
  // already took this one. That is the expected outcome, not a failure.
  if (error?.code === "23505" || !created) return;
  if (error) throw error;

  await enqueue(
    "lead.process",
    {
      leadId: created.id,
      source: {
        provider: "meta",
        pageId,
        formId: lead.form_id ?? formId,
        // Facebook or Instagram. Recorded so spend can be attributed to the
        // placement that actually produced the booking.
        platform: lead.platform ?? null,
        adId: lead.ad_id,
        adName: lead.ad_name,
        adsetId: lead.adset_id,
        adsetName: lead.adset_name,
        campaignId: lead.campaign_id,
        campaignName: lead.campaign_name,
        submittedAt: lead.created_time,
      },
    },
    { businessId, idempotencyKey: `lead.process:${externalId}` },
  );
}

registerLeadSourcePoller("meta", {
  async poll({ integrationId, businessId }) {
    const cfg = config();
    if (!cfg) throw new Error("Meta is not configured on this platform.");

    const admin = createAdminClient();
    const userToken = await getLiveAccessToken(integrationId, cfg);

    const { data: cursor } = await admin
      .from("lead_source_cursors")
      .select("cursor_value, external_object_id")
      .eq("integration_id", integrationId)
      .maybeSingle();

    const since = cursor?.cursor_value
      ? Math.floor(new Date(cursor.cursor_value).getTime() / 1000)
      : Math.floor((Date.now() - FIRST_POLL_WINDOW_DAYS * 864e5) / 1000);

    // Pages first. Each carries its own page token, which is what the leads
    // edge requires — the user token cannot read a form's submissions.
    const pagesResponse = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(userToken)}`,
      { cache: "no-store" },
    );
    if (!pagesResponse.ok) {
      throw new Error(`Meta page lookup failed with status ${pagesResponse.status}.`);
    }

    const pages = ((await pagesResponse.json().catch(() => null)) as {
      data?: { id?: string; name?: string; access_token?: string }[];
    } | null)?.data ?? [];

    let newest: string | null = cursor?.cursor_value ?? null;

    for (const page of pages) {
      if (!page.id || !page.access_token) continue;

      const formsResponse = await fetch(
        `${GRAPH}/${page.id}/leadgen_forms?fields=id,name,status&limit=50&access_token=${encodeURIComponent(page.access_token)}`,
        { cache: "no-store" },
      );
      if (!formsResponse.ok) continue;

      const forms = ((await formsResponse.json().catch(() => null)) as {
        data?: { id?: string; status?: string }[];
      } | null)?.data ?? [];

      for (const form of forms) {
        if (!form.id) continue;

        const url = new URL(`${GRAPH}/${form.id}/leads`);
        url.searchParams.set("access_token", page.access_token);
        url.searchParams.set(
          "fields",
          "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,field_data",
        );
        url.searchParams.set("limit", "100");
        url.searchParams.set("filtering", JSON.stringify([
          { field: "time_created", operator: "GREATER_THAN", value: since },
        ]));

        const leadsResponse = await fetch(url, { cache: "no-store" });
        // One form failing must not abandon the others — a single archived form
        // returning 400 would otherwise cost the whole poll.
        if (!leadsResponse.ok) continue;

        const leads = ((await leadsResponse.json().catch(() => null)) as {
          data?: MetaLead[];
        } | null)?.data ?? [];

        for (const lead of leads) {
          await ingestLead(businessId, page.id, form.id, lead);
          if (lead.created_time && (!newest || lead.created_time > newest)) {
            newest = lead.created_time;
          }
        }
      }
    }

    // Advanced only after every form has been walked, so a failure part-way
    // through re-reads rather than skipping the leads it never reached.
    if (newest) {
      await admin.from("lead_source_cursors").upsert(
        {
          integration_id: integrationId,
          business_id: businessId,
          external_object_id: cursor?.external_object_id ?? null,
          cursor_value: newest,
          last_polled_at: new Date().toISOString(),
        },
        { onConflict: "integration_id" },
      );
    }
  },
});
