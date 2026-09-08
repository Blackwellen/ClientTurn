import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaComment } from "@/lib/messaging/meta-protocol";

/**
 * A comment on the business's own content, arriving by webhook.
 *
 * This is the entry point for the discovery flows on Facebook and Instagram. A
 * comment is the only thing that makes somebody reachable who has never
 * messaged the business, and its id is the address Meta's private-reply
 * endpoint takes.
 *
 * ## Why the webhook rather than a poll
 *
 * `engagement-ingest.ts` reads comments back from `/{page}/feed`, which needs
 * `pages_read_user_content` — a permission the use-case model does not offer on
 * this app. A comment **delivered** to a subscribed webhook needs no read
 * permission at all: Meta is handing it to us rather than us fetching it.
 *
 * So this is not merely the faster path, it is the only one that works for
 * Facebook. The poller stays for Instagram, where `/{ig}/media` with the
 * comments edge is covered by `instagram_basic`, and as a backstop for
 * deliveries Meta failed to make.
 *
 * Latency matters here more than anywhere else in the product: the seven-day
 * private-reply window runs from the comment's **own** timestamp, not from when
 * we heard about it, so every hour of delay is an hour off the only clock that
 * expires silently.
 */

export type CommentIngestOutcome =
  | { status: "CREATED"; prospectId: string }
  | { status: "UPDATED"; prospectId: string }
  | { status: "SKIPPED"; reason: string };

/**
 * Resolves the workspace and records the commenter as a prospect.
 *
 * Every refusal returns `SKIPPED` with a reason rather than throwing. This runs
 * inside the webhook request, and Meta retries anything it does not see
 * acknowledged — so an exception here would turn one unusable comment into a
 * retry loop.
 */
export async function ingestWebhookComment(
  comment: MetaComment,
  entryId: string | null,
): Promise<CommentIngestOutcome> {
  if (!comment.fromId) {
    return { status: "SKIPPED", reason: "The comment names no author." };
  }

  const admin = createAdminClient();

  // Which workspace owns the account this was left on. For a Page comment the
  // entry id is the Page; for Instagram it is the IG account. Both live on the
  // same integration row, so one lookup covers them — and an event for an
  // account nobody has connected is dropped rather than guessed at.
  const column =
    comment.platform === "INSTAGRAM" ? "config->>instagramUserId" : "config->>pageId";

  const { data: integration } = await admin
    .from("integrations")
    .select("business_id, config")
    .eq("provider_type", "meta")
    .eq(column, entryId ?? "")
    .neq("status", "DISCONNECTED")
    .maybeSingle();

  if (!integration) {
    return { status: "SKIPPED", reason: "No connected account matches this event." };
  }

  const businessId = integration.business_id;
  const config = (integration.config ?? {}) as Record<string, unknown>;

  // The business commenting in its own thread. Meta delivers those here too,
  // and ingesting one would create a prospect for the customer themselves.
  const ownIds = [config.pageId, config.instagramUserId].filter(
    (value): value is string => typeof value === "string",
  );
  if (ownIds.includes(comment.fromId)) {
    return { status: "SKIPPED", reason: "That is the business's own comment." };
  }

  const now = new Date().toISOString();

  /* ------------------------------------------------------ already known? */
  const { data: existing } = await admin
    .from("prospects")
    .select("id, private_reply_sent_at, outreach_eligibility")
    .eq("business_id", businessId)
    .eq("social_platform", comment.platform)
    .eq("social_external_id", comment.fromId)
    .maybeSingle();

  if (existing) {
    // A fresh comment replaces the one we would answer. That is not tidiness:
    // the allowance is one private reply *per comment*, so somebody who
    // comments again has handed us a new entitlement and a new seven days.
    // Pointing at the older comment would spend a reply on a closed window.
    //
    // `private_reply_sent_at` is cleared for the same reason — it recorded a
    // reply to a different comment. It must never be cleared on a SUPPRESSED
    // prospect, who is not to be contacted at all.
    if (existing.outreach_eligibility === "SUPPRESSED") {
      return { status: "SKIPPED", reason: "That prospect is suppressed." };
    }

    await admin
      .from("prospects")
      .update({
        social_comment_id: comment.commentId,
        social_commented_at: comment.createdAt,
        private_reply_sent_at: null,
        last_activity_at: comment.createdAt,
        ...(comment.permalinkUrl ? { social_profile_url: comment.permalinkUrl } : {}),
      })
      .eq("business_id", businessId)
      .eq("id", existing.id);

    return { status: "UPDATED", prospectId: existing.id };
  }

  /* ------------------------------------------------------------- new one */
  const { firstName, lastName } = nameParts(comment.fromName);

  if (!firstName && !comment.permalinkUrl) {
    // Nothing to identify them by. Storing this would create a prospect nobody
    // could ever act on or recognise.
    return { status: "SKIPPED", reason: "The comment carries no usable identity." };
  }

  const { data: created, error } = await admin
    .from("prospects")
    .insert({
      business_id: businessId,
      first_name: firstName,
      last_name: lastName,
      role_classification: "UNKNOWN",
      // REVIEW, not READY. Commenting on a post is interest, not a request to
      // be sold to, so a person decides before anything is sent — the same rule
      // `engagement-ingest` applies, and §11.19's whole point.
      status: "REVIEW",
      outreach_eligibility: "REVIEW",
      eligibility_reason:
        "They commented on your content rather than contacting you. Confirm who they are before replying.",
      source_provider: "meta_webhook",
      subscriber_type: "UNKNOWN",
      verification_status: "UNKNOWN",
      social_platform: comment.platform,
      social_external_id: comment.fromId,
      social_profile_url: comment.permalinkUrl,
      social_comment_id: comment.commentId,
      social_commented_at: comment.createdAt,
      last_activity_at: comment.createdAt,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    // A concurrent delivery won the race, or another prospect already holds
    // this comment id. Either way there is exactly one record, which is the
    // point of the unique indexes.
    return { status: "SKIPPED", reason: "Already recorded." };
  }

  if (error || !created) {
    return { status: "SKIPPED", reason: error?.message ?? "Could not record the comment." };
  }

  // Provenance. First-party by definition: they left it on the business's own
  // content, through the account the business connected.
  await admin.from("prospect_data_sources").insert({
    business_id: businessId,
    prospect_id: created.id,
    field_name: "social_identity",
    value_json: {
      value: comment.fromName ?? comment.fromId,
      platform: comment.platform,
      engagement: "COMMENT",
      excerpt: comment.text,
    } as never,
    provider: "meta_webhook",
    provider_entity_id: comment.commentId,
    source_type: "FIRST_PARTY",
    source_url: comment.permalinkUrl,
    confidence: 1,
    obtained_at: comment.createdAt,
    verified_at: now,
  });

  return { status: "CREATED", prospectId: created.id };
}

function nameParts(name: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: null, lastName: null };

  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };

  // Everything after the first token is the surname. Splitting a three-part
  // name any other way is guesswork, and guessing is what this pipeline is
  // built not to do.
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
