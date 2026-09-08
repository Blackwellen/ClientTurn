import "server-only";

export type CrmLeadInput = {
  id: string;
  business_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  status: string;
  qualification_state: string;
  created_at: string;
  services: { name: string; average_value: number | null } | null;
};

export type CrmPushResult = {
  externalContactId: string;
  externalDealId?: string | null;
};

export type CrmAdapter = {
  push: (params: { integrationId: string; lead: CrmLeadInput }) => Promise<CrmPushResult>;
};

/**
 * A push that got part of the way and then failed.
 *
 * A CRM push is not one call. HubSpot creates or updates a contact, then
 * creates a deal against it. If the deal fails the contact still exists in the
 * customer's CRM -- and until this error existed, its id went with the
 * exception: the handler recorded `status: failed` with no
 * `external_contact_id`, so the retry read no prior contact and **created a
 * second one**. Every subsequent retry created another. The customer's CRM
 * filled with duplicates of the same person, and the only record on our side
 * said the push had failed.
 *
 * Carrying the id out with the failure is what makes the retry idempotent: the
 * next attempt finds the contact, updates it, and tries the deal again.
 */
export class CrmPartialPushError extends Error {
  readonly externalContactId: string;
  readonly externalDealId: string | null;

  constructor(
    message: string,
    partial: { externalContactId: string; externalDealId?: string | null },
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CrmPartialPushError";
    this.externalContactId = partial.externalContactId;
    this.externalDealId = partial.externalDealId ?? null;
  }
}

const registry = new Map<string, CrmAdapter>();

export function registerCrmProvider(provider: "hubspot" | "zoho_crm", adapter: CrmAdapter) {
  registry.set(provider, adapter);
}

export function isCrmProvider(provider: string): provider is "hubspot" | "zoho_crm" {
  return registry.has(provider);
}

export function getCrmPushAdapter(provider: string): CrmAdapter {
  const adapter = registry.get(provider);
  if (!adapter) throw new Error(`No CRM adapter registered for ${provider}`);
  return adapter;
}
