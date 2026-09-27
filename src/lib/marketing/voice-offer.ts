/**
 * The public offer for the AI Voice Sales Agent and quote-to-cash.
 *
 * The ONE place the marketing site reads voice prices from. Every figure on
 * the home page, the pricing page, the comparison table and the JSON-LD is
 * derived from the constants below, so a price cannot be written into markup
 * by hand and drift from the decision it came from.
 *
 * Source: owner decision OD-2 (docs/revenue-engine/12-voice-quote-to-cash-gap-map.md),
 * prices from docs/revenue-engine/12-voice-provider-research.md §8.
 *
 * The prices themselves live in `lib/billing/plans.ts` (the source of truth
 * checkout and the entitlement sync read) and are re-exported here, so the
 * site and checkout cannot disagree.
 *
 * House style for public copy: UK English, no emoji, no dashes as punctuation.
 */

import {
  PLANS,
  TRIAL_DAYS,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
} from "../billing/plans.ts";
import { quotesIncludedOnPlan } from "../billing/capability-rules.ts";

/**
 * Prepaid voice minute packs (Starter, Growth, and Pro without the voice
 * item), the dedicated number's monthly price, and the Pro voice item (bundled
 * on Pro by default and removable; a separate subscription item, never a new
 * plan, and the annual discount does not apply to it). Re-exported from
 * plans.ts.
 */
export { VOICE_ADDON, VOICE_MINUTE_PACKS, VOICE_NUMBER_MONTHLY_GBP };

/** Premium voices (larger model and premium text to speech), per minute. */
export const PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN = 0.2;

/** Hard time budget per call, in minutes (lib/voice/time-governor.ts CALL_BUDGET_SEC / 60). */
export const CALL_BUDGET_MINUTES = 5;

/** Pro including the voice item. Derived, never written out. */
export const PRO_MONTHLY_GBP = PLANS.pro.monthlyPrice as number;
export const PRO_WITH_VOICE_MONTHLY_GBP = PRO_MONTHLY_GBP + VOICE_ADDON.monthlyPriceGbp;

/**
 * Pro with voice on annual billing, per month: the discounted platform price
 * plus the undiscounted voice item.
 */
export const PRO_WITH_VOICE_ANNUAL_MONTHLY_GBP =
  Math.round((PLANS.pro.yearlyPrice as number) / 12) + VOICE_ADDON.monthlyPriceGbp;

/** The cheapest way into voice on Starter or Growth. */
export const VOICE_PACKS_FROM_GBP = Math.min(...VOICE_MINUTE_PACKS.map((pack) => pack.priceGbp));

/** The sentence every voice price is shown with. Never presented as free. */
export const VOICE_TRIAL_NOTE = "Voice is a paid feature; trials don't place live calls.";

/** Rules that go with every voice price, stated where the price is. */
export const VOICE_TERMS = [
  `Included minutes reset each month and don't roll over.`,
  `Minute packs are prepaid, never expire and are non-refundable once used.`,
  `There is no overage: when minutes run out, calls stop until you top up.`,
  `Every call has a ${CALL_BUDGET_MINUTES} minute time budget.`,
  VOICE_TRIAL_NOTE,
] as const;

/* ---------------------------------------------------------- formatting --- */

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat("en-GB");

/** "£49", "£11.99", "£0.20". */
export function gbp(value: number): string {
  if (Number.isInteger(value)) return GBP.format(value);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function minutes(value: number): string {
  return `${NUMBER.format(value)} min`;
}

/** Pence per minute for a pack, for the comparison ("49p a minute"). */
export function packPencePerMinute(pack: { minutes: number; priceGbp: number }): number {
  return Math.round((pack.priceGbp / pack.minutes) * 1000) / 10;
}

/** "100 min £49 · 250 min £115 · ..." */
export function packSummary(): string {
  return VOICE_MINUTE_PACKS.map((pack) => `${minutes(pack.minutes)} ${gbp(pack.priceGbp)}`).join(" · ");
}

/* -------------------------------------------------- per-plan presentation --- */

export type PlanVoiceOffer = {
  /** Short cell for the comparison table. */
  agent: string;
  number: string;
  /** Line for a plan card. */
  cardLine: string;
};

export function planVoiceOffer(planId: string): PlanVoiceOffer {
  if (planId === "pro") {
    return {
      agent: `${minutes(VOICE_ADDON.includedMinutes)} a month included (${gbp(PRO_WITH_VOICE_MONTHLY_GBP)} with Voice)`,
      number: "Included with Voice",
      cardLine: `AI Voice Sales Agent: ${minutes(VOICE_ADDON.includedMinutes)} a month and a dedicated number (${gbp(PRO_MONTHLY_GBP)} without voice)`,
    };
  }
  if (planId === "enterprise") {
    return { agent: "Custom", number: "Custom", cardLine: "AI Voice Sales Agent on contract" };
  }
  return {
    agent: `Add-on: minute packs from ${gbp(VOICE_PACKS_FROM_GBP)}`,
    number: `${gbp(VOICE_NUMBER_MONTHLY_GBP)} a month`,
    cardLine: `Voice add-on: minute packs from ${gbp(VOICE_PACKS_FROM_GBP)} plus a ${gbp(VOICE_NUMBER_MONTHLY_GBP)}/month number`,
  };
}

/**
 * Plan catalogue lines as the public site may show them. Nothing ClientTurn
 * sells is unlimited, so a catalogue line that says so is dropped rather
 * than published (gap map §49: "Unlimited follow-up email" in plans.ts).
 */
export function publicFeatureLines(features: readonly string[]): string[] {
  return features.filter((feature) => !/unlimited/i.test(feature));
}

/* ------------------------------------------------------- quote to cash --- */

/**
 * Quote-to-cash on the public site: branded quotes, a simple electronic
 * signature and invoices with payment links. Payment is collected through the
 * customer's own Stripe account (no Stripe Connect in v1, gap map F4), so we
 * never hold the customer's money.
 *
 * Per-plan availability (owner decision 2026-09-27): quotes, e-signature and
 * invoicing are on every paid plan and off in the trial. Read from the
 * capability defaults `can()` enforces (billing/capability-rules.ts), so the
 * site and the product cannot disagree.
 */
export const QUOTES_ON_PLAN: Readonly<Record<string, boolean>> = {
  starter: quotesIncludedOnPlan("starter"),
  growth: quotesIncludedOnPlan("growth"),
  pro: quotesIncludedOnPlan("pro"),
  enterprise: quotesIncludedOnPlan("enterprise"),
};

export const SIGNATURE_LABEL = "Simple electronic signature with audit trail";

/** The trial the voice note refers to, from the plan catalogue. */
export const VOICE_TRIAL_DAYS = TRIAL_DAYS;
