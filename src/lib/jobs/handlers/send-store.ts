import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { unsubscribeUrl } from "@/lib/email/smtp";
import { enqueue } from "@/lib/jobs/queue";
import { recordUsage } from "@/lib/audit";
import {
  isBookingReminderSendKey,
  nextPermittedSendTime,
  type StopReason,
} from "@/lib/automation/scheduler";
import { evaluate } from "@/lib/policy/service";
import type { CampaignType, PolicyChannel, PolicyReasonCode } from "@/lib/policy/types";
import { isPlatformChannel, withinWhatsAppServiceWindow } from "@/lib/messaging/types";
import { countSmsSegments } from "@/lib/messaging/sms-segments";
import { metaWindowDecision } from "@/lib/messaging/meta-window";
import { chooseTemplateForSend } from "@/lib/messaging/whatsapp-templates";
import { loadTemplate, whatsAppTransportFor } from "@/lib/messaging/template-registry";
import {
  emailMessageClass,
  nextCapWindow,
  requiresUnsubscribe,
  type EmailMessageClass,
} from "@/lib/email/sender-health";
import { claimSenderSlot, sendingIdentityFor, type SendingIdentity } from "@/lib/email/sender-slots";
import type { Channel, SendResult } from "@/lib/messaging/types";
import type {
  OutboundMessageRecord,
  PolicyGate,
  SendFailure,
  SendGuardSnapshot,
  SendOrigin,
  SendStore,
} from "@/lib/jobs/send-core";
import { guardOptedOut, SENDING_STATUS } from "@/lib/jobs/send-core";
import { billingSendGate, meterSendBilling } from "@/lib/billing/limits-service";
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

const BASE_MESSAGE_COLUMNS =
  "id, business_id, conversation_id, lead_id, channel, body, subject, status, send_key, origin, campaign_id, automation_run_id, sender_identity_id";
const MESSAGE_COLUMNS = `${BASE_MESSAGE_COLUMNS}, message_class, whatsapp_template_id, template_variables`;

// message_class / whatsapp_template_id / template_variables (0127) post-date
// the generated types; the row is typed by hand below.
function untyped(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

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
  sender_identity_id: string | null;
  message_class: string | null;
  whatsapp_template_id: string | null;
  template_variables: Record<string, unknown> | null;
};

function stringMap(value: Record<string, unknown> | null): Record<string, string> | null {
  if (!value || typeof value !== "object") return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") out[key] = entry;
  return out;
}

