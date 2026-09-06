import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeUrl } from "@/lib/email/smtp";
import { enqueue } from "@/lib/jobs/queue";
import { recordUsage } from "@/lib/audit";
import type { StopReason } from "@/lib/automation/scheduler";
import type { Channel, SendResult } from "@/lib/messaging/types";
import type {
  OutboundMessageRecord,
  SendFailure,
  SendGuardSnapshot,
  SendOrigin,
  SendStore,
} from "@/lib/jobs/send-core";
import {
  channelState,
  leadContact,
  leadState,
  loadBusinessContext,
  loadLead,
  queueNotification,
  stopAutomationRuns,
} from "./shared";

const MESSAGE_COLUMNS =
  "id, business_id, conversation_id, lead_id, channel, body, subject, status, send_key, origin, campaign_id, automation_run_id";

type MessageRow = {
  id: string;
  business_id: string;
  conversation_id: string;
  lead_id: string;
  channel: string;
  body: string;
  subject: string | null;
  status: string;
  send_key: string | null;
  origin: string;
  campaign_id: string | null;
  automation_run_id: string | null;
};

async function messageEvent(
  businessId: string,
  messageId: string,
  eventType: string,
  payload: Record<string, unknown>,
  providerStatus?: string | null,
  errorCode?: string | null,
) {
  const admin = createAdminClient();
  await admin.from("message_events").insert({
    business_id: businessId,
    message_id: messageId,
    event_type: eventType,
    provider_status: providerStatus ?? null,
    error_code: errorCode ?? null,
    payload: payload as never,
  });
}

/**
 * The Supabase-backed implementation of the shared outbound path. Every read
 * here is a fresh read: a job payload is never treated as current truth.
 */
export function createSendStore(): SendStore & {
  conversationId(messageId: string): string | undefined;
} {
  const conversations = new Map<string, string>();

  return {
    conversationId(messageId: string) {
      return conversations.get(messageId);
    },

    async load(messageId: string): Promise<OutboundMessageRecord | null> {
      const admin = createAdminClient();
      const { data } = await admin
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("id", messageId)
        .eq("direction", "outbound")
        .maybeSingle();

      const row = data as MessageRow | null;
      if (!row) return null;

      const channel = row.channel as Channel;
      const lead = await loadLead(row.lead_id);
      const to = lead ? leadContact(lead, channel) : null;
      if (!to) return null;

      conversations.set(row.id, row.conversation_id);

      return {
        id: row.id,
        businessId: row.business_id,
        leadId: row.lead_id,
        channel,
        body: row.body,
        status: row.status,
        sendKey: row.send_key ?? row.id,
        to,
        origin: row.origin as SendOrigin,
        subject: row.subject,
        // Only marketing mail carries an unsubscribe link. A one-to-one reply
        // from the inbox is not a mailing list and must not offer to
        // unsubscribe the recipient from one.
        unsubscribeUrl:
          channel === "email" && row.origin === "campaign" && lead
            ? unsubscribeUrl(lead.unsubscribe_token)
            : null,
      };
    },

    async snapshot(
      message: OutboundMessageRecord,
    ): Promise<SendGuardSnapshot | null> {
      const [business, lead] = await Promise.all([
        loadBusinessContext(message.businessId),
        loadLead(message.leadId),
      ]);
      if (!business || !lead) return null;

      return {
        lead: leadState(lead),
        channel: await channelState(
          message.businessId,
          message.channel,
          message.to,
          business.subscriptionActive && business.status !== "suspended",
        ),
        quietHours: business.quietHours,
        origin: message.origin,
      };
    },

    async markSent(message, result: Extract<SendResult, { ok: true }>) {
      const admin = createAdminClient();
      const now = new Date().toISOString();

      await admin
        .from("messages")
        .update({
          status: "SENT",
          provider: result.provider,
          provider_message_id: result.providerMessageId,
          sent_at: now,
          error_code: null,
          error_message: null,
        })
        .eq("id", message.id)
        .eq("status", "QUEUED");

      await messageEvent(
        message.businessId,
        message.id,
        "sent",
        { provider: result.provider, provider_message_id: result.providerMessageId },
        "sent",
      );

      const conversationId = conversations.get(message.id);
      if (conversationId) {
        await admin
          .from("conversations")
          .update({ last_outbound_at: now, last_message_at: now })
          .eq("id", conversationId);
      }

      const lead = await loadLead(message.leadId);
      if (lead) {
        await admin
          .from("leads")
          .update({
            last_contact_at: now,
            first_contacted_at: lead.first_contacted_at ?? now,
            status: lead.status === "NEW" ? "CONTACTED" : lead.status,
          })
          .eq("id", lead.id)
          .eq("business_id", lead.business_id);
      }
    },

    async markFailed(message, result: SendFailure, terminal: boolean) {
      const admin = createAdminClient();

      // A retryable failure leaves the row QUEUED so the retry is still
      // eligible; only a terminal failure closes it out.
      if (terminal) {
        await admin
          .from("messages")
          .update({
            status: "FAILED",
            error_code: result.errorCode,
            error_message: result.errorMessage.slice(0, 500),
            failed_at: new Date().toISOString(),
          })
          .eq("id", message.id)
          .eq("status", "QUEUED");
      }

      await messageEvent(
        message.businessId,
        message.id,
        "failed",
        { permanent: result.permanent, error: result.errorMessage },
        "failed",
        result.errorCode,
      );

      if (terminal) {
        await queueNotification({
          businessId: message.businessId,
          type: "message_failed",
          severity: "error",
          title: "A message could not be delivered",
          body: result.errorMessage.slice(0, 240),
          entityType: "message",
          entityId: message.id,
          linkUrl: `/app/leads/${message.leadId}`,
          dedupeKey: `message_failed:${message.id}`,
        });
      }
    },

    async abort(message, reason: StopReason) {
      const admin = createAdminClient();
      await admin
        .from("messages")
        .update({
          status: "FAILED",
          error_code: `stopped:${reason}`,
          error_message: `Not sent: ${reason.replace(/_/g, " ")}.`,
          failed_at: new Date().toISOString(),
        })
        .eq("id", message.id)
        .eq("status", "QUEUED");

      await messageEvent(message.businessId, message.id, "stopped", { reason });

      if (message.origin === "automation") {
        await stopAutomationRuns(message.businessId, message.leadId, reason);
      }
    },

    async reschedule(message, at: Date) {
      const admin = createAdminClient();
      await admin
        .from("messages")
        .update({ scheduled_for: at.toISOString() })
        .eq("id", message.id)
        .eq("status", "QUEUED");

      await messageEvent(message.businessId, message.id, "rescheduled", {
        reason: "quiet_hours",
        run_at: at.toISOString(),
      });

      // A distinct key: the job currently running still holds the plain one.
      await enqueue(
        "message.send",
        {
          messageId: message.id,
          leadId: message.leadId,
          sendKey: message.sendKey,
        },
        {
          businessId: message.businessId,
          runAt: at,
          idempotencyKey: `message.send:${message.sendKey}:${at.toISOString()}`,
        },
      );
    },

    async meter(message) {
      await recordUsage({
        businessId: message.businessId,
        metric: message.origin === "campaign" ? "campaign_message" : "message_sent",
        source: `message:${message.id}`,
        metadata: { channel: message.channel, origin: message.origin },
      });
    },
  };
}
