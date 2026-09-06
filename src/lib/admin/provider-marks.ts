import type { ProviderType } from "@/lib/integrations/catalog";

/**
 * Maps the provider identifiers the admin feeds emit onto the integration
 * catalogue's `ProviderType`, so admin tables render the same brand mark as
 * the customer-facing Connections page rather than inventing a second
 * vocabulary for the same companies.
 *
 * Kept free of React so the mapping can be asserted against the files
 * actually present in `public/brands/` — a mark that silently stops
 * resolving should fail a test run, not render as a gap in an operator's
 * table.
 */
export const ADMIN_PROVIDER_ALIAS: Record<string, ProviderType> = {
  meta: "meta",
  twilio: "twilio_sms",
  twilio_sms: "twilio_sms",
  sms: "twilio_sms",
  twilio_whatsapp: "twilio_whatsapp",
  whatsapp: "twilio_whatsapp",
  whatsapp_cloud: "twilio_whatsapp",
  calendly: "calendly",
  google_calendar: "google_calendar",
  google_ads: "google_ads",
  microsoft_ads: "microsoft_ads",
  tiktok_ads: "tiktok_ads",
  linkedin_ads: "linkedin_ads",
  hubspot: "hubspot",
  zoho_crm: "zoho_crm",
  salesforce: "salesforce",
  slack: "slack",
  resend: "email",
  email: "email",
};

/**
 * Event sources that belong to the platform itself rather than to a
 * connectable provider. These deliberately have no brand mark: Stripe billing
 * events, background jobs and generic inbound webhooks are ours, not a
 * customer's integration.
 */
export const INTERNAL_EVENT_SOURCES = [
  "stripe",
  "billing",
  "job",
  "webhook",
] as const;

export type InternalEventSource = (typeof INTERNAL_EVENT_SOURCES)[number];

export function isInternalEventSource(
  provider: string,
): provider is InternalEventSource {
  return (INTERNAL_EVENT_SOURCES as readonly string[]).includes(provider);
}
