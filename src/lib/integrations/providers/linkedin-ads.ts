import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { getLiveAccessToken, type OAuthConfig } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "@/lib/integrations/providers/registry";
import { registerLeadSourcePoller } from "@/lib/integrations/providers/lead-source-registry";
import { ingestLead } from "@/lib/ingest/service";
import {
  linkedinScopes,
  organizationsFromAcls,
  type LinkedInOrganization,
} from "@/lib/integrations/linkedin-orgs";

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
    scope: linkedinScopes(serverEnv.linkedinAds.communityManagementApproved === "true"),
  };
}

type OrganizationAclsResponse = {
  elements?: Array<{
    organizationalTarget?: string;
    "organizationalTarget~"?: { localizedName?: string };
  }>;
} | null;

/**
 * Every organisation the member administers. The connection used to take the
 * first one silently; an agency administering several pages had no way to
 * choose, so every one is kept and Settings offers the choice.
 */
async function fetchOrganizations(accessToken: string): Promise<LinkedInOrganization[]> {
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
  const json = (await response.json().catch(() => null)) as OrganizationAclsResponse;
  return organizationsFromAcls(json?.elements ?? []);
}

registerOAuthProvider("linkedin_ads", {
  getConfig: config,
  async identify(token) {
    try {
      const organizations = await fetchOrganizations(token.accessToken);
      const first = organizations[0] ?? null;
      return {
        externalAccountId: first?.id ?? null,
        displayName: first?.name ?? null,
        scopes: [],
        // The URN is what the engagement provider reads (`config.organizationUrn`).
        // It was never written, so page engagement could not find the page.
        config: first
          ? { organizationUrn: first.urn, organizations }
          : { organizations },
      };
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

/**
 * A form's own question schema.
 *
 * `leadFormResponses` returns answers keyed by the form's `questionId` and
 * nothing else -- no field name, no type. The mapping from question id to
 * "this is the email" lives on the form, which has to be fetched separately.
 */
type LeadFormQuestion = {
  questionId?: number;
  predefinedField?: string;
  name?: string;
};

type LeadFormSchema = {
  id?: string | number;
  versionedLeadGenFormUrn?: string;
  /** Where Lead Sync returns the questions (Microsoft Learn, Lead Sync API). */
  content?: { questions?: LeadFormQuestion[] };
  /** Kept as a fallback for any older shape. */
  questions?: LeadFormQuestion[];
};

/**
 * The numeric form id inside a versioned form URN:
 * `urn:li:versionedLeadGenForm:(urn:li:leadGenForm:3162,1)` -> `3162`.
 * `GET /rest/leadForms/{id}` takes this id, not the versioned URN.
 */
export function leadFormIdFromUrn(urn: string): string | null {
  const match = urn.match(/urn:li:leadGenForm:(\d+)/);
  return match ? match[1] : null;
}

/**
 * LinkedIn's predefined field names, mapped onto our lead columns.
 *
 * Only the fields a lead actually needs. Everything else on the form is kept
 * as a note rather than dropped -- a custom qualifying question ("how many
 * vehicles do you run?") is often the most useful thing on the form, and it
 * has no column to live in.
 */
const PREDEFINED_FIELD_MAP: Record<string, "email" | "phone" | "first_name" | "last_name" | "company"> = {
  EMAIL: "email",
  WORK_EMAIL: "email",
  PHONE_NUMBER: "phone",
  WORK_PHONE_NUMBER: "phone",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  COMPANY_NAME: "company",
  ORGANIZATION: "company",
};

/**
 * Question schemas, cached for a bounded time rather than the life of the
 * process.
 *
 * A poll typically returns many responses to the same handful of forms, and
 * the schema does not change between them -- fetching it per response would
 * turn one poll into dozens of API calls against a rate-limited endpoint. The
 * TTL exists so that a customer editing their form's questions is picked up
 * within one cache lifetime instead of requiring a process restart.
 */
const FORM_SCHEMA_CACHE_TTL_MS = 30 * 60 * 1000;
const FORM_SCHEMA_CACHE = new Map<string, { map: Map<number, string>; cachedAt: number }>();

async function questionMapFor(
  formUrn: string,
  accessToken: string,
): Promise<Map<number, string>> {
  const cached = FORM_SCHEMA_CACHE.get(formUrn);
  if (cached && Date.now() - cached.cachedAt < FORM_SCHEMA_CACHE_TTL_MS) return cached.map;

  const map = new Map<number, string>();

  try {
    const formId = leadFormIdFromUrn(formUrn);
    if (!formId) throw new Error("Unrecognised lead form URN.");
    const response = await fetch(
      `https://api.linkedin.com/rest/leadForms/${formId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Linkedin-Version": LINKEDIN_VERSION,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );

    if (response.ok) {
      const schema = (await response.json().catch(() => null)) as LeadFormSchema | null;
      for (const question of schema?.content?.questions ?? schema?.questions ?? []) {
        if (question.questionId === undefined) continue;
        map.set(question.questionId, question.predefinedField ?? question.name ?? "");
      }
    }
  } catch {
    // A schema we cannot fetch is not a reason to drop the lead. The caller
    // falls back to the previous shape-based guess, which is worse but is
    // still a lead somebody can work.
  }

  // Cached even when empty, so a form whose schema is unavailable is not
  // re-fetched for every response in the same poll.
  FORM_SCHEMA_CACHE.set(formUrn, { map, cachedAt: Date.now() });
  return map;
}

type LeadFormResponse = {
  id?: string;
  submittedAt?: number;
  versionedLeadGenFormUrn?: string;
  leadMetadataInfo?: {
    sponsoredLeadMetadataInfo?: { campaign?: { name?: string; id?: string } };
  };
  formResponse?: { answers?: LeadFormAnswer[] };
};

function answerTexts(response: LeadFormResponse): string[] {
  return (response.formResponse?.answers ?? [])
    .map((answer) => answer.answerDetails?.textQuestionAnswer?.answer)
    .filter((value): value is string => Boolean(value));
}

type MappedLead = {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  /** Everything that has no column of its own, kept verbatim. */
  extras: string[];
};

/**
 * Turns a form response into lead fields.
 *
 * `leadFormResponses` returns answers keyed only by the form's own
 * `questionId`, so this needs the form's schema to know which answer is the
 * email and which is the phone number. Fetching that schema is what this
 * function is for, and it is the difference between a working route and a
 * broken one: without it a LinkedIn lead arrived with a guessed email, no
 * name and no phone, and the instant-follow-up that is the entire point of
 * the lead-form route had nothing to send to.
 *
 * The old shape-based guess ("the answer containing an @ is the email") is
 * kept as the fallback for a form whose schema could not be fetched. It is
 * poor, but a lead with a probable email beats a lead with nothing.
 */
async function mapLeadFields(
  response: LeadFormResponse,
  accessToken: string | null,
): Promise<MappedLead> {
  const answers = response.formResponse?.answers ?? [];
  const mapped: MappedLead = {
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    company: null,
    extras: [],
  };

  const formUrn = response.versionedLeadGenFormUrn;
  const questions =
    formUrn && accessToken ? await questionMapFor(formUrn, accessToken) : new Map();

  for (const answer of answers) {
    const value = answer.answerDetails?.textQuestionAnswer?.answer?.trim();
    if (!value) continue;

    const field = answer.questionId === undefined ? null : questions.get(answer.questionId);
    const column = field ? PREDEFINED_FIELD_MAP[field.toUpperCase()] : undefined;

    switch (column) {
      case "email":
        mapped.email ??= value;
        break;
      case "phone":
        mapped.phone ??= value;
        break;
      case "first_name":
        mapped.firstName ??= value;
        break;
      case "last_name":
        mapped.lastName ??= value;
        break;
      case "company":
        mapped.company ??= value;
        break;
      default:
        // A custom question. Often the most useful thing on the form, and it
        // has no column, so it is labelled with its own question text rather
        // than flattened into an anonymous list.
        mapped.extras.push(field ? `${field}: ${value}` : value);
    }
  }

  // Fallback for a form whose schema was unavailable.
  if (!mapped.email) {
    mapped.email = answerTexts(response).find((text) => text.includes("@")) ?? null;
  }

  return mapped;
}

async function ingestLeadFormResponse(
  businessId: string,
  response: LeadFormResponse,
  accessToken: string | null,
): Promise<void> {
  if (!response.id) return;

  const fields = await mapLeadFields(response, accessToken);
  const campaign = response.leadMetadataInfo?.sponsoredLeadMetadataInfo?.campaign;

  // Custom answers keep their own question text as the key.
  const answers: Record<string, string> = {};
  fields.extras.forEach((extra, index) => {
    const split = extra.indexOf(": ");
    const key = split > 0 ? extra.slice(0, split) : `Answer ${index + 1}`;
    answers[key.slice(0, 200)] = (split > 0 ? extra.slice(split + 2) : extra).slice(0, 2000);
  });

  // The one intake path (design 03 §1). A database failure throws (B13), so
  // the poll retries rather than losing the lead.
  const result = await ingestLead(
    {
      businessId,
      source: {
        type: "AD_FORM",
        provider: "linkedin_ads",
        providerRecordId: response.id,
        formId: response.versionedLeadGenFormUrn,
        campaignId: campaign?.id,
        campaignName: campaign?.name,
        submittedAt: response.submittedAt,
        caller: { type: "SYSTEM", id: "linkedin_ads_poller" },
      },
      person: {
        email: fields.email ?? undefined,
        phone: fields.phone ?? undefined,
        firstName: fields.firstName ?? undefined,
        lastName: fields.lastName ?? undefined,
        companyName: fields.company ?? undefined,
      },
      ...(Object.keys(answers).length ? { answers } : {}),
    },
    {
      externalId: `linkedin:${response.id}`,
      insertExtras: fields.extras.length
        ? { notes: `LinkedIn Lead Gen Forms answers: ${fields.extras.join(" | ")}` }
        : {},
    },
  );

  if (result.outcome === "INVALID") {
    console.warn("[linkedin_ads] lead form response had no usable contact point", {
      businessId,
      responseId: response.id,
      reasons: result.reasons,
    });
  }
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
    // Rest.li 2.0: the parentheses and the key stay raw; only the URN inside
    // is encoded, once -- `owner=(organization:urn%3Ali%3Aorganization%3A123)`
    // exactly as the Lead Sync docs write it. Encoding the whole value again
    // turned %3A into %253A.
    const owner = `(organization:${encodeURIComponent(`urn:li:organization:${organizationId}`)})`;
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
      await ingestLeadFormResponse(businessId, lead, accessToken);
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
