import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import { runTask } from "@/lib/ai/model-router";
import type { SocialReplyClassification } from "@/lib/ai/schemas";
import { isOptOutPhrase } from "@/lib/agent/classification";
import { suppress } from "@/lib/policy/suppression";
import { enqueueAgentTurn, inboundMessageEvent } from "@/lib/agent/events";
import type { SocialPlatform } from "@/lib/outreach/social-limits";

/**
 * A reply on a social channel.
 *
 * `REPLIED` has been a legal state in `social_connection_states` since 0067 and
 * was unreachable until now, because nothing ingested an inbound social
 * message. That single gap is what made the channel a one-way broadcast: no
 * reply meant no classification, no stop condition that actually fired, no
 * promotion, and therefore no booking. Everything in this file exists to close
 * it.
 *
 * ## The order of operations, and why it is this order
 *
 *   1. **Record it.** Idempotently, on the platform's own id. Everything after
 *      this point is derived and can be recomputed; the reply itself cannot.
 *   2. **Stop the sequence.** Before classifying, before promoting, before any
 *      model call. If the process dies immediately after this write, the worst
 *      outcome is an unclassified reply sitting in the queue -- not a follow-up
 *      fired at somebody who already answered.
 *   3. **Classify.** Deterministic opt-out check first, and it wins in both
 *      directions; the model only distinguishes the shades that a phrase list
 *      cannot.
 *   4. **Act.** Suppress, or promote and hand to the agent.
 *
 * ## On promotion
 *
 * `conversations` has carried `prospect_id` with a nullable `lead_id` since
 * 0029, so the thread does not need copying anywhere: promotion attaches a lead
 * to the conversation that already exists, and every message in it is stamped
 * with that lead id. The whole history is in the Lead Drawer the moment it
 * happens, which is the outcome 0029's own comment describes.
 *
 * `promote_reviewed_prospect` refuses a prospect whose `replied_at` is null.
 * Setting that column is therefore not bookkeeping -- it is the fact that makes
 * promotion lawful under the product's own rule that only people who engaged
 * become Leads.
 */

/** How a reply reached us. Only one of them is machine-verified. */
export type ReplyIngestSource = "ASSISTED" | "PARTNER_API";

export type IngestReplyInput = {
  businessId: string;
  prospectId: string;
  platform: SocialPlatform;
  body: string;
  receivedAt?: string;
  /**
   * The platform's own message id where one exists. Omitted for a reply a
   * person is transcribing, in which case a content hash stands in -- see
   * `refFor`.
   */
  externalRef?: string | null;
  ingestedBy: ReplyIngestSource;
  ingestedByUserId?: string | null;
};

export type IngestReplyResult = {
  /** False when this exact reply had already been recorded. */
  recorded: boolean;
  classification: SocialReplyClassification["classification"] | null;
  /** Set when this reply caused a promotion. */
  leadId: string | null;
  suppressed: boolean;
};

/**
 * The idempotency key for a reply.
 *
 * A partner webhook supplies the platform's id and will redeliver it; a person
 * typing a reply into the queue supplies nothing, and may well double-submit
 * the form. Hashing the content and the day gives the second case a stable key
 * without making a genuine repeat of the same words a week later collide with
 * the first.
 */
function refFor(input: IngestReplyInput): string {
  if (input.externalRef?.trim()) return input.externalRef.trim();

  const day = (input.receivedAt ?? new Date().toISOString()).slice(0, 10);
  const digest = createHash("sha256")
    .update(`${input.prospectId}:${day}:${input.body.trim()}`)
    .digest("hex")
    .slice(0, 32);

  return `local:${digest}`;
}

