import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { performSend } from "@/lib/jobs/send-core";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { renderTemplate } from "@/lib/automation/scheduler";
import type { Channel } from "@/lib/messaging/types";
import { runTask } from "@/lib/ai/model-router";
import { MAX_MESSAGE_LENGTH } from "@/lib/campaigns/types";
import { withOptOutWording } from "@/lib/messaging/sms-compliance";
import { loadTemplate } from "@/lib/messaging/template-registry";
import {
  aiPersonalizeApplies,
  campaignTemplateVariables,
  contactStage,
  followUpDueAt,
  followUpIsDue,
  followUpSkipReason,
  settleCampaignContact,
  type CampaignSendOutcome,
} from "@/lib/campaigns/reactivation-channels";
import { createSendStore } from "./send-store";
import {
  loadBusinessContext,
  loadLead,
  mergeValues,
  passesStyleLint,
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
  sent_at: string | null;
  followup_sent_at: string | null;
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

type ContactUpdate = {
  state?: string;
  stopped_reason?: string | null;
  sent_at?: string;
  followup_sent_at?: string;
  next_send_at?: string;
};

/**
 * Settles one campaign contact. A failed write throws: the job retries, and
 * `performSend` finds the message already settled rather than sending again,
 * so the retry only has to redo this bookkeeping.
 */
async function updateContact(contactId: string, patch: ContactUpdate) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("campaign_contacts")
    .update(patch)
    .eq("id", contactId);
  if (error) {
    throw new Error(`Could not update campaign contact ${contactId}: ${error.message}`);
  }
}

/**
 * The approved WhatsApp template a campaign sends once the 24-hour window has
 * closed (0132). Read separately from the campaign row so a database that has
 * not yet run 0132 still sends -- inside the window as before, and outside it
 * the send path refuses rather than sending free text.
 */
async function campaignWhatsAppTemplate(
  campaignId: string,
): Promise<{ id: string; declared: string[]; variableMap: Record<string, string> } | null> {
  // 0132 columns, not yet in the generated types.
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("campaigns")
    .select("whatsapp_template_id, whatsapp_template_variables")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) {
    console.error("[campaign.send] WhatsApp template columns unreadable", {
      campaignId,
      message: error.message,
    });
    return null;
  }
  const row = data as {
    whatsapp_template_id: string | null;
    whatsapp_template_variables: Record<string, unknown> | null;
  } | null;
  if (!row?.whatsapp_template_id) return null;

  const template = await loadTemplate(row.whatsapp_template_id);
  if (!template) return null;

  const variableMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.whatsapp_template_variables ?? {})) {
    if (typeof value === "string") variableMap[key] = value;
  }
  return { id: template.id, declared: template.variables, variableMap };
}

/**
 * One campaign contact at a time, through the same `performSend` path as
 * `message.send` — the guard, the idempotency rule and the metering are the
 * same code, not a second copy of it.
 *
 * A contact receives the initial message, then — when the campaign has one —
 * a single follow-up after the configured delay. Between the two the contact
 * sits in `scheduled`, which is exactly the state a reply, a booking or an
 * opt-out stops, so the follow-up is never sent to someone who has since
 * replied, booked or opted out.
 */
