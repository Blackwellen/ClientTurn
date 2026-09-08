import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPrivateReply } from "@/lib/messaging/meta";
import {
  socialAddress,
  withinPrivateReplyWindow,
  META_PRIVATE_REPLY_WINDOW_DAYS,
  type MetaChannel,
} from "@/lib/messaging/types";
import { checkSuppression } from "@/lib/policy/suppression";
import { renderSocialTemplate } from "@/lib/outreach/social-copy";
import { recordAudit } from "@/lib/audit";

/**
 * The one message Meta permits to somebody who commented but never wrote to us.
 *
 * This is the entry point the whole Meta flow depends on. Everything else the
 * product does on Facebook and Instagram is *answering* — an inbound DM, or a
 * reply to this. Without a private reply there is no way to begin a
 * conversation with a person who has not already begun one, because Meta
 * publishes no follow API and no cold-DM API.
 *
 * ## Why this is not part of the social sequencer
 *
 * `social-scheduler.ts` drives connect → wait → message → follow up, which is
 * the LinkedIn and TikTok shape. A private reply shares almost none of it:
 * there is no invitation, no acceptance to wait for, no follow-up ever, and the
 * "cap" is one message per comment rather than a daily allowance. Folding it
 * into a state machine built for a different mechanism would mean bending both.
 *
 * ## The five gates, in the order they bite
 *
 *   1. **The comment.** No comment id, no route. Meta addresses the recipient
 *      as `{ comment_id }` and offers no alternative.
 *   2. **The window.** Seven days from the comment's own timestamp, never our
 *      receipt time.
 *   3. **The one-reply rule.** One per comment, ever. Enforced here, and again
 *      by a unique index, and again by Meta.
 *   4. **Contactability.** Suppression and opt-outs. A public comment is never
 *      a route around an opt-out somebody made elsewhere.
 *   5. **Approval.** A comment is interest, not a request to be sold to, so a
 *      person approves the prospect before anything is sent.
 */

export type PrivateReplyCandidate = {
  prospectId: string;
  platform: "FACEBOOK" | "INSTAGRAM";
  /**
   * The person's platform-scoped id, bare. Needed because suppression is keyed
   * on the address a message would go to, not on our own row id — checking the
   * prospect id against the suppression list would never match anything, and
   * would therefore never stop a send.
   */
  externalId: string | null;
  commentId: string;
  commentedAt: string;
  firstName: string | null;
  companyName: string | null;
};

export type PrivateReplyOutcome =
  | { status: "SENT"; prospectId: string; providerMessageId: string }
  | { status: "SKIPPED"; prospectId: string; reason: string }
  | { status: "FAILED"; prospectId: string; reason: string };

/** The messaging channel a platform's private reply travels over. */
function channelFor(platform: "FACEBOOK" | "INSTAGRAM"): MetaChannel {
  return platform === "INSTAGRAM" ? "instagram" : "messenger";
}

/**
 * Commenters this workspace may still answer, oldest comment first.
 *
 * Oldest first because the window is closing on them: a backlog worked
 * newest-first would let the oldest expire while capacity was spent on
 * comments with six days left.
 */
