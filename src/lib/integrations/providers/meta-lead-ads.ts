import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveAccessToken, type OAuthConfig, type TokenResponse } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";
import { ingestLead } from "@/lib/ingest/service";
import { logWriteError } from "@/lib/supabase/write-result";

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
 *
 * TOKEN LONGEVITY. The generic OAuth callback's code-exchange
 * (`exchangeCodeForToken` in `src/lib/integrations/oauth.ts`) hits
 * `${GRAPH}/oauth/access_token` directly with the authorization code, which
 * Meta answers with a **short-lived** user token — a few hours, sometimes
 * cited as valid up to roughly a day depending on flow and app review state.
 * Meta has no `refresh_token` grant at all (confirmed live: every stored Meta
 * secret has `refresh_token: null`, unlike every other provider in this
 * codebase), so `getLiveAccessToken`'s generic refresh path cannot rescue it —
 * once that short-lived token expired, every Meta connection went from
 * "connected" to silently dead with no self-healing mechanism, which is
 * exactly the "connections disconnect after a day" symptom this was built to
 * fix. `afterConnect` below performs the second call Meta's own docs require
 * (https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived,
 * confirmed live 2026-09-13) to exchange that short-lived token for a
 * long-lived one (~60 days, `expires_in` ≈ 5,184,000 seconds) and overwrites
 * the stored access token with it. This does not make the connection
 * permanent — Meta's long-lived tokens do not auto-renew, and there is no
 * further refresh mechanism once *that* expires either — but it is the real
 * lifetime Meta's own API offers short of standing up a Business Manager
 * System User, which is out of scope here. A future maintenance job that
 * notices a Meta connection is within a few days of its stored expiry and
 * prompts for reconnection would be the honest next step; this fix stops the
 * connection from being far shorter-lived than Meta itself allows.
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
    // Meta takes a comma-separated list, not an array. Each one buys a specific
    // capability and none is speculative:
    //
    //   pages_show_list          pick which Page to connect
    //   pages_read_engagement    read comments on the Page's own posts (replies to people who engaged; not a prospect source)
    //   leads_retrieval          read lead-form submissions
    //   pages_manage_metadata    subscribe the Page to our webhook
    //   pages_messaging          send and receive Messenger DMs
    //   instagram_basic          resolve the linked Instagram account
    //   instagram_manage_messages  send and receive Instagram DMs
    //   business_management      resolve the Business the Page belongs to
    //
    // The two messaging scopes are what make an autonomous conversation
    // possible at all; without them the connection reads leads and comments and
    // can never reply.
    scope: [
      "pages_show_list",
      "pages_read_engagement",
      // Deliberately NOT `pages_read_user_content`. Reading the Page's own
      // posts back needs it, and the use-case model does not offer it on this
      // app — but a comment *delivered* to a subscribed webhook needs no read
      // permission at all, because Meta hands it over rather than us fetching
      // it. `feed` is subscribed, `social/comment-ingest.ts` receives it, and
      // that path is both permitted and faster: the seven-day private-reply
      // window runs from the comment's own timestamp, so polling latency came
      // straight off the only clock that expires silently.
      "leads_retrieval",
      // Required to reach `/{page}/leadgen_forms`, which the poller below calls
      // as the backstop for a webhook Meta failed to deliver. Without it that
      // edge returns `(#200) Requires pages_manage_ads permission to manage the
      // object`, and the safety net silently stops working while the webhook
      // path carries on — the worst shape of failure for this route, because
      // the thing that breaks is the thing that catches breakage.
      "pages_manage_ads",
      "pages_manage_metadata",
      "pages_messaging",
      "instagram_basic",
      "instagram_manage_messages",
      "business_management",
    ].join(","),
  };
}

/**
 * Subscribes the connected Page to this app's webhooks.
 *
 * Two subscriptions are needed and only one of them is obvious. The app-level
 * one — configured once in the dashboard — says *where* Page events go. This
 * one says *whose* events to send, and without it Meta delivers nothing at all:
 * no Messenger message, no Instagram DM, no comment, no lead. The webhook is
 * configured, verified, and silent, which is the hardest kind of broken to
 * notice because every check short of sending a real message passes.
 *
 * It has to use the **Page** access token, not the user's. A user token is
 * refused here, and it fails in the shape that looks like a permissions problem
 * rather than a wrong-credential one.
 *
 * The same trap is documented in `whatsapp-cloud.ts` for WhatsApp Business
 * Accounts, where it was handled from the start. Pages went without it, so
 * every Meta connection completed successfully and then received nothing.
 *
 * A failure is logged and swallowed: the connection is still worth keeping, and
 * reconnecting re-runs this. What must not happen is an OAuth callback that
 * throws after the token was granted.
 */
