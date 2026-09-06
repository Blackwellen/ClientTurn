import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { suppress } from "@/lib/policy/suppression";
import {
  classifyDeterministic,
  classifyHeuristic,
} from "@/lib/agent/classification";
import { replyClassificationFor, type LeadIntent } from "@/lib/agent/types";
import { replyActionFor, type ReplyAction, type ReplyRuleKey } from "../campaign-draft";
import { recordCampaignEvent } from "./lifecycle";

/**
 * What happens when a cold prospect replies (V4 section 18.32).
 *
 * Classification is the platform's existing deterministic classifier, not a
 * second opinion written for campaigns. An unsubscribe recognised in the
 * unified inbox and an unsubscribe recognised here must be the same
 * unsubscribe, or the product has two different ideas about who has opted out.
 *
 * Promotion goes through `promote_reviewed_prospect`, the same routine the
 * Prospects surface calls. There is deliberately no campaign-specific
 * conversion path: the conversation row, the message history and the
 * provenance all survive precisely because nothing here reimplements it.
 */

/** The campaign rule a classified reply falls under. */
export function ruleKeyFor(intent: LeadIntent): ReplyRuleKey {
  const bucket = replyClassificationFor(intent);
  switch (bucket) {
    case "UNSUBSCRIBE":
      return "UNSUBSCRIBE";
    case "COMPLAINT":
      // A complaint is handled with the same finality as an unsubscribe. The
      // difference matters for reporting, not for whether we write again.
      return "UNSUBSCRIBE";
    case "POSITIVE":
    case "BOOKING_INTENT":
      return "POSITIVE";
    case "NOT_INTERESTED":
    case "OBJECTION":
      return "NOT_INTERESTED";
    case "HUMAN_REQUEST":
    case "WRONG_NUMBER":
      return "HUMAN_REQUEST";
    default:
      return "QUESTION";
  }
}

/** The `messages.reply_classification` value for a classified reply. */
export function messageClassificationFor(intent: LeadIntent): string {
  const bucket = replyClassificationFor(intent);
  switch (bucket) {
    case "POSITIVE":
    case "BOOKING_INTENT":
      return "POSITIVE_INTEREST";
    case "QUESTION":
      return "NEUTRAL_QUESTION";
    case "OBJECTION":
      return "OBJECTION";
    case "NOT_INTERESTED":
      return "NOT_NOW";
    case "UNSUBSCRIBE":
      return "UNSUBSCRIBE";
    case "COMPLAINT":
      return "COMPLAINT";
    case "HUMAN_REQUEST":
      return "HUMAN_REQUEST";
    case "WRONG_NUMBER":
      return "WRONG_PERSON";
    default:
      return "UNKNOWN";
  }
}

export type ReplyOutcome = {
  intent: LeadIntent;
  ruleKey: ReplyRuleKey;
  action: ReplyAction;
  sequenceStopped: boolean;
  suppressed: boolean;
  promotedLeadId: string | null;
};

/**
 * Handles one inbound reply on a campaign conversation.
 *
 * Idempotent by the message id: a webhook replay re-reads the same row and the
 * writes below all settle to the same state, so a duplicate delivery cannot
 * promote a prospect twice or suppress an address twice.
 */