export async function ingestSocialReply(
  input: IngestReplyInput,
): Promise<IngestReplyResult> {
  const admin = createAdminClient();
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const externalRef = refFor(input);

  const body = input.body.trim();
  if (!body) {
    return { recorded: false, classification: null, leadId: null, suppressed: false };
  }

  /* 1. Record ------------------------------------------------------------ */

  const { data: inserted, error } = await admin
    .from("social_inbound_replies")
    .insert({
      business_id: input.businessId,
      prospect_id: input.prospectId,
      platform: input.platform,
      body,
      received_at: receivedAt,
      external_ref: externalRef,
      ingested_by: input.ingestedBy,
      ingested_by_user_id: input.ingestedByUserId ?? null,
    })
    .select("id")
    .single();

  // 23505 is the unique index doing its job: this reply is already recorded,
  // and everything downstream of it already ran. Returning early is what makes
  // a redelivered webhook harmless.
  if (error?.code === "23505") {
    const { data: existing } = await admin
      .from("social_inbound_replies")
      .select("classification, promoted_lead_id")
      .eq("business_id", input.businessId)
      .eq("platform", input.platform)
      .eq("external_ref", externalRef)
      .maybeSingle();

    return {
      recorded: false,
      classification:
        (existing?.classification as IngestReplyResult["classification"]) ?? null,
      leadId: existing?.promoted_lead_id ?? null,
      suppressed: existing?.classification === "OPT_OUT",
    };
  }
  if (error) throw error;

  /* 2. Stop the sequence ------------------------------------------------- */

  await stopSequence({
    businessId: input.businessId,
    prospectId: input.prospectId,
    platform: input.platform,
    receivedAt,
  });

  const conversationId = await recordInboundMessage({
    businessId: input.businessId,
    prospectId: input.prospectId,
    platform: input.platform,
    body,
    receivedAt,
  });

  /* 3. Classify ---------------------------------------------------------- */

  const classification = await classifyReply(input.businessId, body, inserted.id);

  await admin
    .from("social_inbound_replies")
    .update({ classification, classified_at: new Date().toISOString() })
    .eq("id", inserted.id);

  // Carry the verdict onto the thread.
  //
  // The classification already existed and was thrown away: the inbox had no
  // idea an interested reply had landed, so it could filter by channel and by
  // unread and not by the question somebody actually opens it with -- who wants
  // to talk to me.
  if (conversationId) {
    await admin
      .from("conversations")
      .update({ interest: classification })
      .eq("business_id", input.businessId)
      .eq("id", conversationId);
  }

  /* 4. Act --------------------------------------------------------------- */

  if (classification === "OPT_OUT") {
    await suppressProspect(input.businessId, input.prospectId);
    return { recorded: true, classification, leadId: null, suppressed: true };
  }

  const leadId = await maybePromote({
    businessId: input.businessId,
    prospectId: input.prospectId,
    replyId: inserted.id,
    classification,
    conversationId,
    body,
    receivedAt,
    platform: input.platform,
  });

  return { recorded: true, classification, leadId, suppressed: false };
}

/* ------------------------------------------------------------ stopping */

/**
 * Everything that must stop the instant somebody replies.
 *
 * Written as one function because these four writes are a single fact -- "they
 * answered" -- and doing three of them is worse than doing none: a state that
 * says REPLIED while a DRAFT follow-up still sits in the queue is precisely the
 * configuration that sends a chase to someone mid-conversation.
 */
async function stopSequence(input: {
  businessId: string;
  prospectId: string;
  platform: SocialPlatform;
  receivedAt: string;
}): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("social_connection_states")
    .update({
      state: "REPLIED",
      replied_at: input.receivedAt,
      // The clock is cleared, not rescheduled. From here the conversation is
      // event-driven and the sequencer has no further opinion about it.
      next_action: null,
      next_action_at: null,
      halted_reason: "They replied, so the outreach sequence stopped here.",
    })
    .eq("business_id", input.businessId)
    .eq("prospect_id", input.prospectId)
    .eq("platform", input.platform);

  // The composed-but-unsent follow-up. In ASSISTED mode this is the message a
  // person would otherwise have sent an hour later without knowing.
  await admin
    .from("social_outbound_messages")
    .update({
      status: "DISCARDED",
      discarded_reason: "They replied before this was sent.",
    })
    .eq("business_id", input.businessId)
    .eq("prospect_id", input.prospectId)
    .eq("status", "DRAFT");

  // `replied_at` on the prospect is what `promote_reviewed_prospect` checks, so
  // this write is the difference between a promotable prospect and one the
  // routine will refuse.
  await admin
    .from("prospects")
    .update({
      replied_at: input.receivedAt,
      last_activity_at: input.receivedAt,
      status: "REPLIED",
    })
    .eq("business_id", input.businessId)
    .eq("id", input.prospectId)
    .in("status", ["APPROVED", "OUTREACH_ACTIVE", "READY"]);
}

