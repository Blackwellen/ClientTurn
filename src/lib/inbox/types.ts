/**
 * Unified inbox — shared vocabulary.
 *
 * Pure: no `server-only`, no Supabase, so the channel catalogue and its labels
 * can be used by client components directly.
 *
 * The catalogue is deliberately honest about what each platform permits. A
 * channel we cannot read is described as such, with the reason, rather than
 * being shown as an empty folder that looks like a bug.
 */

export const INBOX_CHANNELS = [
  "all",
  "email",
  "whatsapp",
  "sms",
  "messenger",
  "instagram",
  "linkedin",
  "tiktok",
] as const;

export type InboxChannel = (typeof INBOX_CHANNELS)[number];

/**
 * Whether ClientTurn actually ingests this channel today.
 *
 * Deliberately separate from `canRead`. `canRead` is a fact about the
 * platform's API; this is a fact about our own code, and conflating the two is
 * how Messenger and Instagram came to ship as tabs that could never contain a
 * conversation. A tab whose ingestion is `not-built` must say so rather than
 * rendering the ordinary "nothing here yet" empty state, which reads as "you
 * have no messages" when it means "we cannot fetch them".
 */
export type ChannelIngestion =
  | "live"
  | "not-built"
  /**
   * Threads exist here, but nothing syncs them.
   *
   * LinkedIn is the case this state was added for. There is no API that reads
   * a member's inbox, so the channel can never be "live" -- but conversations
   * on it are no longer empty either: the social outreach queue records every
   * message sent from the connected account and every reply entered against
   * it, and those are ordinary rows in `conversations` and `messages`.
   *
   * The distinction matters to the empty state. "We cannot fetch these" and
   * "these arrive when somebody records them" call for different sentences,
   * and showing the first when the second is true tells a customer their
   * working queue is broken.
   */
  | "recorded"
  | "impossible";

export type ChannelDefinition = {
  key: InboxChannel;
  label: string;
  /** Can the platform's API give us the messages at all? */
  canRead: boolean;
  /** Can we send from here, once connected? */
  canSend: boolean;
  /** Have we built the ingestion path? */
  ingestion: ChannelIngestion;
  /** What has to be connected first. Null when nothing does. */
  requires: string | null;
  /** Shown when the channel is selected and empty. Explains *why*. */
  emptyExplanation: string;
};

export const CHANNEL_DEFINITIONS: Record<InboxChannel, ChannelDefinition> = {
  all: {
    key: "all",
    label: "All messages",
    canRead: true,
    canSend: true,
    ingestion: "live",
    requires: null,
    emptyExplanation:
      "Connect your channels to bring their conversations together here.",
  },
  email: {
    key: "email",
    label: "Email",
    canRead: true,
    canSend: true,
    ingestion: "live",
    requires: "Connect a mailbox in Settings → Connections",
    emptyExplanation:
      "Connect your mailbox and replies to your campaigns will appear here alongside everything else.",
  },
  whatsapp: {
    key: "whatsapp",
    label: "WhatsApp",
    canRead: true,
    canSend: true,
    ingestion: "live",
    requires: "Connect WhatsApp in Settings → Connections",
    emptyExplanation:
      "WhatsApp conversations appear here once the WhatsApp Business connection is live.",
  },
  sms: {
    key: "sms",
    label: "SMS",
    canRead: true,
    canSend: true,
    ingestion: "live",
    requires: "Connect a messaging number in Settings → Connections",
    emptyExplanation: "Text conversations with your leads appear here.",
  },
  messenger: {
    key: "messenger",
    label: "Messenger",
    canRead: true,
    canSend: true,
    ingestion: "live",
    requires: "Connect your Facebook Page in Settings → Connections",
    emptyExplanation:
      "Messages people send your Facebook Page arrive here within seconds. You can reply for 24 hours after their last message — after that Facebook stops delivering, and the thread is marked so nobody writes a reply that would never arrive.",
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    canRead: true,
    canSend: true,
    ingestion: "live",
    requires:
      "Link an Instagram professional account to your Facebook Page in Settings → Connections",
    emptyExplanation:
      "Direct messages to your Instagram account arrive here within seconds. The same 24-hour reply window applies as on Messenger.",
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    // Still false, and for the same reason as before: LinkedIn has no API that
    // gives an application access to a member's inbox, and the messaging APIs
    // are limited to approved partner programmes. What changed is that the
    // channel is no longer empty -- the social outreach queue records what was
    // sent and what came back, so the thread is here even though nothing
    // synced it. `canRead` describes the platform; `ingestion` describes us.
    canRead: false,
    canSend: false,
    ingestion: "recorded",
    requires: "Connect a LinkedIn sending account in Find Leads → Social",
    emptyExplanation:
      "LinkedIn conversations appear here as they are worked from the social outreach queue — the messages sent from your connected account, and the replies recorded against them. LinkedIn offers no API that lets an application read a member's inbox, so nothing is synced automatically and replies are recorded rather than fetched.",
  },
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    // The same shape as LinkedIn, for a different reason. Meta publishes a
    // messaging API and LinkedIn restricts one to partners; TikTok simply has
    // no public API that reads direct messages at all. Business messaging
    // exists in the app, in some regions, and is not exposed for reading — so
    // "live" is not a state this channel can reach by writing more code.
    canRead: false,
    canSend: false,
    ingestion: "recorded",
    requires: "Connect a TikTok sending account in Find Leads → Social",
    emptyExplanation:
      "TikTok conversations appear here as they are worked from the social outreach queue — the messages sent from your connected account, and the replies recorded against them. TikTok offers no API that lets an application read direct messages, so nothing is synced automatically. TikTok also refuses a direct message until the person follows you back, so a conversation only starts here once that has happened.",
  },
};

