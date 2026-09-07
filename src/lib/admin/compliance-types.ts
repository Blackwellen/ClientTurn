/**
 * Compliance shapes shared with client components. No `server-only`, no
 * Supabase import.
 *
 * The vocabulary matters more here than anywhere else in the admin area: these
 * strings describe what the *policy engine* decided, not what a designer chose
 * to colour amber. A value like "Controlled" means a versioned rule pack
 * imposes conditions on that channel in that country — it is never a UI-level
 * judgement, and no component may compute one.
 */

export const POLICY_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  RETIRED: "Archived",
};

export const POLICY_STATUS_TONE = {
  DRAFT: "warning",
  ACTIVE: "success",
  RETIRED: "neutral",
} as const;

/**
 * How a channel may be used in a jurisdiction. Ordered from least to most
 * restrictive so a matrix cell can be compared, not just displayed.
 */
export const POLICY_STANCES = [
  "ALLOWED",
  "OPT_OUT",
  "CONTROLLED",
  "OPT_IN",
  "LIMITED",
  "RESTRICTED",
  "REVIEW",
] as const;
export type PolicyStance = (typeof POLICY_STANCES)[number];

export const POLICY_STANCE_LABEL: Record<PolicyStance, string> = {
  ALLOWED: "Allowed",
  OPT_OUT: "Opt-out",
  CONTROLLED: "Controlled",
  OPT_IN: "Opt-in",
  LIMITED: "Limited",
  RESTRICTED: "Restricted",
  REVIEW: "Review",
};

export const POLICY_STANCE_TONE = {
  ALLOWED: "success",
  OPT_OUT: "info",
  CONTROLLED: "warning",
  OPT_IN: "info",
  LIMITED: "warning",
  RESTRICTED: "danger",
  REVIEW: "warning",
} as const;

export const POLICY_CHANNELS = [
  "EMAIL",
  "COLD_EMAIL",
  "SMS",
  "WHATSAPP",
  "SOCIAL",
  "PHONE",
  "IN_APP",
] as const;
export type PolicyChannel = (typeof POLICY_CHANNELS)[number];

export const POLICY_CHANNEL_LABEL: Record<PolicyChannel, string> = {
  EMAIL: "Email",
  COLD_EMAIL: "Cold email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  SOCIAL: "Social",
  PHONE: "Phone",
  IN_APP: "In-app",
};

export type PolicyVersionRow = {
  id: string;
  version: string;
  name: string;
  scope: string;
  status: PolicyStatus;
  countryCodes: string[];
  channels: PolicyChannel[];
  effectiveFrom: string | null;
  retiredAt: string | null;
  createdAt: string;
  notes: string | null;
};

/** One row of the country matrix: a stance per channel, from the active packs. */
export type CountryPolicyRow = {
  countryCode: string;
  countryName: string;
  stances: Partial<Record<PolicyChannel, PolicyStance>>;
  retentionYears: number | null;
  status: PolicyStatus;
  /** The pack version that decided this row. Never blank on a live matrix. */
  policyVersion: string;
};

export type ChannelPolicyRow = {
  channel: PolicyChannel;
  stance: PolicyStance;
  requirements: string[];
  rateLimit: string | null;
  providers: string[];
  /** How many configured providers actually serve the channel right now. */
  providerCount: number;
};

export const REVIEW_ITEM_TYPES = [
  "CONTENT",
  "PROVIDER",
  "CAMPAIGN",
  "CONTACT",
  "INTEGRATION",
  "POLICY_EXCEPTION",
  "PRIVACY_REQUEST",
] as const;
export type ReviewItemType = (typeof REVIEW_ITEM_TYPES)[number];

export const REVIEW_ITEM_TYPE_LABEL: Record<ReviewItemType, string> = {
  CONTENT: "Content",
  PROVIDER: "Provider",
  CAMPAIGN: "Campaign",
  CONTACT: "Contact",
  INTEGRATION: "Integration",
  POLICY_EXCEPTION: "Policy exception",
  PRIVACY_REQUEST: "Privacy request",
};

