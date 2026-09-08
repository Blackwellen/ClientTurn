/**
 * Messaging shapes and pure helpers. Deliberately free of `server-only` so the
 * unit tests and any shared code can use them without pulling the service-role
 * client (or a React Server Component marker) into scope.
 */

export type Channel =
  | "sms"
  | "whatsapp"
  | "email"
  | "messenger"
  | "instagram"
  | "linkedin"
  | "tiktok";

/**
 * The channels that reach a person through Meta's Messaging APIs.
 *
 * They are grouped because everything that makes them different from SMS and
 * email is shared between them: the address is a platform-scoped id rather
 * than a phone number or mailbox, the send goes out through the workspace's
 * own Page token rather than a global carrier credential, and — the rule that
 * governs the whole design — a business may only message somebody who messaged
 * it first, inside a bounded window.
 *
 * **LinkedIn is deliberately not in this set**, despite also being a social
 * platform with a platform-scoped address. It is not a Meta channel: it routes
 * to a different provider, and its gate is a different gate — acceptance of a
 * connection request, which never expires, rather than a 24-hour window that
 * only the recipient can reopen. Adding it here to save a word would route
 * every LinkedIn send through Meta's Page token and apply a messaging window
 * that does not exist on that platform. Use `isPlatformChannel` for the
 * broader "addressed by platform id, not by phone or mailbox" question.
 */
export const META_CHANNELS = ["messenger", "instagram"] as const;
export type MetaChannel = (typeof META_CHANNELS)[number];

export function isMetaChannel(channel: Channel): channel is MetaChannel {
  return channel === "messenger" || channel === "instagram";
}

/**
 * Every channel whose address is a platform-scoped id rather than a phone
 * number or a mailbox.
 *
 * What these share is narrower than what the Meta channels share: the address
 * shape, the fact that suppression must be scoped per platform, and the fact
 * that a gate of *some* kind stands before the first message. What that gate
 * is differs, so nothing here may assume the Meta window.
 */
export const PLATFORM_CHANNELS = [
  "messenger",
  "instagram",
  "linkedin",
  "tiktok",
] as const;
export type PlatformChannel = (typeof PLATFORM_CHANNELS)[number];

export function isPlatformChannel(channel: Channel): channel is PlatformChannel {
  return (PLATFORM_CHANNELS as readonly string[]).includes(channel);
}

/**
 * The channels a message can be *scheduled* on.
 *
 * The complement of `PLATFORM_CHANNELS`, and the distinction is a real one
 * rather than a tidy-up. An automation queues a send for three days' time; that
 * is only meaningful where the right to send still exists when the time comes.
 * On Messenger and Instagram it will not — the window closes 24 hours after the
 * person last wrote. On LinkedIn and TikTok the send depends on an acceptance
 * that may never come.
 *
 * So follow-up sequences, reactivation campaigns and quiet-hours deferral all
 * operate on these three and only these three. A platform conversation is
 * driven by `social_connection_states` and answered live by the agent, which is
 * a different mechanism for a different reason, not an omission.
 */
export const BROADCAST_CHANNELS = ["sms", "whatsapp", "email"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export function isBroadcastChannel(channel: Channel): channel is BroadcastChannel {
  return channel === "sms" || channel === "whatsapp" || channel === "email";
}

/**
 * Meta's standard messaging window, in hours.
 *
 * Outside it a Page may not send a promotional or conversational message at
 * all — only a small set of tagged transactional messages, none of which this
 * product sends. It is enforced as a hard gate rather than a warning because
 * a send outside the window does not merely fail: repeated attempts are what
 * gets a Page's messaging permission withdrawn.
 */
export const META_MESSAGING_WINDOW_HOURS = 24;

/**
 * Whether an automated reply is still permitted on a social thread.
 *
 * `lastInboundAt` is when *they* last wrote. Nothing the business sends
 * reopens the window — only the person can — which is why the outbound
 * timestamp is deliberately not a parameter here.
 */
export function withinMetaMessagingWindow(
  lastInboundAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const opened = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(opened)) return false;
  return now.getTime() - opened < META_MESSAGING_WINDOW_HOURS * 3600_000;
}

