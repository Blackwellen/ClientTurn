import "server-only";
import type { CrmOpportunity } from "@/lib/opportunities/stages";
import type { CrmPullPage } from "@/lib/integrations/crm-pull/plan";

export type { CrmOpportunity };

export type CrmLeadInput = {
  id: string;
  business_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  /** The company the lead named, when it did. Sent as the CRM's company. */
  company_name?: string | null;
  status: string;
  qualification_state: string;
  created_at: string;
  services: { name: string; average_value: number | null } | null;
  /**
   * The lead's current opportunity (decision Q3), when it has one. Adapters
   * that model deals push its stage and, once closed, won/lost with the
   * reason. Absent on a lead that has not reached qualification.
   */
  opportunity?: CrmOpportunity | null;
};

/** A note to attach to the lead's CRM record (the handoff brief, Phase 3.4). */
export type CrmNoteInput = {
  integrationId: string;
  businessId: string;
  leadId: string;
  /** The CRM record id recorded by the last push (`crm_push_records`). */
  externalContactId: string;
  body: string;
};

export type CrmPushResult = {
  externalContactId: string;
  externalDealId?: string | null;
};

/**
 * What erasing a person in the connected CRM actually did. Reported per system
 * to the person who asked, so the wording has to be exact: a record moved to
 * a recycle bin is still there for a while, and saying "deleted" about it
 * would be untrue (brief §15).
 */
export type CrmEraseResult = {
  outcome: "DELETED" | "RECYCLED" | "NOT_FOUND";
  detail: string;
};

export type CrmAdapter = {
  /**
   * `linkedExternalId` is the CRM record this lead was pulled from, when it
   * was (`external_entity_links`). Adapters update that record rather than
   * creating a second one for the same person.
   */
  push: (params: {
    integrationId: string;
    lead: CrmLeadInput;
    linkedExternalId?: string | null;
  }) => Promise<CrmPushResult>;
  /**
   * Optional: remove the person from the CRM, by the ids a push recorded.
   * Absent means the adapter cannot, and the caller reports "manual".
   */
  erase?: (params: {
    integrationId: string;
    externalContactId: string;
    externalDealId: string | null;
  }) => Promise<CrmEraseResult>;
  /** Optional: attach a plain-text note to the pushed record. Absent = not supported. */
  pushNote?: (params: CrmNoteInput) => Promise<{ externalNoteId: string }>;
  /**
   * Optional: one page of records modified at or after `since` (brief §29,
   * the opt-in inbound sync). Oldest first. Absent = the adapter cannot pull.
   */
  pull?: (params: {
    integrationId: string;
    since: string;
    pageToken: string | null;
    pageSize: number;
  }) => Promise<CrmPullPage>;
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

export function registerCrmProvider(
  provider: "hubspot" | "zoho_crm" | "salesforce",
  adapter: CrmAdapter,
) {
  registry.set(provider, adapter);
}

export function isCrmProvider(provider: string): provider is "hubspot" | "zoho_crm" | "salesforce" {
  return registry.has(provider);
}

/** The adapter, or undefined when none is registered. Never throws. */
export function findCrmAdapter(provider: string): CrmAdapter | undefined {
  return registry.get(provider);
}

export function getCrmPushAdapter(provider: string): CrmAdapter {
  const adapter = registry.get(provider);
  if (!adapter) throw new Error(`No CRM adapter registered for ${provider}`);
  return adapter;
}
