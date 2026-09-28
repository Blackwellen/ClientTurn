import "server-only";
import { formToRecord, verifyTwilioSignature } from "@/lib/twilio/signature";
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
import { decideSmsSender, twilioErrorSuppression } from "./sms-compliance";
import { suppress } from "@/lib/policy/suppression";
import { twilioContentVariables } from "./whatsapp-templates";
import { smsSendTarget } from "./sms-sender";
import { readSmsSenderContext } from "@/lib/voice/sender-context";

const API_ROOT = "https://api.twilio.com/2010-04-01";

export type TwilioCredentials = {
  /** `AC…` — the path segment. Never an API key. */
  accountSid: string;
  /** What authenticates: either the account auth token, or an API key secret. */
  authToken: string;
  /** `SK…` when authenticating with an API key, else the account SID again. */
  authSid: string;
  smsFrom?: string;
  messagingServiceSid?: string;
  whatsappFrom?: string;
};

/**
 * Twilio has two credential shapes and they are not interchangeable in the
 * place it matters.
 *
 *   * **Account SID + auth token.** `AC…` in the path, `AC…:token` in the
 *     header. Same value twice.
 *   * **API key.** `AC…` in the path, `SK…:secret` in the header. Different
 *     values, and the safer option — a key can be revoked without rotating the
 *     account's own token.
 *
 * The failure this guards against is silent and total: an `SK…` in the path
 * returns `20404 not found` on every request, while the credentials are
 * perfectly valid. The send fails, the error says "not found", and nothing
 * points at the configuration.
 *
 * So the account SID is resolved separately from whatever authenticates, and a
 * value that cannot be an account SID is refused rather than sent.
 */
export function resolveTwilioSids(input: {
  configuredSid: string | null | undefined;
  apiKeySid: string | null | undefined;
}): { accountSid: string | null; authSid: string | null } {
  const configured = input.configuredSid ?? null;
  const apiKeySid = input.apiKeySid ?? null;

  // An explicit API key SID means the other value must be the account.
  if (apiKeySid) {
    return {
      accountSid: configured?.startsWith("AC") ? configured : null,
      authSid: apiKeySid,
    };
  }

  // Only one value. If it is an account SID it plays both roles; if it is an
  // API key there is no account SID to build a URL from, and pretending
  // otherwise produces the 404 above.
  if (configured?.startsWith("AC")) {
    return { accountSid: configured, authSid: configured };
  }

  return { accountSid: null, authSid: configured };
}

/** The same decision, against this deployment's environment. */
function resolveSids(): { accountSid: string | null; authSid: string | null } {
  return resolveTwilioSids({
    configuredSid: serverEnv.twilio.accountSid,
    apiKeySid: serverEnv.twilio.apiKeySid,
  });
}

