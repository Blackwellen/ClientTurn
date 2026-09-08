import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "./social-limits";

/**
 * Recording the moment a prospect opens the channel.
 *
 * When somebody accepts a connection or follow request, a fact comes into
 * existence that did not exist a moment earlier: they were asked, and they said
 * yes. This module writes that fact down, because a relationship nobody
 * recorded is one the policy engine cannot see — and the engine is what decides
 * whether the next message may be sent.
 *
 * ## Why this is separate from the state machine
 *
 * `social_connection_states.state = ACCEPTED` already records the acceptance
 * for the scheduler's purposes. This writes the *permission* record, which is a
 * different question with a different audience. The state machine answers "what
 * should the sequence do next"; `contact_permissions` answers "on what basis
 * are we contacting this person", and it is the row an auditor reads.
 *
 * Keeping them apart matters because they can legitimately disagree. A prospect
 * can be ACCEPTED and still uncontactable — suppressed, opted out, or an
 * individual subscriber the country pack refuses. Folding the permission into
 * the state would make the sequence's own bookkeeping look like a legal
 * conclusion, which is exactly the confusion to avoid.
 *
 * ## What this does not do
 *
 * It does not grant consent. `consent_status` is left `UNKNOWN` deliberately:
 * accepting a follow is a relationship, not a marketing opt-in, and writing
 * GRANTED here would manufacture evidence of something the person never did. An
 * opt-out still binds, suppression still applies, and the subscriber-type rules
 * are untouched.
 */

export type SocialAcceptanceInput = {
  businessId: string;
  prospectId: string;
  platform: SocialPlatform;
  /** The profile that accepted, kept as the evidence for the relationship. */
  profileUrl: string | null;
  /** When the acceptance was observed. Defaults to now. */
  acceptedAt?: Date;
};

/**
 * Records that a prospect accepted a connection or follow.
 *
 * Idempotent: an acceptance can be reported twice — by a poller and by a person
 * marking it in the queue — and the second report must not create a second row
 * or move the recorded date forward. The unique constraint on
 * `(business_id, subject_type, subject_id)` makes that a database guarantee
 * rather than a race for the caller to lose.
 *
 * Never downgrades an existing relationship. Somebody who is already an
 * existing customer does not become a mere social connection because they
 * happened to follow the business back; the stronger basis is the true one and
 * overwriting it would weaken the record for no reason.
 */
export async function recordSocialAcceptance(
  input: SocialAcceptanceInput,
): Promise<{ recorded: boolean; reason: string | null }> {
  const admin = createAdminClient();
  const acceptedAt = (input.acceptedAt ?? new Date()).toISOString();

  const { data: existing } = await admin
    .from("contact_permissions")
    .select("id, relationship_type, consent_status")
    .eq("business_id", input.businessId)
    .eq("subject_type", "PROSPECT")
    .eq("subject_id", input.prospectId)
    .maybeSingle();

  const evidence = input.profileUrl
    ? `Accepted a ${platformLabel(input.platform)} connection request from this workspace (${input.profileUrl}).`
    : `Accepted a ${platformLabel(input.platform)} connection request from this workspace.`;

  if (!existing) {
    const { error } = await admin.from("contact_permissions").insert({
      business_id: input.businessId,
      subject_type: "PROSPECT",
      subject_id: input.prospectId,
      relationship_type: "ACCEPTED_SOCIAL_CONNECTION",
      relationship_detail: evidence,
      // Not consent. See the module header — recording GRANTED here would
      // manufacture evidence of an opt-in that never happened.
      consent_status: "UNKNOWN",
      lawful_basis_tag: "LEGITIMATE_INTERESTS",
      // Left UNKNOWN rather than guessed. Whether this is a corporate or an
      // individual subscriber decides which sending regime applies, and a
      // social profile does not answer it — the pack sends UNKNOWN to human
      // review, which is the correct outcome.
      subscriber_type: "UNKNOWN",
    });

    if (error) return { recorded: false, reason: error.message };
    return { recorded: true, reason: null };
  }

  // A stronger basis already on file wins. Accepting a follow adds nothing to
  // "they are an existing customer", and replacing it would lose evidence.
  if (
    existing.relationship_type !== "UNKNOWN" &&
    existing.relationship_type !== "FOUND_BY_US"
  ) {
    return {
      recorded: false,
      reason: "A stronger relationship is already recorded for this prospect.",
    };
  }

  // Withdrawn consent is absolute and an acceptance does not reopen it. A
  // person who opted out and later followed the account has not un-opted-out.
  if (existing.consent_status === "WITHDRAWN") {
    return {
      recorded: false,
      reason: "This contact has withdrawn consent, which an acceptance does not reverse.",
    };
  }

  const { error } = await admin
    .from("contact_permissions")
    .update({
      relationship_type: "ACCEPTED_SOCIAL_CONNECTION",
      relationship_detail: evidence,
      lawful_basis_tag: "LEGITIMATE_INTERESTS",
    })
    .eq("id", existing.id);

  if (error) return { recorded: false, reason: error.message };
  void acceptedAt;
  return { recorded: true, reason: null };
}

function platformLabel(platform: SocialPlatform): string {
  switch (platform) {
    case "LINKEDIN":
      return "LinkedIn";
    case "FACEBOOK":
      return "Facebook";
    case "INSTAGRAM":
      return "Instagram";
    case "TIKTOK":
      return "TikTok";
    default:
      return platform;
  }
}
