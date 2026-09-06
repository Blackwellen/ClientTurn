/**
 * Messaging shapes and pure helpers. Deliberately free of `server-only` so the
 * unit tests and any shared code can use them without pulling the service-role
 * client (or a React Server Component marker) into scope.
 */

export type Channel = "sms" | "whatsapp" | "email";

export type SendRequest = {
  businessId: string;
  to: string;
  body: string;
  /** Idempotency key so a retried send cannot duplicate a message. */
  sendKey: string;
  channel: Channel;
  /** Email only. SMS and WhatsApp have no subject line. */
  subject?: string | null;
  /** Email only. Marketing mail must carry a working unsubscribe. */
  unsubscribeUrl?: string | null;
};

export type SendResult =
  | { ok: true; providerMessageId: string; provider: string }
  | { ok: false; errorCode: string; errorMessage: string; permanent: boolean };

export type InboundMessage = {
  provider: string;
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
  channel: Channel;
  receivedAt: string;
};

export type MessageStatusEvent = {
  provider: string;
  providerMessageId: string;
  status: "SENT" | "DELIVERED" | "FAILED";
  errorCode?: string;
  occurredAt: string;
};

export interface MessagingProvider {
  readonly name: string;
  send(request: SendRequest): Promise<SendResult>;
  verifyWebhook(request: Request, rawBody: string): Promise<boolean>;
  parseInbound(rawBody: string): Promise<InboundMessage[]>;
  parseStatus(rawBody: string): Promise<MessageStatusEvent[]>;
}

/** Raised when a provider is selected but its credentials are absent. */
export class ProviderNotConfiguredError extends Error {
  readonly code = "provider_not_configured";
  readonly provider: string;
  readonly missing: string[];

  constructor(provider: string, missing: string[]) {
    super(
      `${provider} is not configured. Missing: ${missing.join(", ") || "credentials"}.`,
    );
    this.name = "ProviderNotConfiguredError";
    this.provider = provider;
    this.missing = missing;
  }
}

/** UK-biased E.164 normalisation. Used for dedupe, suppression and routing. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("07") && digits.length === 11) {
    return `+44${digits.slice(1)}`;
  }
  if (digits.startsWith("44")) return `+${digits}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  return `+${digits}`;
}

/** Strips the transport prefix Twilio puts on WhatsApp addresses. */
export function stripChannelPrefix(address: string): string {
  return address.replace(/^whatsapp:/i, "").trim();
}

export function channelForAddress(address: string): Channel {
  return /^whatsapp:/i.test(address) ? "whatsapp" : "sms";
}

const STOP_KEYWORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt out",
  "opt-out",
  "remove",
]);

/** Deterministic match only — opt-out must never depend on interpretation. */
export function isOptOutKeyword(body: string): boolean {
  const cleaned = body
    .trim()
    .toLowerCase()
    .replace(/^["'“”‘’]+|["'“”‘’.!?]+$/g, "")
    .replace(/\s+/g, " ");
  return STOP_KEYWORDS.has(cleaned);
}

const START_KEYWORDS = new Set(["start", "unstop", "yes join", "resubscribe"]);

export function isOptInKeyword(body: string): boolean {
  return START_KEYWORDS.has(body.trim().toLowerCase().replace(/[.!?]$/, ""));
}
