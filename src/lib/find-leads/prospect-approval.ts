/**
 * Whether a person may approve a prospect for outreach, and why not.
 *
 * Pure (no `server-only`, no Supabase) so the drawer's button and both server
 * actions apply one rule.
 *
 * Approval is what RESOLVES a review. The single-prospect action and the
 * drawer used to require `outreach_eligibility = 'ELIGIBLE'` first, while the
 * bulk action accepted REVIEW. With email verification off (no paid vendor,
 * CLAUDE.md resolved conflict 7) every sourced prospect lands in REVIEW, so the
 * drawer's "Approve for outreach" was permanently disabled: a dead end
 * (2026-09-29).
 *
 * Approval never overrides the law. SUPPRESSED is a decision already taken (an
 * opt-out, a complaint, a bounce) and stays refused, and the dispatcher still
 * re-runs the policy engine before every send, so an unincorporated business
 * (PECR individual subscriber) is refused at send time whatever was approved.
 */

export type ApprovalInput = {
  status: string;
  outreachEligibility: string;
  promotedToLeadId: string | null;
};

/** Statuses a prospect can be approved from. */
export const APPROVABLE_STATUSES = ["READY", "REVIEW", "VERIFIED"] as const;
/** Eligibilities a person may approve: a clear pass, or a review they resolve. */
export const APPROVABLE_ELIGIBILITIES = ["ELIGIBLE", "REVIEW"] as const;

export function approvalBlockedReason(input: ApprovalInput): string | null {
  if (input.promotedToLeadId) return "This prospect is already a lead.";
  if (
    input.outreachEligibility === "SUPPRESSED" ||
    ["SUPPRESSED", "UNSUBSCRIBED", "BOUNCED"].includes(input.status)
  ) {
    return "This prospect has opted out or cannot be reached, so it cannot be contacted.";
  }
  if (input.status === "APPROVED" || input.status === "OUTREACH_ACTIVE") {
    return "This prospect has already been approved.";
  }
  if (!(APPROVABLE_ELIGIBILITIES as readonly string[]).includes(input.outreachEligibility)) {
    return "This prospect's contactability has not been assessed yet.";
  }
  if (!(APPROVABLE_STATUSES as readonly string[]).includes(input.status)) {
    return "This prospect is not at a stage where it can be approved.";
  }
  return null;
}
