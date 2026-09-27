/**
 * "Running low on SMS / WhatsApp" -- the ONE threshold rule behind the owner
 * notification (limits-service `meterSendBilling`), the app banner
 * (`getBillingNotice`) and the Usage & limits row, so the three never
 * disagree about whether a workspace is running low or what to buy.
 *
 * Owner request (2026-09-27): "When SMS runs out, prompt them when coming up
 * to it to buy a pack."
 *
 * Pure -- no `server-only`, no Supabase -- so the client table, the server
 * and the unit tests compute the same answer.
 *
 * ## The rule
 *
 *   remaining   = the plan's allowance left this period + top-up credit
 *   percentUsed = used this period / (used this period + remaining)
 *
 * i.e. the share of everything that was available this period that has gone.
 * A top-up makes the percentage fall, which is correct: there is more left.
 *
 *   75%  -> "running low"        (warning)
 *   90%  -> "nearly out"         (warning)
 *   100% -> nothing left         (danger)   -- remaining is exactly 0
 *
 * Each threshold is notified once per billing period per channel (the
 * watermark, migration 0140). A top-up that takes usage back under a
 * threshold re-arms it, so running low twice in one period is announced twice.
 *
 * ## The recommended pack
 *
 * The smallest bundle that covers the projected shortfall to the end of the
 * period at this period's average daily rate, capped at the largest bundle.
 * Prices and sizes come from the catalogue (plans.ts); nothing here invents a
 * number. A trial has no packs: it is pointed at starting its plan instead.
 *
 * There is no overage (owner, 2026-09-27): past the allowance, prepaid credit
 * is the only way on, so at zero sending on the channel is refused.
 *
 * ## WhatsApp: tokens
 *
 * WhatsApp has no allowance; it is bought as WhatsApp TOKENS
 * (whatsapp-tokens.ts) and every figure here is in tokens: used this period =
 * tokens spent, remaining = the token balance. Fewer tokens than the cheapest
 * message (a 2-token reply) is "run out", since nothing more can be sent. The
 * copy states tokens with the approximate replies / marketing messages they
 * cover, never a £ amount.
 */

import type { MessageCreditBundle, MessageCreditChannel } from "./plans.ts";
import { TOP_UP_REFUND_NOTICE } from "./refundability.ts";
import { WHATSAPP_TOKENS_PER_MESSAGE, whatsappCoverageText } from "./whatsapp-tokens.ts";

