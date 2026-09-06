/**
 * Contactability and channel-policy shapes.
 *
 * Deliberately free of `server-only` and of any Supabase import: the decision
 * rules in `channel-policy.ts` are pure and unit-tested, the same way
 * `jobs/send-core.ts` keeps the send guard testable. Anything that needs the
 * database lives in `service.ts`.
 */

/** V4 §63. Distinct from the V3 messaging `Channel`, which is SMS/WhatsApp only. */
export type PolicyChannel = "EMAIL" | "SMS" | "WHATSAPP" | "SOCIAL";

export const POLICY_CHANNELS: PolicyChannel[] = ["EMAIL", "SMS", "WHATSAPP", "SOCIAL"];

/**
 * What kind of contact this is. The distinction is the whole point of the
 * engine: COLD is outbound to someone with no prior relationship and is far
 * more constrained than WARM.
 */
export type CampaignType = "WARM" | "COLD" | "REACTIVATION" | "TRANSACTIONAL";

export type SubscriberType =
  | "CORPORATE"
  | "SOLE_TRADER"
  | "PARTNERSHIP"
  | "INDIVIDUAL"
  | "UNKNOWN";

export type RelationshipType =
  | "THEY_CONTACTED_US"
  | "EXISTING_CUSTOMER"
  | "REFERRAL"
  | "REQUESTED_INFORMATION"
  | "EXPLICIT_MARKETING_CONSENT"
  | "EXISTING_BUSINESS_RELATIONSHIP"
  | "FOUND_BY_US"
  | "IMPORTED"
  | "OTHER"
  | "UNKNOWN";

export type ConsentStatus = "GRANTED" | "WITHDRAWN" | "NOT_REQUIRED" | "UNKNOWN";

export type OutreachEligibility =
  | "ELIGIBLE"
  | "CONSENT_REQUIRED"
  | "REVIEW"
  | "SUPPRESSED";

/** V4 §67.1. Every one of these is a machine code the UI maps to a sentence. */
export type PolicyReasonCode =
  | "ALLOWED"
  | "BLOCKED_OPT_OUT"
  | "BLOCKED_NO_PERMISSION"
  | "BLOCKED_COLD_CHANNEL"
  | "BLOCKED_SUBSCRIBER_TYPE"
  | "BLOCKED_COUNTRY_POLICY"
  | "BLOCKED_PROVIDER"
  | "BLOCKED_DAILY_LIMIT"
  | "BLOCKED_MONTHLY_LIMIT"
  | "BLOCKED_COST_BUDGET"
  | "BLOCKED_QUIET_HOURS"
  | "BLOCKED_INVALID_CONTACT"
  | "BLOCKED_DOMAIN_HEALTH"
  | "BLOCKED_BUSINESS_STATE"
  | "REVIEW_REQUIRED";

/** V4 §91.2. */
export type PolicyOutcome =
  | "ALLOWED"
  | "BLOCKED"
  | "REVIEW_REQUIRED"
  | "REQUIRE_CONSENT"
  | "REQUIRE_PRIVACY_NOTICE"
  | "REQUIRE_TEMPLATE"
  | "REQUIRE_MANUAL_ACTION";

export type PolicyDecision = {
  outcome: PolicyOutcome;
  reasonCode: PolicyReasonCode;
  /** Sentence for the UI. Never contains provider names or costs. */
  message: string;
  policyVersion: string;
  /** Set when the decision is "not now" rather than "not ever". */
  retryAt?: Date;
  /** Obligations the caller must satisfy before sending. */
  requirements?: PolicyRequirement[];
};

export type PolicyRequirement =
  | "UNSUBSCRIBE_LINK"
  | "POSTAL_FOOTER"
  | "PRIVACY_NOTICE"
  | "APPROVED_TEMPLATE"
  | "HUMAN_REVIEW";

/* ------------------------------------------------------------ policy packs */

export type ChannelRuleSet = {
  allowedChannels: PolicyChannel[];
  allowedSubscriberTypes?: SubscriberType[];
  reviewSubscriberTypes?: SubscriberType[];
  blockedSubscriberTypes?: SubscriberType[];
  requireRelationship?: boolean;
  requirePostalFooter?: boolean;
  requireUnsubscribe?: boolean;
  requirePrivacyNotice?: boolean;
};

export type QuietHoursRule = {
  start: string;
  end: string;
  channels: PolicyChannel[];
};

export type CompliancePolicyPack = {
  version: string;
  name: string;
  countryCodes: string[];
  cold: ChannelRuleSet;
  warm: ChannelRuleSet;
  quietHours: QuietHoursRule | null;
};

/* ----------------------------------------------------------------- inputs */

/** Everything the decision needs, gathered by the caller. No I/O happens
 *  inside the rules themselves. */
