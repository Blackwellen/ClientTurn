/**
 * Abandoned checkout and the post-payment thank-you (the direct-sale loop,
 * steps 3 and 4).
 *
 * Pure: zod and relative imports only. The schedule, the stop rule, the
 * channel choice and the wording the model is steered with are all decided
 * here and asserted by tests/direct-sale.test.ts; the job
 * (jobs/handlers/checkout-nudge.ts) only reads state and acts on the answer.
 *
 * ## The rules
 *
 *   * A checkout attempt that is not PAID after `delay_hours` (default 24) is
 *     ABANDONED and the assistant follows up: at most `max_nudges` (default 2),
 *     the next `gap_hours` (default 48) after the previous one, so 24h and 72h.
 *   * Every nudge is re-decided immediately before it is queued, and the send
 *     guard decides again immediately before it goes. Payment (the lead is WON
 *     the moment a token-matched payment lands), a payment waiting for a
 *     person to confirm it, an opt-out, suppression, a human takeover or a
 *     closed lead stop it.
 *   * Channel: a lead who has engaged stays on the channel the link went out
 *     on; one who has not goes by email where possible (free) and SMS only if
 *     it is affordable under the channel budget -- the same owner rule as
 *     follow-up/channel-strategy.ts.
 *   * An attempt with no payment EXPIRES a week after its last nudge. A
 *     payment that arrives later still counts: money is never ignored.
 */

import { z } from "zod";

export const abandonedCheckoutSchema = z.object({
  enabled: z.boolean(),
  delay_hours: z.number().int().min(1).max(336),
  max_nudges: z.number().int().min(0).max(3),
  gap_hours: z.number().int().min(12).max(336),
});
export type AbandonedCheckoutSettings = z.infer<typeof abandonedCheckoutSchema>;

export const DEFAULT_ABANDONED_CHECKOUT: AbandonedCheckoutSettings = {
  enabled: true,
  delay_hours: 24,
  max_nudges: 2,
  gap_hours: 48,
};

/** How long after the last nudge (or the first due time, with none) an attempt expires. */
export const EXPIRE_AFTER_LAST_NUDGE_HOURS = 7 * 24;

const HOUR_MS = 3_600_000;

/** The stored columns (0143), read defensively: anything malformed is the default. */
export function parseAbandonedSettings(row: unknown): AbandonedCheckoutSettings {
  if (!row || typeof row !== "object") return DEFAULT_ABANDONED_CHECKOUT;
  const raw = row as Record<string, unknown>;
  const candidate = {
    enabled: raw.abandoned_checkout_enabled ?? DEFAULT_ABANDONED_CHECKOUT.enabled,
    delay_hours: Number(raw.abandoned_checkout_delay_hours ?? DEFAULT_ABANDONED_CHECKOUT.delay_hours),
    max_nudges: Number(raw.abandoned_checkout_max_nudges ?? DEFAULT_ABANDONED_CHECKOUT.max_nudges),
    gap_hours: Number(raw.abandoned_checkout_gap_hours ?? DEFAULT_ABANDONED_CHECKOUT.gap_hours),
  };
  const parsed = abandonedCheckoutSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_ABANDONED_CHECKOUT;
}

/** When nudge `n` (1-based) is due. */
export function nudgeDueAt(sentAt: Date, n: number, settings: AbandonedCheckoutSettings): Date {
  const hours = settings.delay_hours + settings.gap_hours * Math.max(0, n - 1);
  return new Date(sentAt.getTime() + hours * HOUR_MS);
}

/** Every nudge's due time, in order. Empty when nudges are off. */
export function nudgeSchedule(sentAt: Date, settings: AbandonedCheckoutSettings): Date[] {
  if (!settings.enabled || settings.max_nudges === 0) return [];
  return Array.from({ length: settings.max_nudges }, (_, index) => nudgeDueAt(sentAt, index + 1, settings));
}

/** When an unpaid attempt stops being chased and becomes EXPIRED. */
export function attemptExpiresAt(sentAt: Date, settings: AbandonedCheckoutSettings): Date {
  const schedule = nudgeSchedule(sentAt, settings);
  const last = schedule.at(-1) ?? nudgeDueAt(sentAt, 1, settings);
  return new Date(last.getTime() + EXPIRE_AFTER_LAST_NUDGE_HOURS * HOUR_MS);
}

export type NudgeStopReason =
  | "PAID"
  | "EXPIRED"
  | "ALREADY_SENT"
  | "DISABLED"
  | "EXHAUSTED"
  | "PAYMENT_UNDER_REVIEW"
  | "OPTED_OUT"
  | "LEAD_CLOSED"
  | "HUMAN_TAKEOVER"
  | "AUTOMATION_PAUSED"
  | "ARCHIVED";

export type NudgeDecision =
  | { action: "SEND" }
  | { action: "WAIT"; until: Date }
  | { action: "STOP"; reason: NudgeStopReason };

/**
 * Whether nudge `n` may be queued now. The stop-on-payment rule is first and
 * absolute: a PAID attempt, or any payment for the lead still waiting for a
 * person to confirm it, is never nudged -- someone who may have paid is not
 * chased for the money.
 */
