/**
 * Contact-channel preference (elite-closer brief, 2026-09-27). Pure.
 *
 * Where it helps, the assistant may ask once, lightly, whether this is the
 * best way to reach the lead. Three hard rules:
 *   * never the first question (not before the lead has replied twice);
 *   * never twice (`leads.preferred_contact_channel_asked_at`, 0147);
 *   * never on a turn that already has a question, an objection or a close,
 *     so it never breaks "one question per turn" or gets in the way of a sale.
 *
 * The answer is parsed deterministically and stored as
 * `leads.preferred_contact_channel`. The follow-up channel strategy
 * (follow-up/channel-strategy.ts `preferredStepChannel`) respects it; the
 * send guard still decides, per send, whether that channel may be used at
 * all (consent, suppression, quiet hours), and a mobile is only ever one the
 * lead gave themselves (CLAUDE.md resolved conflict 6).
 */

export const CONTACT_CHANNELS = ["sms", "whatsapp", "email", "phone"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function parseStoredChannelPreference(value: unknown): ContactChannel | null {
  return (CONTACT_CHANNELS as readonly string[]).includes(value as string) ? (value as ContactChannel) : null;
}

/** Modes in which the question may be asked (agent/types AgentMode values). */
const ASKABLE_MODES = new Set(["QUALIFICATION", "GENERAL_ENQUIRY", "POST_BOOKING", "FOLLOW_UP"]);

/** Replies from the lead before the question may appear (never the first question). */
export const MIN_INBOUND_BEFORE_ASKING = 2;

export function shouldAskChannelPreference(input: {
  mode: string;
  /** Messages the lead has sent in this conversation, including this one. */
  inboundCount: number;
  alreadyAsked: boolean;
  preference: ContactChannel | null;
  /** The turn already asks something (a planned question, a close, an objection). */
  turnHasQuestion: boolean;
  channel: string;
}): boolean {
  if (input.alreadyAsked || input.preference) return false;
  if (input.turnHasQuestion) return false;
  if (input.inboundCount < MIN_INBOUND_BEFORE_ASKING) return false;
  if (!ASKABLE_MODES.has(input.mode)) return false;
  // Only where a different channel is a real option.
  return ["sms", "whatsapp", "email"].includes(input.channel);
}

export const CHANNEL_PREFERENCE_LINE =
  "If it fits naturally, ask lightly whether this is the best way to reach them (the one question this turn). Ask it once only.";

const CHANNEL_WORDS: { channel: ContactChannel; pattern: RegExp }[] = [
  { channel: "email", pattern: /\b(e-?mail|inbox)\b/i },
  { channel: "whatsapp", pattern: /\bwhats\s?app\b/i },
  { channel: "phone", pattern: /\b(call|ring|phone me|by phone|on the phone)\b/i },
  { channel: "sms", pattern: /\b(text|texts|sms|message me here)\b/i },
];

/**
 * The lead's answer to "is this the best way to reach you?". "Yes, this is
 * fine" is the current channel; a named channel wins; anything else is null
 * (nothing is recorded, and the question is not asked again).
 */
export function parseChannelPreference(text: string | null | undefined, currentChannel: string): ContactChannel | null {
  const value = (text ?? "").normalize("NFKC").replace(/[’]/g, "'").toLowerCase();
  if (!value.trim()) return null;
  // "email rather than text", "not text, email please": a channel right after
  // a negation or comparison is the one they do not want.
  const named = CHANNEL_WORDS.map((entry) => ({ entry, at: value.search(entry.pattern) }))
    .filter((hit) => hit.at >= 0)
    .filter((hit) => !/\b(not|no|than|instead of|rather than|don'?t)\s+(by\s+|a\s+|on\s+)?$/.test(value.slice(Math.max(0, hit.at - 20), hit.at)))
    .sort((a, b) => a.at - b.at);
  if (named.length > 0) return named[0].entry.channel;
  if (/^(yes|yeah|yep|yup|sure|ok|okay|fine|perfect|that'?s fine|this is fine|here is fine|this works|here'?s (fine|good|best))\b/.test(value.trim())) {
    return parseStoredChannelPreference(currentChannel);
  }
  return null;
}