export type PolicyInput = {
  channel: PolicyChannel;
  campaignType: CampaignType;
  country: string | null;
  subscriberType: SubscriberType;
  relationshipType: RelationshipType;
  consentStatus: ConsentStatus;
  hasConsentEvidence: boolean;
  /** Destination address for the channel; null when the contact has none. */
  destination: string | null;
  /** Result of the suppression lookup. Null when nothing suppresses. */
  suppression: { reason: string; scope: "PLATFORM" | "WORKSPACE" } | null;
  /** The V3 per-lead opt-out flag, which binds every origin. */
  optedOut: boolean;
  /** Workspace-level state: an inactive subscription stops all outbound. */
  businessActive: boolean;
  /** Sender/provider readiness for this channel. */
  senderAvailable: boolean;
  senderHealth: "HEALTHY" | "WATCH" | "WARNING" | "PAUSED";
  /** Caps, already resolved to "is there room". */
  withinDailyCap: boolean;
  withinMonthlyCap: boolean;
  withinBudget: boolean;
  /** Local time in the recipient's timezone, for quiet hours. */
  localTime: { hour: number; minute: number };
  pack: CompliancePolicyPack;
};

/* ------------------------------------------------------- display helpers */

const REASON_SENTENCES: Record<PolicyReasonCode, string> = {
  ALLOWED: "This channel can be used.",
  BLOCKED_OPT_OUT: "This contact has opted out and cannot be messaged.",
  BLOCKED_NO_PERMISSION: "There is no recorded permission to contact this person on this channel.",
  BLOCKED_COLD_CHANNEL: "This channel cannot be used for cold outreach.",
  BLOCKED_SUBSCRIBER_TYPE: "This channel is not permitted for this type of recipient.",
  BLOCKED_COUNTRY_POLICY: "The policy for this country does not permit this channel.",
  BLOCKED_PROVIDER: "The provider for this channel is not connected.",
  BLOCKED_DAILY_LIMIT: "The daily sending limit for this channel has been reached.",
  BLOCKED_MONTHLY_LIMIT: "The monthly sending limit for this channel has been reached.",
  BLOCKED_COST_BUDGET: "This send would exceed the allowance for this period.",
  BLOCKED_QUIET_HOURS: "It is currently outside permitted contact hours.",
  BLOCKED_INVALID_CONTACT: "There is no usable address for this channel.",
  BLOCKED_DOMAIN_HEALTH: "Sending is paused while sender health recovers.",
  BLOCKED_BUSINESS_STATE: "This workspace does not have an active subscription.",
  REVIEW_REQUIRED: "This contact needs a human decision before any message is sent.",
};

export function policyReasonSentence(code: PolicyReasonCode): string {
  return REASON_SENTENCES[code] ?? "This message cannot be sent.";
}

const ELIGIBILITY_LABELS: Record<OutreachEligibility, string> = {
  ELIGIBLE: "Eligible",
  CONSENT_REQUIRED: "Consent required",
  REVIEW: "Review",
  SUPPRESSED: "Suppressed",
};

export function eligibilityLabel(value: OutreachEligibility): string {
  return ELIGIBILITY_LABELS[value] ?? "Unknown";
}

/** Green / amber / red, matching the one status vocabulary the product uses. */
export function eligibilityTone(
  value: OutreachEligibility,
): "success" | "warning" | "danger" | "neutral" {
  if (value === "ELIGIBLE") return "success";
  if (value === "CONSENT_REQUIRED" || value === "REVIEW") return "warning";
  if (value === "SUPPRESSED") return "danger";
  return "neutral";
}

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  THEY_CONTACTED_US: "They contacted us",
  EXISTING_CUSTOMER: "Existing customer",
  REFERRAL: "Referral or introduction",
  REQUESTED_INFORMATION: "Requested information",
  EXPLICIT_MARKETING_CONSENT: "Gave explicit marketing consent",
  EXISTING_BUSINESS_RELATIONSHIP: "Existing business relationship",
  FOUND_BY_US: "We found this person or company",
  IMPORTED: "Imported from another system",
  OTHER: "Other",
  UNKNOWN: "Not recorded",
};

export function relationshipLabel(value: RelationshipType): string {
  return RELATIONSHIP_LABELS[value] ?? "Not recorded";
}

/**
 * The relationships that describe someone who came to the business, rather
 * than someone the business went out and found. Used by the Add Lead wizard to
 * decide whether a record belongs in Leads at all (V4 §6.5).
 */
const WARM_RELATIONSHIPS = new Set<RelationshipType>([
  "THEY_CONTACTED_US",
  "EXISTING_CUSTOMER",
  "REQUESTED_INFORMATION",
  "EXPLICIT_MARKETING_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
]);

export function isWarmRelationship(value: RelationshipType): boolean {
  return WARM_RELATIONSHIPS.has(value);
}

/** "I found this person" is the one answer that must never produce a Lead. */
export function isProspectRelationship(value: RelationshipType): boolean {
  return value === "FOUND_BY_US";
}
