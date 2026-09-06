/**
 * ChannelPolicyService — the pure decision core (V4 §67, §91).
 *
 * `canSend()` answers one question: may this workspace contact this person, on
 * this channel, right now? It is deliberately pure — no Supabase import, no
 * `server-only` marker — so every rule below is directly unit-testable and
 * there is exactly one copy of it. `service.ts` gathers the inputs and records
 * the decision.
 *
 * Order matters. The checks run cheapest-and-most-absolute first, so a
 * suppressed contact is never evaluated against a budget, and a decision is
 * never "allowed on a technicality" because an earlier rule was skipped.
 *
 * This file encodes an operable policy, not legal advice. The packs it reads
 * are versioned rows (compliance_policy_versions) precisely so that counsel can
 * change the rules without a deploy, and so a past decision can be replayed
 * against the pack that produced it.
 */

import {
  policyReasonSentence,
  type CampaignType,
  type CompliancePolicyPack,
  type PolicyChannel,
  type PolicyDecision,
  type PolicyInput,
  type PolicyReasonCode,
  type PolicyRequirement,
  type ChannelRuleSet,
  type SubscriberType,
} from "./types.ts";

function decide(
  input: PolicyInput,
  outcome: PolicyDecision["outcome"],
  reasonCode: PolicyReasonCode,
  extra: Partial<PolicyDecision> = {},
): PolicyDecision {
  return {
    outcome,
    reasonCode,
    message: extra.message ?? policyReasonSentence(reasonCode),
    policyVersion: input.pack.version,
    ...extra,
  };
}

/** Cold and warm read different rule sets. Reactivation is warm by definition
 *  — it only ever targets leads the business already has a relationship with —
 *  and transactional traffic is not marketing at all. */
function ruleSetFor(pack: CompliancePolicyPack, campaignType: CampaignType): ChannelRuleSet {
  return campaignType === "COLD" ? pack.cold : pack.warm;
}

function requirementsFor(rules: ChannelRuleSet): PolicyRequirement[] {
  const out: PolicyRequirement[] = [];
  if (rules.requireUnsubscribe) out.push("UNSUBSCRIBE_LINK");
  if (rules.requirePostalFooter) out.push("POSTAL_FOOTER");
  if (rules.requirePrivacyNotice) out.push("PRIVACY_NOTICE");
  return out;
}

/** WhatsApp needs an approved template for business-initiated conversations,
 *  whatever the relationship. */
function templateRequired(channel: PolicyChannel): boolean {
  return channel === "WHATSAPP";
}