export const ALLOWANCE_ALERT_THRESHOLDS = [75, 90, 100] as const;
export type AllowanceAlertThreshold = (typeof ALLOWANCE_ALERT_THRESHOLDS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------ measurement */

export type AllowancePosition = {
  /** The plan's included units this period (SMS segments; 0 for WhatsApp). */
  allowance: number;
  /** Units used this period, from every source (SMS segments / WhatsApp tokens). */
  usedThisPeriod: number;
  /** Top-up credit left (SMS segments / WhatsApp tokens). Never expires. */
  creditBalance: number;
  /**
   * The fewest units one send can use (WhatsApp: a 2-token reply). Less than
   * this left is nothing left. Default 1.
   */
  minPerSend?: number;
};

/** Allowance left this period plus top-up credit (0 when it cannot pay for one send). */
export function allowanceRemaining(position: AllowancePosition): number {
  const allowanceLeft = Math.max(0, position.allowance - Math.max(0, position.usedThisPeriod));
  const total = allowanceLeft + Math.max(0, Math.floor(position.creditBalance));
  return total < Math.max(1, position.minPerSend ?? 1) ? 0 : total;
}

/**
 * Share of what was available this period that has been used, 0-100, not
 * rounded (so 99.6% is not mistaken for "run out"). Nothing used and nothing
 * available (WhatsApp before any credit is bought) reads as 0: there is
 * nothing to run low on.
 */
export function allowancePercentUsed(position: AllowancePosition): number {
  const used = Math.max(0, position.usedThisPeriod);
  const remaining = allowanceRemaining(position);
  if (remaining <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, (used / (used + remaining)) * 100);
}

/** The highest threshold reached, or null below 75%. */
export function crossedThreshold(position: AllowancePosition): AllowanceAlertThreshold | null {
  const used = Math.max(0, position.usedThisPeriod);
  // "Run out" is exact: no units left and at least one was used.
  if (allowanceRemaining(position) <= 0) return used > 0 ? 100 : null;
  const percent = allowancePercentUsed(position);
  if (percent >= 90) return 90;
  if (percent >= 75) return 75;
  return null;
}

/* ------------------------------------------------------------- watermark */

/**
 * The stored watermark that applies to this period: a watermark from another
 * period does not count, so every period starts un-warned.
 */
export function watermarkForPeriod(
  stored: { periodStart: string; warnedAtPercent: number } | null,
  periodStart: string,
): number {
  if (!stored) return 0;
  return new Date(stored.periodStart).getTime() === new Date(periodStart).getTime()
    ? stored.warnedAtPercent
    : 0;
}

/**
 * What to do after a send. `notify` is the threshold to announce (once), and
 * `watermark` is what to store. Crossing several thresholds at once announces
 * only the highest. Falling back below the watermark (a top-up) lowers it
 * without a notification, so the threshold can be announced again later.
 */
export function nextAllowanceAlert(input: {
  crossed: AllowanceAlertThreshold | null;
  watermark: number;
}): { notify: AllowanceAlertThreshold | null; watermark: number } {
  const crossed = input.crossed ?? 0;
  if (crossed > input.watermark) return { notify: crossed as AllowanceAlertThreshold, watermark: crossed };
  return { notify: null, watermark: Math.min(input.watermark, crossed) };
}

/* ------------------------------------------------------ recommended pack */

/** When the period's allowance resets: its end, or a month after its start. */
export function periodResetDate(periodStart: string, periodEnd: string | null): Date {
  if (periodEnd) return new Date(periodEnd);
  const start = new Date(periodStart);
  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + 1,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
    ),
  );
}

/**
 * Units still needed before the period resets beyond what is left, at this
 * period's average daily rate. The rate is taken over at least one day so a
 * busy first hour does not project a month of that pace.
 */
export function projectedShortfall(input: {
  usedThisPeriod: number;
  remaining: number;
  periodStart: string;
  resetsAt: Date;
  now: Date;
}): number {
  const elapsedDays = Math.max(1, (input.now.getTime() - new Date(input.periodStart).getTime()) / DAY_MS);
  const daysLeft = Math.max(0, (input.resetsAt.getTime() - input.now.getTime()) / DAY_MS);
  const dailyRate = Math.max(0, input.usedThisPeriod) / elapsedDays;
  return Math.max(0, Math.ceil(dailyRate * daysLeft - Math.max(0, input.remaining)));
}

/**
 * The smallest bundle for this channel that covers the shortfall, or the
 * largest when none does. Null when the channel has no bundles.
 */
export function recommendBundle(input: {
  channel: MessageCreditChannel;
  shortfall: number;
  bundles: readonly MessageCreditBundle[];
}): MessageCreditBundle | null {
  const forChannel = input.bundles
    .filter((bundle) => bundle.channel === input.channel)
    .slice()
    .sort((a, b) => a.credits - b.credits);
  if (forChannel.length === 0) return null;
  return forChannel.find((bundle) => bundle.credits >= input.shortfall) ?? forChannel[forChannel.length - 1];
}

/* ----------------------------------------------------------------- links */

/** Settings -> Billing & Usage -> Message credits, with a bundle pre-selected. */
export function creditBundleHref(bundleKey: string): string {
  return `/app/settings?section=billing&bundle=${encodeURIComponent(bundleKey)}#message-credits`;
}

/** Where a trial chooses (or changes) the plan it converts to. */
export const CHOOSE_PLAN_HREF = "/app/settings?section=billing";

/**
 * The `bundle` query parameter, accepted only when it names a bundle this
 * workspace can buy. Anything else is ignored rather than trusted.
 */
export function parseBundleParam(
  value: string | string[] | undefined,
  allowed: readonly MessageCreditBundle[],
): string | null {
  const key = Array.isArray(value) ? value[0] : value;
  if (!key) return null;
  return allowed.some((bundle) => bundle.key === key) ? key : null;
}

