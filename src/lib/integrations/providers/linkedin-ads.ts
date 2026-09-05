import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { getLiveAccessToken, type OAuthConfig } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";

/**
 * LinkedIn Marketing API — Lead Sync. Confirmed against Microsoft Learn's
 * current LinkedIn API docs (learn.microsoft.com/en-us/linkedin/...):
 *
 * - OAuth2 3-legged flow: authorize
 *   https://www.linkedin.com/oauth/v2/authorization, token
 *   https://www.linkedin.com/oauth/v2/accessToken (shared/authentication/
 *   authorization-code-flow).
 * - Lead retrieval and permissions: marketing/lead-sync/leadsync — the
 *   `r_marketing_leadgen_automation` scope reads `leadForms`,
 *   `leadFormResponses` and manages `leadNotifications` (real-time webhook
 *   subscriptions); `r_ads` and `r_organization_admin` are needed alongside
 *   it to resolve the ad account / organization that owns the forms
 *   (marketing/lead-sync/getting-access-leadsync).
 * - Real-time delivery is the officially recommended path over polling
 *   (marketing/lead-sync/lead-sync-usecase: "The push model is recommended").
 *   The webhook contract (challenge validation, `X-LI-Signature` HMAC) is in
 *   shared/api-guide/webhook-validation and implemented in
 *   src/app/api/webhooks/linkedin-ads/route.ts.
 *
 * IMPORTANT ACCESS GATE, not just OAuth credentials: "Lead Sync API is a
 * separate program, and access to the Advertising API does not automatically
 * grant access. You must apply separately" (marketing/lead-sync/leadsync).
 * The application requires a verified business email, a verified LinkedIn
 * Company Page, and LinkedIn's review of the stated use case — a process that
 * can take days to weeks and is not simply "set two env vars". Until that
 * approval exists, `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` alone let a
 * workspace *start* an OAuth connection, but every `leadNotifications` /
 * `leadFormResponses` call will 403 with "the member doesn't have lead access
 * permission" regardless of scopes requested. See report for the
 * recommendation to gate this behind an explicit "platform approved" flag
 * once that approval is obtained, rather than only `requiredEnv`.
 */

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const ORGANIZATION_ACLS_URL =
  "https://api.linkedin.com/rest/organizationAcls";
const LINKEDIN_VERSION = "202601";

function config(): OAuthConfig | null {
  const { clientId, clientSecret } = serverEnv.linkedinAds;
  if (!clientId || !clientSecret) return null;
  return {
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    scope: "r_marketing_leadgen_automation r_ads r_organization_admin",
  };
}

async function fetchOrganization(
  accessToken: string,
): Promise<{ id: string | null; name: string | null }> {
  // Resolves the calling member's administered organization so the
  // integration row shows a human-readable account rather than a bare token.
  // ACL role names per organization-access-control-by-role.
  const url = new URL(ORGANIZATION_ACLS_URL);
  url.searchParams.set("q", "roleAssignee");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Linkedin-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  const json = (await response.json().catch(() => null)) as {
    elements?: Array<{
      organizationalTarget?: string;
      "organizationalTarget~"?: { localizedName?: string };
    }>;
  } | null;

  const first = json?.elements?.[0];
  const urn = first?.organizationalTarget ?? null;
  return {
    id: urn ? urn.split(":").pop() ?? null : null,
    name: first?.["organizationalTarget~"]?.localizedName ?? null,
  };
}

registerOAuthProvider("linkedin_ads", {
  getConfig: config,
  async identify(token) {
    try {
      const org = await fetchOrganization(token.accessToken);
      return { externalAccountId: org.id, displayName: org.name, scopes: [] };
    } catch {
      // Lead Sync API access not yet approved for this app, or the member has
      // no organization role — connection still succeeds so status can show
      // ACTION_REQUIRED rather than blocking the OAuth round trip outright.
      return { externalAccountId: null, displayName: null, scopes: [] };
    }
  },
});

type LeadFormAnswer = {
  answerDetails?: {
    textQuestionAnswer?: { answer?: string };
  };
  questionId?: number;
};

type LeadFormResponse = {
  id?: string;
  submittedAt?: number;
  versionedLeadGenFormUrn?: string;
  leadMetadataInfo?: {
    sponsoredLeadMetadataInfo?: { campaign?: { name?: string; id?: string } };
  };
  formResponse?: { answers?: LeadFormAnswer[] };
};