/** Returns the missing variable names, or an empty array when usable. */
export function twilioConfigProblems(): string[] {
  const { authToken, smsFrom, messagingServiceSid } = serverEnv.twilio;
  const { accountSid } = resolveSids();
  const missing: string[] = [];
  if (!accountSid) {
    // Named precisely rather than as a bare "missing": the commonest cause is
    // an API key SID pasted into the account SID variable, which looks set.
    missing.push("TWILIO_ACCOUNT_SID (must be the AC… account SID, not an SK… API key)");
  }
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
  const { accountSid, authSid } = resolveSids();
  if (!accountSid) return null;

  return {
    accountSid,
    authSid: authSid ?? accountSid,
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
  // 63016: outside the WhatsApp 24-hour session window, free text refused —
  // the policy gate above should stop this before it reaches Twilio, but a
  // retry cannot fix it either way, and repeating it damages the number's
  // quality rating.
  63016,
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
 * The StatusCallback for outbound messages: the configured webhook URL
 * (TWILIO_WEBHOOK_URL, also what signatures are verified against), else the
 * app URL + the webhook route. Only a public https URL is sent -- Twilio
 * cannot call back to localhost, and a plain-http callback would expose the
 * delivery payload.
 */
export function twilioStatusCallbackUrl(
  webhookUrl: string | null | undefined,
  siteUrl: string | null | undefined,
): string | null {
  const candidate =
    webhookUrl || (siteUrl ? `${siteUrl.replace(/\/+$/, "")}/api/webhooks/twilio` : null);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The request signature and form parsing live in `lib/twilio/signature.ts`,
 * shared with the voice webhooks. Re-exported so existing imports keep working.
 */
export { computeTwilioSignature, verifyTwilioSignature, formToRecord } from "@/lib/twilio/signature";

const STATUS_MAP: Record<string, MessageStatusEvent["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "DELIVERED",
  failed: "FAILED",
  undelivered: "FAILED",
};

/**
 * A synchronous refusal that is a fact about the recipient — they texted STOP
 * to the carrier (21610) or the number is invalid (21211, 21614) — is written
 * to the suppression list, so no send path queues another message to them.
 *
 * Best effort: the send has already failed permanently and the result must
 * reach the caller either way. A failed suppression write is logged; the same
 * code comes back on the status callback, which records it too.
 */
async function recordRecipientFailure(request: SendRequest, errorCode: string) {
  const hit = twilioErrorSuppression(errorCode, request.channel);
  if (!hit) return;
  try {
    await suppress({
      businessId: request.businessId,
      channel: hit.channel,
      reason: hit.reason,
      source: "PROVIDER_TWILIO",
      sourceReference: `twilio:${errorCode}`,
      phone: stripChannelPrefix(request.to),
    });
  } catch (error) {
    console.error("[twilio] could not record provider suppression", {
      errorCode,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

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

    // SMS: the workspace's own dedicated number when it has an ACTIVE one
    // (its Messaging Service, under its subaccount), else the platform
    // sender exactly as before (messaging/sms-sender.ts).
    let accountSid = credentials.accountSid;
    let from: string | undefined;
    let messagingServiceSid = credentials.messagingServiceSid;
    if (request.channel === "whatsapp") {
      from = credentials.whatsappFrom;
    } else {
      const { number, subaccountSid } = await readSmsSenderContext(request.businessId);
      const target = smsSendTarget({
        number,
        subaccountSid,
        platform: { from: credentials.smsFrom ?? null, messagingServiceSid: credentials.messagingServiceSid ?? null },
        platformAccountSid: credentials.accountSid,
      });
      if (target.kind === "DEDICATED") {
        accountSid = target.accountSid ?? credentials.accountSid;
        from = undefined;
        messagingServiceSid = target.messagingServiceSid ?? undefined;
      } else {
        from = credentials.smsFrom;
      }
    }

    if (!from && !messagingServiceSid) {
      return {
        ok: false,
        errorCode: "provider_not_configured",
        errorMessage: `No Twilio sender is configured for ${request.channel}.`,
        permanent: true,
      };
    }

    // A one-way alphanumeric sender cannot receive STOP, so a message from one
    // must carry another opt-out route or not go at all.
    let body = request.body;
    if (request.channel === "sms" && from) {
      const decision = decideSmsSender({
        from,
        body,
        optOutUrl: request.unsubscribeUrl,
      });
      if (decision.action === "block") {
        return {
          ok: false,
          errorCode: decision.errorCode,
          errorMessage: decision.errorMessage,
          permanent: true,
        };
      }
      body = decision.body;
    }

    // Outside the WhatsApp window the gate hands over an approved template
    // (brief §45): sent by ContentSid with its variables, never as free text.
    const template = request.channel === "whatsapp" ? (request.template ?? null) : null;
    if (template && template.provider !== "twilio") {
      return {
        ok: false,
        errorCode: "template_wrong_transport",
        errorMessage: "A WhatsApp Business Account template cannot be sent through Twilio.",
        permanent: true,
      };
    }

    const form = new URLSearchParams({ To: addressFor(request.channel, request.to) });
    if (template) {
      form.set("ContentSid", template.externalId);
      form.set("ContentVariables", twilioContentVariables(template));
    } else {
      form.set("Body", body);
    }
    if (from) form.set("From", addressFor(request.channel, from));
    else form.set("MessagingServiceSid", messagingServiceSid!);

    // Phase 3.5: delivery status on every send, to the existing webhook route
    // (which already records message.status). The same URL signature
    // verification uses, so the callbacks verify.
    const statusCallback = twilioStatusCallbackUrl(serverEnv.twilio.webhookUrl, serverEnv.siteUrl);
    if (statusCallback) form.set("StatusCallback", statusCallback);

    let response: Response;
    try {
      response = await fetch(
        `${API_ROOT}/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              // The auth SID, which is the API key when one is configured.
              // The path above always uses the account SID.
              `${credentials.authSid}:${credentials.authToken}`,
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

    const payload = await response.json().catch(() => null);
    const result = toSendResult(response.status, payload);
    if (!result.ok) await recordRecipientFailure(request, result.errorCode);
    return result;
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

/**
 * Every Content template on the platform's Twilio account with its WhatsApp
 * approval, for the registry sync (brief §45):
 * `GET https://content.twilio.com/v1/ContentAndApprovals`, paged by
 * `meta.next_page_url`. Null when Twilio is not configured; throws when Twilio
 * refuses, so a sync never mistakes an outage for "no templates".
 */
export async function fetchTwilioContentTemplates(): Promise<Record<string, unknown>[] | null> {
  const credentials = twilioCredentials();
  if (!credentials) return null;

  const authorization = `Basic ${Buffer.from(`${credentials.authSid}:${credentials.authToken}`).toString("base64")}`;
  const out: Record<string, unknown>[] = [];
  let url: string | null = "https://content.twilio.com/v1/ContentAndApprovals?PageSize=100";

  for (let page = 0; url && page < 20; page += 1) {
    const response: Response = await fetch(url, { headers: { Authorization: authorization } });
    if (!response.ok) {
      throw new Error(`Twilio Content templates could not be read (status ${response.status}).`);
    }
    const payload = (await response.json().catch(() => ({}))) as {
      contents?: Record<string, unknown>[];
      meta?: { next_page_url?: string | null };
    };
    out.push(...(payload.contents ?? []));
    const next = payload.meta?.next_page_url ?? null;
    // Only ever follow Twilio's own host.
    url = next && next.startsWith("https://content.twilio.com/") ? next : null;
  }
  return out;
}
