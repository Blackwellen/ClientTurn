/**
 * Customer-facing connection copy that more than one surface needs. Pure.
 */

/** HubSpot scopes, read *and* write: the push searches by email before it creates. */
export const HUBSPOT_REQUIRED_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
] as const;

export const HUBSPOT_SCOPE_HELP = `That token does not have permission to read and write contacts. Give the service key (or private app) these scopes and try again: ${HUBSPOT_REQUIRED_SCOPES.join(", ")}.`;
