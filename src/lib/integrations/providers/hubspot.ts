import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { registerCrmProvider, type CrmLeadInput } from "@/lib/integrations/providers/crm-registry";

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
 *   (POST /crm/v3/objects/deals; HubSpot-defined association type id 4 = contact -> deal.
 *   Required scopes: crm.objects.deals.read / crm.objects.deals.write.)
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
        "That token does not have permission to read/write contacts. Add the crm.objects.contacts and crm.objects.deals scopes to the private app and try again.",
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

async function upsertDeal(
  token: string,
  lead: CrmLeadInput,
  contactId: string,
  previousDealId: string | null,
): Promise<string> {
  const amount = lead.services?.average_value;
  const properties: Record<string, string> = {
    dealname: `${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "New lead"} - ${lead.services?.name ?? "Client Turn"}`,
  };
  if (amount != null) properties.amount = String(amount);

  if (previousDealId) {
    const updated = await hubspotFetch(token, `/crm/v3/objects/deals/${previousDealId}`, {
      method: "PATCH",
      body: { properties },
    });
    if (updated.ok) return previousDealId;
  }

  const created = await hubspotFetch(token, "/crm/v3/objects/deals", {
    method: "POST",
    body: {
      properties,
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 4 }],
        },
      ],
    },
  });
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
    existingRecord?.external_contact_id ?? null,
  );

  let dealId: string | null = null;
  if (params.lead.services?.average_value != null) {
    dealId = await upsertDeal(
      token,
      params.lead,
      contactId,
      existingRecord?.external_deal_id ?? null,
    );
  }

  return { externalContactId: contactId, externalDealId: dealId };
}

registerCrmProvider("hubspot", { push });
