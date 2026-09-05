import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import {
  ProviderNotConfiguredError,
  channelForAddress,
  stripChannelPrefix,
  type Channel,
  type InboundMessage,
  type MessageStatusEvent,
  type MessagingProvider,
  type SendRequest,
  type SendResult,
} from "./types";

const API_ROOT = "https://api.twilio.com/2010-04-01";

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  smsFrom?: string;
  messagingServiceSid?: string;
  whatsappFrom?: string;
};

/** Returns the missing variable names, or an empty array when usable. */
export function twilioConfigProblems(): string[] {
  const { accountSid, authToken, smsFrom, messagingServiceSid } =
    serverEnv.twilio;
  const missing: string[] = [];
  if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!smsFrom && !messagingServiceSid) {
    missing.push("TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID");
  }
  return missing;
}

export function isTwilioConfigured(): boolean {
  return twilioConfigProblems().length === 0;
}

export function twilioCredentials(): TwilioCredentials | null {
  if (!isTwilioConfigured()) return null;
  const env = serverEnv.twilio;
  return {
    accountSid: env.accountSid!,
    authToken: env.authToken!,
    smsFrom: env.smsFrom,
    messagingServiceSid: env.messagingServiceSid,
    whatsappFrom: env.whatsappFrom,
  };
}

function addressFor(channel: Channel, value: string): string {
  return channel === "whatsapp" ? `whatsapp:${stripChannelPrefix(value)}` : value;
}

/**
 * Twilio's Messages API has no idempotency key, so duplicate suppression is the
 * caller's job: the worker only dispatches a message row still in QUEUED and
 * flips it before returning.
 */
const PERMANENT_CODES = new Set([
  21211, 21214, 21217, 21219, 21610, 21612, 21614, 21408, 21606, 63003,
]);

function toSendResult(status: number, body: unknown): SendResult {
  const payload = body as {
    sid?: string;
    status?: string;
    code?: number;
    message?: string;
  } | null;

  if (status >= 200 && status < 300 && payload?.sid) {
    return { ok: true, providerMessageId: payload.sid, provider: "twilio" };
  }

  const code = payload?.code ?? 0;
  return {
    ok: false,
    errorCode: String(code || status),
    errorMessage: payload?.message ?? `Twilio responded with ${status}.`,
    // 4xx other than rate limiting is the caller's fault and will not improve.
    permanent:
      PERMANENT_CODES.has(code) ||
      (status >= 400 && status < 500 && status !== 429),
  };
}

/**
 * Canonical Twilio signature: HMAC-SHA1 over the full request URL with every
 * POST parameter appended in sorted key order, base64 encoded.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function formToRecord(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const record: Record<string, string> = {};
  for (const [key, value] of params) record[key] = value;
  return record;
}

const STATUS_MAP: Record<string, MessageStatusEvent["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "DELIVERED",
  failed: "FAILED",
  undelivered: "FAILED",
};

class TwilioProvider implements MessagingProvider {
  readonly name = "twilio";

  async send(request: SendRequest): Promise<SendResult> {
    const credentials = twilioCredentials();
    if (!credentials) {
      const error = new ProviderNotConfiguredError(
        "Twilio",
        twilioConfigProblems(),
      );
      return {
        ok: false,
        errorCode: error.code,
        errorMessage: error.message,
        permanent: true,
      };
    }

    const from =
      request.channel === "whatsapp"
        ? credentials.whatsappFrom
        : credentials.smsFrom;

    if (!from && !credentials.messagingServiceSid) {
      return {
        ok: false,
        errorCode: "provider_not_configured",
        errorMessage: `No Twilio sender is configured for ${request.channel}.`,
        permanent: true,
      };
    }

    const form = new URLSearchParams({
      To: addressFor(request.channel, request.to),
      Body: request.body,
    });
    if (from) form.set("From", addressFor(request.channel, from));
    else form.set("MessagingServiceSid", credentials.messagingServiceSid!);

    let response: Response;
    try {
      response = await fetch(
        `${API_ROOT}/Accounts/${credentials.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${credentials.accountSid}:${credentials.authToken}`,
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "I-Twilio-Idempotency-Token": request.sendKey,
          },
          body: form.toString(),
        },
      );
    } catch (error) {
      return {
        ok: false,
        errorCode: "network_error",
        errorMessage: error instanceof Error ? error.message : String(error),
        permanent: false,
      };
    }

    const body = await response.json().catch(() => null);
    return toSendResult(response.status, body);
  }

  async verifyWebhook(request: Request, rawBody: string): Promise<boolean> {
    const token = serverEnv.twilio.authToken;
    // No token means no verification is possible, which must reject rather
    // than wave the request through.
    if (!token) return false;

    const url = serverEnv.twilio.webhookUrl ?? request.url;
    return verifyTwilioSignature(
      token,
      url,
      formToRecord(rawBody),
      request.headers.get("x-twilio-signature"),
    );
  }

  async parseInbound(rawBody: string): Promise<InboundMessage[]> {
    const form = formToRecord(rawBody);
    const sid = form.MessageSid ?? form.SmsMessageSid ?? form.SmsSid;
    if (!sid || form.From === undefined) return [];

    return [
      {
        provider: "twilio",
        providerMessageId: sid,
        from: stripChannelPrefix(form.From),
        to: stripChannelPrefix(form.To ?? ""),
        body: form.Body ?? "",
        channel: channelForAddress(form.From),
        receivedAt: new Date().toISOString(),
      },
    ];
  }

  async parseStatus(rawBody: string): Promise<MessageStatusEvent[]> {
    const form = formToRecord(rawBody);
    const sid = form.MessageSid ?? form.SmsSid;
    const status = STATUS_MAP[(form.MessageStatus ?? "").toLowerCase()];
    if (!sid || !status) return [];

    return [
      {
        provider: "twilio",
        providerMessageId: sid,
        status,
        errorCode: form.ErrorCode || undefined,
        occurredAt: new Date().toISOString(),
      },
    ];
  }
}

export function createTwilioProvider(): MessagingProvider {
  return new TwilioProvider();
}