async function subscribePage(pageId: string, pageAccessToken: string): Promise<boolean> {
  const fields = ["messages", "messaging_postbacks", "feed", "leadgen"].join(",");

  try {
    const response = await fetch(
      `${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=${fields}`,
      { method: "POST", headers: { authorization: `Bearer ${pageAccessToken}` } },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[meta] page ${pageId} not subscribed to webhooks: ${response.status} ${detail.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[meta] page ${pageId} subscribe failed`, error);
    return false;
  }
}

/**
 * Exchanges the short-lived token the callback already stored for Meta's
 * long-lived one and overwrites `integration_secrets` with it. See the file
 * header comment ("TOKEN LONGEVITY") for why this exists.
 *
 * Deliberately non-fatal: the short-lived token `storeConnection` already
 * wrote still works for the next few hours, so a failure here (Meta down, a
 * transient network error) should not fail the whole connect attempt the way
 * Calendly's `afterConnect` correctly does for its webhook subscription --
 * without that subscription Calendly is not merely short-lived, it is
 * useless. A Meta connection that keeps today's short-lived token is
 * degraded, not dead, and reconnecting (or the next successful poll cycle,
 * once a retry exists) can still upgrade it later.
 */
async function afterConnect(params: {
  integrationId: string;
  token: TokenResponse;
}): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("client_secret", cfg.clientSecret);
  url.searchParams.set("fb_exchange_token", params.token.accessToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (error) {
    console.error("[meta] long-lived token exchange failed (network)", error);
    return;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      `[meta] long-lived token exchange rejected (status ${response.status}): ${detail.slice(0, 300)}`,
    );
    return;
  }

  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    console.error("[meta] long-lived token exchange returned no access_token");
    return;
  }

  const admin = createAdminClient();
  const tokenWrite = await admin
    .from("integration_secrets")
    .update({
      access_token: json.access_token,
      token_expires_at: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : null,
    })
    .eq("integration_id", params.integrationId);
  // A lost write leaves the short-lived token in place, which expires within
  // hours. Logged so the cause is findable when polling later starts failing.
  logWriteError(tokenWrite, "integration_secrets.meta_long_lived_token", {
    integrationId: params.integrationId,
  });
}

registerOAuthProvider("meta", {
  getConfig: config,
  afterConnect,
  async identify(token: { accessToken: string }) {
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

    // Which Page, and which Instagram account is linked to it.
    //
    // Without this the connection completes and every send fails: the transport
    // reads `config.pageId`, and a token alone does not say which of somebody's
    // Pages they meant. The first Page with a linked Instagram account is
    // preferred, because that is the one that can do both halves of the
    // product; otherwise the first Page.
    let pageId: string | null = null;
    let instagramUserId: string | null = null;
    let pageName: string | null = null;
    let pageList: MetaPageOption[] = [];

    try {
      const pagesResponse = await fetch(
        `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(token.accessToken)}`,
        { cache: "no-store" },
      );

      if (pagesResponse.ok) {
        const pages = (await pagesResponse.json()) as {
          data?: {
            id?: string;
            name?: string;
            access_token?: string;
            instagram_business_account?: { id?: string };
          }[];
        };

        const list = pages.data ?? [];
        const chosen =
          list.find((page) => page.instagram_business_account?.id) ?? list[0] ?? null;
        // Every Page they manage, without tokens, so Settings can offer the
        // choice instead of living with the one picked here.
        pageList = list
          .filter((page): page is { id: string; name?: string; instagram_business_account?: { id?: string } } =>
            Boolean(page.id),
          )
          .map((page) => ({
            id: page.id,
            name: page.name ?? page.id,
            instagramUserId: page.instagram_business_account?.id ?? null,
          }));

        pageId = chosen?.id ?? null;
        pageName = chosen?.name ?? null;
        instagramUserId = chosen?.instagram_business_account?.id ?? null;

        if (pageId && chosen?.access_token) {
          await subscribePage(pageId, chosen.access_token);
        }
      }
    } catch {
      // A failure here leaves `config` empty rather than throwing. The
      // connection is still recorded, the send path reports "no Page
      // connected", and reconnecting resolves it — which is a far better
      // outcome than an OAuth callback that 500s after the token was granted.
    }

    return {
      externalAccountId: json?.id ?? null,
      // The Page name, not the person's — this row is shown as "which account
      // is connected", and the Page is what the customer recognises.
      displayName: pageName ?? json?.name ?? null,
      scopes: [],
      config: {
        ...(pageId ? { pageId } : {}),
        ...(instagramUserId ? { instagramUserId } : {}),
        ...(pageList.length > 0 ? { pages: pageList } : {}),
      },
    };
  },
});

/* ------------------------------------------------------------ Page choice */

export type MetaPageOption = { id: string; name: string; instagramUserId: string | null };

/**
 * The Pages this connection's token can manage, read live.
 *
 * Used to (re)build the picker for a connection made before the list was
 * stored, and to confirm a choice against what Meta says now rather than
 * against a list that may be weeks old.
 */
async function managedPages(
  integrationId: string,
): Promise<(MetaPageOption & { accessToken: string })[]> {
  const cfg = config();
  if (!cfg) throw new Error("Meta is not configured on this platform.");
  const token = await getLiveAccessToken(integrationId, cfg);
  const response = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Meta would not list your Pages (status ${response.status}). Reconnect Meta.`);
  }
  const json = (await response.json().catch(() => ({}))) as {
    data?: {
      id?: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: { id?: string };
    }[];
  };
  return (json.data ?? [])
    .filter((page) => page.id && page.access_token)
    .map((page) => ({
      id: page.id!,
      name: page.name ?? page.id!,
      instagramUserId: page.instagram_business_account?.id ?? null,
      accessToken: page.access_token!,
    }));
}

