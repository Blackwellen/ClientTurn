/**
 * Platform Settings shapes shared with client components (V4 §47).
 *
 * Two things this file deliberately does *not* carry: secret values, and
 * anything a settings screen would have to invent. A provider row reports the
 * *name* of the credential reference and whether it resolves — never the
 * credential — and a limit that has not been configured reads as "not set"
 * rather than as an unlimited default.
 */

export const SETTINGS_VIEWS = [
  "providers",
  "ai",
  "outreach",
  "compliance",
  "price-book",
  "flags",
] as const;
export type SettingsView = (typeof SETTINGS_VIEWS)[number];

export const SETTINGS_VIEW_LABEL: Record<SettingsView, string> = {
  providers: "Providers",
  ai: "AI & Agents",
  outreach: "Outreach",
  compliance: "Compliance",
  "price-book": "Price Book",
  flags: "Feature Flags",
};

/* ------------------------------------------------------------- providers --- */

export const PROVIDER_TYPES = [
  "ENRICHMENT",
  "PROSPECT_SEARCH",
  "EMAIL_VERIFICATION",
  "AI_MODEL",
  "MESSAGING",
  "SOCIAL",
  "EMAIL_INFRA",
  "CRM",
  "CALENDAR",
  "DATABASE",
  "PAYMENTS",
  "OTHER",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = {
  ENRICHMENT: "Enrichment",
  PROSPECT_SEARCH: "Prospect search",
  EMAIL_VERIFICATION: "Email verification",
  AI_MODEL: "AI model",
  MESSAGING: "Messaging",
  SOCIAL: "Social",
  EMAIL_INFRA: "Email infrastructure",
  CRM: "CRM",
  CALENDAR: "Calendar",
  DATABASE: "Database",
  PAYMENTS: "Payments",
  OTHER: "Other",
};

export const UNIT_BASES = [
  "REQUEST",
  "RECORD",
  "THOUSAND",
  "MESSAGE",
  "SEGMENT",
  "TOKEN",
  "MINUTE",
] as const;
export type UnitBasis = (typeof UNIT_BASES)[number];

export const UNIT_BASIS_LABEL: Record<UnitBasis, string> = {
  REQUEST: "per request",
  RECORD: "per record",
  THOUSAND: "per 1,000",
  MESSAGE: "per message",
  SEGMENT: "per segment",
  TOKEN: "per 1K tokens",
  MINUTE: "per minute",
};

export type ProviderHealthState = "HEALTHY" | "DEGRADED" | "INCIDENT" | "OFFLINE" | "UNKNOWN";

export const PROVIDER_HEALTH_LABEL: Record<ProviderHealthState, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  INCIDENT: "Incident",
  OFFLINE: "Offline",
  UNKNOWN: "Not monitored",
};

export const PROVIDER_HEALTH_TONE = {
  HEALTHY: "success",
  DEGRADED: "warning",
  INCIDENT: "danger",
  OFFLINE: "danger",
  UNKNOWN: "neutral",
} as const;

export type PlatformProviderRow = {
  /** Null when the provider is in the catalogue but has no overrides row yet. */
  id: string | null;
  provider: string;
  label: string;
  type: ProviderType;
  enabled: boolean;
  priority: number;
  failoverOrder: number | null;
  /** Empty means global. */
  countryCodes: string[];
  capabilities: string[];
  unitCostEstimate: number | null;
  unitBasis: UnitBasis | null;
  currency: string;
  hardCostCeiling: number | null;
  rateLimitPerMinute: number | null;
  rateLimitPerHour: number | null;
  rateLimitPerDay: number | null;
  maxConcurrency: number | null;
  status: ProviderHealthState;
  lastCheckedAt: string | null;
  /** The env var or vault key, e.g. "env:CLEARBIT_API_KEY". Never the value. */
  credentialRef: string | null;
  /** True when the referenced secret actually resolves on this deployment. */
  credentialConfigured: boolean;
  credentialEnvironment: string;
  credentialRotatedAt: string | null;
  notes: string | null;
};

export type ProviderDetail = PlatformProviderRow & {
  /** 30-day usage from the cost ledger. Zero when nothing has been spent. */
  requests30d: number;
  cost30d: number;
  /** Fraction of the configured per-minute limit currently in use, 0-1. */
  rateLimitUsage: number | null;
  errorRate: number | null;
  averageLatencyMs: number | null;
  recentChanges: { at: string; summary: string; by: string | null }[];
  /**
   * Providers that would take over for this one, in order. Derived from the
   * registry, so a failover chain shown here is the chain the worker uses.
   */
  failoverChain: { provider: string; label: string; order: number }[];
};

/* ------------------------------------------------------------ ai & agents --- */

