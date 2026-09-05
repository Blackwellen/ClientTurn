/**
 * Provider catalogue and pure display helpers. Free of `server-only` and of any
 * Supabase import so client components can use these directly.
 */

export type ProviderType =
  | "meta"
  | "twilio_sms"
  | "twilio_whatsapp"
  | "google_calendar"
  | "calendly"
  | "email"
  | "google_ads"
  | "microsoft_ads"
  | "tiktok_ads"
  | "linkedin_ads"
  | "slack"
  | "hubspot"
  | "zoho_crm";

export type IntegrationCategory = "leads" | "messaging" | "booking" | "email" | "crm";

export type PlanFeature = "whatsapp";

export type ProviderDefinition = {
  id: ProviderType;
  name: string;
  category: IntegrationCategory;
  /** One plain sentence: what connecting this actually does. */
  summary: string;
  /** Named so support can tell a customer what to look for. */
  accountLabel: string;
  /** Environment variables the platform needs before a connection is possible. */
  requiredEnv: string[];
  /** Feature gate that must be in the plan before this can be connected. */
  requiresFeature?: PlanFeature;
  /**
   * `platform` providers are run by Client Turn on every workspace's behalf and
   * are never connected by the customer; `workspace` providers need the
   * customer's own account.
   */
  connection: "workspace" | "platform";
  /** Server route that starts the connection. Null until that flow is live. */
  connectPath: string | null;
  /**
   * `oauth` navigates to `connectPath`, a redirect flow. `token` opens a
   * dialog for a customer-pasted credential instead (e.g. a HubSpot private
   * app token) — there is no redirect for those.
   */
  connectionMethod: "oauth" | "token";
  /** What stops working the moment this is disconnected. */
  disconnectConsequence: string;
  configurable: boolean;
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "meta",
    connection: "workspace",
    connectPath: null,
    connectionMethod: "oauth",
    name: "Meta Lead Ads",
    category: "leads",
    summary:
      "Delivers every new lead from your Facebook and Instagram lead forms into Client Turn within seconds.",
    accountLabel: "Business account",
    requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
    disconnectConsequence:
      "New leads from your Facebook and Instagram forms stop arriving. Leads already in Client Turn are kept, and follow-up for them continues.",
    configurable: true,
  },
  {
    id: "twilio_sms",
    connection: "workspace",
    connectPath: null,
    connectionMethod: "oauth",
    name: "Twilio SMS",
    category: "messaging",
    summary:
      "Sends your follow-up text messages and receives the replies that drive qualification.",
    accountLabel: "Sending number",
    requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    disconnectConsequence:
      "All SMS follow-up stops immediately, including sequences already in progress, and inbound replies are no longer received.",
    configurable: true,
  },
  {
    id: "twilio_whatsapp",
    connection: "workspace",
    connectPath: null,
    connectionMethod: "oauth",
    name: "WhatsApp",
    category: "messaging",
    summary:
      "Sends follow-up over WhatsApp where a lead prefers it, using approved message templates.",
    accountLabel: "WhatsApp sender",
    requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
    requiresFeature: "whatsapp",
    disconnectConsequence:
      "WhatsApp follow-up stops. Conversations already on WhatsApp fall back to SMS only if a mobile number is on file.",
    configurable: true,
  },
  {
    id: "google_calendar",
    connection: "workspace",
    connectPath: null,
    connectionMethod: "oauth",
    name: "Google Calendar",
    category: "booking",
    summary:
      "Offers your real availability to qualified leads and writes confirmed appointments into your calendar.",
    accountLabel: "Calendar",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    disconnectConsequence:
      "Qualified leads are no longer offered calendar slots, and new appointments are not written to your calendar. Existing bookings stay in Client Turn.",
    configurable: true,
  },
  {
    id: "calendly",
    connection: "workspace",
    connectPath: null,
    connectionMethod: "oauth",
    name: "Calendly",
    category: "booking",
    summary:
      "Sends your Calendly link to qualified leads and records the booking when they choose a time.",
    accountLabel: "Calendly account",
    requiredEnv: ["CALENDLY_CLIENT_ID", "CALENDLY_CLIENT_SECRET"],
    disconnectConsequence:
      "Booking links stop being sent automatically and Calendly bookings stop being recorded against leads.",
    configurable: true,
  },
  {
    id: "email",
    connection: "platform",
    connectPath: null,
    connectionMethod: "oauth",
    name: "Resend email",
    category: "email",
    summary:
      "Sends your system email — invitations, handover alerts and integration failure warnings.",
    accountLabel: "Sending domain",
    requiredEnv: ["RESEND_API_KEY"],
    disconnectConsequence:
      "Invitations, handover alerts and failure warnings stop being emailed. Lead follow-up is unaffected.",
    configurable: true,
  },  {
    id: "google_ads",
    connection: "workspace",
    connectPath: "/api/integrations/google_ads/connect",
    connectionMethod: "oauth",
    name: "Google Ads",
    category: "leads",
    summary:
      "Delivers leads from your Google Ads Lead Form extensions into Client Turn.",
    accountLabel: "Google Ads account",
    requiredEnv: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    disconnectConsequence:
      "New leads from your Google Ads lead forms stop arriving. Leads already in Client Turn keep their follow-up.",
    configurable: true,
  },
  {
    id: "microsoft_ads",
    connection: "workspace",
    connectPath: "/api/integrations/microsoft_ads/connect",
    connectionMethod: "oauth",
    name: "Microsoft Advertising",
    category: "leads",
    summary:
      "Delivers leads from your Microsoft (Bing) Advertising Lead Form extensions into Client Turn.",
    accountLabel: "Microsoft Advertising account",
    requiredEnv: ["MICROSOFT_ADS_CLIENT_ID", "MICROSOFT_ADS_CLIENT_SECRET", "MICROSOFT_ADS_DEVELOPER_TOKEN"],
    disconnectConsequence:
      "New leads from your Microsoft Advertising lead forms stop arriving. Leads already in Client Turn keep their follow-up.",
    configurable: true,
  },
  {
    id: "tiktok_ads",
    connection: "workspace",
    connectPath: "/api/integrations/tiktok_ads/connect",
    connectionMethod: "oauth",
    name: "TikTok Lead Generation",
    category: "leads",
    summary:
      "Delivers leads from your TikTok Lead Generation ads into Client Turn.",
    accountLabel: "TikTok for Business account",
    requiredEnv: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"],
    disconnectConsequence:
      "New leads from your TikTok lead forms stop arriving. Leads already in Client Turn keep their follow-up.",
    configurable: true,
  },
  {
    id: "linkedin_ads",
    connection: "workspace",
    connectPath: "/api/integrations/linkedin_ads/connect",
    connectionMethod: "oauth",
    name: "LinkedIn Lead Gen Forms",
    category: "leads",
    summary:
      "Delivers leads from your LinkedIn Lead Gen Forms ads into Client Turn.",
    accountLabel: "LinkedIn ad account",
    requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    disconnectConsequence:
      "New leads from your LinkedIn lead forms stop arriving. Leads already in Client Turn keep their follow-up.",
    configurable: true,
  },
  {
    id: "slack",
    connection: "workspace",
    connectPath: "/api/integrations/slack/connect",
    connectionMethod: "oauth",
    name: "Slack",
    category: "messaging",
    summary:
      "Posts new-lead and handover alerts into a Slack channel your team is already watching.",
    accountLabel: "Slack workspace",
    requiredEnv: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    disconnectConsequence:
      "Slack alerts stop. Nothing about lead handling changes — this is a notification channel only.",
    configurable: true,
  },
  {
    id: "hubspot",
    connection: "workspace",
    connectPath: null,
    connectionMethod: "token",
    name: "HubSpot",
    category: "crm",
    summary:
      "Pushes qualified leads and bookings into your HubSpot CRM as contacts and deals.",
    accountLabel: "HubSpot portal",
    requiredEnv: [],
    disconnectConsequence:
      "Leads stop being pushed to HubSpot. Nothing in Client Turn itself changes.",
    configurable: true,
  },
  {
    id: "zoho_crm",
    connection: "workspace",
    connectPath: "/api/integrations/zoho_crm/connect",
    connectionMethod: "oauth",
    name: "Zoho CRM",
    category: "crm",
    summary:
      "Pushes qualified leads and bookings into your Zoho CRM as leads and deals.",
    accountLabel: "Zoho CRM account",
    requiredEnv: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"],
    disconnectConsequence:
      "Leads stop being pushed to Zoho CRM. Nothing in Client Turn itself changes.",
    configurable: true,
  },
];

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  leads: "Lead sources",
  messaging: "Messaging",
  booking: "Booking",
  email: "Email",
  crm: "CRM",
};

