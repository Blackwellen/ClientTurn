import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { performSend } from "@/lib/jobs/send-core";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { renderTemplate } from "@/lib/automation/scheduler";
import type { Channel } from "@/lib/messaging/types";
import { runTask } from "@/lib/ai/model-router";
import { MAX_MESSAGE_LENGTH } from "@/lib/campaigns/types";
import { createSendStore } from "./send-store";
import {
  loadBusinessContext,
  loadLead,
  mergeValues,
  queueNotification,
  queueOutboundMessage,
} from "./shared";
import { parsePayload } from "./parse";
import { campaignSendPayload } from "./payloads";

const DUE_LIMIT = 40;

type ContactRow = {
  id: string;
  lead_id: string;
  state: string;
  next_send_at: string | null;
};

async function finishIfDrained(campaignId: string, businessId: string) {
  const admin = createAdminClient();
  const { count } = await admin
    .from("campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("state", ["pending", "scheduled"]);

  if ((count ?? 0) > 0) return;

  const { data } = await admin
    .from("campaigns")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "RUNNING")
    .select("id, name")
    .maybeSingle();

  if (!data) return;

  await queueNotification({
    businessId,
    type: "campaign_complete",
    severity: "info",
    title: `Campaign finished: ${data.name}`,
    entityType: "campaign",
    entityId: campaignId,
    linkUrl: `/app/reactivation?campaign=${campaignId}`,
    dedupeKey: `campaign_complete:${campaignId}`,
  });
}

/**
 * One campaign contact at a time, through the same `performSend` path as
 * `message.send` — the guard, the idempotency rule and the metering are the
 * same code, not a second copy of it.
 */
export async function handleCampaignSend(job: ClaimedJob) {
  const payload = parsePayload(campaignSendPayload, job.payload);
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, business_id, status, channel, message_template, subject_template, ai_personalize")
    .eq("id", payload.campaignId)
    .maybeSingle();

  if (!campaign) {
    throw new PermanentJobError(`Campaign ${payload.campaignId} is gone.`);
  }
  if (campaign.status !== "RUNNING") return;
  if (!campaign.message_template) {
    throw new PermanentJobError(
      `Campaign ${campaign.id} has no message template.`,
    );
  }

  const business = await loadBusinessContext(campaign.business_id);
  if (!business) {
    throw new PermanentJobError(`Business ${campaign.business_id} is gone.`);
  }

  let query = admin
    .from("campaign_contacts")
    .select("id, lead_id, state, next_send_at")
    .eq("campaign_id", campaign.id)
    .in("state", ["pending", "scheduled"]);

  query = payload.contactIds?.length
    ? query.in("id", payload.contactIds)
    : query.lte("next_send_at", new Date().toISOString()).limit(DUE_LIMIT);

  const { data: contacts } = await query;

  const provider = getMessagingProvider();
  const channel = campaign.channel as Channel;

  // An email campaign without a subject cannot be sent, and failing here — at
  // the campaign, once — is clearer than failing per contact.
  if (channel === "email" && !campaign.subject_template?.trim()) {
    throw new PermanentJobError(
      `Campaign ${campaign.id} is an email campaign with no subject line.`,
    );
  }

  for (const contact of (contacts ?? []) as ContactRow[]) {
    const lead = await loadLead(contact.lead_id);
    if (!lead) {
      await admin
        .from("campaign_contacts")
        .update({ state: "failed", stopped_reason: "lead_removed" })
        .eq("id", contact.id);
      continue;
    }

    const values = await mergeValues(business, lead);
    let body = renderTemplate(campaign.message_template, values).trim();

    if (campaign.ai_personalize && business.aiAssistEnabled) {
      const context =
        `Base message: ${body}\n` +
        `Merge context: ${Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`;

      const personalized = await runTask<{ message: string }>({
        taskType: "reactivation_copy",
        businessId: campaign.business_id,
        leadId: lead.id,
        context,
        maxOutputTokens: 200,
      });

      const candidate = personalized.data?.message?.trim();
      if (candidate && candidate.length > 0 && candidate.length <= MAX_MESSAGE_LENGTH) {
        body = candidate;
      }
    }

    const messageId = await queueOutboundMessage({
      businessId: campaign.business_id,
      leadId: lead.id,
      channel,
      body,
      subject:
        channel === "email"
          ? renderTemplate(campaign.subject_template ?? "", values).trim()
          : null,
      origin: "campaign",
      campaignId: campaign.id,
      sendKey: `campaign:${campaign.id}:${contact.id}`,
      enqueueSend: false,
    });

    if (!messageId) {
      await admin
        .from("campaign_contacts")
        .update({ state: "failed", stopped_reason: "no_conversation" })
        .eq("id", contact.id);
      continue;
    }

    const outcome = await performSend({
      store: createSendStore(),
      provider,
      messageId,
      finalAttempt: job.attempts >= job.max_attempts,
    });

    const now = new Date().toISOString();

    if (outcome.outcome === "sent") {
      await admin
        .from("campaign_contacts")
        .update({ state: "sent", sent_at: now })
        .eq("id", contact.id);
    } else if (outcome.outcome === "aborted") {
      await admin
        .from("campaign_contacts")
        .update({ state: "suppressed", stopped_reason: outcome.reason })
        .eq("id", contact.id);
    } else if (outcome.outcome === "rescheduled") {
      await admin
        .from("campaign_contacts")
        .update({ next_send_at: outcome.at.toISOString(), state: "scheduled" })
        .eq("id", contact.id);
    } else if (outcome.outcome === "failed") {
      if (outcome.permanent || job.attempts >= job.max_attempts) {
        await admin
          .from("campaign_contacts")
          .update({ state: "failed", stopped_reason: outcome.errorCode })
          .eq("id", contact.id);
      }
      // A transient failure leaves the contact due for the next pass.
    } else if (outcome.outcome === "already_processed") {
      await admin
        .from("campaign_contacts")
        .update({ state: "sent", sent_at: now })
        .eq("id", contact.id);
    }
  }

  await finishIfDrained(campaign.id, campaign.business_id);
}
