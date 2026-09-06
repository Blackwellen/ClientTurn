import { gradesAtOrAbove, type CampaignDraft, type Grade } from "./campaign-draft.ts";

/**
 * Who a campaign may contact (V4 section 16.11).
 *
 * One module, two callers: the wizard's "Eligibility rule preview" and the
 * dispatcher's per-recipient re-check at send time. That is the whole point of
 * it being here — the preview is not allowed to be a prettier description of a
 * rule the runtime implements differently.
 *
 * Membership of a campaign is never permission. `evaluateEligibility` is
 * re-run immediately before every send with live suppression and live policy,
 * because someone can opt out between being sourced and being written to, and
 * that opt-out has to win.
 */

export type EligibilityRule = {
  key: string;
  label: string;
  /** True when this rule is active for the current draft. */
  applies: boolean;
};

/** The deterministic rule list, rendered verbatim in the wizard. */
export function eligibilityRules(draft: CampaignDraft): EligibilityRule[] {
  const { intentScore, audience } = draft;

  return [
    {
      key: "grade",
      label: `Grade is ${intentScore.minimumGrade} or above`,
      applies: true,
    },
    {
      key: "intent",
      label: intentScore.intentRequired
        ? `Intent signal is required (last ${intentScore.maxIntentAgeDays} days)`
        : `Intent signal is optional (boosts score, last ${intentScore.maxIntentAgeDays} days)`,
      applies: true,
    },
    {
      key: "customers",
      label: "Not an existing customer",
      applies: audience.exclusions.existingCustomers,
    },
    {
      key: "leads",
      label: "Not an active lead",
      applies: audience.exclusions.existingLeads,
    },
    {
      key: "suppression",
      label: "Not in global suppression list",
      // Never optional. Rendered unconditionally so nobody reads its absence
      // as "this campaign skips suppression".
      applies: true,
    },
    {
      key: "categories",
      label:
        intentScore.intentCategoryIds.length > 0
          ? "Matches selected intent categories"
          : "No intent category filter",
      applies: intentScore.intentCategoryIds.length > 0,
    },
    {
      key: "audience",
      label: "Meets location, industry and role criteria from your audience settings",
      applies: true,
    },
  ].filter((rule) => rule.applies || rule.key === "suppression" || rule.key === "categories");
}

/* ------------------------------------------------------- runtime verdict */

export type EligibilityOutcome = "ELIGIBLE" | "REVIEW" | "EXCLUDED";

export type EligibilityVerdict = {
  outcome: EligibilityOutcome;
  reasonCode: string;
  reason: string;
};

export type EligibilityCandidate = {
  grade: Grade | null;
  score: number | null;
  status: string;
  outreachEligibility: string;
  email: string | null;
  promotedToLeadId: string | null;
  isExistingCustomer: boolean;
  /** Matching, unexpired intent signals in the campaign's selected categories. */
  matchingIntentSignals: number;
  /** True when the address is on the global suppression list. */
  suppressed: boolean;
  /** True when the company or domain is on the campaign's exclusion list. */
  companyExcluded: boolean;
};

/**
 * The single verdict for one prospect against one campaign.
 *
 * Ordered so the strongest reason is reported: someone who is both suppressed
 * and low-graded is excluded because they opted out, not because they scored
 * badly, and the recorded reason has to say so.
 */
export function evaluateEligibility(
  candidate: EligibilityCandidate,
  draft: CampaignDraft,
): EligibilityVerdict {
  const { intentScore, audience } = draft;

  if (candidate.suppressed || candidate.outreachEligibility === "SUPPRESSED") {
    return {
      outcome: "EXCLUDED",
      reasonCode: "SUPPRESSED",
      reason: "On the suppression list",
    };
  }
  if (candidate.status === "UNSUBSCRIBED" || candidate.status === "BOUNCED") {
    return {
      outcome: "EXCLUDED",
      reasonCode: "UNREACHABLE",
      reason: "Unsubscribed or bounced",
    };
  }
  if (candidate.promotedToLeadId) {
    // A promoted prospect is a Lead. Cold-contacting them again would be
    // writing to a customer relationship as though it were a stranger.
    return {
      outcome: "EXCLUDED",
      reasonCode: "ALREADY_A_LEAD",
      reason: "Already promoted to a lead",
    };
  }
  if (!candidate.email) {
    return { outcome: "EXCLUDED", reasonCode: "NO_EMAIL", reason: "No email address" };
  }
  if (audience.exclusions.existingCustomers && candidate.isExistingCustomer) {
    return {
      outcome: "EXCLUDED",
      reasonCode: "EXISTING_CUSTOMER",
      reason: "Already a customer",
    };
  }
  if (candidate.companyExcluded) {
    return {
      outcome: "EXCLUDED",
      reasonCode: "COMPANY_EXCLUDED",
      reason: "Company or domain is excluded",
    };
  }
  if (intentScore.intentRequired && candidate.matchingIntentSignals === 0) {
    return {
      outcome: "EXCLUDED",
      reasonCode: "NO_INTENT",
      reason: "No matching intent signal in the required window",
    };
  }

  const allowed = gradesAtOrAbove(intentScore.minimumGrade);
  if (!candidate.grade || !allowed.includes(candidate.grade)) {
    return {
      outcome: "REVIEW",
      reasonCode: "BELOW_GRADE",
      reason: `Below the minimum grade of ${intentScore.minimumGrade}`,
    };
  }
  if (candidate.score !== null && candidate.score < intentScore.reviewThreshold) {
    return {
      outcome: "REVIEW",
      reasonCode: "BELOW_REVIEW_THRESHOLD",
      reason: `Scores below the review threshold of ${intentScore.reviewThreshold}`,
    };
  }
  if (candidate.outreachEligibility !== "ELIGIBLE") {
    return {
      outcome: "REVIEW",
      reasonCode: "CONTACTABILITY_REVIEW",
      reason: "Contact rules need a human decision",
    };
  }

  return { outcome: "ELIGIBLE", reasonCode: "ELIGIBLE", reason: "Meets every campaign rule" };
}

/**
 * Effective intent freshness.
 *
 * A category may define a shorter freshness than the campaign asks for. The
 * stricter of the two wins, so a campaign cannot widen a category's own rule
 * by asking for a longer window.
 */
export function effectiveFreshnessDays(
  campaignMaxAgeDays: number,
  categoryFreshnessDays: number,
): number {
  return Math.min(campaignMaxAgeDays, categoryFreshnessDays);
}