/* -------------------------------------------------------- the transcript */

/**
 * Puts the reply on the prospect's conversation.
 *
 * The same conversation the outbound messages were written to, so promotion
 * later attaches a lead to a thread that already reads correctly rather than to
 * an empty one. Returns the conversation id because the promotion step needs it
 * and re-reading it would be a second round trip for a value we just resolved.
 */
async function recordInboundMessage(input: {
  businessId: string;
  prospectId: string;
  platform: SocialPlatform;
  body: string;
  receivedAt: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const channel = channelFor(input.platform);

  const { data: prospect } = await admin
    .from("prospects")
    .select("conversation_id")
    .eq("business_id", input.businessId)
    .eq("id", input.prospectId)
    .maybeSingle();

  let conversationId = prospect?.conversation_id ?? null;

  if (!conversationId) {
    const { data: created } = await admin
      .from("conversations")
      .insert({
        business_id: input.businessId,
        prospect_id: input.prospectId,
        channel,
        last_inbound_at: input.receivedAt,
        last_message_at: input.receivedAt,
      })
      .select("id")
      .single();

    conversationId = created?.id ?? null;
    if (conversationId) {
      await admin
        .from("prospects")
        .update({ conversation_id: conversationId })
        .eq("business_id", input.businessId)
        .eq("id", input.prospectId);
    }
  } else {
    await admin
      .from("conversations")
      .update({ last_inbound_at: input.receivedAt, last_message_at: input.receivedAt })
      .eq("id", conversationId);
  }

  if (!conversationId) return null;

  await admin.from("messages").insert({
    business_id: input.businessId,
    conversation_id: conversationId,
    prospect_id: input.prospectId,
    direction: "inbound",
    channel,
    body: input.body,
    status: "RECEIVED",
    received_at: input.receivedAt,
  });

  await admin
    .from("social_connection_states")
    .update({ conversation_id: conversationId })
    .eq("business_id", input.businessId)
    .eq("prospect_id", input.prospectId)
    .eq("platform", input.platform);

  return conversationId;
}

/** The transport a platform's messages travel on. See 0072 §1 on the naming. */
export function channelFor(platform: SocialPlatform): string {
  switch (platform) {
    case "LINKEDIN":
      return "linkedin";
    case "INSTAGRAM":
      return "instagram";
    case "TIKTOK":
      return "tiktok";
    case "FACEBOOK":
      return "messenger";
  }
}

/* ------------------------------------------------------- classification */

/**
 * How the reply is read.
 *
 * The deterministic phrase check runs first and is final. A model is not
 * allowed to overrule "stop contacting me" into UNCLEAR, because that error is
 * irreversible from the recipient's point of view and a regulator's; and the
 * check is equally not allowed to invent an opt-out the words do not contain,
 * which is why it is a phrase list rather than a sentiment judgement.
 *
 * Everything else is genuinely ambiguous -- "not the right time" versus "not my
 * department" versus "how much?" -- and that is what the model is for. Its
 * failure mode is safe: UNCLEAR halts the sequence and shows the reply to a
 * person, which is what happens when AI is off entirely.
 */
async function classifyReply(
  businessId: string,
  body: string,
  replyId: string,
): Promise<SocialReplyClassification["classification"]> {
  if (isOptOutPhrase(body)) return "OPT_OUT";

  const result = await runTask<SocialReplyClassification>({
    taskType: "social_reply_classification",
    businessId,
    // Stable per reply: a retried job re-reads the same words and must not be
    // billed twice for the same answer.
    idempotencyKey: `social-reply:${replyId}`,
    maxOutputTokens: 200,
    context: `The reply, verbatim:\n\n${body}`,
  });

  if (!result.data) return "UNCLEAR";

  // A model that says OPT_OUT where the phrase check did not is not trusted to
  // suppress somebody on its own -- suppression is irreversible from the
  // product -- but it is a strong enough signal to stop and ask a person.
  if (result.data.classification === "OPT_OUT") return "UNCLEAR";

  // Low confidence is not a classification. Routing it to UNCLEAR is the same
  // rule the qualification engine follows, and it costs a person ten seconds.
  if (result.requiresReview) return "UNCLEAR";

  return result.data.classification;
}

async function suppressProspect(businessId: string, prospectId: string): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("prospects")
    .update({
      outreach_eligibility: "SUPPRESSED",
      suppressed_at: new Date().toISOString(),
      suppression_reason: "They asked not to be contacted again.",
      status: "SUPPRESSED",
    })
    .eq("business_id", businessId)
    .eq("id", prospectId);

  // The global list too. An opt-out on LinkedIn is an opt-out, and a workspace
  // emailing them next week because the suppression was only recorded on the
  // prospect row is exactly the failure 0069 unified the lists to prevent.
  const { data: prospect } = await admin
    .from("prospects")
    .select("email, phone_e164, linkedin_url")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();

  // The one suppression list every send path reads (0069). Each destination is
  // filed in its own column rather than a generic `destination` field: the
  // lookup is indexed per kind, and an email written into the phone slot would
  // match nothing for ever after.
  //
  // Channel ALL, because somebody who says "stop" on Instagram has said "do not
  // contact me" -- not "not by Instagram". Suppressing only the channel the
  // words arrived on is how a person who opted out receives a cold email a
  // fortnight later.
  const destinations: { email?: string | null; phone?: string | null }[] = [
    ...(prospect?.email ? [{ email: prospect.email }] : []),
    ...(prospect?.phone_e164 ? [{ phone: prospect.phone_e164 }] : []),
  ];

  for (const destination of destinations) {
    await suppress({
      businessId,
      ...destination,
      channel: "ALL",
      reason: "OPT_OUT",
      source: "social_reply",
    }).catch(() => {
      // A suppression that fails to write must not lose the reply we already
      // recorded. The prospect row above is the binding one for this channel.
    });
  }
}