export async function dueForPrivateReply(
  businessId: string,
  limit = 25,
  now: Date = new Date(),
): Promise<PrivateReplyCandidate[]> {
  const admin = createAdminClient();

  const earliest = new Date(
    now.getTime() - META_PRIVATE_REPLY_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  const { data } = await admin
    .from("prospects")
    .select(
      "id, social_platform, social_external_id, social_comment_id, social_commented_at, first_name, outreach_eligibility, status",
    )
    .eq("business_id", businessId)
    .in("social_platform", ["FACEBOOK", "INSTAGRAM"])
    .not("social_comment_id", "is", null)
    .is("private_reply_sent_at", null)
    // Approval is a precondition, not a later check. A comment is interest, not
    // a request to be sold to, and §11.19 keeps the judgement human.
    .eq("outreach_eligibility", "ELIGIBLE")
    // Inside the window at the database rather than after the read: a workspace
    // with ten thousand stale commenters should not page through all of them to
    // find the handful that are still answerable.
    .gte("social_commented_at", earliest)
    .order("social_commented_at", { ascending: true })
    .limit(limit);

  const candidates: PrivateReplyCandidate[] = [];

  for (const row of data ?? []) {
    if (!row.social_comment_id || !row.social_commented_at) continue;
    if (row.social_platform !== "FACEBOOK" && row.social_platform !== "INSTAGRAM") continue;

    candidates.push({
      prospectId: row.id,
      platform: row.social_platform,
      externalId: row.social_external_id,
      commentId: row.social_comment_id,
      commentedAt: row.social_commented_at,
      firstName: row.first_name,
      companyName: null,
    });
  }

  return candidates;
}

/**
 * Sends one private reply, or explains why it did not.
 *
 * Every refusal returns `SKIPPED` with a sentence rather than throwing. A
 * prospect who fell out of the window, or who was suppressed since being
 * approved, is an ordinary outcome the queue should show — not an error that
 * stops the sweep working the rest of the batch.
 *
 * The write order is deliberate: `private_reply_sent_at` is stamped **before**
 * the send, not after. A crash between the two then costs one unsent message,
 * which the customer can see and re-approve. The other order costs a *second*
 * send against the same comment — refused by Meta, logged against the Page, and
 * exactly the behaviour that attracts enforcement.
 */
export async function sendOnePrivateReply(input: {
  businessId: string;
  businessName: string;
  candidate: PrivateReplyCandidate;
  /** Composed elsewhere when AI is enabled; the template is the fallback. */
  body?: string;
  companyType?: string | null;
  serviceLine?: string | null;
  now?: Date;
}): Promise<PrivateReplyOutcome> {
  const { candidate, businessId } = input;
  const now = input.now ?? new Date();
  const admin = createAdminClient();

  if (!withinPrivateReplyWindow(candidate.commentedAt, now)) {
    return {
      status: "SKIPPED",
      prospectId: candidate.prospectId,
      reason: `Their comment is more than ${META_PRIVATE_REPLY_WINDOW_DAYS} days old, so Facebook and Instagram will no longer deliver a reply to it.`,
    };
  }

  // Contactability, re-read now rather than trusted from the batch. Approval
  // may have happened days ago and a suppression since.
  //
  // Keyed on the *platform address*, which is what a suppression row holds —
  // `socialAddress` builds the same string the send path and the opt-out
  // handler use, so all three agree by construction rather than by three
  // separate pieces of string concatenation staying in step.
  const channel = channelFor(candidate.platform);

  if (!candidate.externalId) {
    // No platform id means no address, which means suppression cannot be
    // checked. An unverifiable contactability decision is a refusal, never an
    // assumption that nobody objected.
    return {
      status: "SKIPPED",
      prospectId: candidate.prospectId,
      reason:
        "This prospect has no platform id recorded, so it is not possible to confirm they have not opted out.",
    };
  }

  const suppression = await checkSuppression(businessId, "SOCIAL", {
    social: socialAddress(channel, candidate.externalId),
  });

  if (suppression) {
    return {
      status: "SKIPPED",
      prospectId: candidate.prospectId,
      reason: "They are on your suppression list, so nothing was sent.",
    };
  }

  const body =
    input.body?.trim() ||
    renderSocialTemplate({
      kind: "PRIVATE_REPLY",
      platform: candidate.platform,
      step: 1,
      context: {
        businessName: input.businessName,
        companyType: input.companyType ?? null,
        serviceLine: input.serviceLine ?? null,
        prospect: {
          first_name: candidate.firstName,
          // Neither is known for a commenter, and neither is guessed at. Meta
          // gives a display name and nothing else, so the template falls back
          // to its own neutral wording rather than to an invented job title.
          last_name: null,
          role_title: null,
          company: candidate.companyName ? { name: candidate.companyName } : null,
        },
      },
    });

  // Claim the one reply before spending it. See the note above on ordering:
  // the conditional `is null` makes this the atomic claim, so two workers
  // racing the same prospect produce exactly one send.
  const { data: claimed } = await admin
    .from("prospects")
    .update({ private_reply_sent_at: now.toISOString() })
    .eq("business_id", businessId)
    .eq("id", candidate.prospectId)
    .is("private_reply_sent_at", null)
    .select("id")
    .maybeSingle();

  if (!claimed) {
    // Zero rows updated has two quite different causes, and reporting the wrong
    // one is a lie shown to a customer. Either the reply really was already
    // sent — the ordinary race, and the outcome the claim exists to produce —
    // or the prospect is not there at all: deleted, or belonging to another
    // workspace. A live probe against a nonexistent id reported "their one
    // reply had already been sent", which would have somebody hunting for a
    // message that was never composed.
    const { data: existing } = await admin
      .from("prospects")
      .select("private_reply_sent_at")
      .eq("business_id", businessId)
      .eq("id", candidate.prospectId)
      .maybeSingle();

    return {
      status: "SKIPPED",
      prospectId: candidate.prospectId,
      reason: existing
        ? "Their one reply had already been sent."
        : "That prospect no longer exists in this workspace, so nothing was sent.",
    };
  }

  // The message row exists before the send, so a customer can see what was said
  // even if the transport then fails.
  const { data: message } = await admin
    .from("social_outbound_messages")
    .insert({
      business_id: businessId,
      prospect_id: candidate.prospectId,
      platform: candidate.platform,
      kind: "PRIVATE_REPLY",
      sequence_step: 0,
      body,
      status: "DRAFT",
      composed_by: input.body ? "AI" : "TEMPLATE",
      comment_id: candidate.commentId,
      performed_by: "PARTNER_API",
    })
    .select("id")
    .single();

  const result = await sendPrivateReply({
    businessId,
    channel,
    commentId: candidate.commentId,
    body,
  });

  if (!result.ok) {
    // The claim is deliberately NOT released. Meta's refusals here are
    // permanent by nature — the comment is too old, the reply is spent, or the
    // permission is absent — and releasing it would have the next sweep make
    // the same refused request again.
    if (message) {
      await admin
        .from("social_outbound_messages")
        .update({ status: "FAILED", last_error: result.errorMessage })
        .eq("id", message.id);
    }

    return {
      status: "FAILED",
      prospectId: candidate.prospectId,
      reason: result.errorMessage,
    };
  }

  if (message) {
    await admin
      .from("social_outbound_messages")
      .update({ status: "SENT", sent_at: now.toISOString() })
      .eq("id", message.id);
  }

  await admin
    .from("prospects")
    // OUTREACH_ACTIVE, not CONTACTED: the prospect status vocabulary is the
    // sourcing one (DISCOVERED -> ... -> REPLIED -> CONVERTED), not the lead
    // lifecycle's. They are deliberately different vocabularies for
    // deliberately different objects, and borrowing a word from the wrong one
    // is rejected by the check constraint rather than silently stored.
    .update({ last_contacted_at: now.toISOString(), status: "OUTREACH_ACTIVE" })
    .eq("business_id", businessId)
    .eq("id", candidate.prospectId);

  await recordAudit({
    businessId,
    actorUserId: null,
    action: "social_outreach.messaged",
    entityType: "prospect",
    entityId: candidate.prospectId,
    metadata: {
      platform: candidate.platform,
      kind: "PRIVATE_REPLY",
      commentId: candidate.commentId,
      providerMessageId: result.providerMessageId,
    },
  });

  return {
    status: "SENT",
    prospectId: candidate.prospectId,
    providerMessageId: result.providerMessageId,
  };
}
