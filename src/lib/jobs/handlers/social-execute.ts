import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePayload } from "./parse";
import { socialExecutePayload } from "./payloads";
import { recordSocialAction } from "@/lib/outreach/social-outreach";
import { partnerSenderFor } from "@/lib/outreach/social-partners";

/**
 * Performs one prepared social action through a partner integration.
 *
 * This is the only place in the product that would cause something to happen
 * on a social platform without a person clicking, and it is deliberately the
 * narrowest handler in the codebase. Everything it can do has already been
 * decided, composed, capped and policy-checked by `social-scheduler.ts`; all
 * that is left is the transport.
 *
 * ## Why it usually does nothing
 *
 * There is no general API for sending a connection request or a message from a
 * personal LinkedIn account. The Conversations and Messaging APIs are limited
 * to approved partner programmes, and automating a personal account outside one
 * is what gets the account restricted -- which costs the customer far more than
 * a slow campaign.
 *
 * So `partnerSenderFor` returns null unless the workspace genuinely has a
 * compliant integration configured, and this handler then leaves the message in
 * DRAFT for a person to send. That is not a failure state: it is the default,
 * and the queue in Find Leads is built around it. The job records why rather
 * than throwing, because a workspace without a partner integration is a normal
 * workspace and not a broken one.
 */
export async function handleSocialExecute(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(socialExecutePayload, job.payload);
  const admin = createAdminClient();

  // Whichever message is currently in DRAFT for this pair -- see the payload's
  // own comment on why this is not addressed by message id. A retry after the
  // prospect replied correctly finds nothing here, because the reply handler
  // discarded it.
  const { data: message } = await admin
    .from("social_outbound_messages")
    .select("id, account_id, kind, body, sequence_step")
    .eq("business_id", payload.businessId)
    .eq("prospect_id", payload.prospectId)
    .eq("platform", payload.platform)
    .eq("status", "DRAFT")
    .maybeSingle();

  // Nothing to do. The commonest reason by far is that the prospect replied
  // between composition and execution, which is exactly the outcome the
  // sequence is designed to be interrupted by.
  if (!message) return;

  if (!message.account_id) {
    throw new PermanentJobError(
      "The sending account for this message no longer exists, so it cannot be performed.",
    );
  }

  const { data: account } = await admin
    .from("social_sending_accounts")
    .select("id, send_mode, status, platform")
    .eq("business_id", payload.businessId)
    .eq("id", message.account_id)
    .maybeSingle();

  if (!account || account.status !== "ACTIVE" || account.send_mode !== "PARTNER_API") {
    // Not an error: an account moved back to ASSISTED, paused, or restricted
    // simply means a person performs this one. The draft stays where it is.
    await admin
      .from("social_outbound_messages")
      .update({
        last_error:
          "This account no longer sends through a partner integration, so the message is waiting for someone to send it.",
      })
      .eq("id", message.id);
    return;
  }

  const sender = partnerSenderFor(payload.platform);
  if (!sender) {
    await admin
      .from("social_outbound_messages")
      .update({
        last_error:
          "No partner integration is configured for this platform, so the message is waiting for someone to send it from the connected account.",
      })
      .eq("id", message.id);
    return;
  }

  const result = await sender.send({
    businessId: payload.businessId,
    prospectId: payload.prospectId,
    accountId: account.id,
    kind: message.kind as "INVITE_NOTE" | "OPENER" | "FOLLOW_UP",
    body: message.body,
  });

  if (!result.ok) {
    await admin
      .from("social_outbound_messages")
      .update({
        // FAILED rather than DISCARDED: the words are still good, and a person
        // can send this one by hand. Discarding would lose the composition and
        // the token spend behind it.
        status: result.permanent ? "FAILED" : "DRAFT",
        last_error: result.errorMessage,
      })
      .eq("id", message.id);

    if (result.permanent) {
      throw new PermanentJobError(result.errorMessage);
    }
    throw new Error(result.errorMessage);
  }

  // `recordSocialAction` re-checks the plan and the caps itself before writing,
  // and it is what advances the state machine and the append-only log. The
  // handler deliberately does not write `social_connection_states` directly:
  // two writers to that state machine is how a cap comes to disagree with the
  // log it is counted from.
  const recorded = await recordSocialAction({
    businessId: payload.businessId,
    prospectId: payload.prospectId,
    platform: payload.platform,
    accountId: account.id,
    action: message.kind === "INVITE_NOTE" ? "INVITE" : "MESSAGE",
    noteBody: message.kind === "INVITE_NOTE" ? message.body : null,
    performedBy: "PARTNER_API",
    actorUserId: null,
  });

  if (!recorded.ok) {
    // The platform accepted it but our own rules now refuse it. The send has
    // already happened and cannot be taken back, so the message is marked sent
    // and the disagreement is recorded rather than hidden.
    await admin
      .from("social_outbound_messages")
      .update({
        status: "SENT",
        sent_at: new Date().toISOString(),
        performed_by: "PARTNER_API",
        last_error: `Sent, but the state machine refused the update: ${recorded.error}`,
      })
      .eq("id", message.id);
    return;
  }

  const now = new Date().toISOString();

  await admin
    .from("social_outbound_messages")
    .update({
      status: "SENT",
      sent_at: now,
      performed_by: "PARTNER_API",
      last_error: null,
    })
    .eq("id", message.id);

  // The clock moves on. `sequence_step` is advanced here rather than in
  // `recordSocialAction` because that function is shared with the assisted
  // path, and the step belongs to the sequence rather than to the action.
  await admin
    .from("social_connection_states")
    .update({
      sequence_step: message.sequence_step,
      last_outbound_at: now,
      next_action: null,
      // Cleared, not scheduled. The next sweep recomputes when the follow-up
      // is due from `last_outbound_at`, so a gap setting changed in the
      // meantime takes effect rather than being frozen at composition time.
      next_action_at: now,
      attempts: 0,
    })
    .eq("business_id", payload.businessId)
    .eq("prospect_id", payload.prospectId)
    .eq("platform", payload.platform);
}