export const PLATFORM_AGENTS = [
  "BUSINESS_INTELLIGENCE",
  "ICP_STRATEGY",
  "SEARCH",
  "RESEARCH",
  "INTENT",
  "SCORING",
  "OUTREACH",
  "CONVERSION",
  "OPTIMIZATION",
  "COPILOT",
  "SUPPORT_COPILOT",
] as const;
export type PlatformAgent = (typeof PLATFORM_AGENTS)[number];

export const PLATFORM_AGENT_LABEL: Record<PlatformAgent, string> = {
  BUSINESS_INTELLIGENCE: "Business Intelligence Agent",
  ICP_STRATEGY: "ICP Strategy Agent",
  SEARCH: "Lead Sourcing Agent",
  RESEARCH: "Prospect Research Agent",
  INTENT: "Intent Agent",
  SCORING: "Lead Scoring Agent",
  OUTREACH: "Campaign Drafting Agent",
  CONVERSION: "Qualification Agent",
  OPTIMIZATION: "Optimisation Agent",
  COPILOT: "ClientTurn Copilot",
  SUPPORT_COPILOT: "Support Copilot",
};

export type AgentSettingRow = {
  agent: PlatformAgent;
  label: string;
  enabled: boolean;
  primaryModel: string;
  fallbackModel: string | null;
  /** Pounds per day. Null means no cap configured, which is reported as a risk. */
  dailySpendCap: number | null;
  dailyTokenCap: number | null;
  perRunCostCap: number | null;
  /** Actual spend over the last 24 hours, from `agent_runs`. */
  spend24h: number;
  runs24h: number;
  errorRate: number | null;
  activePromptVersion: string | null;
  promptVersions: {
    version: string;
    status: "DRAFT" | "ACTIVE" | "RETIRED";
    modelHint: string | null;
    createdAt: string;
  }[];
};

export type AiSettings = {
  /** Global stop. When true no agent may start a new run, whatever its toggle. */
  killSwitch: boolean;
  killSwitchReason: string | null;
  killSwitchAt: string | null;
  defaultModel: string;
  fallbackModel: string;
  /** Pounds per day across every agent. */
  totalDailyBudget: number | null;
  spentToday: number;
  minimumEvaluationScore: number | null;
  agents: AgentSettingRow[];
};

/* --------------------------------------------------------------- outreach --- */

export type OutreachSettings = {
  globalDailyEmailCap: number | null;
  globalDailySmsCap: number | null;
  globalDailyWhatsappCap: number | null;
  perMailboxDailyCap: number | null;
  campaignConcurrency: number | null;
  /** Percentages, 0-100. */
  bounceThreshold: number | null;
  complaintThreshold: number | null;
  minimumDeliveryRate: number | null;
  socialChannelsEnabled: boolean;
  /** Live counters, so a cap can be read against what is actually happening. */
  emailsToday: number;
  smsToday: number;
  whatsappToday: number;
  activeCampaigns: number;
};

/* ------------------------------------------------------------- price book --- */

export type PriceBookRow = {
  id: string;
  provider: string;
  product: string;
  region: string | null;
  currency: string;
  unit: string;
  unitCost: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** True when this is the row currently in force for its provider/product. */
  current: boolean;
};

/* ---------------------------------------------------------- feature flags --- */

export const FLAG_STATUSES = ["ENABLED", "BETA", "DISABLED"] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

export const FLAG_STATUS_LABEL: Record<FlagStatus, string> = {
  ENABLED: "Enabled",
  BETA: "In beta",
  DISABLED: "Disabled",
};

export const FLAG_STATUS_TONE = {
  ENABLED: "success",
  BETA: "info",
  DISABLED: "neutral",
} as const;

export type FeatureFlagRow = {
  key: string;
  label: string;
  description: string | null;
  status: FlagStatus;
  rolloutPercent: number;
  workspaceCount: number;
  updatedAt: string;
};

/* -------------------------------------------------------------- change log --- */

export type SettingChangeRow = {
  id: string;
  at: string;
  namespace: string;
  version: number;
  summary: string;
  changedBy: string | null;
};

export type PlatformSettingsData = {
  view: SettingsView;
  summary: {
    totalProviders: number;
    healthyProviders: number;
    degradedProviders: number;
    offlineProviders: number;
    /** Weighted mean unit cost across providers that declare one. */
    averageUnitCost: number | null;
    /** Highest per-minute rate-limit utilisation across providers, 0-1. */
    peakRateLimitUsage: number | null;
    activeAgents: number;
    totalAgents: number;
    activeFlags: number;
    totalFlags: number;
  };
  providers: PlatformProviderRow[];
  providerDetail: ProviderDetail | null;
  ai: AiSettings;
  outreach: OutreachSettings;
  priceBook: PriceBookRow[];
  flags: FeatureFlagRow[];
  changeLog: SettingChangeRow[];
};
