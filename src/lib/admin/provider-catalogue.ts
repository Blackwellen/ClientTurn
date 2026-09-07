/**
 * The provider catalogue: every provider ClientTurn can talk to, what kind of
 * thing it is, what it can do, and which environment variable holds its
 * credential.
 *
 * This is *not* the configuration — priority, cost ceilings, rate limits and
 * country availability live in `platform_providers` and are edited by an
 * operator. The catalogue is the fixed part: a provider that is not here has no
 * client code behind it, so offering it in the settings UI would be a promise
 * the platform could not keep.
 *
 * `credentialRef` names the variable rather than reading it here, so this file
 * stays free of `server-only` and can be imported by a type or a label.
 */

import type { ProviderType, UnitBasis } from "./platform-settings-types";

export type CatalogueEntry = {
  provider: string;
  label: string;
  type: ProviderType;
  capabilities: string[];
  /** The environment variable(s) that must all be set for this to be usable. */
  credentialRef: string;
  requiredEnv: string[];
  defaultUnitBasis: UnitBasis;
};

export const PROVIDER_CATALOGUE: CatalogueEntry[] = [
  {
    provider: "supabase",
    label: "Supabase",
    type: "DATABASE",
    capabilities: ["Postgres", "Auth", "Realtime", "Row level security"],
    credentialRef: "env:SUPABASE_SERVICE_ROLE_KEY",
    requiredEnv: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "openai",
    label: "Azure OpenAI",
    type: "AI_MODEL",
    capabilities: [
      "Intent classification",
      "Value extraction",
      "Research summaries",
      "Copilot drafting",
    ],
    credentialRef: "env:AZURE_OPENAI_API_KEY",
    requiredEnv: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
    defaultUnitBasis: "TOKEN",
  },
  {
    provider: "meta",
    label: "Meta",
    type: "SOCIAL",
    capabilities: ["Lead Ads ingestion", "Page webhooks", "Ad account sync"],
    credentialRef: "env:META_APP_SECRET",
    requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "twilio_sms",
    label: "Twilio SMS",
    type: "MESSAGING",
    capabilities: ["Outbound SMS", "Inbound SMS", "Delivery receipts"],
    credentialRef: "env:TWILIO_AUTH_TOKEN",
    requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    defaultUnitBasis: "SEGMENT",
  },
  {
    provider: "twilio_whatsapp",
    label: "WhatsApp (Twilio)",
    type: "MESSAGING",
    capabilities: ["Template messages", "Session messages", "Delivery receipts"],
    credentialRef: "env:TWILIO_AUTH_TOKEN",
    requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
    defaultUnitBasis: "MESSAGE",
  },
  {
    provider: "resend",
    label: "Resend",
    type: "EMAIL_INFRA",
    capabilities: ["Transactional email", "Outreach email", "Bounce webhooks"],
    credentialRef: "env:RESEND_API_KEY",
    requiredEnv: ["RESEND_API_KEY"],
    defaultUnitBasis: "MESSAGE",
  },
  {
    provider: "stripe",
    label: "Stripe",
    type: "PAYMENTS",
    capabilities: ["Subscriptions", "Invoices", "Customer balance", "Webhooks"],
    credentialRef: "env:STRIPE_SECRET_KEY_TEST",
    requiredEnv: ["STRIPE_SECRET_KEY_TEST"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "calendly",
    label: "Calendly",
    type: "CALENDAR",
    capabilities: ["Booking webhooks", "Event types", "Scheduling links"],
    credentialRef: "env:CALENDLY_CLIENT_SECRET",
    requiredEnv: ["CALENDLY_CLIENT_ID", "CALENDLY_CLIENT_SECRET"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "google_calendar",
    label: "Google Calendar",
    type: "CALENDAR",
    capabilities: ["Availability", "Event creation", "Two-way sync"],
    credentialRef: "env:GOOGLE_CLIENT_SECRET",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "google_workspace",
    label: "Google Workspace",
    type: "EMAIL_INFRA",
    capabilities: ["Gmail API send", "Gmail API poll", "Thread resolution"],
    credentialRef: "env:GOOGLE_CLIENT_SECRET",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    defaultUnitBasis: "MESSAGE",
  },
  {
    provider: "microsoft_365",
    label: "Microsoft 365",
    type: "EMAIL_INFRA",
    capabilities: ["Graph send", "Graph poll", "Thread resolution"],
    credentialRef: "env:MICROSOFT_CLIENT_SECRET",
    requiredEnv: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    defaultUnitBasis: "MESSAGE",
  },
  {
    provider: "pipedrive",
    label: "Pipedrive",
    type: "CRM",
    capabilities: ["Contact push", "Deal push", "Field mapping"],
    credentialRef: "env:PIPEDRIVE_CLIENT_SECRET",
    requiredEnv: ["PIPEDRIVE_CLIENT_ID", "PIPEDRIVE_CLIENT_SECRET"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "hubspot",
    label: "HubSpot",
    type: "CRM",
    capabilities: ["Contact push", "Deal push", "Field mapping"],
    credentialRef: "env:HUBSPOT_CLIENT_SECRET",
    requiredEnv: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"],
    defaultUnitBasis: "REQUEST",
  },
  {
    provider: "apollo",
    label: "Apollo",
    type: "PROSPECT_SEARCH",
    capabilities: ["Company search", "Contact search", "Firmographics"],
    credentialRef: "env:APOLLO_API_KEY",
    requiredEnv: ["APOLLO_API_KEY"],
    defaultUnitBasis: "RECORD",
  },
  {
    provider: "hunter",
    label: "Hunter.io",
    type: "EMAIL_VERIFICATION",
    capabilities: ["Email finder", "Email verification", "Domain search"],
    credentialRef: "env:HUNTER_API_KEY",
    requiredEnv: ["HUNTER_API_KEY"],
    defaultUnitBasis: "RECORD",
  },
  {
    provider: "clearbit",
    label: "Clearbit",
    type: "ENRICHMENT",
    capabilities: [
      "Company enrichment",
      "Contact enrichment",
      "Firmographics",
      "Technographics",
    ],
    credentialRef: "env:CLEARBIT_API_KEY",
    requiredEnv: ["CLEARBIT_API_KEY"],
    defaultUnitBasis: "RECORD",
  },
  {
    provider: "zerobounce",
    label: "ZeroBounce",
    type: "EMAIL_VERIFICATION",
    capabilities: ["Email verification", "Catch-all detection", "Bulk verification"],
    credentialRef: "env:ZEROBOUNCE_API_KEY",
    requiredEnv: ["ZEROBOUNCE_API_KEY"],
    defaultUnitBasis: "RECORD",
  },
];

const BY_PROVIDER = new Map(
  PROVIDER_CATALOGUE.map((entry) => [entry.provider, entry]),
);

export function catalogueEntry(provider: string): CatalogueEntry | undefined {
  return BY_PROVIDER.get(provider);
}