export type ReviewQueueItem = {
  id: string;
  reference: string;
  type: ReviewItemType;
  item: string;
  reason: string;
  region: string | null;
  priority: "HIGH" | "MEDIUM" | "LOW";
  status: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  businessId: string | null;
  businessName: string | null;
  createdAt: string;
};

export const SUPPRESSION_REASONS = [
  "OPT_OUT",
  "COMPLAINT",
  "BOUNCE",
  "MANUAL",
  "LEGAL",
  "INVALID",
  "PROVIDER",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const SUPPRESSION_REASON_LABEL: Record<SuppressionReason, string> = {
  OPT_OUT: "Unsubscribe",
  COMPLAINT: "Complaint",
  BOUNCE: "Bounce",
  MANUAL: "Manual",
  LEGAL: "Legal / policy",
  INVALID: "Invalid",
  PROVIDER: "Provider",
};

export type SuppressionRow = {
  id: string;
  type: "Email" | "Phone" | "Domain" | "Social";
  /** Partially masked. A suppression list is a list of people who said no. */
  value: string;
  reason: SuppressionReason;
  channel: string;
  source: string;
  businessId: string | null;
  businessName: string | null;
  createdAt: string;
  expiresAt: string | null;
  /**
   * Server-decided. Only a suppression added by mistake — a manual entry, or a
   * provider bounce later shown to be transient — may ever be lifted.
   */
  removable: boolean;
  removalBlockedReason: string | null;
};

export const PRIVACY_REQUEST_TYPES = [
  "EXPORT",
  "DELETION",
  "ACCESS",
  "MARKETING_DATA",
] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_TYPE_LABEL: Record<PrivacyRequestType, string> = {
  EXPORT: "Data export",
  DELETION: "Data deletion",
  ACCESS: "Access request",
  MARKETING_DATA: "Marketing data",
};

export const PRIVACY_REQUEST_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "REJECTED",
] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export const PRIVACY_REQUEST_STATUS_LABEL: Record<PrivacyRequestStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
};

export const PRIVACY_REQUEST_STATUS_TONE = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  REJECTED: "neutral",
} as const;

export type PrivacyRequestRow = {
  id: string;
  reference: string;
  type: PrivacyRequestType;
  subject: string;
  businessId: string | null;
  businessName: string | null;
  status: PrivacyRequestStatus;
  receivedAt: string;
  dueAt: string | null;
  /** True once the statutory window has passed without completion. */
  overdue: boolean;
};

export type ComplianceAuditRow = {
  id: string;
  at: string;
  event: string;
  entity: string;
  actor: string;
  detail: string;
};

export type PolicyDetail = PolicyVersionRow & {
  /** Human-readable requirement list from the pack's `rules_json`. */
  keyRequirements: string[];
  keyChanges: string[];
  linkedProviders: { provider: string; label: string; healthy: boolean }[];
  countryRows: CountryPolicyRow[];
  channelRows: ChannelPolicyRow[];
  recentChanges: { at: string; summary: string }[];
  /** How many decisions the engine has taken under this version. */
  decisionCount: number;
  canPublish: boolean;
  publishBlockedReason: string | null;
};

export type ComplianceViewData = {
  summary: {
    activePolicies: number;
    countriesCovered: number;
    providersConfigured: number;
    itemsInReview: number;
    suppressedContacts: number;
    privacyNotices: number;
    pendingPrivacyRequests: number;
    highPriorityReviews: number;
  };
  versions: PolicyVersionRow[];
  countryMatrix: CountryPolicyRow[];
  channelMatrix: ChannelPolicyRow[];
  reviewQueue: ReviewQueueItem[];
  suppressions: SuppressionRow[];
  suppressionQuery: string;
  privacyRequests: PrivacyRequestRow[];
  auditRows: ComplianceAuditRow[];
  detail: PolicyDetail | null;
};
