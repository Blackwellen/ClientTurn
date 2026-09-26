/**
 * Email controls (brief §43, design 05 §3.5). Pure.
 *
 *   * Message class: TRANSACTIONAL or MARKETING, derived from where a message
 *     came from. Only MARKETING carries the unsubscribe link and the RFC 8058
 *     List-Unsubscribe header, and only MARKETING is counted against a
 *     sender's daily cap. Suppression binds both classes: a transactional
 *     booking confirmation is still not sent to an address on the list.
 *   * Complaint rate: complaints / sent per sender over seven days. Gmail's
 *     guidance (01 §6): stay under 0.1%, never reach 0.3%. At 0.1% the sender
 *     is WATCH and the workspace is warned; at 0.3% it is PAUSED, which the
 *     policy engine and the send-slot claim both refuse.
 *   * Caps: the configured cap (with its warm-up ramp) is ceilinged by the
 *     connected mailbox provider's safe daily limit (MAILBOX_SEND_LIMITS).
 */

import { limitsForHost } from "./account.ts";

/* ----------------------------------------------------------- message class */

export const EMAIL_MESSAGE_CLASSES = ["TRANSACTIONAL", "MARKETING"] as const;
export type EmailMessageClass = (typeof EMAIL_MESSAGE_CLASSES)[number];

/** The send-core origins, restated so this module stays dependency-free. */
export type MessageOrigin =
  | "automation"
  | "manual"
  | "campaign"
  | "system"
  | "agent"
  | "agent_handover";

/**
 * MARKETING: reactivation campaigns and automated follow-up sequences -- the
 * sends a person did not type and that promote the business.
 *
 * TRANSACTIONAL: booking confirmations and reminders (a booking reminder step
 * is an automation, but it is about an appointment the lead made), system
 * notices, and one-to-one conversation (a person's reply, the agent's reply,
 * the handover acknowledgement), which is not a mailing.
 */
export function emailMessageClass(input: {
  origin: MessageOrigin;
  bookingReminder?: boolean;
}): EmailMessageClass {
  if (input.origin === "campaign") return "MARKETING";
  if (input.origin === "automation") return input.bookingReminder ? "TRANSACTIONAL" : "MARKETING";
  return "TRANSACTIONAL";
}

/** Only marketing carries the unsubscribe link and List-Unsubscribe headers. */
export function requiresUnsubscribe(messageClass: EmailMessageClass): boolean {
  return messageClass === "MARKETING";
}

/* ---------------------------------------------------------- complaint rate */

export const COMPLAINT_WINDOW_DAYS = 7;
/** Gmail best practice: below 0.1%. At or above it the sender is watched. */
export const COMPLAINT_WATCH_RATE = 0.001;
/** Gmail's hard line: 0.3%. At or above it sending from the sender stops. */
export const COMPLAINT_PAUSE_RATE = 0.003;
/**
 * A single complaint never hard-pauses a sender on its own: on a small volume
 * one report is already above 0.3%, and pausing a mailbox on one person's click
 * would punish every other recipient. It still raises WATCH and a warning.
 */
export const MIN_COMPLAINTS_TO_PAUSE = 2;

export type SenderHealthState = "HEALTHY" | "WATCH" | "PAUSED";

export type ComplaintVerdict = {
  state: SenderHealthState;
  /** complaints / sent; 0 when nothing was sent. */
  rate: number;
  reason: string | null;
};

export function complaintVerdict(input: { sent: number; complaints: number }): ComplaintVerdict {
  const sent = Math.max(0, input.sent);
  const complaints = Math.max(0, input.complaints);
  if (complaints === 0) return { state: "HEALTHY", rate: 0, reason: null };
  // Complaints with nothing sent in the window (the send aged out first) are
  // still complaints: measured against one send, so they cannot read as 0%.
  const rate = complaints / Math.max(sent, 1);
  const percent = `${(rate * 100).toFixed(2)}%`;
  if (rate >= COMPLAINT_PAUSE_RATE && complaints >= MIN_COMPLAINTS_TO_PAUSE) {
    return {
      state: "PAUSED",
      rate,
      reason: `Spam complaints reached ${percent} over ${COMPLAINT_WINDOW_DAYS} days (limit 0.3%). Sending is paused until the rate falls.`,
    };
  }
  if (rate >= COMPLAINT_WATCH_RATE) {
    return {
      state: "WATCH",
      rate,
      reason: `Spam complaints are ${percent} over ${COMPLAINT_WINDOW_DAYS} days (keep below 0.1%).`,
    };
  }
  return { state: "HEALTHY", rate, reason: null };
}

/** An outbound email in the window, with who it went to. */
export type SentEmail = { senderId: string; recipient: string; sentAt: string; complained: boolean };
/** A COMPLAINT suppression row in the window. */
export type ComplaintRow = { email: string; createdAt: string };

/**
 * Per sender: how many emails it sent in the window, and how many complaints
 * are attributable to it. A complaint (an ARF report recorded as a COMPLAINT
 * suppression, or a message flagged `complained_at`) is attributed to the
 * sender that most recently emailed that address before the complaint arrived,
 * and is counted once per address.
 */
export function complaintsBySender(
  sent: SentEmail[],
  complaints: ComplaintRow[],
): Map<string, { sent: number; complaints: number }> {
  const out = new Map<string, { sent: number; complaints: number }>();
  const bump = (senderId: string, key: "sent" | "complaints") => {
    const entry = out.get(senderId) ?? { sent: 0, complaints: 0 };
    entry[key] += 1;
    out.set(senderId, entry);
  };

  const byRecipient = new Map<string, SentEmail[]>();
  for (const message of sent) {
    bump(message.senderId, "sent");
    const key = message.recipient.trim().toLowerCase();
    if (!key) continue;
    const list = byRecipient.get(key) ?? [];
    list.push(message);
    byRecipient.set(key, list);
  }

  const counted = new Set<string>();
  const attribute = (recipient: string, at: number) => {
    const key = recipient.trim().toLowerCase();
    if (!key || counted.has(key)) return;
    const candidates = (byRecipient.get(key) ?? [])
      .filter((message) => Date.parse(message.sentAt) <= at)
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
    const last = candidates[0];
    if (!last) return;
    counted.add(key);
    bump(last.senderId, "complaints");
  };

  for (const complaint of complaints) attribute(complaint.email, Date.parse(complaint.createdAt));
  for (const message of sent) if (message.complained) attribute(message.recipient, Number.POSITIVE_INFINITY);

  return out;
}

/* -------------------------------------------------------------- caps */

/** The connected mailbox provider's safe daily limit, used as a ceiling on every sender. */
export function mailboxDailyCeiling(smtpHost: string | null | undefined): number | null {
  if (!smtpHost?.trim()) return null;
  return limitsForHost(smtpHost.trim()).perDay;
}

/** What the UI shows as "today's cap": the lower of the ramped allowance and the ceiling. */
export function effectiveDailyCap(allowance: number, ceiling: number | null): number {
  return ceiling && ceiling > 0 ? Math.min(allowance, ceiling) : allowance;
}

/**
 * A marketing email refused only by the day's cap is deferred, not dropped:
 * five minutes past the next UTC midnight, when the counter rolls over. Quiet
 * hours are re-checked when it runs.
 */
export function nextCapWindow(at: Date): Date {
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1, 0, 5));
  return next;
}
