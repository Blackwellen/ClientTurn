/**
 * Contactability states (design 03 §6, brief §13). Pure.
 *
 * `contactability_results.state` is derived, never set by hand: the database
 * trigger `contactability_results_derive_state` (0123) computes it from the
 * row the policy engine writes. This is the same derivation in TypeScript, so
 * it can be tested and shown in the UI without a round trip; the test suite
 * holds the two vocabularies together.
 *
 * Derived since 0131:
 *   - SOFT_OPT_IN: an EXISTING_CUSTOMER relationship, an individual subscriber
 *     (individual, sole trader, partnership), and a first-party sale or
 *     negotiation record: an opportunity WON or at PROPOSAL / CHECKOUT_SENT /
 *     NEGOTIATION (ICO: details obtained "in the course of a sale or
 *     negotiations for a sale").
 *   - REPLY_WINDOW_OPEN: the lead wrote in on WhatsApp (or Messenger /
 *     Instagram for SOCIAL) within the last 24 hours.
 * The database reads those facts itself; callers here pass them in `facts`.
 *
 * Not derived yet: UNSUBSCRIBED (as distinct from OPTED_OUT) needs the
 * suppression source.
 */

export const CONTACTABILITY_STATES = [
  // permission
  "PERMITTED",
  "CONSENTED",
  "SOFT_OPT_IN",
  "LEGITIMATE_INTERESTS_REVIEWED",
  "EXISTING_CUSTOMER",
  // timing and pauses
  "REPLY_WINDOW_OPEN",
  "TEMPORARILY_PAUSED",
  "LEGAL_HOLD",
  // refusals and objections
  "OPTED_OUT",
  "UNSUBSCRIBED",
  "DO_NOT_CONTACT",
  "BLOCKED",
  // address problems
  "HARD_BOUNCE",
  "COMPLAINT",
  "INVALID",
  // default
  "UNKNOWN",
] as const;

export type ContactabilityState = (typeof CONTACTABILITY_STATES)[number];

const PAUSE_REASONS = new Set([
  "BLOCKED_QUIET_HOURS",
  "BLOCKED_DAILY_LIMIT",
  "BLOCKED_MONTHLY_LIMIT",
  "BLOCKED_COST_BUDGET",
  "BLOCKED_PROVIDER",
  "BLOCKED_DOMAIN_HEALTH",
  "BLOCKED_BUSINESS_STATE",
]);

const SUPPRESSION_STATE: Record<string, ContactabilityState> = {
  BOUNCE: "HARD_BOUNCE",
  COMPLAINT: "COMPLAINT",
  LEGAL: "LEGAL_HOLD",
  INVALID: "INVALID",
  MANUAL: "DO_NOT_CONTACT",
  PROVIDER: "BLOCKED",
  OPT_OUT: "OPTED_OUT",
};

export type ContactabilityRow = {
  result: string;
  reasonCode: string;
  relationshipType: string | null;
  channel: string;
  /** LEAD | PROSPECT. SOFT_OPT_IN and REPLY_WINDOW_OPEN apply to leads only. */
  subjectType?: string | null;
  subscriberType?: string | null;
  /** The stored `evidence_json`. */
  evidence: {
    suppression?: { reason?: string | null } | null;
    consent_status?: string | null;
  } | null;
};

/**
 * @param activeLiaChannels channels covered by an ACTIVE legitimate-interest
 *   assessment for the workspace. LEGITIMATE_INTERESTS_REVIEWED requires one.
 */
/** Facts the database trigger looks up for itself (0131). */
export type ContactabilityFacts = {
  /** An inbound message on this channel's messaging surface within 24 hours. */
  inboundWithin24h?: boolean;
  /** An opportunity WON, or at PROPOSAL / CHECKOUT_SENT / NEGOTIATION. */
  saleOrNegotiation?: boolean;
};

const INDIVIDUAL_SUBSCRIBERS = new Set(["INDIVIDUAL", "SOLE_TRADER", "PARTNERSHIP"]);

export function contactabilityState(
  row: ContactabilityRow,
  activeLiaChannels: readonly string[] = [],
  facts: ContactabilityFacts = {},
): ContactabilityState {
  const suppression = row.evidence?.suppression?.reason ?? null;
  const consent = row.evidence?.consent_status ?? null;

  if (suppression) return SUPPRESSION_STATE[suppression] ?? "OPTED_OUT";
  if (row.reasonCode === "BLOCKED_OPT_OUT" || consent === "WITHDRAWN") return "OPTED_OUT";
  if (row.reasonCode === "BLOCKED_INVALID_CONTACT") return "INVALID";
  if (PAUSE_REASONS.has(row.reasonCode)) return "TEMPORARILY_PAUSED";

  if (row.result === "ALLOWED") {
    const lead = row.subjectType === "LEAD";
    if (lead && (row.channel === "WHATSAPP" || row.channel === "SOCIAL") && facts.inboundWithin24h) {
      return "REPLY_WINDOW_OPEN";
    }
    if (
      row.relationshipType === "EXISTING_CUSTOMER" &&
      lead &&
      INDIVIDUAL_SUBSCRIBERS.has(row.subscriberType ?? "") &&
      facts.saleOrNegotiation
    ) {
      return "SOFT_OPT_IN";
    }
    if (row.relationshipType === "EXISTING_CUSTOMER") return "EXISTING_CUSTOMER";
    if (consent === "GRANTED" || row.relationshipType === "EXPLICIT_MARKETING_CONSENT") return "CONSENTED";
    if (
      (row.relationshipType === "FOUND_BY_US" ||
        row.relationshipType === "UNKNOWN" ||
        row.relationshipType === "IMPORTED") &&
      activeLiaChannels.includes(row.channel)
    ) {
      return "LEGITIMATE_INTERESTS_REVIEWED";
    }
    return "PERMITTED";
  }

  if (row.result === "BLOCKED") return "BLOCKED";
  return "UNKNOWN";
}
