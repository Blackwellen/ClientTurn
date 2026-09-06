import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { enqueue } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInboundEmail } from "@/lib/email/inbound";
import {
  loadEmailCredentials,
  recordEmailHealth,
  saveInboundCursor,
} from "@/lib/email/store";
import { normaliseEmail } from "@/lib/email/account";
import { parsePayload } from "./parse";
import { emailPollPayload } from "./payloads";

/**
 * Reads replies from each workspace's own mailbox and hands them to the same
 * inbound pipeline an SMS reply goes through, so a reply by email stops the
 * follow-up, records the conversation and can qualify a lead exactly as a
 * text does.
 *
 * A customer mailbox cannot call us, so this polls. It is deliberately
 * conservative: a bounded batch per run, a stored cursor so nothing is read
 * twice, and machine mail routed to suppression rather than to qualification.
 */

const BOUNCE_HINTS = [
  "user unknown",
  "no such user",
  "mailbox unavailable",
  "address rejected",
  "does not exist",
  "recipient not found",
  "550 5.1.1",
];

/** Fans the poll out to every workspace with a mailbox that reads replies. */
export async function scheduleEmailPolls() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("business_id, config, status")
    .eq("provider_type", "imap_smtp")
    .in("status", ["HEALTHY", "DEGRADED"]);

  for (const row of data ?? []) {
    const config = row.config as { inbound?: { protocol?: string } } | null;
    if (!config?.inbound?.protocol || config.inbound.protocol === "none") {
      continue;
    }
    await enqueue(
      "email.poll",
      { businessId: row.business_id },
      {
        businessId: row.business_id,
        // One poll per workspace in flight at a time: two concurrent readers
        // would race on the cursor and double-import replies.
        idempotencyKey: `email.poll:${row.business_id}`,
      },
    );
  }
}

function looksLikeBounce(subject: string | null, body: string): boolean {
  const haystack = `${subject ?? ""} ${body}`.toLowerCase();
  if (
    haystack.includes("delivery status notification") ||
    haystack.includes("undeliverable") ||
    haystack.includes("mail delivery failed") ||
    haystack.includes("returned mail")
  ) {
    return true;
  }
  return BOUNCE_HINTS.some((hint) => haystack.includes(hint));
}

/** Pulls the failed recipient out of a bounce so the right address is suppressed. */
function bouncedAddress(body: string): string | null {
  const match =
    body.match(/(?:failed recipient|original-recipient|final-recipient)[^\n]*?([\w.+-]+@[\w.-]+)/i) ??
    body.match(/<([\w.+-]+@[\w.-]+)>/);
  return match ? normaliseEmail(match[1]) : null;
}

export async function handleEmailPoll(job: ClaimedJob) {
  const payload = parsePayload(emailPollPayload, job.payload);
  const businessId = payload.businessId;

  const credentials = await loadEmailCredentials(businessId);
  if (!credentials || credentials.config.inbound.protocol === "none") return;

  const result = await fetchInboundEmail(credentials);

  if (!result.ok) {
    await recordEmailHealth(businessId, {
      ok: false,
      code: result.code,
      message: result.message,
      permanent: result.permanent,
    });
    // A permanent failure needs the customer to fix their settings; retrying
    // a wrong password only risks locking their mailbox.
    if (result.permanent) return;
    throw new Error(`Email poll failed: ${result.message}`);
  }

  const admin = createAdminClient();

  for (const message of result.messages) {
    const from = message.from;
    if (!from) continue;

    // Bounces and complaints are suppression events, never replies: treating
    // a mailer-daemon as a lead reply would stop the follow-up for the wrong
    // reason and pollute the conversation.
    if (message.autoSubmitted || looksLikeBounce(message.subject, message.text)) {
      const failed = bouncedAddress(message.text) ?? from;
      if (looksLikeBounce(message.subject, message.text)) {
        await admin.from("contact_suppressions").upsert(
          {
            business_id: businessId,
            normalized_contact: failed,
            channel: "email",
            reason: "bounce",
            source: `email_poll:${message.uid}`,
          },
          { onConflict: "business_id,normalized_contact,channel" },
        );
      }
      continue;
    }

    const { data: lead } = await admin
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .ilike("email", from)
      .limit(1)
      .maybeSingle();

    // Mail from someone who is not a lead is somebody else's conversation.
    if (!lead) continue;

    // Same shape as every other ingress in this codebase: land the event in
    // `webhook_events` first, then queue the work. The unique index on
    // (provider, external_event_id) is what makes a re-read of the same mail
    // a no-op rather than a duplicate reply.
    const externalEventId = message.messageId ?? `${businessId}:${message.uid}`;

    const { data: event } = await admin
      .from("webhook_events")
      .upsert(
        {
          provider: "smtp",
          external_event_id: externalEventId,
          business_id: businessId,
          event_type: "inbound_email",
          payload: {
            kind: "inbound_email",
            message: {
              provider: "smtp",
              providerMessageId: externalEventId,
              from,
              to: credentials.config.fromEmail,
              body: message.text,
              channel: "email",
              receivedAt: message.receivedAt,
            },
          } as never,
        },
        { onConflict: "provider,external_event_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    // No row back means this mail was already ingested on an earlier poll.
    if (!event) continue;

    await enqueue(
      "message.process_inbound",
      { webhookEventId: event.id, provider: "smtp" },
      {
        businessId,
        idempotencyKey: `email.inbound:${event.id}`,
      },
    );
  }

  await saveInboundCursor(businessId, result.cursor);
  await recordEmailHealth(businessId, { ok: true });
}