/** Refreshes the stored Page list (no tokens stored) and returns it. */
export async function refreshMetaPages(input: {
  businessId: string;
  integrationId: string;
}): Promise<MetaPageOption[]> {
  const pages = await managedPages(input.integrationId);
  const options = pages.map(({ accessToken: _token, ...page }) => {
    void _token;
    return page;
  });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("integrations")
    .select("config")
    .eq("id", input.integrationId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Meta connection: ${error.message}`);
  const current = (row?.config ?? {}) as Record<string, unknown>;
  const write = await admin
    .from("integrations")
    .update({ config: { ...current, pages: options } as never })
    .eq("id", input.integrationId)
    .eq("business_id", input.businessId);
  logWriteError(write, "integrations.meta_pages", { integrationId: input.integrationId });
  return options;
}

/**
 * Switches which Page this workspace receives leads and messages for.
 *
 * The webhook routes a delivery by `config.pageId`, so a Page that is not the
 * chosen one is not routed at all. Subscribing the new Page happens first:
 * a switch that recorded the new Page but left it unsubscribed would receive
 * nothing from either.
 */
export async function selectMetaPage(input: {
  businessId: string;
  integrationId: string;
  pageId: string;
}): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const pages = await managedPages(input.integrationId);
  const page = pages.find((candidate) => candidate.id === input.pageId);
  if (!page) {
    return { ok: false, error: "That Page is not one this Meta connection can manage." };
  }

  const subscribed = await subscribePage(page.id, page.accessToken);
  if (!subscribed) {
    return {
      ok: false,
      error: "Meta refused to send that Page's leads to Client Turn. Check you are an admin of the Page, then try again.",
    };
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("integrations")
    .select("config")
    .eq("id", input.integrationId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (error || !row) return { ok: false, error: "The Meta connection could not be read." };

  const current = (row.config ?? {}) as Record<string, unknown>;
  const { error: writeError } = await admin
    .from("integrations")
    .update({
      display_name: page.name,
      config: {
        ...current,
        pageId: page.id,
        instagramUserId: page.instagramUserId,
        pages: pages.map(({ accessToken: _token, ...option }) => {
          void _token;
          return option;
        }),
      } as never,
    })
    .eq("id", input.integrationId)
    .eq("business_id", input.businessId);
  if (writeError) return { ok: false, error: "The Page choice could not be saved." };

  return { ok: true, name: page.name };
}

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

/** Field names that map to a lead column; every other answer is kept as an answer. */
const STANDARD_FIELDS = new Set([
  "full_name", "name", "first_name", "last_name", "email", "phone_number", "phone",
]);

/**
 * One Meta lead through the one intake path (design 03 §1). `ingestLead`
 * dedupes on Meta's own lead id (a webhook and a poll delivering the same
 * lead produce one touch), writes the per-submission attribution, records
 * that they contacted the business, and queues `lead.process`. A database
 * failure throws (B13), so the poll fails before its cursor moves past a lead
 * that was never stored.
 */
async function ingestMetaLead(
  businessId: string,
  pageId: string,
  formId: string,
  lead: MetaLead,
): Promise<void> {
  if (!lead.id) return;

  const fullName = fieldValue(lead.field_data, "full_name", "name");
  const [derivedFirst, ...derivedRest] = (fullName ?? "").trim().split(/\s+/);

  const firstName = fieldValue(lead.field_data, "first_name") ?? derivedFirst ?? undefined;
  const lastName =
    fieldValue(lead.field_data, "last_name") ??
    (derivedRest.length > 0 ? derivedRest.join(" ") : undefined);

  const answers: Record<string, string> = {};
  for (const field of lead.field_data ?? []) {
    const value = field.values?.[0];
    if (!field.name || !value || STANDARD_FIELDS.has(field.name.toLowerCase())) continue;
    answers[field.name.slice(0, 200)] = value.slice(0, 2000);
  }

  const result = await ingestLead(
    {
      businessId,
      source: {
        type: "AD_FORM",
        provider: "meta",
        providerRecordId: lead.id,
        pageId,
        formId: lead.form_id ?? formId,
        campaignId: lead.campaign_id,
        campaignName: lead.campaign_name,
        adsetId: lead.adset_id,
        adsetName: lead.adset_name,
        adId: lead.ad_id,
        adName: lead.ad_name,
        // When the person submitted the form, not when we polled it.
        submittedAt: lead.created_time,
        caller: { type: "SYSTEM", id: "meta_lead_ads" },
      },
      person: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: fieldValue(lead.field_data, "email"),
        phone: fieldValue(lead.field_data, "phone_number", "phone"),
      },
      ...(Object.keys(answers).length ? { answers } : {}),
    },
    // The pre-touch dedupe key, so a lead ingested before lead_touches
    // existed is still recognised when the poll window re-reads it.
    { externalId: `meta:${lead.id}` },
  );

  if (result.outcome === "INVALID") {
    console.warn("[meta] lead form submission had no usable contact point", {
      businessId,
      leadId: lead.id,
      reasons: result.reasons,
    });
  }
}

registerLeadSourcePoller("meta", {
  async poll({ integrationId, businessId }) {
    const cfg = config();
    if (!cfg) throw new Error("Meta is not configured on this platform.");

    const admin = createAdminClient();
    const storedToken = await getLiveAccessToken(integrationId, cfg);

    const { data: cursor } = await admin
      .from("lead_source_cursors")
      .select("cursor_value, external_object_id")
      .eq("integration_id", integrationId)
      .maybeSingle();

    const since = cursor?.cursor_value
      ? Math.floor(new Date(cursor.cursor_value).getTime() / 1000)
      : Math.floor((Date.now() - FIRST_POLL_WINDOW_DAYS * 864e5) / 1000);

    // Pages first. Each carries its own page token, which is what the leads
    // edge requires — the user token cannot read a form's submissions directly.
    //
    // Two token shapes are handled here:
    //   * User token  → /me/accounts returns page list with per-page tokens.
    //   * Page token  → /me/accounts is forbidden; use the token directly for
    //     the page whose id is stored in config, discovered from the integration row.
    const pagesResponse = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(storedToken)}`,
      { cache: "no-store" },
    );

    let pages: { id: string; access_token: string }[];

    if (pagesResponse.ok) {
      const raw = ((await pagesResponse.json().catch(() => null)) as {
        data?: { id?: string; name?: string; access_token?: string }[];
      } | null)?.data ?? [];
      pages = raw.filter((p): p is { id: string; access_token: string } =>
        typeof p.id === "string" && typeof p.access_token === "string",
      );
    } else {
      // Stored token is a page token — /me/accounts is not available.
      // Read the pageId we already resolved at connect time and use the token directly.
      const { data: intRow } = await admin
        .from("integrations")
        .select("config")
        .eq("id", integrationId)
        .maybeSingle();
      const cfgPageId =
        typeof (intRow?.config as Record<string, unknown> | null)?.pageId === "string"
          ? (intRow!.config as Record<string, unknown>).pageId as string
          : null;
      if (!cfgPageId) {
        throw new Error(`Meta page lookup failed with status ${pagesResponse.status}.`);
      }
      pages = [{ id: cfgPageId, access_token: storedToken }];
    }

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
          await ingestMetaLead(businessId, page.id, form.id, lead);
          if (lead.created_time && (!newest || lead.created_time > newest)) {
            newest = lead.created_time;
          }
        }
      }
    }

    // Advanced only after every form has been walked, so a failure part-way
    // through re-reads rather than skipping the leads it never reached.
    if (newest) {
      // Logged, not thrown: a lost cursor only means the next poll re-reads
      // leads it has already stored, which the duplicate check absorbs.
      const cursorWrite = await admin.from("lead_source_cursors").upsert(
        {
          integration_id: integrationId,
          business_id: businessId,
          external_object_id: cursor?.external_object_id ?? null,
          cursor_value: newest,
          last_polled_at: new Date().toISOString(),
        },
        { onConflict: "integration_id" },
      );
      logWriteError(cursorWrite, "lead_source_cursors.upsert", { businessId, integrationId });
    }
  },
});