/**
 * Field extraction is best-effort: `leadFormResponses` ties answers to a
 * form's own `questionId`s, not to a fixed predefinedField name, so mapping
 * "which questionId is the email" requires having fetched that form's schema
 * via `leadForms` first. That per-form schema cache is out of scope here;
 * this reads only the free-text answer values in order, which is enough to
 * seed a lead's notes for a human to complete, not to reliably auto-populate
 * phone/email. Flagged in the report as follow-up work.
 */
function answerTexts(response: LeadFormResponse): string[] {
  return (response.formResponse?.answers ?? [])
    .map((answer) => answer.answerDetails?.textQuestionAnswer?.answer)
    .filter((value): value is string => Boolean(value));
}

async function ingestLeadFormResponse(
  businessId: string,
  response: LeadFormResponse,
): Promise<void> {
  if (!response.id) return;

  const admin = createAdminClient();
  const externalId = `linkedin:${response.id}`;
  const texts = answerTexts(response);

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      business_id: businessId,
      external_id: externalId,
      email: texts.find((text) => text.includes("@")) ?? null,
      notes: texts.length ? `LinkedIn Lead Gen Forms answers: ${texts.join(" | ")}` : null,
      status: "NEW",
    })
    .select("id")
    .single();

  if (error?.code === "23505" || !created) return;
  if (error) throw error;

  const campaign = response.leadMetadataInfo?.sponsoredLeadMetadataInfo?.campaign;

  await enqueue(
    "lead.process",
    {
      leadId: created.id,
      source: {
        provider: "linkedin_ads",
        formId: response.versionedLeadGenFormUrn,
        campaignId: campaign?.id,
        campaignName: campaign?.name,
      },
    },
    { businessId, idempotencyKey: `lead.process:${externalId}` },
  );
}

/**
 * The webhook (src/app/api/webhooks/linkedin-ads/route.ts) only carries a
 * lead's URN and timestamp, not its answers — LinkedIn's own docs describe
 * fetching the full record via `leadFormResponses` once notified. Rather than
 * doing that provider call inside the webhook request, the webhook enqueues
 * this same `lead_source.poll` job for an immediate run; this poller also
 * runs on its normal 5-minute cadence as a backfill/resilience net per
 * LinkedIn's own guidance ("a combination of both methods provides a
 * balance").
 */
registerLeadSourcePoller("linkedin_ads", {
  async poll({ integrationId, businessId }) {
    const cfg = config();
    if (!cfg) throw new Error("LinkedIn Lead Gen Forms is not configured on this platform.");

    const admin = createAdminClient();
    const accessToken = await getLiveAccessToken(integrationId, cfg);

    const { data: integration } = await admin
      .from("integrations")
      .select("external_account_id")
      .eq("id", integrationId)
      .maybeSingle();
    const organizationId = integration?.external_account_id;
    if (!organizationId) {
      throw new Error("No LinkedIn organization is linked to this integration.");
    }

    const { data: cursor } = await admin
      .from("lead_source_cursors")
      .select("cursor_value")
      .eq("integration_id", integrationId)
      .maybeSingle();

    const since = cursor?.cursor_value ? Number(cursor.cursor_value) : Date.now() - 24 * 60 * 60 * 1000;
    const owner = encodeURIComponent(`(organization:urn%3Ali%3Aorganization%3A${organizationId})`);
    const url =
      `https://api.linkedin.com/rest/leadFormResponses?q=owner&owner=${owner}` +
      `&leadType=(leadType:SPONSORED)&submittedAtTimeRange=(start:${since},end:${Date.now()})`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Linkedin-Version": LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!response.ok) {
      throw new Error(`LinkedIn lead poll failed with status ${response.status}.`);
    }

    const json = (await response.json().catch(() => null)) as {
      elements?: LeadFormResponse[];
    } | null;
    const leads = json?.elements ?? [];

    for (const lead of leads) {
      await ingestLeadFormResponse(businessId, lead);
    }

    await admin.from("lead_source_cursors").upsert(
      {
        integration_id: integrationId,
        business_id: businessId,
        external_object_id: organizationId,
        cursor_value: String(Date.now()),
        last_polled_at: new Date().toISOString(),
      },
      { onConflict: "integration_id" },
    );
  },
});