async function messageEvent(
  businessId: string,
  messageId: string,
  eventType: string,
  payload: Record<string, unknown>,
  providerStatus?: string | null,
  errorCode?: string | null,
) {
  const admin = createAdminClient();
  // The event trail is observability: logged, never thrown.
  logWriteError(
    await admin.from("message_events").insert({
      business_id: businessId,
      message_id: messageId,
      event_type: eventType,
      provider_status: providerStatus ?? null,
      error_code: errorCode ?? null,
      payload: payload as never,
    }),
    "send: message event",
    { businessId, messageId, eventType },
  );
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
  // The acknowledgement that a person is taking over: a reply to the lead's own
  // message, judged exactly as any other agent reply is.
  agent_handover: "WARM",
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

/**
 * When this lead last messaged the business on WhatsApp, straight from the
 * conversation row. Read fresh at send time — same reasoning as
 * `socialThreadAddress` above: a message queued hours or days earlier must
 * not carry a stale verdict about whether the service window is still open.
 */
async function whatsAppLastInboundAt(
  businessId: string,
  conversationId: string | null,
): Promise<string | null> {
  if (!conversationId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("conversations")
    .select("last_inbound_at")
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .maybeSingle();

  return data?.last_inbound_at ?? null;
}

export function createSendStore(): SendStore & {
  conversationId(messageId: string): string | undefined;
} {
  const conversations = new Map<string, string>();
  // The sending identity resolved in `load`, for the policy gate's health check.
  const identities = new Map<string, SendingIdentity>();

  return {
    conversationId(messageId: string) {
      return conversations.get(messageId);
    },

    async load(messageId: string): Promise<OutboundMessageRecord | null> {
      const read = (columns: string) =>
        untyped()
          .from("messages")
          .select(columns)
          .eq("id", messageId)
          .eq("direction", "outbound")
          .maybeSingle();
      let { data, error } = await read(MESSAGE_COLUMNS);
      // Before migration 0127 the class/template columns do not exist: read
      // the rest, and the class is derived from the origin as it always was.
      if (error && isSchemaLag(error)) ({ data, error } = await read(BASE_MESSAGE_COLUMNS));

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

      // §43: the class decides the unsubscribe requirement. Stored at queue
      // time where the queuer knew it; derived from the origin otherwise.
      const messageClass: EmailMessageClass | null =
        channel === "email"
          ? row.message_class === "TRANSACTIONAL" || row.message_class === "MARKETING"
            ? row.message_class
            : emailMessageClass({
                origin: row.origin as SendOrigin,
                bookingReminder: isBookingReminderSendKey(row.send_key),
              })
          : null;

      // The identity controls From (§43): the one queued with the message,
      // else the workspace default. A person's typed reply keeps the mailbox's
      // own From, as before.
      const identity =
        channel === "email" && row.origin !== "manual"
          ? await sendingIdentityFor(row.business_id, row.sender_identity_id)
          : null;
      if (identity) identities.set(row.id, identity);

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
        //
        // §43: that is now the MARKETING class. A booking reminder is an
        // automation too, but it is transactional and carries neither the
        // link nor the List-Unsubscribe headers.
        unsubscribeUrl:
          channel === "email" && messageClass && requiresUnsubscribe(messageClass) && lead
            ? unsubscribeUrl(lead.unsubscribe_token)
            : null,
        messageClass,
        senderIdentity: identity
          ? {
              id: identity.id,
              displayName: identity.displayName,
              email: identity.email,
              replyTo: identity.replyTo,
            }
          : null,
        queuedTemplate:
          channel === "whatsapp" && row.whatsapp_template_id
            ? { templateId: row.whatsapp_template_id, variables: stringMap(row.template_variables) }
            : null,
      };
    },

    async claim(message: OutboundMessageRecord): Promise<boolean> {
      const admin = createAdminClient();
      // One conditional update is the whole lock: of any number of concurrent
      // callers, exactly one matches a QUEUED row. Nothing else is written, so
      // a claim that loses leaves no trace.
      const { data, error } = await admin
        .from("messages")
        .update({ status: SENDING_STATUS })
        .eq("id", message.id)
        .eq("status", "QUEUED")
        .select("id")
        .maybeSingle();

      // An error is not a claim. Throwing lets the job retry and re-read the
      // row, which is safe: nothing has reached the carrier yet.
      if (error) throw new Error(`Could not claim message ${message.id}: ${error.message}`);
      return Boolean(data);
    },

    async reconcileInFlight(message: OutboundMessageRecord) {
      const admin = createAdminClient();

      // The carrier's id is the one fact that settles it. If a previous attempt
      // got as far as recording it, the message went.
      const { data: row, error } = await admin
        .from("messages")
        .select("provider_message_id")
        .eq("id", message.id)
        .maybeSingle();
      if (error) throw new Error(`Could not read message ${message.id}: ${error.message}`);

      if (row?.provider_message_id) {
        const { error: settleError } = await admin
          .from("messages")
          .update({ status: "SENT", sent_at: new Date().toISOString() })
          .eq("id", message.id)
          .eq("status", SENDING_STATUS);
        if (settleError) throw new Error(`Could not settle message ${message.id}: ${settleError.message}`);
        await messageEvent(message.businessId, message.id, "reconciled", {
          provider_message_id: row.provider_message_id,
        });
        return;
      }

      // Unknown. The row stays SENDING -- if the attempt that claimed it is
      // merely slow, its own markSent still lands -- and a person is asked to
      // check, because resending something that may already have arrived is
      // the one outcome this state exists to prevent.
      await messageEvent(message.businessId, message.id, "unconfirmed", {
        reason: "claimed_without_outcome",
      });

      await flagForAttention({
        businessId: message.businessId,
        leadId: message.leadId,
        reason: `send_unconfirmed:${message.id}`,
        title: "A message may or may not have been delivered",
        body:
          "A send was interrupted after it was handed to the provider. Check the conversation before sending it again.",
      });
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
        // Channel suppression (below) is the opt-out check; the lead-wide flag
        // binds only where it cannot be derived (guardOptedOut).
        lead: { ...leadState(lead), optedOut: guardOptedOut(lead, message.channel) },
        channel: await channelState(
          message.businessId,
          message.channel,
          message.to,
          business.subscriptionActive && business.status !== "suspended",
        ),
        quietHours: business.quietHours,
        origin: message.origin,
        // Phase 3.1: a booking reminder step is marked by its send key.
        bookingReminder: isBookingReminderSendKey(message.sendKey),
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

      // 8.13: billing, re-checked at the moment of sending -- the dunning
      // pause (deferred, not dropped), the channel's daily cap, and for SMS /
      // WhatsApp the allowance, then top-up credit, then overage within its cap.
      const billing = await billingSendGate({
        businessId: message.businessId,
        channel: message.channel,
        body: message.body,
        origin: message.origin,
        at,
      });
      if (billing) return billing;

      // Phase 3.5: Messenger / Instagram 24-hour window, checked for manual and
      // automation sends too (the agent already checks its own). Read fresh:
      // a message queued hours ago must not carry a stale verdict.
      if (message.channel === "messenger" || message.channel === "instagram") {
        const window = metaWindowDecision({
          origin: message.origin,
          lastInboundAt: await whatsAppLastInboundAt(
            message.businessId,
            conversations.get(message.id) ?? null,
          ),
          now: at,
        });
        if (!window.allowed) {
          return { action: "block", reasonCode: "REVIEW_REQUIRED", message: window.message };
        }
      }

      const withinWhatsAppWindow =
        message.channel === "whatsapp"
          ? withinWhatsAppServiceWindow(
              await whatsAppLastInboundAt(message.businessId, conversations.get(message.id) ?? null),
              at,
            )
          : false;

      const decision = await evaluate({
        businessId: message.businessId,
        withinWhatsAppWindow,
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
          // The engine checks this channel's suppression itself; the flag is
          // passed only where it cannot be derived from the list.
          optedOut: guardOptedOut(lead, message.channel),
          // Leads carry no country of their own; the recorded permission does,
          // and `evaluate` falls back to it. Absent both, the country-neutral
          // pack applies, which is the restrictive one.
          timezone: business.timezone,
        },
        channel: POLICY_CHANNEL[message.channel],
        // A booking reminder is about an appointment the lead made: it is
        // judged as transactional, not as a follow-up (§43).
        campaignType:
          message.origin === "automation" && isBookingReminderSendKey(message.sendKey)
            ? "TRANSACTIONAL"
            : CAMPAIGN_TYPE[message.origin],
        // The guard already resolved provider health for this channel; asking
        // the database a second time would be a different answer at a different
        // instant, which is worse than reusing the one we acted on. A marketing
        // email also carries its sender identity's complaint health (§43): a
        // PAUSED sender is refused by the engine. Transactional mail to a
        // person who booked is not held back by a marketing complaint rate.
        sender: {
          available: guard.channel.integrationHealthy,
          health:
            message.channel === "email" && message.messageClass === "MARKETING"
              ? (identities.get(message.id)?.healthState ?? "HEALTHY")
              : "HEALTHY",
        },
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

      // REQUIRE_TEMPLATE is how the pack says "WhatsApp, but only from an
      // approved template" — it is not itself a refusal. It is treated as one
      // here because neither WhatsApp transport this send path can reach
      // (Twilio or Meta's Cloud API) is ever handed a template by the
      // follow-up engine: sending free text here would reach the carrier and
      // be refused by WhatsApp itself, which also counts against the number's
      // quality rating. Blocking it as a policy decision — visible, reasoned,
      // and routed to a human — is the honest outcome until template selection
      // is wired into the automation.
      //
      // §45: the step can now name an approved template. It is re-read here --
      // a template paused or rejected since the step was queued is refused --
      // and must belong to the transport this workspace sends through. Only an
      // automation or campaign send uses one; a person's typed reply and the
      // agent never go out as a template, and never as free text either.
      if (decision.outcome === "REQUIRE_TEMPLATE") {
        const queued = message.queuedTemplate ?? null;
        if (!queued || (message.origin !== "automation" && message.origin !== "campaign")) {
          return {
            action: "block",
            reasonCode: "REVIEW_REQUIRED",
            message:
              "The WhatsApp service window has closed. Send this as a reply after the lead messages again, or contact them on another channel.",
          };
        }
        const [template, transport] = await Promise.all([
          loadTemplate(queued.templateId),
          whatsAppTransportFor(message.businessId),
        ]);
        const choice = chooseTemplateForSend({
          template,
          businessId: message.businessId,
          transport,
          variables: queued.variables,
        });
        if (!choice.ok) {
          return { action: "block", reasonCode: "REVIEW_REQUIRED", message: choice.message };
        }
        return { action: "allow", template: choice.template };
      }

      if (decision.outcome !== "ALLOWED") {
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
      const isMarketingEmail = message.channel === "email" && message.messageClass === "MARKETING";

      if (needsUnsubscribe && isMarketingEmail && !message.unsubscribeUrl) {
        return {
          action: "block",
          reasonCode: "REVIEW_REQUIRED",
          message:
            "This email requires an unsubscribe link under the applicable policy and none was attached.",
        };
      }

      // §43: a marketing email takes a place in its sender's day -- the lower
      // of the ramped cap and the mailbox provider's ceiling. Refused only by
      // the cap, it waits for tomorrow rather than being dropped. Last, so a
      // message refused for any other reason never uses a slot.
      const identity = identities.get(message.id);
      if (isMarketingEmail && identity) {
        const claimed = await claimSenderSlot(message.businessId, identity.id);
        if (!claimed) {
          return { action: "defer", at: nextCapWindow(at), reasonCode: "BLOCKED_DAILY_LIMIT" };
        }
      }

      return { action: "allow" };
    },

    async blockedByPolicy(message, gate) {
      const admin = createAdminClient();

      // Throws on failure: the row would otherwise sit QUEUED with no job and
      // no reason shown. Retry-safe — the retry re-loads the row and, still
      // QUEUED, re-runs the gate, which refuses again.
      assertWrite(
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
          .eq("status", "QUEUED"),
        "send: mark blocked by policy",
        { businessId: message.businessId, messageId: message.id },
      );

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

      const { error: sentError } = await admin
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
        // SENDING is the normal case, from our own claim. QUEUED covers a
        // store used without a claim.
        .in("status", ["QUEUED", SENDING_STATUS]);

      // The carrier has accepted it. Throwing here leaves the row SENDING, so
      // the retry reconciles instead of resending.
      if (sentError) {
        throw new Error(`Message ${message.id} was sent but not recorded: ${sentError.message}`);
      }

      // What went out, for cost attribution and deliverability (§43, §45):
      // the email's class and identity, the WhatsApp template and its
      // pricing category. Bookkeeping on a recorded send: logged, not thrown.
      const sentExtras: Record<string, unknown> = {};
      if (message.channel === "email") {
        if (message.messageClass) sentExtras.message_class = message.messageClass;
        if (message.senderIdentity) sentExtras.sender_identity_id = message.senderIdentity.id;
      }
      if (message.template) {
        sentExtras.whatsapp_template_id = message.template.templateId;
        sentExtras.template_category = message.template.category;
        sentExtras.template_variables = message.template.variables;
      }
      if (Object.keys(sentExtras).length > 0) {
        logWriteError(
          await untyped().from("messages").update(sentExtras).eq("id", message.id),
          "send: record class, identity and template",
          { businessId: message.businessId, messageId: message.id },
        );
      }

      await messageEvent(
        message.businessId,
        message.id,
        "sent",
        { provider: result.provider, provider_message_id: result.providerMessageId },
        "sent",
      );

      // Display state after a recorded send: logged, not thrown.
      const conversationId = conversations.get(message.id);
      if (conversationId) {
        logWriteError(
          await admin
            .from("conversations")
            .update({ last_outbound_at: now, last_message_at: now })
            .eq("id", conversationId),
          "send: conversation timestamps",
          { businessId: message.businessId, messageId: message.id, conversationId },
        );
      }

      const lead = await loadLead(message.leadId);
      if (lead) {
        logWriteError(
          await admin
            .from("leads")
            .update({
              last_contact_at: now,
              first_contacted_at: lead.first_contacted_at ?? now,
              status: lead.status === "NEW" ? "CONTACTED" : lead.status,
            })
            .eq("id", lead.id)
            .eq("business_id", lead.business_id),
          "send: lead contacted status",
          { businessId: message.businessId, messageId: message.id, leadId: lead.id },
        );
      }
    },

    async markFailed(message, result: SendFailure, terminal: boolean) {
      const admin = createAdminClient();

      // A retryable failure puts the row back to QUEUED so the retry is still
      // eligible -- the provider told us it did not take the message, so this
      // is the one exit from SENDING that may be dispatched again. Only a
      // terminal failure closes it out.
      if (terminal) {
        const { error } = await admin
          .from("messages")
          .update({
            status: "FAILED",
            error_code: result.errorCode,
            error_message: result.errorMessage.slice(0, 500),
            failed_at: new Date().toISOString(),
          })
          .eq("id", message.id)
          .in("status", ["QUEUED", SENDING_STATUS]);
        if (error) throw new Error(`Could not record failure of ${message.id}: ${error.message}`);
      } else {
        const { error } = await admin
          .from("messages")
          .update({ status: "QUEUED" })
          .eq("id", message.id)
          .eq("status", SENDING_STATUS);
        if (error) throw new Error(`Could not release message ${message.id}: ${error.message}`);
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
      // Retry-safe for the same reason as `blockedByPolicy`: a retry finds the
      // row still QUEUED and re-evaluates the stop conditions.
      assertWrite(
        await admin
          .from("messages")
          .update({
            status: "FAILED",
            error_code: `stopped:${reason}`,
            error_message: `Not sent: ${reason.replace(/_/g, " ")}.`,
            failed_at: new Date().toISOString(),
          })
          .eq("id", message.id)
          .eq("status", "QUEUED"),
        "send: mark stopped",
        { businessId: message.businessId, messageId: message.id, reason },
      );

      await messageEvent(message.businessId, message.id, "stopped", { reason });

      if (message.origin === "automation") {
        await stopAutomationRuns(message.businessId, message.leadId, reason);
      }
    },

    async reschedule(message, at: Date) {
      const admin = createAdminClient();
      // Display only: the delayed job below is what actually defers the send,
      // and it re-checks quiet hours when it runs.
      logWriteError(
        await admin
          .from("messages")
          .update({ scheduled_for: at.toISOString() })
          .eq("id", message.id)
          .eq("status", "QUEUED"),
        "send: reschedule",
        { businessId: message.businessId, messageId: message.id },
      );

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
      // 8.13: SMS by segment / WhatsApp by message against the allowance,
      // then credit, then overage. Never throws (the message has gone).
      await meterSendBilling({
        businessId: message.businessId,
        messageId: message.id,
        channel: message.channel,
        body: message.body,
      });
      await recordUsage({
        businessId: message.businessId,
        metric: message.origin === "campaign" ? "campaign_message" : "message_sent",
        source: `message:${message.id}`,
        metadata: {
          channel: message.channel,
          origin: message.origin,
          // Phase 3.5: SMS cost is per segment (GSM-7 / UCS-2), recorded per send.
          ...(message.channel === "sms"
            ? (() => {
                const count = countSmsSegments(message.body);
                return { sms_segments: count.segments, sms_encoding: count.encoding };
              })()
            : {}),
          // §45: WhatsApp is priced per template category outside the window.
          ...(message.template
            ? {
                whatsapp_template_category: message.template.category,
                whatsapp_template_id: message.template.templateId,
              }
            : {}),
          ...(message.messageClass ? { message_class: message.messageClass } : {}),
        },
      });
    },
  };
}