/* ------------------------------------------------------------ the alert */

export type AllowanceAlert = {
  channel: MessageCreditChannel;
  threshold: AllowanceAlertThreshold;
  tone: "warning" | "danger";
  /** Units left: allowance left + credit. */
  remaining: number;
  /** Rounded, for display. */
  percentUsed: number;
  /** ISO date the included allowance resets. */
  resetsAt: string;
  trial: boolean;
  /** The recommended pack; null in a trial or when the channel has none. */
  recommended: MessageCreditBundle | null;
  action: { label: string; href: string };
  title: string;
  body: string;
};

export type AllowanceAlertInput = AllowancePosition & {
  channel: MessageCreditChannel;
  /** The workspace is in its free trial: no packs. */
  trial: boolean;
  periodStart: string;
  periodEnd: string | null;
  /** When the trial converts to the paid plan, for the trial copy. */
  trialEndsAt?: string | null;
  now: Date;
  /** The bundles this workspace can buy (plans.ts `creditBundlesFor`). */
  bundles: readonly MessageCreditBundle[];
};

const NUMBER = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

function unitWord(channel: MessageCreditChannel, count: number): string {
  if (channel === "sms") return count === 1 ? "SMS segment" : "SMS segments";
  return count === 1 ? "WhatsApp token" : "WhatsApp tokens";
}

/** WhatsApp: " (about 60 conversation replies or 24 marketing messages)". */
function coverage(channel: MessageCreditChannel, units: number): string {
  return channel === "whatsapp" ? ` (${whatsappCoverageText(units)})` : "";
}

function channelLabel(channel: MessageCreditChannel): string {
  return channel === "sms" ? "SMS" : "WhatsApp";
}

/** Shown wherever a pack is offered: one definition, in refundability.ts. */
export { TOP_UP_REFUND_NOTICE };

/**
 * What happens at zero, stated as the send path actually behaves
 * (send-store `blockedByPolicy`): the send is refused (no overage); an
 * automated step or an AI reply goes by email where the lead has an address
 * and a mailbox is connected; otherwise an AI reply's lead is handed to a
 * person.
 */
export function atZeroText(channel: MessageCreditChannel): string {
  return channel === "sms"
    ? "no new texts go out: automated follow-up and AI replies to leads who text back go by email where the lead has an email address and your mailbox is connected, otherwise the lead is handed to your team, and texts you type yourself are refused"
    : "no WhatsApp messages go out: automated follow-up and AI replies go by email where the lead has an email address and your mailbox is connected, otherwise the lead is handed to your team, and messages you type yourself are refused";
}

/**
 * The alert for one channel, or null below 75%. Every surface (notification,
 * banner, Usage & limits row) renders this, so the numbers and the pack match.
 */
