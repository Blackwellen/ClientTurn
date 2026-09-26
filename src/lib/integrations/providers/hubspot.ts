import "server-only";
import { HUBSPOT_SCOPE_HELP } from "@/lib/integrations/connector-copy";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  CrmPartialPushError,
  registerCrmProvider,
  type CrmEraseResult,
  type CrmLeadInput,
  type CrmNoteInput,
} from "@/lib/integrations/providers/crm-registry";
import { hubspotDealStage } from "@/lib/opportunities/stages";
import type { CrmPullPage, CrmPulledRecord } from "@/lib/integrations/crm-pull/plan";

/**
 * HubSpot — CRM push destination via a customer-pasted Private App token.
 *
 * Docs consulted live while building this:
 * - Private apps: https://developers.hubspot.com/docs/api/private-apps
 *   (Settings -> Integrations -> Private Apps -> Create a private app -> Scopes
 *   -> reveal token on the Auth tab. Sent as `Authorization: Bearer <token>`.)
 * - Contacts: https://developers.hubspot.com/docs/api/crm/contacts
 *   (POST /crm/v3/objects/contacts, PATCH /crm/v3/objects/contacts/{id},
 *   POST /crm/v3/objects/contacts/search. Required scopes: crm.objects.contacts.read
 *   and crm.objects.contacts.write.)
 * - Deals + associations: https://developers.hubspot.com/docs/api/crm/deals
 *   (POST /crm/v3/objects/deals; HubSpot-defined association type id 3 = deal -> contact,
 *   confirmed live against GET /crm/v4/associations/deals/contacts/labels, which returns
 *   only { typeId: 3, fromObjectTypeId: "0-3", toObjectTypeId: "0-1" }. Id 4 is the reverse
 *   direction (contact -> deal) and is rejected when creating a deal with this association
 *   shape ("invalid from object type 0-3 ... expected 0-1"). Required scopes:
 *   crm.objects.deals.read / crm.objects.deals.write.)
 *
 * HubSpot's batch "upsert" endpoint (crm/v3/objects/contacts/batch/upsert) has
 * long-standing, publicly reported bugs around missing properties on newly
 * created records and dropped associations, so this adapter does the upsert
 * itself: search by email (or reuse the id already recorded from a previous
 * push) and PATCH if found, otherwise POST to create.
 *
 * We deliberately write only HubSpot's standard contact properties
 * (firstname, lastname, email, phone, zip). A custom property to carry
 * `qualification_state`/`status` would have to be created in the customer's
 * HubSpot portal first, which we cannot assume, so that context is left out
 * rather than risking every push failing on an unknown-property error.
 */

const API_ROOT = "https://api.hubapi.com";

// GET /account-info/v3/details returns portalId, accountType, timeZone etc.
// It has no account/company name field, so the display name is derived from
// the portal id alone.
type HubSpotAccountInfo = {
  portalId?: number;
};

async function hubspotFetch(
  token: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, json };
}

export async function connectHubspot(
  workspace: { businessId: string; userId: string; role: string },
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Prove the token actually works before saving anything. The account-info
  // endpoint is the lightest authenticated call HubSpot exposes and reveals
  // the portal id/name for display, so it doubles as identification.
  const info = await fetch(`${API_ROOT}/account-info/v3/details`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!info) {
    return { ok: false, error: "Could not reach HubSpot. Try again." };
  }

  if (!info.ok) {
    return info.status === 401 || info.status === 403
      ? { ok: false, error: "That token was rejected by HubSpot. Check it and try again." }
      : { ok: false, error: "Could not verify that token with HubSpot. Try again." };
  }

  const account = (await info.json().catch(() => ({} as HubSpotAccountInfo))) as HubSpotAccountInfo;

  // A second, scope-specific call: account-info succeeding only proves the
  // token is real, not that it can write contacts/deals, so also confirm the
  // scopes we actually need are granted.
  const scopeCheck = await hubspotFetch(token, "/crm/v3/objects/contacts?limit=1", {
    method: "GET",
  });
  if (!scopeCheck.ok) {
    return {
      ok: false,
      error:
        HUBSPOT_SCOPE_HELP,
    };
  }

  const admin = createAdminClient();
  const externalAccountId = account.portalId != null ? String(account.portalId) : null;
  const displayName = externalAccountId ? `HubSpot portal ${externalAccountId}` : null;

  const { data: integration, error } = await admin
    .from("integrations")
    .upsert(
      {
        business_id: workspace.businessId,
        provider_type: "hubspot",
        status: "HEALTHY",
        external_account_id: externalAccountId,
        display_name: displayName,
        scopes: [],
        connected_by: workspace.userId,
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_code: null,
        last_error_message: null,
      },
      { onConflict: "business_id,provider_type" },
    )
    .select("id")
    .single();

  if (error || !integration) {
    return { ok: false, error: "Could not save the connection." };
  }

  const { error: secretError } = await admin.from("integration_secrets").upsert(
    {
      integration_id: integration.id,
      business_id: workspace.businessId,
      access_token: token,
      refresh_token: null,
      token_expires_at: null,
    },
    { onConflict: "integration_id" },
  );

  if (secretError) {
    return { ok: false, error: "Could not save the connection." };
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.connected",
    entityType: "integration",
    entityId: integration.id,
    metadata: { provider: "hubspot" },
  });

  return { ok: true };
}