export async function handleCampaignSend(job: ClaimedJob) {
  const payload = parsePayload(campaignSendPayload, job.payload);
  const admin = createAdminClient();

  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select(
      "id, business_id, status, channel, message_template, subject_template, ai_personalize, followup_template, followup_subject_template, followup_delay_seconds",
    )
    .eq("id", payload.campaignId)
    .maybeSingle();

  // A read error is not "gone": throwing lets the job retry instead of
  // permanently failing a campaign over a transient database fault.
  if (campaignError) {
    throw new Error(`Could not load campaign ${payload.campaignId}: ${campaignError.message}`);
  }

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
    .select("id, lead_id, state, next_send_at, sent_at, followup_sent_at")
    .eq("campaign_id", campaign.id)
    .in("state", ["pending", "scheduled"]);

  query = payload.contactIds?.length
    ? query.in("id", payload.contactIds)
    : query.lte("next_send_at", new Date().toISOString()).limit(DUE_LIMIT);

  const { data: contacts, error: contactsError } = await query;
  if (contactsError) {
    throw new Error(`Could not load contacts for campaign ${campaign.id}: ${contactsError.message}`);
  }

  const provider = getMessagingProvider();
  const channel = campaign.channel as Channel;

  // An email campaign without a subject cannot be sent, and failing here — at
  // the campaign, once — is clearer than failing per contact.
  if (channel === "email" && !campaign.subject_template?.trim()) {
    throw new PermanentJobError(
      `Campaign ${campaign.id} is an email campaign with no subject line.`,
    );
  }

  // WhatsApp reactivation reaches people outside the 24-hour window, where
  // only the campaign's approved template can be delivered.
  const whatsappTemplate =
    channel === "whatsapp"
      ? await campaignWhatsAppTemplate(campaign.id).catch((error: unknown) => {
          console.error("[campaign.send] WhatsApp template lookup failed", {
            campaignId: campaign.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
      : null;

  const followUpDelay =
    campaign.followup_template?.trim() && (campaign.followup_delay_seconds ?? 0) > 0
      ? (campaign.followup_delay_seconds as number)
      : null;

  // Contacts that must be looked at again later -- a follow-up now scheduled,
  // or a send held by quiet hours -- are woken by one job for the batch.
  const wakeups: { id: string; at: Date }[] = [];

  for (const contact of (contacts ?? []) as ContactRow[]) {
    const stage = contactStage(contact);
    if (stage === "done") {
      await updateContact(contact.id, { state: "sent" });
      continue;
    }

    if (stage === "followup") {
      // Nothing to follow up with: the initial message was the whole
      // campaign for this contact.
      if (!followUpDelay || !campaign.followup_template) {
        await updateContact(contact.id, { state: "sent" });
        continue;
      }
      // A retried batch job can re-read a contact that is waiting for its
      // follow-up; it is left for its own scheduled pass.
      if (!followUpIsDue(contact.next_send_at, new Date())) continue;
    }

    const lead = await loadLead(contact.lead_id);
    if (!lead) {
      await updateContact(
        contact.id,
        stage === "initial"
          ? { state: "failed", stopped_reason: "lead_removed" }
          : { state: "sent", stopped_reason: "followup_skipped:lead_removed" },
      );
      continue;
    }

    if (stage === "followup") {
      const skip = followUpSkipReason(lead, contact.sent_at);
      if (skip) {
        await updateContact(contact.id, {
          state: "sent",
          stopped_reason: `followup_skipped:${skip}`,
        });
        continue;
      }
    }

    const template =
      stage === "initial"
        ? campaign.message_template
        : (campaign.followup_template as string);
    const subjectTemplate =
      stage === "initial"
        ? campaign.subject_template
        : campaign.followup_subject_template || campaign.subject_template;

    const values = await mergeValues(business, lead);
    let body = renderTemplate(template, values).trim();

    if (
      aiPersonalizeApplies({
        channel,
        requested: Boolean(campaign.ai_personalize),
        aiAssistEnabled: business.aiAssistEnabled,
      })
    ) {
      const context =
        `Base message: ${body}\n` +
        `Merge context: ${Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`;

      const personalized = await runTask<{ message: string }>({
        taskType: "reactivation_copy",
        businessId: campaign.business_id,
        leadId: lead.id,
        // Reactivation copy goes to someone who has not replied to it yet, so
        // the low pre-reply ceiling applies.
        stage: "PRE_REPLY",
        context,
        maxOutputTokens: 200,
        // One personalisation per campaign message: a retried job re-running
        // this contact is charged once.
        correlationId:
          stage === "initial"
            ? `campaign:${campaign.id}:${contact.id}`
            : `campaign:${campaign.id}:${contact.id}:followup`,
      });

      const candidate = personalized.data?.message?.trim();
      // Same style lint as the agent; a failing personalisation falls back to
      // the campaign's own template rather than being retried.
      if (
        candidate &&
        candidate.length > 0 &&
        candidate.length <= MAX_MESSAGE_LENGTH &&
        (await passesStyleLint(business, candidate))
      ) {
        body = candidate;
      }
    }

    // A reactivation message is marketing: every SMS and WhatsApp carries the
    // workspace's opt-out wording (email carries its unsubscribe link).
    body = withOptOutWording(body, { channel, wording: business.optOutWording });

    const messageId = await queueOutboundMessage({
      businessId: campaign.business_id,
      leadId: lead.id,
      channel,
      body,
      subject:
        channel === "email"
          ? renderTemplate(subjectTemplate ?? "", values).trim()
          : null,
      origin: "campaign",
      campaignId: campaign.id,
      sendKey:
        stage === "initial"
          ? `campaign:${campaign.id}:${contact.id}`
          : `campaign:${campaign.id}:${contact.id}:followup`,
      enqueueSend: false,
      whatsappTemplate: whatsappTemplate
        ? {
            templateId: whatsappTemplate.id,
            variables: campaignTemplateVariables(
              whatsappTemplate.declared,
              whatsappTemplate.variableMap,
              values,
            ),
          }
        : null,
    });

    if (!messageId) {
      await updateContact(
        contact.id,
        stage === "initial"
          ? { state: "failed", stopped_reason: "no_conversation" }
          : { state: "sent", stopped_reason: "followup_failed:no_conversation" },
      );
      continue;
    }

    const outcome = await performSend({
      store: createSendStore(),
      provider,
      messageId,
      finalAttempt: job.attempts >= job.max_attempts,
    });

    const now = new Date();
    const update = settleCampaignContact({
      stage,
      outcome: outcome as CampaignSendOutcome,
      now,
      finalAttempt: job.attempts >= job.max_attempts,
      followUpAt:
        stage === "initial" && followUpDelay
          ? followUpDueAt(now, followUpDelay, business.quietHours)
          : null,
    });

    // A transient failure leaves the contact due for the next pass.
    if (!update) continue;
    await updateContact(contact.id, update);

    if (update.state === "scheduled" && update.next_send_at) {
      wakeups.push({ id: contact.id, at: new Date(update.next_send_at) });
    }
  }

  if (wakeups.length > 0) {
    const at = new Date(Math.max(...wakeups.map((wake) => wake.at.getTime())));
    await enqueue(
      "campaign.send",
      {
        campaignId: campaign.id,
        contactIds: wakeups.map((wake) => wake.id).slice(0, 200),
      },
      {
        businessId: campaign.business_id,
        runAt: at,
        idempotencyKey: `campaign.send:${campaign.id}:wake:${wakeups[0].id}:${at.toISOString()}`,
      },
    );
  }

  await finishIfDrained(campaign.id, campaign.business_id);
}
