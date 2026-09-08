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
  /**
   * They accepted a connection or follow request from the business.
   *
   * Given its own value rather than being folded into
   * `EXISTING_BUSINESS_RELATIONSHIP`, which would be the convenient choice and
   * the wrong one. Accepting a follow is a real affirmative act by the
   * recipient — they were asked, and they said yes — but it is not the same as
   * having traded with the business, and a record that claimed otherwise would
   * misdescribe the evidence to anyone auditing it later.
   *
   * It counts as warm because the person chose to open the channel, which is
   * exactly the "would they reasonably expect this contact" question the
   * legitimate-interests balance turns on. It is deliberately not consent: an
   * opt-out still binds, suppression still applies, and the subscriber-type
   * rules are untouched.
   */
  | "ACCEPTED_SOCIAL_CONNECTION"
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
  | "BLOCKED_SOURCE_NOT_PERMITTED"
  | "REVIEW_REQUIRED";

/** V4 §91.2. */
/**
 * Every verdict the engine can reach.
 *
 * A const array rather than a bare union, matching `POLICY_CHANNELS` above, so
 * the set is enumerable at runtime. That is what lets a test walk every outcome
 * and prove each one maps to a value `compliance_decisions.decision` permits —
 * an unmapped outcome would otherwise be a CHECK violation at send time, on the
 * write whose whole purpose is to prove the send was lawful.
 */
export const POLICY_OUTCOMES = [
  "ALLOWED",
  "BLOCKED",
  "REVIEW_REQUIRED",
  "REQUIRE_CONSENT",
  "REQUIRE_PRIVACY_NOTICE",
  "REQUIRE_TEMPLATE",
  "REQUIRE_MANUAL_ACTION",
] as const;

export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export type PolicyDecision = {
  outcome: PolicyOutcome;
  reasonCode: PolicyReasonCode;
  /** Sentence for the UI. Never contains provider names or costs. */
  message: string;
  policyVersion: string;
  /** Set when the decision is "not now" rather than "not ever". */
  retryAt?: Date;
  /**
   * The window that produced a BLOCKED_QUIET_HOURS decision, as the pack states
   * it. The rules are pure and hold only a local wall-clock, so they cannot
   * build a `retryAt` themselves; the caller turns this into a concrete instant
   * in the recipient's timezone and reschedules rather than aborting.
   */
  quietHours?: { start: string; end: string };
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
  /**
   * Whether every source this record came from is one the workspace permits
   * (Programme §16, §17).
   *
   * `UNKNOWN` means no provenance was recorded, and is deliberately not the
   * same as permitted: a prospect that arrived from nowhere identifiable is
   * exactly the one worth stopping on. Only consulted for cold outreach —
   * where someone came to the business, the relationship is the basis and the
   * source of the record adds nothing to it.
   */
  sourcePermitted: "PERMITTED" | "NOT_PERMITTED" | "UNKNOWN";
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
  BLOCKED_SOURCE_NOT_PERMITTED:
    "This record came from a source your workspace has not permitted for outreach.",
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
  ACCEPTED_SOCIAL_CONNECTION: "Accepted your connection or follow",
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
  // They said yes to being connected. That is the person opening the door,
  // which is the distinction this set exists to draw.
  "ACCEPTED_SOCIAL_CONNECTION",
]);

export function isWarmRelationship(value: RelationshipType): boolean {
  return WARM_RELATIONSHIPS.has(value);
}

/** "I found this person" is the one answer that must never produce a Lead. */
export function isProspectRelationship(value: RelationshipType): boolean {
  return value === "FOUND_BY_US";
}

/**
 * `PolicyOutcome` (seven values) to `compliance_decisions.decision` (five).
 *
 * Two vocabularies for one concept, and they are not redundant: the outcome
 * says what the engine did, the decision column says what a compliance officer
 * needs to see in a list. The mapping is stated once, here, rather than being
 * inferred at each call site.
 *
 *   * A refusal because the person opted out is **SUPPRESSED**, not REJECTED.
 *     They are different facts and only one of them is a decision about the
 *     recipient's wishes -- a report that conflates them cannot answer "how many
 *     people did we decline to contact because they asked us not to".
 *   * Every "REQUIRE_*" outcome is **ESCALATED**: the engine has stopped and a
 *     person must act. That is exactly what the review queue is for.
 *   * A quiet-hours block is **DEFERRED**, not a refusal. The message is going;
 *     it is going later.
 */
export function decisionColumnFor(
  decision: PolicyDecision,
): "APPROVED" | "REJECTED" | "SUPPRESSED" | "ESCALATED" | "DEFERRED" {
  if (decision.outcome === "ALLOWED") return "APPROVED";
  if (decision.reasonCode === "BLOCKED_QUIET_HOURS") return "DEFERRED";
  if (decision.reasonCode === "BLOCKED_OPT_OUT") return "SUPPRESSED";
  if (decision.outcome === "BLOCKED") return "REJECTED";
  // REVIEW_REQUIRED and every REQUIRE_* variant.
  return "ESCALATED";
}