export const CATEGORY_ORDER: IntegrationCategory[] = [
  "leads",
  "messaging",
  "booking",
  "crm",
  "email",
];

export type IntegrationRecord = {
  id: string;
  providerType: ProviderType;
  status: string;
  externalAccountId: string | null;
  displayName: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export type IntegrationObjectRecord = {
  id: string;
  objectType: string;
  externalId: string;
  name: string | null;
  enabled: boolean;
  mappedFieldCount: number;
};

/** Why a provider cannot be connected right now, if anything. */
export type ProviderBlock =
  | { kind: "unavailable"; reason: string }
  | { kind: "plan"; reason: string }
  | null;

export type ProviderCardModel = {
  definition: ProviderDefinition;
  integration: IntegrationRecord | null;
  block: ProviderBlock;
  connected: boolean;
  status: string;
};

export function connectionStatus(integration: IntegrationRecord | null) {
  return integration?.status ?? "DISCONNECTED";
}

export function isConnected(integration: IntegrationRecord | null) {
  return Boolean(integration) && integration!.status !== "DISCONNECTED";
}

/** Never a token — only a human-readable reference to the connected account. */
export function accountReference(integration: IntegrationRecord | null) {
  if (!integration) return null;
  return integration.displayName ?? integration.externalAccountId ?? null;
}

export function primaryActionLabel(model: ProviderCardModel) {
  if (model.block || model.definition.connection === "platform") return null;
  if (!model.connected) return "Connect";
  if (model.status === "ACTION_REQUIRED" || model.status === "DEGRADED") {
    return "Reconnect";
  }
  return "Configure";
}

export const OBJECT_TYPE_LABELS: Record<string, string> = {
  meta_page: "Page",
  meta_form: "Lead form",
  google_calendar: "Calendar",
  calendly_event_type: "Event type",
  phone_number: "Number",
};

export function formMappingState(object: IntegrationObjectRecord) {
  if (!object.enabled) {
    return { label: "Not receiving", tone: "neutral" as const };
  }
  if (object.mappedFieldCount === 0) {
    return { label: "Fields not mapped", tone: "warning" as const };
  }
  return { label: `${object.mappedFieldCount} fields mapped`, tone: "success" as const };
}