async function getStoredToken(integrationId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!data?.access_token) {
    throw new Error("No stored HubSpot token for this integration.");
  }
  return data.access_token;
}

function contactProperties(lead: CrmLeadInput): Record<string, string> {
  const properties: Record<string, string> = {};
  if (lead.first_name) properties.firstname = lead.first_name;
  if (lead.last_name) properties.lastname = lead.last_name;
  if (lead.email) properties.email = lead.email;
  if (lead.phone) properties.phone = lead.phone;
  if (lead.postcode) properties.zip = lead.postcode;
  // HubSpot's standard contact property. Optional there, so only when known.
  if (lead.company_name?.trim()) properties.company = lead.company_name.trim();
  return properties;
}

async function findContactIdByEmail(token: string, email: string): Promise<string | null> {
  const result = await hubspotFetch(token, "/crm/v3/objects/contacts/search", {
    method: "POST",
    body: {
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
      limit: 1,
    },
  });
  if (!result.ok) return null;
  const results = result.json.results as Array<{ id: string }> | undefined;
  return results?.[0]?.id ?? null;
}

async function upsertContact(
  token: string,
  lead: CrmLeadInput,
  previousContactId: string | null,
): Promise<string> {
  const properties = contactProperties(lead);

  const existingId =
    previousContactId ?? (lead.email ? await findContactIdByEmail(token, lead.email) : null);

  if (existingId) {
    const updated = await hubspotFetch(token, `/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH",
      body: { properties },
    });
    if (updated.ok) return existingId;
    // Fall through to create if the previously recorded contact was deleted.
  }

  const created = await hubspotFetch(token, "/crm/v3/objects/contacts", {
    method: "POST",
    body: { properties },
  });
  if (!created.ok) {
    throw new Error(
      `HubSpot rejected the contact (status ${created.status}): ${JSON.stringify(created.json)}`,
    );
  }
  return String(created.json.id);
}

/**
 * Deal properties from the opportunity (decision Q3), falling back to the
 * service's average value for a lead pushed before it had one.
 *
 * Stage: `pipeline: "default"` plus one of HubSpot's default-pipeline stage
 * ids (stages.ts `hubspotDealStage`) -- closedwon / closedlost once the
 * opportunity is closed, with the reason in HubSpot's standard
 * `closed_won_reason` / `closed_lost_reason` properties.
 */
function dealProperties(lead: CrmLeadInput, withStage: boolean): Record<string, string> {
  const opportunity = lead.opportunity ?? null;
  const person = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "New lead";
  const properties: Record<string, string> = {
    dealname: opportunity?.name ?? `${person} - ${lead.services?.name ?? "Client Turn"}`,
  };
  const amount = opportunity?.value ?? lead.services?.average_value ?? null;
  if (amount != null) properties.amount = String(amount);
  if (opportunity?.currency) properties.deal_currency_code = opportunity.currency;

  if (withStage && opportunity) {
    properties.pipeline = "default";
    properties.dealstage = hubspotDealStage(opportunity.stage, opportunity.outcome);
    if (opportunity.closedAt) properties.closedate = opportunity.closedAt;
    if (opportunity.outcome === "WON" && opportunity.outcomeReason) {
      properties.closed_won_reason = opportunity.outcomeReason.slice(0, 500);
    }
    if (opportunity.outcome === "LOST" && opportunity.outcomeReason) {
      properties.closed_lost_reason = opportunity.outcomeReason.slice(0, 500);
    }
  }
  return properties;
}

/**
 * A portal that renamed or removed the default pipeline's stages, or turned
 * off multi-currency, rejects those properties with a 400 naming them. The
 * deal itself is still worth writing, so the call is repeated once without
 * the stage fields rather than failing the whole push.
 */
function rejectedStageProperties(result: { status: number; json: Record<string, unknown> }): boolean {
  if (result.status !== 400) return false;
  const text = JSON.stringify(result.json).toLowerCase();
  return /dealstage|pipeline|closed_(won|lost)_reason|deal_currency_code|closedate/.test(text);
}

async function upsertDeal(
  token: string,
  lead: CrmLeadInput,
  contactId: string,
  previousDealId: string | null,
): Promise<string> {
  if (previousDealId) {
    let updated = await hubspotFetch(token, `/crm/v3/objects/deals/${previousDealId}`, {
      method: "PATCH",
      body: { properties: dealProperties(lead, true) },
    });
    if (!updated.ok && rejectedStageProperties(updated)) {
      updated = await hubspotFetch(token, `/crm/v3/objects/deals/${previousDealId}`, {
        method: "PATCH",
        body: { properties: dealProperties(lead, false) },
      });
    }
    if (updated.ok) return previousDealId;
  }

  const create = (withStage: boolean) =>
    hubspotFetch(token, "/crm/v3/objects/deals", {
      method: "POST",
      body: {
        properties: dealProperties(lead, withStage),
        associations: [
          {
            to: { id: contactId },
            // Deal -> contact, not contact -> deal (id 4). Confirmed live against
            // GET /crm/v4/associations/deals/contacts/labels -- see header comment.
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
          },
        ],
      },
    });

  let created = await create(true);
  if (!created.ok && rejectedStageProperties(created)) created = await create(false);
  if (!created.ok) {
    throw new Error(
      `HubSpot rejected the deal (status ${created.status}): ${JSON.stringify(created.json)}`,
    );
  }
  return String(created.json.id);
}

async function push(params: {
  integrationId: string;
  lead: CrmLeadInput;
  linkedExternalId?: string | null;
}): Promise<{ externalContactId: string; externalDealId?: string | null }> {
  const token = await getStoredToken(params.integrationId);

  const admin = createAdminClient();
  const { data: existingRecord } = await admin
    .from("crm_push_records")
    .select("external_contact_id, external_deal_id")
    .eq("business_id", params.lead.business_id)
    .eq("lead_id", params.lead.id)
    .eq("provider_type", "hubspot")
    .maybeSingle();

  const contactId = await upsertContact(
    token,
    params.lead,
    // A contact pulled from HubSpot is updated in place, not re-created.
    existingRecord?.external_contact_id ?? params.linkedExternalId ?? null,
  );

  let dealId: string | null = null;
  // A deal once the lead has an opportunity (decision Q3) or, as before, a
  // service with a value to put on one.
  if (params.lead.opportunity || params.lead.services?.average_value != null) {
    try {
      dealId = await upsertDeal(
        token,
        params.lead,
        contactId,
        existingRecord?.external_deal_id ?? null,
      );
    } catch (error) {
      // The contact exists in the customer's HubSpot whether or not the deal
      // does. Throwing a plain error here discarded its id, so the retry read
      // no prior contact and created a second one -- and the one after that a
      // third. Handing the id to the caller is what makes this retryable
      // instead of duplicating a person on every attempt.
      throw new CrmPartialPushError(
        error instanceof Error ? error.message : "The deal could not be created.",
        { externalContactId: contactId },
        { cause: error },
      );
    }
  }

  return { externalContactId: contactId, externalDealId: dealId };
}

/**
 * Erasure uses HubSpot's GDPR delete, which removes the contact permanently
 * (not to the recycle bin) and blocks the address from being re-created by
 * form submissions. The deal, whose name can carry the person's name, is
 * archived. Scope: crm.objects.contacts.write, already required for push.
 */
async function erase(params: {
  integrationId: string;
  externalContactId: string;
  externalDealId: string | null;
}): Promise<CrmEraseResult> {
  const token = await getStoredToken(params.integrationId);

  const contact = await hubspotFetch(token, "/crm/v3/objects/contacts/gdpr-delete", {
    method: "POST",
    body: { objectId: params.externalContactId },
  });
  if (contact.status === 404) {
    return { outcome: "NOT_FOUND", detail: "HubSpot has no contact with the recorded id." };
  }
  if (!contact.ok) {
    throw new Error(`HubSpot refused the GDPR delete (status ${contact.status}).`);
  }

  if (params.externalDealId) {
    // Best effort: the contact, which holds the personal data, is already gone.
    await hubspotFetch(token, `/crm/v3/objects/deals/${params.externalDealId}`, {
      method: "DELETE",
    }).catch(() => null);
  }

  return {
    outcome: "DELETED",
    detail: params.externalDealId
      ? "Contact permanently deleted in HubSpot (GDPR delete); the linked deal was archived."
      : "Contact permanently deleted in HubSpot (GDPR delete).",
  };
}

/**
 * The handoff brief as a HubSpot note on the contact (Phase 3.4).
 * POST /crm/v3/objects/notes with `hs_note_body` and `hs_timestamp`,
 * associated note -> contact with HubSpot-defined association type 202.
 * Notes are covered by the contact scopes the push already requires.
 */
async function pushNote(params: CrmNoteInput): Promise<{ externalNoteId: string }> {
  const token = await getStoredToken(params.integrationId);
  const created = await hubspotFetch(token, "/crm/v3/objects/notes", {
    method: "POST",
    body: {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: params.body.slice(0, 60_000),
      },
      associations: [
        {
          to: { id: params.externalContactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
        },
      ],
    },
  });
  if (!created.ok) {
    throw new Error(`HubSpot rejected the note (status ${created.status}).`);
  }
  return { externalNoteId: String(created.json.id) };
}

/**
 * The opt-in inbound sync (brief §29). One page of contacts modified at or
 * after `since`, oldest first, through the CRM search API:
 * POST /crm/v3/objects/contacts/search, filter `lastmodifieddate GTE`, sorted
 * ascending, paged with `after`. Scope: crm.objects.contacts.read (already
 * required for push).
 *
 * The owner's email comes from GET /crm/v3/owners, which needs
 * crm.objects.owners.read. A token without it still pulls -- the owner is just
 * left unmapped rather than failing the page.
 */
const PULL_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "company",
  "jobtitle",
  "zip",
  "createdate",
  "lastmodifieddate",
  "hubspot_owner_id",
];

async function ownerEmails(token: string): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const result = await hubspotFetch(token, "/crm/v3/owners/?limit=500", { method: "GET" }).catch(
    () => null,
  );
  if (!result?.ok) return owners;
  for (const owner of (result.json.results as Array<{ id?: string; email?: string }> | undefined) ?? []) {
    if (owner.id && owner.email) owners.set(String(owner.id), owner.email);
  }
  return owners;
}

async function pull(params: {
  integrationId: string;
  since: string;
  pageToken: string | null;
  pageSize: number;
}): Promise<CrmPullPage> {
  const token = await getStoredToken(params.integrationId);

  const result = await hubspotFetch(token, "/crm/v3/objects/contacts/search", {
    method: "POST",
    body: {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "lastmodifieddate",
              operator: "GTE",
              value: String(Date.parse(params.since)),
            },
          ],
        },
      ],
      sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
      properties: PULL_PROPERTIES,
      limit: Math.min(Math.max(params.pageSize, 1), 100),
      ...(params.pageToken ? { after: params.pageToken } : {}),
    },
  });

  if (result.status === 429) return { records: [], nextPageToken: null, rateLimited: true };
  if (!result.ok) {
    throw new Error(`HubSpot refused the contact search (status ${result.status}).`);
  }

  const rows =
    (result.json.results as Array<{ id: string; properties?: Record<string, string | null> }> | undefined) ??
    [];
  const owners = rows.some((row) => row.properties?.hubspot_owner_id)
    ? await ownerEmails(token)
    : new Map<string, string>();

  const records: CrmPulledRecord[] = rows.map((row) => {
    const p = row.properties ?? {};
    return {
      externalId: String(row.id),
      objectType: "contact",
      firstName: p.firstname ?? null,
      lastName: p.lastname ?? null,
      email: p.email ?? null,
      phone: p.mobilephone || p.phone || null,
      companyName: p.company ?? null,
      roleTitle: p.jobtitle ?? null,
      postcode: p.zip ?? null,
      createdAt: p.createdate ?? null,
      modifiedAt: p.lastmodifieddate ?? "",
      ownerEmail: p.hubspot_owner_id ? (owners.get(String(p.hubspot_owner_id)) ?? null) : null,
    };
  });

  const paging = result.json.paging as { next?: { after?: string } } | undefined;
  return { records, nextPageToken: paging?.next?.after ?? null };
}

registerCrmProvider("hubspot", { push, erase, pushNote, pull });
