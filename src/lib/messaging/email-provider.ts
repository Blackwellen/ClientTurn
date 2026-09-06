import "server-only";
import { sendEmail } from "@/lib/email/smtp";
import { recordEmailHealth } from "@/lib/email/store";
import type {
  InboundMessage,
  MessageStatusEvent,
  MessagingProvider,
  SendRequest,
  SendResult,
} from "./types";

/**
 * The email channel behind the same `MessagingProvider` interface the SMS and
 * WhatsApp channels use, so `performSend` — with its guard, its idempotency
 * rule and its metering — is shared rather than duplicated for email.
 *
 * Inbound and delivery status are not webhook-driven here: a customer's own
 * mailbox has no webhook to register, so replies arrive through the
 * `email.poll` job instead. The webhook methods therefore accept nothing.
 */
export function createEmailProvider(): MessagingProvider {
  return {
    name: "smtp",

    async send(request: SendRequest): Promise<SendResult> {
      if (!request.subject || request.subject.trim().length === 0) {
        return {
          ok: false,
          errorCode: "missing_subject",
          errorMessage: "An email cannot be sent without a subject line.",
          permanent: true,
        };
      }

      const result = await sendEmail({
        businessId: request.businessId,
        to: request.to,
        subject: request.subject,
        // The stored body is the restricted markup the composer produced.
        // `sendEmail` sanitises it again and derives the plain-text part.
        html: request.body,
        unsubscribeUrl: request.unsubscribeUrl,
        sendKey: request.sendKey,
      });

      // The connection's health is a property of the mailbox, not of one
      // message, so every send updates it: a customer sees "action required"
      // in Settings the moment their password stops working.
      await recordEmailHealth(
        request.businessId,
        result.ok
          ? { ok: true }
          : {
              ok: false,
              code: result.errorCode,
              message: result.errorMessage,
              permanent: result.permanent,
            },
      );

      return result;
    },

    // There is no webhook for a customer mailbox. Refusing here means a
    // misrouted request can never be treated as authentic.
    async verifyWebhook(): Promise<boolean> {
      return false;
    },

    async parseInbound(): Promise<InboundMessage[]> {
      return [];
    },

    async parseStatus(): Promise<MessageStatusEvent[]> {
      return [];
    },
  };
}