export async function handleCampaignReply(input: {
  businessId: string;
  campaignId: string;
  prospectId: string;
  messageId: string;
  body: string;
}): Promise<ReplyOutcome | null> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("id, name, reply_rules_json, promotion_rule")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!campaign) return null;

  // Binding rules first, hint second, UNKNOWN last. The model is not consulted
  // here at all: a campaign reply never needs generation, only routing.
  const verdict = classifyDeterministic(input.body) ?? classifyHeuristic(input.body);
  const intent: LeadIntent = verdict?.intent ?? "UNKNOWN";
  const ruleKey = ruleKeyFor(intent);
  const action = replyActionFor(
    ruleKey,
    (campaign.reply_rules_json ?? {}) as Record<string, string>,
  );

  await admin
    .from("messages")
    .update({
      reply_classification: messageClassificationFor(intent),
      reply_confidence: verdict?.confidence ?? null,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.messageId);

  // A reply always stops the sequence, whatever it said. Continuing to send
  // scheduled follow-ups to someone who has answered is the single most
  // common way cold outreach becomes spam.
  const { data: stopped } = await admin
    .from("outreach_recipient_runs")
    .update({
      status: "REPLIED",
      replied_at: new Date().toISOString(),
      next_step_due_at: null,
      stop_reason: "REPLIED",
    })
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .eq("prospect_id", input.prospectId)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"])
    .select("id");

  await admin
    .from("prospects")
    .update({
      status: "REPLIED",
      replied_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("id", input.prospectId)
    .neq("status", "CONVERTED");

  let suppressed = false;
  if (action === "AUTO_SUPPRESS") {
    suppressed = await suppressProspect(
      input.businessId,
      input.prospectId,
      ruleKey === "UNSUBSCRIBE" ? "OPT_OUT" : "MANUAL",
    );
  }

  let promotedLeadId: string | null = null;
  if (shouldPromote(campaign.promotion_rule, ruleKey) && !suppressed) {
    promotedLeadId = await promote(input.businessId, input.prospectId);
  }

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: "REPLY_RECEIVED",
    actorType: "SYSTEM",
    summary: `Reply classified as ${ruleKey.toLowerCase().replace(/_/g, " ")}.`,
    metadata: {
      prospectId: input.prospectId,
      classification: messageClassificationFor(intent),
      action,
      promoted: Boolean(promotedLeadId),
    },
  });

  return {
    intent,
    ruleKey,
    action,
    sequenceStopped: (stopped?.length ?? 0) > 0,
    suppressed,
    promotedLeadId,
  };
}

/**
 * Whether the campaign's promotion rule fires for this reply.
 *
 * BOOKED_EVENT deliberately does not fire on a reply. A booking is a booking,
 * and "they sounded keen" is not one — that rule is satisfied by the booking
 * webhook, not by the inbox.
 */
function shouldPromote(rule: string, ruleKey: ReplyRuleKey): boolean {
  if (rule === "POSITIVE_REPLY") return ruleKey === "POSITIVE";
  return false;
}

/**
 * Promotion, through the one canonical routine.
 *
 * `promote_reviewed_prospect` keeps the conversation row, stamps every message
 * in it with the new lead id, and carries the score, the intent and the
 * sourcing provenance across. Writing a second promotion path here would break
 * all of that quietly.
 */
async function promote(businessId: string, prospectId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("prospects")
    .select("promoted_to_lead_id")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();

  // Idempotent: a replayed reply returns the lead that already exists.
  if (existing?.promoted_to_lead_id) return existing.promoted_to_lead_id;

  // No actor: this promotion was caused by the prospect replying, not by a
  // person clicking. The audit row below records the trigger instead.
  const { data: leadId, error } = await admin.rpc("promote_reviewed_prospect", {
    p_business_id: businessId,
    p_prospect_id: prospectId,
    // The routine stores this as `approved_by`, and Postgres accepts a NULL
    // uuid here. The generated signature types it as required, so the null is
    // asserted rather than the argument being dropped.
    p_user_id: null as unknown as string,
  });

  if (error || !leadId) return null;

  await recordAudit({
    businessId,
    actorType: "system",
    action: "prospect.promoted_to_lead",
    entityType: "prospect",
    entityId: prospectId,
    metadata: { leadId, trigger: "positive_reply" },
  });

  return leadId as string;
}

async function suppressProspect(
  businessId: string,
  prospectId: string,
  reason: "OPT_OUT" | "MANUAL",
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: prospect } = await admin
    .from("prospects")
    .select("email")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();

  if (!prospect?.email) return false;

  await suppress({
    businessId,
    // An opt-out is a person saying "do not contact me", not "not by
    // email" — it applies to every channel.
    channel: reason === "OPT_OUT" ? "ALL" : "EMAIL",
    email: prospect.email,
    reason,
    source: "REPLY",
  });

  await admin
    .from("prospects")
    .update({
      status: reason === "OPT_OUT" ? "UNSUBSCRIBED" : "DISQUALIFIED",
      outreach_eligibility: "SUPPRESSED",
      eligibility_reason:
        reason === "OPT_OUT"
          ? "Asked not to be contacted again"
          : "Told us they are not interested",
    })
    .eq("business_id", businessId)
    .eq("id", prospectId);

  return true;
}