export function nudgeDecision(input: {
  attempt: { status: string; nudgesSent: number; sentAt: Date };
  nudge: number;
  settings: AbandonedCheckoutSettings;
  lead: {
    optedOut: boolean;
    status: string;
    humanTakeover: boolean;
    archived: boolean;
    automationActive: boolean;
  };
  /** A REVIEW / LINKED-not-applied payment exists for this lead. */
  paymentUnderReview: boolean;
  now: Date;
}): NudgeDecision {
  const { attempt, settings, lead, nudge } = input;
  if (attempt.status === "PAID") return { action: "STOP", reason: "PAID" };
  if (attempt.status === "EXPIRED") return { action: "STOP", reason: "EXPIRED" };
  if (input.paymentUnderReview) return { action: "STOP", reason: "PAYMENT_UNDER_REVIEW" };
  if (lead.status === "WON" || lead.status === "LOST") return { action: "STOP", reason: "LEAD_CLOSED" };
  if (lead.optedOut) return { action: "STOP", reason: "OPTED_OUT" };
  if (lead.archived) return { action: "STOP", reason: "ARCHIVED" };
  if (lead.humanTakeover) return { action: "STOP", reason: "HUMAN_TAKEOVER" };
  if (!lead.automationActive) return { action: "STOP", reason: "AUTOMATION_PAUSED" };
  if (!settings.enabled) return { action: "STOP", reason: "DISABLED" };
  if (nudge > settings.max_nudges) return { action: "STOP", reason: "EXHAUSTED" };
  if (nudge <= attempt.nudgesSent) return { action: "STOP", reason: "ALREADY_SENT" };
  const due = nudgeDueAt(attempt.sentAt, nudge, settings);
  // A minute of slack: a job run a moment early is not re-queued for nothing.
  if (input.now.getTime() < due.getTime() - 60_000) return { action: "WAIT", until: due };
  return { action: "SEND" };
}

/** The status an attempt should carry at `now`, absent a payment. */
export function attemptStatusAt(
  attempt: { status: string; sentAt: Date },
  settings: AbandonedCheckoutSettings,
  now: Date,
): "SENT" | "PAID" | "ABANDONED" | "EXPIRED" {
  if (attempt.status === "PAID") return "PAID";
  if (now.getTime() >= attemptExpiresAt(attempt.sentAt, settings).getTime()) return "EXPIRED";
  if (now.getTime() >= nudgeDueAt(attempt.sentAt, 1, settings).getTime()) return "ABANDONED";
  return "SENT";
}

/* ---------------------------------------------------------- channel */

export type NudgeChannel = "sms" | "email" | "whatsapp" | "messenger" | "instagram" | "tiktok" | "linkedin";

/**
 * The channel a nudge goes on, or null when there is no usable one (the nudge
 * is then skipped, never forced). Engaged: the channel the link was sent on.
 * Unengaged: email first (free), SMS only when affordable.
 */
export function nudgeChannel(input: {
  sentChannel: NudgeChannel;
  engaged: boolean;
  available: { sms: boolean; email: boolean };
  leadHas: { sms: boolean; email: boolean };
  smsAffordable: boolean;
}): NudgeChannel | null {
  if (input.engaged) return input.sentChannel;
  if (input.available.email && input.leadHas.email) return "email";
  if (input.available.sms && input.leadHas.sms && input.smsAffordable) return "sms";
  // Not engaged and no cheap route: stay where the conversation already is
  // only if it is a channel with no per-message cost to budget.
  if (input.sentChannel !== "sms" && input.sentChannel !== "email") return input.sentChannel;
  return null;
}

/* ---------------------------------------------------------- wording */

/**
 * The strategy lines the model is given for a nudge. The model writes the
 * words; the validator (the same one every turn uses) decides whether they
 * may go, with the tracked link and only its approved price text allowed.
 */
export function nudgeGuidance(input: {
  nudge: number;
  maxNudges: number;
  product: string;
  priceText: string;
  hoursSinceSent: number;
}): string[] {
  const days = Math.max(1, Math.round(input.hoursSinceSent / 24));
  const last = input.nudge >= input.maxNudges;
  return [
    "CHECKOUT FOLLOW-UP",
    `The lead was sent the approved checkout link for ${input.product} about ${days} day${days === 1 ? "" : "s"} ago and has not completed it.`,
    "Write one short, friendly message that makes it easy to finish: acknowledge they may be busy, answer the most likely hesitation (timing, fit, or a question about what is included) in one sentence, and invite a reply if anything is holding them back.",
    `If you mention the price, use exactly: ${input.priceText}. Offer no discount beyond what the business allows, and never say they have paid or ordered.`,
    last
      ? "This is the last reminder: do not imply there will be more, and do not create urgency or pressure."
      : "Do not create urgency or pressure.",
    "Do not write any link: the runtime appends the same checkout link itself.",
  ];
}

/**
 * The thank-you after a confirmed payment. Deterministic: its facts (the
 * payment happened, what for) are ones the runtime holds, and "your payment
 * has come through" is exactly the sentence the validator forbids a model to
 * write on its own. The next steps are the workspace's own words (the link's
 * onboarding text), or a short generic line that promises no time.
 */
export function thankYouMessage(input: {
  firstName: string | null;
  businessName: string;
  product: string | null;
  onboardingText: string | null;
}): { body: string; subject: string } {
  const name = input.firstName?.trim();
  const greeting = name ? `Thank you, ${name}!` : "Thank you!";
  const what = input.product?.trim() ? ` for ${input.product.trim()}` : "";
  const confirmed = `Your payment${what} has come through.`;
  const next = input.onboardingText?.trim()
    ? input.onboardingText.trim()
    : `The team at ${input.businessName} will be in touch with the next steps.`;
  return {
    body: `${greeting} ${confirmed} ${next}`.slice(0, 1400),
    subject: `Thank you from ${input.businessName}`.slice(0, 150),
  };
}
