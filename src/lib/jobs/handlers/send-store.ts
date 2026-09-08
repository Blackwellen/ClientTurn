import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeUrl } from "@/lib/email/smtp";
import { enqueue } from "@/lib/jobs/queue";
import { recordUsage } from "@/lib/audit";
import { nextPermittedSendTime, type StopReason } from "@/lib/automation/scheduler";
import { evaluate } from "@/lib/policy/service";
import type { CampaignType, PolicyChannel, PolicyReasonCode } from "@/lib/policy/types";
import { isPlatformChannel } from "@/lib/messaging/types";
import type { Channel, SendResult } from "@/lib/messaging/types";
import type {
  OutboundMessageRecord,
  PolicyGate,
  SendFailure,
  SendGuardSnapshot,
  SendOrigin,
  SendStore,
} from "@/lib/jobs/send-core";
import {
  channelState,
  flagForAttention,
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
 * The messaging channel names are lower-case; the policy engine's vocabulary is
 * upper-case and groups every social platform under one `SOCIAL` rule.
 *
 * Declared as an exhaustive `Record<Channel, ...>` on purpose: adding a channel
 * to `Channel` without deciding how policy treats it should fail the build, not
 * produce an `undefined` that the engine would silently refuse with a
 * misleading reason.
 */
const POLICY_CHANNEL: Record<Channel, PolicyChannel> = {
  sms: "SMS",
  whatsapp: "WHATSAPP",
  email: "EMAIL",
  // The packs draw the line at "a social platform", not at which one: the
  // consent position for a LinkedIn message is the same as for an Instagram
  // one, and splitting them would invite a pack that permits one by oversight.
  messenger: "SOCIAL",
  instagram: "SOCIAL",
  linkedin: "SOCIAL",
  tiktok: "SOCIAL",
};

/**
 * Policy refusals a person in the workspace can actually do something about —
 * by recording the relationship, capturing consent, or classifying the
 * recipient. Everything absent from this set (opt-out, suppression, an inactive
 * subscription, a dead address) is settled, and raising it for review would
 * only invite someone to work around it.
 */
const RESOLVABLE_BY_A_HUMAN = new Set<PolicyReasonCode>([
  "BLOCKED_NO_PERMISSION",
  "BLOCKED_SUBSCRIBER_TYPE",
  "REVIEW_REQUIRED",
]);

/**
 * What kind of contact each origin represents, in the policy engine's terms.
 *
 * Every one of these reads the pack's *warm* rule set — only COLD is treated
 * differently, and nothing on this path is cold: a lead exists because someone
 * came to the business. The distinction is still drawn truthfully because it is
 * written to the contactability record, and "we sent this as reactivation" is
 * the kind of claim that has to survive being checked.
 */
const CAMPAIGN_TYPE: Record<SendOrigin, CampaignType> = {
  automation: "WARM",
  agent: "WARM",
  manual: "WARM",
  campaign: "REACTIVATION",
  system: "TRANSACTIONAL",
};

/**
 * The Supabase-backed implementation of the shared outbound path. Every read
 * here is a fresh read: a job payload is never treated as current truth.
 */
/**
 * The platform address a social thread replies to.
 *
 * Read fresh from the conversation rather than carried on the message row: a
 * thread's address is set once when the conversation is created and a message
 * queued days earlier must not carry a stale copy of it.
 */
async function socialThreadAddress(
  businessId: string,
  conversationId: string | null,
): Promise<string | null> {
  if (!conversationId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("conversations")
    .select("external_thread_id")
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .maybeSingle();

  return data?.external_thread_id ?? null;
}

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

      // Where this message actually goes. On Messenger and Instagram the
      // address is the thread's, not the lead's: `leadContact` returns null for
      // those channels by design, because a lead row has nowhere to hold a
      // page-scoped id and falling back to the phone number would send an SMS
      // to somebody who only ever wrote on Instagram.
      const to = isPlatformChannel(channel)
        ? await socialThreadAddress(row.business_id, row.conversation_id)
        : lead
          ? leadContact(lead, channel)
          : null;

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
        // Automated mail carries an unsubscribe link; a one-to-one reply typed
        // by a person does not, because it is not a mailing list.
        //
        // `automation` is included deliberately: V4 section 19.1 makes email a
        // warm follow-up channel, and an automated sequence is marketing even
        // though a human did not press send. Both the UK and US policy packs
        // set requireUnsubscribe for warm email, so omitting the link here
        // would put every follow-up email in breach.
        unsubscribeUrl:
          channel === "email" &&
          (row.origin === "campaign" || row.origin === "automation") &&
          lead
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

    async policy(
      message: OutboundMessageRecord,
      guard: SendGuardSnapshot,
      at: Date,
    ): Promise<PolicyGate> {
      const [business, lead] = await Promise.all([
        loadBusinessContext(message.businessId),
        loadLead(message.leadId),
      ]);

      // Neither can be missing by the time we are here — `snapshot()` already
      // loaded both — but proceeding on a null would mean sending with no
      // recipient facts at all, which is exactly the case to refuse.
      if (!business || !lead) {
        return {
          action: "block",
          reasonCode: "BLOCKED_INVALID_CONTACT",
          message: "The lead this message belongs to could no longer be read.",
        };
      }

      const decision = await evaluate({
        businessId: message.businessId,
        subject: {
          type: "LEAD",
          id: lead.id,
          email: lead.email,
          phone: lead.phone_normalized ?? lead.phone,
          // A social thread's address is the platform-scoped id this message is
          // going to, which is not held on the lead row. Without it the engine
          // would see no destination and refuse every social send as an invalid
          // contact.
          social: isPlatformChannel(message.channel) ? message.to : null,
          optedOut: lead.opted_out,
          // Leads carry no country of their own; the recorded permission does,
          // and `evaluate` falls back to it. Absent both, the country-neutral
          // pack applies, which is the restrictive one.
          timezone: business.timezone,
        },
        channel: POLICY_CHANNEL[message.channel],
        campaignType: CAMPAIGN_TYPE[message.origin],
        // The guard already resolved provider health for this channel; asking
        // the database a second time would be a different answer at a different
        // instant, which is worse than reusing the one we acted on.
        sender: { available: guard.channel.integrationHealthy, health: "HEALTHY" },
        record: true,
        at,
      });

      if (decision.reasonCode === "BLOCKED_QUIET_HOURS" && decision.quietHours) {
        return {
          action: "defer",
          reasonCode: decision.reasonCode,
          at: nextPermittedSendTime(at, {
            enabled: true,
            start: decision.quietHours.start,
            end: decision.quietHours.end,
            timezone: business.timezone,
          }),
        };
      }

      // REQUIRE_TEMPLATE is an allow with an obligation attached, not a refusal:
      // it is how the pack says "WhatsApp, but only from an approved template".
      const permitted =
        decision.outcome === "ALLOWED" || decision.outcome === "REQUIRE_TEMPLATE";

      if (!permitted) {
        return {
          action: "block",
          reasonCode: decision.reasonCode,
          message: decision.message,
        };
      }

      // The pack can require an unsubscribe link. Automated and campaign email
      // already carry one (see `load`), so this cannot refuse traffic that was
      // previously fine — it is the assertion that the two stay in step if
      // either side changes.
      const needsUnsubscribe = decision.requirements?.includes("UNSUBSCRIBE_LINK");
      const isBulkEmail =
        message.channel === "email" &&
        (message.origin === "automation" || message.origin === "campaign");

      if (needsUnsubscribe && isBulkEmail && !message.unsubscribeUrl) {
        return {
          action: "block",
          reasonCode: "REVIEW_REQUIRED",
          message:
            "This email requires an unsubscribe link under the applicable policy and none was attached.",
        };
      }

      return { action: "allow" };
    },

    async blockedByPolicy(message, gate) {
      const admin = createAdminClient();

      await admin
        .from("messages")
        .update({
          // BLOCKED, not FAILED. We did not try and fail; we decided not to
          // try. FAILED means the provider would not deliver it and somebody
          // should look at the connection -- and every rate and usage
          // denominator in the product counts FAILED as an attempt, so a
          // workspace with a clean suppression list would watch its delivery
          // rate fall for doing the right thing.
          status: "BLOCKED",
          error_code: `policy:${gate.reasonCode}`,
          error_message: gate.message.slice(0, 500),
          failed_at: new Date().toISOString(),
        })
        .eq("id", message.id)
        .eq("status", "QUEUED");

      await messageEvent(message.businessId, message.id, "blocked", {
        reason_code: gate.reasonCode,
        detail: gate.message,
      });

      // A sequence policy has refused must not keep trying the next step.
      if (message.origin === "automation") {
        await stopAutomationRuns(message.businessId, message.leadId, "suppressed");
      }

      // Two different failures, deliberately handled differently. A contact who
      // opted out is finished, and putting them in a human's queue invites
      // someone to message them anyway. A contact we simply lack permission for
      // is a decision waiting to be made, and that does belong to a person.
      if (RESOLVABLE_BY_A_HUMAN.has(gate.reasonCode)) {
        await flagForAttention({
          businessId: message.businessId,
          leadId: message.leadId,
          reason: `policy:${gate.reasonCode}`,
          title: "A follow-up needs permission before it can be sent",
          body: gate.message,
          takeover: true,
        });
      }
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