/**
 * The three questions somebody opens the inbox with.
 *
 * Channel answers "where is it". These answer "does it need me". `interested`
 * is the one that was missing and is the reason the tab exists: every social
 * reply is classified on arrival, and until `conversations.interest` was added
 * that verdict never reached the inbox, so a reply saying "yes, let's talk" sat
 * in the same undifferentiated list as one saying "wrong person".
 */
export const INBOX_VIEWS = ["received", "interested", "unread", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const VIEW_LABELS: Record<InboxView, string> = {
  received: "Received",
  interested: "Interested",
  unread: "Unread",
  all: "All",
};

/** The classifications that count as somebody worth replying to. */
export const INTERESTED_CLASSIFICATIONS = ["INTERESTED", "QUESTION"] as const;

export function parseView(value: string | undefined): InboxView {
  return INBOX_VIEWS.includes(value as InboxView) ? (value as InboxView) : "received";
}

export function channelLabel(channel: string): string {
  return CHANNEL_DEFINITIONS[channel as InboxChannel]?.label ?? channel;
}

export function parseChannel(value: string | undefined): InboxChannel {
  return INBOX_CHANNELS.includes(value as InboxChannel) ? (value as InboxChannel) : "all";
}

export type ConversationRow = {
  id: string;
  channel: string;
  displayName: string;
  handle: string | null;
  leadId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  /**
   * Served through this application's own proxy, never the platform's CDN. A
   * direct `<img src>` would tell Meta, on every render, which of its users
   * this business is looking at. Null where there is no usable image, which is
   * an ordinary state -- the row falls back to initials.
   */
  avatarUrl: string | null;
  /**
   * When the person last wrote. Null on channels where it does not constrain
   * anything; on Messenger and Instagram it is what decides whether a reply can
   * still be delivered.
   */
  lastInboundAt: string | null;
};

export type ThreadMessage = {
  id: string;
  direction: string;
  body: string;
  status: string;
  createdAt: string;
};

/**
 * Channels ClientTurn can send on from inside the inbox.
 *
 * This is the *only* definition. `inbox/actions.ts` imports it rather than
 * restating a channel list, because it previously restated one and the two
 * drifted: the composer rendered on Messenger and Instagram while the server
 * accepted SMS and WhatsApp only, so a customer found out after typing.
 *
 * Email is included now that `sendManualMessage` resolves an email destination.
 * The send worker always could -- `send-store.load()` has addressed email since
 * it was written -- and the gap was only that nothing in the inbox could create
 * the outbound row.
 */
export function canReplyOn(channel: string, hasLead: boolean): boolean {
  return (
    // Still a lead. A conversation attached only to a prospect has no subject
    // the send path can resolve a policy decision for -- `send-core` loads a
    // lead and refuses without one -- so offering a composer there would
    // produce a message that could never be gated, let alone sent.
    hasLead &&
    (channel === "sms" ||
      channel === "whatsapp" ||
      channel === "email" ||
      channel === "messenger" ||
      channel === "instagram")
  );
}

/**
 * Meta's two reply windows, in hours. Restated from the messaging layer so a
 * client component can decide what to render without importing a `server-only`
 * module; `tests/meta-flows.test.ts` asserts they stay equal.
 *
 * There are two because Meta permits two different things:
 *
 *   * **24 hours** for an automated reply. This is what the agent gets.
 *   * **7 days** for a person answering by hand, using the human-agent tag.
 *     The tag exists so somebody who has to go and look something up is not
 *     locked out. Using it to deliver an automated message would misrepresent
 *     to Meta what the message is, which is why the agent never touches it.
 *
 * The composer therefore stays usable after the agent has stopped — with the
 * difference stated, so nobody assumes the assistant is still working the
 * thread.
 */
export const SOCIAL_REPLY_WINDOW_HOURS = 24;
export const SOCIAL_HUMAN_WINDOW_HOURS = 24 * 7;

export type ReplyWindow =
  | { state: "OPEN"; hoursLeft: number }
  /** Automation has stopped, but a person may still answer by hand. */
  | { state: "HUMAN_ONLY"; daysLeft: number }
  | { state: "CLOSED" }
  | { state: "NOT_APPLICABLE" };

/**
 * Whether a reply typed into this thread would actually be delivered.
 *
 * Meta permits a business to answer somebody who wrote to it, for 24 hours
 * after they last did. Nothing the business sends reopens that window -- only
 * the person can -- so the outbound timestamp is deliberately not an input.
 *
 * The composer needs this because the alternative is worse than a disabled box:
 * a customer types a careful reply, it is accepted, and it silently never
 * arrives. Showing the closed window with the reason is the honest version.
 */
export function replyWindow(
  channel: string,
  lastInboundAt: string | null,
  now: Date = new Date(),
): ReplyWindow {
  if (channel !== "messenger" && channel !== "instagram") {
    return { state: "NOT_APPLICABLE" };
  }
  if (!lastInboundAt) return { state: "CLOSED" };

  const opened = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(opened)) return { state: "CLOSED" };

  const msLeft = opened + SOCIAL_REPLY_WINDOW_HOURS * 3600_000 - now.getTime();
  if (msLeft > 0) {
    return { state: "OPEN", hoursLeft: Math.ceil(msLeft / 3600_000) };
  }

  // Past 24 hours the assistant stops, but a person has six more days. Showing
  // this as CLOSED would have customers abandon threads they could still save.
  const humanMsLeft = opened + SOCIAL_HUMAN_WINDOW_HOURS * 3600_000 - now.getTime();
  if (humanMsLeft > 0) {
    return { state: "HUMAN_ONLY", daysLeft: Math.ceil(humanMsLeft / 86_400_000) };
  }

  return { state: "CLOSED" };
}
