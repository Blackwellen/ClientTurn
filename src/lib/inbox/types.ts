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
export type ChannelIngestion = "live" | "not-built" | "impossible";

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
    ingestion: "not-built",
    requires: null,
    emptyExplanation:
      "Messenger conversations are not synced into ClientTurn yet. Facebook's messaging API supports it and the work is not built, so connecting a Page will not bring these conversations here. Reply in Meta Business Suite for now.",
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    canRead: true,
    canSend: true,
    ingestion: "not-built",
    requires: null,
    emptyExplanation:
      "Instagram conversations are not synced into ClientTurn yet. The work is not built, so connecting an account will not bring these conversations here. Reply in Meta Business Suite for now.",
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    // The one channel we genuinely cannot read. LinkedIn has no API that gives
    // an application access to a member's inbox; the messaging APIs are limited
    // to approved partner programmes. Saying so here is what stops the UI from
    // promising something it cannot deliver.
    canRead: false,
    canSend: false,
    ingestion: "impossible",
    requires: null,
    emptyExplanation:
      "LinkedIn does not offer an API that lets an application read a member's inbox, so messages cannot be synced here. A LinkedIn Ads connection brings in lead form submissions, but not conversations.",
  },
};

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
};

export type ThreadMessage = {
  id: string;
  direction: string;
  body: string;
  status: string;
  createdAt: string;
};

/** Channels ClientTurn can currently send on from inside the inbox. */
export function canReplyOn(channel: string, hasLead: boolean): boolean {
  return hasLead && (channel === "sms" || channel === "whatsapp");
}