/* ------------------------------------------------------------ promotion */

/** Replies that mean the relationship has changed. */
const PROMOTABLE = new Set(["INTERESTED", "QUESTION", "OBJECTION"]);

async function maybePromote(input: {
  businessId: string;
  prospectId: string;
  replyId: string;
  classification: SocialReplyClassification["classification"];
  conversationId: string | null;
  body: string;
  receivedAt: string;
  platform: SocialPlatform;
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data: controls } = await admin
    .from("business_data_controls")
    .select("social_auto_promote_on_reply")
    .eq("business_id", input.businessId)
    .maybeSingle();

  // Default false, per `lead-routes.ts`: promotion stays a human decision
  // unless a workspace has explicitly said otherwise. A workspace that has not
  // answered has not consented to it.
  if (!controls?.social_auto_promote_on_reply) return null;
  if (!PROMOTABLE.has(input.classification)) return null;

  const { data: leadId, error } = await admin.rpc("promote_reviewed_prospect", {
    p_business_id: input.businessId,
    p_prospect_id: input.prospectId,
    // Null: the promotion is the system's own decision and there is no user to
    // name. The function declares `p_user_id uuid` and coalesces it, so null is
    // the intended "no actor" value -- but Supabase's type generator renders
    // every argument non-nullable, so the cast is asserting what the SQL
    // already permits rather than working around a real constraint.
    p_user_id: null as unknown as string,
  });

  // A refusal here is not a failure of the reply. The reply is recorded, the
  // sequence is stopped, and a person will see it in the queue -- which is the
  // outcome a workspace with auto-promotion off gets anyway.
  if (error || !leadId) return null;

  await admin
    .from("social_inbound_replies")
    .update({ promoted_lead_id: leadId })
    .eq("id", input.replyId);

  // Hand the conversation to the agent. From here it is an ordinary lead
  // conversation: the agent qualifies, answers, and tries to book, on the
  // channel the person actually used.
  if (input.conversationId) {
    const { data: message } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (message) {
      await enqueueAgentTurn(
        inboundMessageEvent({
          businessId: input.businessId,
          leadId,
          conversationId: input.conversationId,
          channel: "linkedin",
          provider: null,
          messageId: message.id,
          body: input.body,
          receivedAt: input.receivedAt,
        }),
      );
    }
  }

  return leadId;
}