function minutesOfDay(time: { hour: number; minute: number }): number {
  return time.hour * 60 + time.minute;
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Quiet hours normally wrap midnight (20:00 → 08:00), so the comparison is
 * "outside the permitted window" rather than a simple range check.
 */
export function isWithinQuietHours(
  localTime: { hour: number; minute: number },
  rule: { start: string; end: string },
): boolean {
  const start = parseClock(rule.start);
  const end = parseClock(rule.end);
  if (start === null || end === null) return false;

  const now = minutesOfDay(localTime);
  // A window that wraps midnight is quiet when now is after start OR before end.
  if (start > end) return now >= start || now < end;
  return now >= start && now < end;
}

/** The next moment quiet hours lift, as minutes past midnight local. */
export function quietHoursEndMinutes(rule: { end: string }): number {
  return parseClock(rule.end) ?? 0;
}

function subscriberVerdict(
  rules: ChannelRuleSet,
  subscriberType: SubscriberType,
): "ALLOW" | "REVIEW" | "BLOCK" {
  if (rules.blockedSubscriberTypes?.includes(subscriberType)) return "BLOCK";
  if (rules.reviewSubscriberTypes?.includes(subscriberType)) return "REVIEW";
  // An explicit allow-list is exhaustive: anything not named is not permitted.
  if (rules.allowedSubscriberTypes && rules.allowedSubscriberTypes.length > 0) {
    return rules.allowedSubscriberTypes.includes(subscriberType) ? "ALLOW" : "REVIEW";
  }
  return "ALLOW";
}

/**
 * The single can-send decision.
 *
 * Nothing here consults a model, and nothing here can be overridden by one: a
 * result of BLOCKED is final for this input, and the only way to change it is
 * to change the underlying facts (record consent, remove a suppression, connect
 * a sender) or the policy pack.
 */
export function canSend(input: PolicyInput): PolicyDecision {
  const rules = ruleSetFor(input.pack, input.campaignType);

  /* 1. Absolute blocks. These bind every origin, including a human sending by
   *    hand, and are checked before anything that could be argued with. */

  if (input.optedOut) {
    return decide(input, "BLOCKED", "BLOCKED_OPT_OUT");
  }

  if (input.suppression) {
    return decide(input, "BLOCKED", "BLOCKED_OPT_OUT", {
      message:
        input.suppression.scope === "PLATFORM"
          ? "This address is suppressed across ClientTurn and cannot be messaged."
          : "This contact is on your suppression list and cannot be messaged.",
    });
  }

  if (!input.destination || input.destination.trim() === "") {
    return decide(input, "BLOCKED", "BLOCKED_INVALID_CONTACT");
  }

  if (!input.businessActive) {
    return decide(input, "BLOCKED", "BLOCKED_BUSINESS_STATE");
  }

  /* 2. Channel permission for this kind of contact. This is where cold SMS,
   *    cold WhatsApp and cold social are refused: the seeded packs list EMAIL
   *    as the only cold channel, and there is no customer-facing setting that
   *    can widen it. */

  if (!rules.allowedChannels.includes(input.channel)) {
    return decide(
      input,
      "BLOCKED",
      input.campaignType === "COLD" ? "BLOCKED_COLD_CHANNEL" : "BLOCKED_COUNTRY_POLICY",
      {
        message:
          input.campaignType === "COLD"
            ? `${titleCase(input.channel)} cannot be used for cold outreach under the ${input.pack.name} policy.`
            : `${titleCase(input.channel)} is not permitted under the ${input.pack.name} policy.`,
      },
    );
  }

  /* 3. Who the recipient is. An individual subscriber is treated far more
   *    protectively than a corporate one, and an unknown classification is a
   *    review rather than a guess. */

  const verdict = subscriberVerdict(rules, input.subscriberType);
  if (verdict === "BLOCK") {
    return decide(input, "BLOCKED", "BLOCKED_SUBSCRIBER_TYPE");
  }
  if (verdict === "REVIEW") {
    return decide(input, "REVIEW_REQUIRED", "REVIEW_REQUIRED", {
      message:
        input.subscriberType === "UNKNOWN"
          ? "We could not confirm whether this is a business or an individual, so it needs a human decision."
          : "This type of recipient needs a human decision before contact.",
      requirements: ["HUMAN_REVIEW"],
    });
  }

  /* 4. Consent and relationship. Withdrawn consent is as absolute as an
   *    opt-out; a missing relationship on a channel that requires one is a
   *    consent request, not a block, because the customer can fix it. */

  if (input.consentStatus === "WITHDRAWN") {
    return decide(input, "BLOCKED", "BLOCKED_OPT_OUT", {
      message: "This contact has withdrawn consent and cannot be messaged.",
    });
  }

  if (rules.requireRelationship) {
    const hasRelationship =
      input.relationshipType !== "UNKNOWN" && input.relationshipType !== "FOUND_BY_US";
    const hasConsent = input.consentStatus === "GRANTED" && input.hasConsentEvidence;

    if (!hasRelationship && !hasConsent) {
      return decide(input, "REQUIRE_CONSENT", "BLOCKED_NO_PERMISSION", {
        message:
          "There is no recorded relationship or consent for this contact, so this channel needs permission first.",
        requirements: ["HUMAN_REVIEW"],
      });
    }
  }

  /* 5. Whether we can physically and safely send. Sender health is a platform
   *    safety limit: §66.2 is explicit that a user cannot override it. */

  if (!input.senderAvailable) {
    return decide(input, "BLOCKED", "BLOCKED_PROVIDER", {
      message: `No ${input.channel.toLowerCase()} sender is connected for this workspace.`,
    });
  }

  if (input.senderHealth === "PAUSED") {
    return decide(input, "BLOCKED", "BLOCKED_DOMAIN_HEALTH");
  }

  /* 6. Allowance and caps. Ordered cheapest first so a workspace that is out of
   *    allowance is told that, rather than being told about a daily cap it
   *    would also have hit. */

  if (!input.withinBudget) {
    return decide(input, "BLOCKED", "BLOCKED_COST_BUDGET");
  }
  if (!input.withinMonthlyCap) {
    return decide(input, "BLOCKED", "BLOCKED_MONTHLY_LIMIT");
  }
  if (!input.withinDailyCap) {
    return decide(input, "BLOCKED", "BLOCKED_DAILY_LIMIT");
  }

  /* 7. Timing. Unlike everything above, this is "not now" rather than "not
   *    ever", so the caller reschedules instead of aborting. */

  const quiet = input.pack.quietHours;
  if (quiet && quiet.channels.includes(input.channel) && isWithinQuietHours(input.localTime, quiet)) {
    return decide(input, "BLOCKED", "BLOCKED_QUIET_HOURS", {
      message: `Contact hours for ${titleCase(input.channel)} resume at ${quiet.end}.`,
    });
  }

  /* 8. Allowed — but possibly with obligations attached. */

  const requirements = requirementsFor(rules);
  if (templateRequired(input.channel)) {
    return decide(input, "REQUIRE_TEMPLATE", "ALLOWED", {
      message: "Allowed using an approved WhatsApp template.",
      requirements: [...requirements, "APPROVED_TEMPLATE"],
    });
  }

  return decide(input, "ALLOWED", "ALLOWED", {
    requirements: requirements.length ? requirements : undefined,
  });
}

/**
 * Collapses a set of per-channel decisions into the single eligibility label
 * shown on a prospect or lead. SUPPRESSED beats everything, then REVIEW, then
 * CONSENT_REQUIRED; a contact is only ELIGIBLE if at least one channel allows.
 */
export function summariseEligibility(
  decisions: PolicyDecision[],
): "ELIGIBLE" | "CONSENT_REQUIRED" | "REVIEW" | "SUPPRESSED" {
  if (decisions.length === 0) return "REVIEW";

  if (decisions.some((d) => d.reasonCode === "BLOCKED_OPT_OUT")) return "SUPPRESSED";
  if (decisions.some((d) => d.outcome === "ALLOWED" || d.outcome === "REQUIRE_TEMPLATE")) {
    return "ELIGIBLE";
  }
  if (decisions.some((d) => d.outcome === "REVIEW_REQUIRED")) return "REVIEW";
  if (decisions.some((d) => d.outcome === "REQUIRE_CONSENT")) return "CONSENT_REQUIRED";
  return "REVIEW";
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