/**
 * Meta's private-reply window, in days.
 *
 * This is the answer to "how do we ever start a conversation, if we cannot DM a
 * stranger". A business **may** message somebody who has never DM'd it, on one
 * condition: they commented on, mentioned, or replied to a story on the
 * business's own content. One message, once, per comment.
 *
 * It is the entry point the whole social flow depends on, and it is bounded in
 * three ways that the code has to respect exactly:
 *
 *   * **One message per comment, ever.** Not one per person and not one per
 *     day. A second attempt against the same comment id is refused by Meta,
 *     and repeated attempts are what gets a Page's messaging permission
 *     reviewed.
 *   * **Seven days from the comment, not from when we noticed it.** Meta clocks
 *     it against the comment's own creation timestamp, so a backlogged worker
 *     can miss the window on a comment posted minutes ago in real time. This is
 *     why the ingest records `occurredAt` from the platform rather than `now()`.
 *   * **It does not open the 24-hour window.** Only the person replying does
 *     that. Until they answer, the business has had its one turn.
 */
export const META_PRIVATE_REPLY_WINDOW_DAYS = 7;

/**
 * Whether a comment can still be privately replied to.
 *
 * `commentedAt` is the platform's timestamp for the comment, never our own
 * receipt time — see above. A missing or unparseable timestamp is treated as
 * outside the window: attempting a send Meta will refuse is worse than skipping
 * one it might have allowed.
 */
export function withinPrivateReplyWindow(
  commentedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!commentedAt) return false;
  const posted = new Date(commentedAt).getTime();
  if (!Number.isFinite(posted)) return false;
  return now.getTime() - posted < META_PRIVATE_REPLY_WINDOW_DAYS * 86_400_000;
}

/**
 * How long a **person** may keep answering, using the human-agent tag.
 *
 * Meta permits a business to respond manually for seven days, well beyond the
 * 24 hours automation gets. The distinction is the point of the tag: it exists
 * so a human who needs time to look something up is not locked out, and using
 * it to deliver an automated reply would misrepresent to Meta what the message
 * is. So the inbox composer uses this bound and the agent never does.
 */
export const META_HUMAN_AGENT_WINDOW_HOURS = 24 * 7;

/**
 * Whether a person typing in the inbox would still be delivered.
 *
 * Deliberately a different function from `withinMetaMessagingWindow` rather
 * than a parameter on it. Two callers, two bounds, two different legal bases —
 * a shared helper with a boolean flag is exactly how the automated path ends up
 * borrowing the human one.
 */
export function withinHumanAgentWindow(
  lastInboundAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const opened = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(opened)) return false;
  return now.getTime() - opened < META_HUMAN_AGENT_WINDOW_HOURS * 3600_000;
}

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
  if (/^whatsapp:/i.test(address)) return "whatsapp";
  if (/^meta_psid:/i.test(address)) return "messenger";
  if (/^meta_igsid:/i.test(address)) return "instagram";
  if (/^li_urn:/i.test(address)) return "linkedin";
  return "sms";
}

/**
 * The address form for a person reachable only through a platform.
 *
 * Prefixed rather than stored bare so that a page-scoped id can never be
 * mistaken for a phone number by `normalisePhone`, and so suppression keyed on
 * the address is scoped to the platform it belongs to — being blocked on
 * Instagram is not a reason to stop emailing somebody, and vice versa.
 */
export function socialAddress(channel: PlatformChannel, platformId: string): string {
  const prefix =
    channel === "instagram"
      ? "meta_igsid"
      : channel === "linkedin"
        ? "li_urn"
        : "meta_psid";
  return `${prefix}:${platformId.trim()}`;
}

/** The bare platform id from a prefixed social address. */
export function platformIdFrom(address: string): string | null {
  const match = /^(?:meta_(?:psid|igsid)|li_urn):(.+)$/i.exec(address.trim());
  return match ? match[1] : null;
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