export function allowanceAlertFor(alertInput: AllowanceAlertInput): AllowanceAlert | null {
  // WhatsApp: tokens, and fewer than one reply's worth is nothing left.
  const input: AllowanceAlertInput =
    alertInput.channel === "whatsapp"
      ? { ...alertInput, allowance: 0, minPerSend: WHATSAPP_TOKENS_PER_MESSAGE.SERVICE }
      : alertInput;
  const threshold = crossedThreshold(input);
  if (threshold === null) return null;

  const remaining = allowanceRemaining(input);
  const percentUsed = Math.round(allowancePercentUsed(input));
  const resetsAt = periodResetDate(input.periodStart, input.periodEnd);
  const label = channelLabel(input.channel);
  const exhausted = threshold === 100;
  const hasAllowance = input.allowance > 0;

  if (input.trial) {
    const converts = input.trialEndsAt ? ` on ${DATE.format(new Date(input.trialEndsAt))}` : "";
    const left = exhausted
      ? `You've used all ${NUMBER.format(input.allowance)} ${unitWord(input.channel, input.allowance)} in your trial.`
      : `You have ${NUMBER.format(remaining)} of the trial's ${NUMBER.format(input.allowance)} ${unitWord(input.channel, input.allowance)} left.`;
    return {
      channel: input.channel,
      threshold,
      tone: exhausted ? "danger" : "warning",
      remaining,
      percentUsed,
      resetsAt: resetsAt.toISOString(),
      trial: true,
      recommended: null,
      action: { label: "Upgrade now", href: CHOOSE_PLAN_HREF },
      title: exhausted
        ? "Start your plan to keep texting"
        : `Trial ${label} is ${percentUsed}% used: start your plan to keep texting`,
      body:
        `${left} The trial's ${label} is kept small to show it working. ` +
        `Upgrade now to start your plan today on the card you added, or its full allowance starts when the trial ends${converts}. ` +
        (exhausted
          ? `Until then, ${atZeroText(input.channel)}.`
          : `At zero, ${atZeroText(input.channel)} until then.`),
    };
  }

  const shortfall = projectedShortfall({
    usedThisPeriod: input.usedThisPeriod,
    remaining,
    periodStart: input.periodStart,
    resetsAt,
    now: input.now,
  });
  const recommended = recommendBundle({ channel: input.channel, shortfall, bundles: input.bundles });

  const allowanceLeft = Math.max(0, input.allowance - Math.max(0, input.usedThisPeriod));
  const credit = Math.max(0, Math.floor(input.creditBalance));
  const breakdown =
    hasAllowance && credit > 0
      ? ` (${NUMBER.format(allowanceLeft)} of this period's allowance and ${NUMBER.format(credit)} top-up credit)`
      : "";
  const reset = hasAllowance
    ? ` Your included allowance resets on ${DATE.format(resetsAt)}; top-up credit never expires.`
    : " WhatsApp has no included allowance; WhatsApp tokens never expire.";

  const need =
    shortfall > 0
      ? ` At your current rate you'll need about ${NUMBER.format(shortfall)} more before ${hasAllowance ? "it resets" : DATE.format(resetsAt)}.`
      : "";
  const pack = recommended
    ? ` Recommended: ${NUMBER.format(recommended.credits)} ${unitWord(input.channel, recommended.credits)}${coverage(input.channel, recommended.credits)} for ${GBP.format(recommended.priceGbp)}${
        shortfall > recommended.credits ? " (our largest pack; you may need more than one)" : ""
      }. ${TOP_UP_REFUND_NOTICE}`
    : "";

  const title = exhausted
    ? `You've run out of ${label}`
    : `${label} is ${percentUsed}% used: ${NUMBER.format(remaining)} ${unitWord(input.channel, remaining)} left`;

  const nothingLeft =
    input.channel === "whatsapp"
      ? "You have no WhatsApp tokens left for another message"
      : `You have no ${label} allowance or top-up credit left`;
  const nothingBeyond =
    input.channel === "whatsapp"
      ? "Nothing is charged beyond the tokens you buy."
      : "Nothing is charged beyond the credit you buy.";
  const body = exhausted
    ? `${nothingLeft}, so ${atZeroText(input.channel)}.${reset}${pack}`
    : `You have ${NUMBER.format(remaining)} ${unitWord(input.channel, remaining)} left${coverage(input.channel, remaining)}${breakdown}.${reset}${need} At zero, ${atZeroText(input.channel)}. ${nothingBeyond}${pack}`;

  return {
    channel: input.channel,
    threshold,
    tone: exhausted ? "danger" : "warning",
    remaining,
    percentUsed,
    resetsAt: resetsAt.toISOString(),
    trial: false,
    recommended,
    action: recommended
      ? {
          label: input.channel === "whatsapp" ? "Buy WhatsApp tokens" : `Buy ${label} credits`,
          href: creditBundleHref(recommended.key),
        }
      : { label: "See usage & limits", href: "/app/settings?section=billing#usage-limits" },
    title,
    body,
  };
}

/** Most urgent first: run out, then the higher percentage. */
export function mostUrgentAlert(alerts: readonly (AllowanceAlert | null)[]): AllowanceAlert | null {
  return (
    alerts
      .filter((alert): alert is AllowanceAlert => alert !== null)
      .sort((a, b) => b.threshold - a.threshold || b.percentUsed - a.percentUsed)[0] ?? null
  );
}
