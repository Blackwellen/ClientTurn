import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { enqueue } from "@/lib/jobs/queue";
import { formToRecord, verifyTwilioSignature } from "@/lib/messaging/twilio";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { suppress } from "@/lib/policy/suppression";
import { twilioErrorSuppression } from "@/lib/messaging/sms-compliance";
import { stripChannelPrefix } from "@/lib/messaging/types";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const twimlHeaders = { "Content-Type": "text/xml; charset=utf-8" };

const inboundSchema = z.object({
  MessageSid: z.string().min(10).max(80).optional(),
  SmsMessageSid: z.string().min(10).max(80).optional(),
  SmsSid: z.string().min(10).max(80).optional(),
  AccountSid: z.string().max(80).optional(),
  From: z.string().min(1).max(60).optional(),
  To: z.string().max(60).optional(),
  Body: z.string().max(4000).optional(),
  MessageStatus: z.string().max(40).optional(),
  SmsStatus: z.string().max(40).optional(),
  ErrorCode: z.string().max(20).optional(),
});

/**
 * Twilio signs the exact URL it posted to. Behind a proxy `request.url` is the
 * internal one, so the configured public URL wins when it is set.
 */
function signedUrl(request: Request): string {
  if (serverEnv.twilio.webhookUrl) return serverEnv.twilio.webhookUrl;

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}${url.search}`;
}

const DELIVERY_STATUS: Record<string, "SENT" | "DELIVERED" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "DELIVERED",
  failed: "FAILED",
  undelivered: "FAILED",
};

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const authToken = serverEnv.twilio.authToken;

  // No token means verification is impossible, which must reject rather than
  // silently accept unauthenticated traffic.
  if (!authToken) {
    return new Response(EMPTY_TWIML, { status: 503, headers: twimlHeaders });
  }

  const rawBody = await request.text();
  const form = formToRecord(rawBody);

  if (
    !verifyTwilioSignature(
      authToken,
      signedUrl(request),
      form,
      request.headers.get("x-twilio-signature"),
    )
  ) {
    return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
  }

  const parsed = inboundSchema.safeParse(form);
  if (!parsed.success) {
    return new Response(EMPTY_TWIML, { status: 400, headers: twimlHeaders });
  }

  const payload = parsed.data;
  const sid = payload.MessageSid ?? payload.SmsMessageSid ?? payload.SmsSid;
  if (!sid) {
    return new Response(EMPTY_TWIML, { status: 400, headers: twimlHeaders });
  }

  const statusValue = (payload.MessageStatus ?? payload.SmsStatus ?? "").toLowerCase();
  const isStatusCallback = Boolean(DELIVERY_STATUS[statusValue]);
  const eventId = isStatusCallback ? `${sid}:${statusValue}` : sid;

  const supabase = createAdminClient();

  const { error: inboxError } = await supabase.from("webhook_events").insert({
    provider: "twilio",
    external_event_id: eventId,
    event_type: isStatusCallback ? "message.status" : "message.inbound",
    status: "received",
    payload: { kind: isStatusCallback ? "status" : "inbound", form } as never,
  });

  // A Twilio retry of an event already recorded is acknowledged, not repeated.
  if (inboxError?.code === "23505") {
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
  if (inboxError) {
    return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
  }

  if (isStatusCallback) {
    // A delivery receipt is local writes only, not provider I/O. A failure is
    // recorded on the inbox row rather than thrown: a 5xx would make Twilio
    // retry into the unique index above and the event would be acknowledged
    // unprocessed, losing an opt-out it may carry.
    let failure: string | null = null;
    try {
      await applyDeliveryStatus(
        sid,
        DELIVERY_STATUS[statusValue],
        payload.ErrorCode,
        payload.To,
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    logWriteError(
      await supabase
        .from("webhook_events")
        .update(
          failure
            ? { status: "failed", last_error: failure.slice(0, 500) }
            : { status: "processed", processed_at: new Date().toISOString() },
        )
        .eq("provider", "twilio")
        .eq("external_event_id", eventId),
      "twilio webhook: record delivery status outcome",
      { eventId, failure },
    );

    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }

  await enqueue(
    "message.process_inbound",
    { provider: "twilio", externalEventId: eventId },
    { priority: 10, idempotencyKey: `message.process_inbound:twilio:${eventId}` },
  );

  return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
}

async function applyDeliveryStatus(
  providerMessageId: string,
  status: "SENT" | "DELIVERED" | "FAILED",
  errorCode?: string,
  recipient?: string,
) {
  const supabase = createAdminClient();

  const { data: message, error: lookupError } = await supabase
    .from("messages")
    .select("id, business_id, status, channel")
    .eq("provider", "twilio")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!message) return;

  const now = new Date().toISOString();
  const patch: {
    status: string;
    delivered_at?: string;
    failed_at?: string;
    error_code?: string | null;
  } = { status };
  if (status === "DELIVERED") patch.delivered_at = now;
  if (status === "FAILED") {
    patch.failed_at = now;
    patch.error_code = errorCode ?? null;
  }

  // DELIVERED must never be walked back to SENT by a late-arriving receipt.
  // Read, but only acted on after the suppression below: a failed status
  // write must not stop a carrier-reported opt-out from being recorded.
  const statusUpdate =
    message.status === "DELIVERED" && status === "SENT"
      ? null
      : await supabase.from("messages").update(patch).eq("id", message.id);

  const context = {
    businessId: message.business_id,
    messageId: message.id,
    providerMessageId,
    status,
  };

  logWriteError(
    await supabase.from("message_events").insert({
      business_id: message.business_id,
      message_id: message.id,
      event_type: "delivery_status",
      provider_status: status,
      error_code: errorCode ?? null,
      payload: { provider_message_id: providerMessageId } as never,
    }),
    "twilio webhook: delivery status event",
    context,
  );

  // A failure that is a fact about the recipient — they sent STOP to the
  // carrier (21610), or the number cannot receive messages (21211, 21614) — is
  // a suppression, on the one list every send path reads. Otherwise every
  // later send to them fails the same way, and an opt-out goes unrecorded.
  const hit = status === "FAILED" ? twilioErrorSuppression(errorCode, message.channel) : null;
  if (hit && recipient) {
    await suppress({
      businessId: message.business_id,
      channel: hit.channel,
      reason: hit.reason,
      source: "PROVIDER_TWILIO",
      sourceReference: `twilio:${errorCode}:${providerMessageId}`,
      phone: stripChannelPrefix(recipient),
    });
  }

  // Thrown into the caller's catch, which records the inbox row as failed.
  if (statusUpdate) assertWrite(statusUpdate, "twilio webhook: message delivery status", context);
}
