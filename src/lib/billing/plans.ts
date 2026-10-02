/**
 * Plan catalogue. Shared by the pricing page, checkout and entitlement checks.
 * Prices are display values in GBP; Stripe holds the authoritative amounts.
 *
 * Pricing per CLAUDE.md build brief §42-43 (2026-09-05 repricing): Starter
 * £99, Growth £199, Pro £399, 15% annual discount (not two-months-free).
 *
 * Allowances revised 2026-09-27 (docs/economics.md §10, migration 0138) to the
 * owner's margin rule: every plan and billing interval at least 75% gross
 * margin at MAXIMUM use of every included allowance, prices unchanged.
 * `tests/plan-margins.test.ts` recomputes it from this file and
 * `unit-costs.ts`, so an allowance change that breaks the rule fails CI.
 *
 *  - Follow-up after the first text goes by email through the customer's own
 *    mailbox (free to us), so included SMS is sized to an instant first text
 *    per lead at the lead cap, not to a five-step SMS sequence.
 *  - WhatsApp is a paid add-on on Growth and above: 0 included, sold only as
 *    prepaid WhatsApp TOKEN packs, spent per message by Meta category
 *    (whatsapp-tokens.ts). Priced to compete with WhatsApp specialists, the
 *    one purchase allowed below 75% (owner, 2026-09-27; floor: cost + 25%).
 *  - Every SMS credit bundle and AI token pack is priced at >= 75% margin
 *    after Stripe fees.
 *  - NO OVERAGE, anywhere (owner, 2026-09-27: "it will get abused, make them
 *    top up"). Past an allowance the only way on is prepaid top-up credit;
 *    without it the send is refused. Migration 0141 seeds
 *    `plan_entitlements.overage_allowed = false` to match.
 */

import { WHATSAPP_TOKEN_PACKS } from "./whatsapp-tokens.ts";

export type PlanId = "trial" | "starter" | "growth" | "pro" | "enterprise";

export const ANNUAL_DISCOUNT_PERCENT = 15;

export type PlanDefinition = {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyPrice: number | null; // null = contact sales
  yearlyPrice: number | null; // monthlyPrice * 12 * (1 - discount), rounded
  leadLimit: number;
  userLimit: number;
  smsSegmentAllowance: number;
  /**
   * Included outbound WhatsApp messages per month. 0 on every plan since
   * 2026-09-27: WhatsApp is a paid add-on (prepaid WhatsApp tokens), not an
   * allowance. Seeded into `plan_entitlements.whatsapp_message` (0138).
   */
  whatsappMessageAllowance: number;
  reactivationContactLimit: number;
  /**
   * The WhatsApp add-on can be used on this plan: paid per message from
   * prepaid WhatsApp tokens (no included messages). The plan gate for WhatsApp.
   */
  whatsappEnabled: boolean;
  campaignsEnabled: boolean;
  aiAssistAllowed: boolean;
  /**
   * Included AI tokens per month. `plan_entitlements.ai_tokens` is the
   * runtime authority so an allowance can be changed without a deploy;
   * this is the seeded default and what the pricing page advertises, so
   * the two must agree.
   */
  aiTokenAllowance: number;
  recommended: boolean;
  selfServe: boolean;
  features: string[];
};

function annualPrice(monthly: number): number {
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100));
}

export const PLANS: Record<Exclude<PlanId, "trial">, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "For a single owner replying to every lead themselves.",
    monthlyPrice: 99,
    yearlyPrice: annualPrice(99),
    leadLimit: 100,
    userLimit: 1,
    smsSegmentAllowance: 200,
    whatsappMessageAllowance: 0,
    reactivationContactLimit: 100,
    whatsappEnabled: false,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 1_000_000,
    recommended: false,
    selfServe: true,
    features: [
      "100 new leads per month",
      "200 included outbound UK SMS segments (an instant first text for every lead)",
      "Unlimited follow-up email from your own mailbox",
      "1 user",
      "Meta Lead Ads",
      "AI conversation handling",
      "1,000 AI credits a month (about 360 assistant replies)",
      "New-lead follow-up + qualification",
      "Booking / handover",
      "Basic dashboard",
      "Limited reactivation",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline: "For businesses running Meta ads consistently.",
    monthlyPrice: 199,
    yearlyPrice: annualPrice(199),
    leadLimit: 400,
    userLimit: 3,
    smsSegmentAllowance: 400,
    whatsappMessageAllowance: 0,
    reactivationContactLimit: 500,
    whatsappEnabled: true,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 4_000_000,
    recommended: true,
    selfServe: true,
    features: [
      "400 new leads per month",
      "400 included outbound UK SMS segments (an instant first text for every lead)",
      "Unlimited follow-up email from your own mailbox",
      "3 users",
      "WhatsApp add-on: prepaid WhatsApp tokens (2 per reply, 5 per marketing message)",
      "AI conversation handling",
      "4,000 AI credits a month (about 1,450 assistant replies)",
      "Reactivation up to 500 selected contacts",
      "Multiple services",
      "Full source reporting",
      "Custom sequence timings",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For a sales team handling high lead volume.",
    monthlyPrice: 399,
    yearlyPrice: annualPrice(399),
    leadLimit: 1000,
    userLimit: 10,
    smsSegmentAllowance: 1000,
    whatsappMessageAllowance: 0,
    reactivationContactLimit: 2500,
    whatsappEnabled: true,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 6_000_000,
    recommended: false,
    selfServe: true,
    features: [
      "1,000 new leads per month",
      "1,000 included outbound UK SMS segments (an instant first text for every lead)",
      "Unlimited follow-up email from your own mailbox",
      "10 users",
      "WhatsApp add-on: prepaid WhatsApp tokens (2 per reply, 5 per marketing message)",
      "2,500 reactivation contacts",
      "Advanced handover / routing",
      "Full reporting",
      "Priority support",
      "6,000 AI credits a month (about 2,180 assistant replies)",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For multi-branch operations with custom requirements.",
    monthlyPrice: null,
    yearlyPrice: null,
    leadLimit: 100000,
    userLimit: 100,
    smsSegmentAllowance: 100000,
    whatsappMessageAllowance: 0,
    reactivationContactLimit: 100000,
    whatsappEnabled: true,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 40_000_000,
    recommended: false,
    selfServe: false,
    features: [
      "Custom lead, user and messaging limits",
      "Dedicated support contact",
      "Data processing agreement",
      "Onboarding assistance",
      "Everything in Pro",
      "40,000 AI credits a month",
    ],
  },
};

/**
 * The free trial -- the ONE place its length and its limits are defined.
 *
 * Signup, `getEntitlements`, the Stripe checkout (`trial_period_days`), the
 * entitlement snapshot the webhook writes and the pricing/terms copy all read
 * this. It used to be written out three times (and signup disagreed with this
 * constant about AI assist), which is how a trial ended up with different
 * rules depending on which path last touched the subscription row.
 *
 * A trial is a Stripe subscription in `trialing` with a verified card on file
 * (8.10). Whatever plan was chosen at checkout, these limits apply until the
 * first invoice is paid: the trial is for evaluating the product, not for
 * spending a paid tier's messaging allowance for free.
 *
 * Sized so the worst-case MARGINAL cost of a trial is under 50p (owner rule,
 * docs/economics.md §2, `trialWorstCase` in unit-costs.ts): follow-up email
 * through the customer's own mailbox carries the trial (free to us), 8 SMS
 * segments show SMS working (about 34p), and 50k AI tokens (about 18 agent
 * replies at ~2,750 tokens each) sit under a 6p AI spend ceiling (`ai_budgets`
 * trial PLAN row, 0138).
 */
export const TRIAL = {
  days: 14,
  leadLimit: 25,
  userLimit: 1,
  smsSegmentAllowance: 8,
  whatsappMessageAllowance: 0,
  reactivationContactLimit: 0,
  whatsappEnabled: false,
  campaignsEnabled: false,
  aiAssistAllowed: true,
  aiTokenAllowance: 50_000,
  /** The trial's AI spend ceiling in pence (`ai_budgets` PLAN row, 0138). */
  aiSpendCeilingPence: 6,
} as const;

/**
 * Daily cap on system email (Resend, which we pay for) per workspace: owner
 * alerts and notification emails. Campaign and follow-up email never uses
 * Resend -- it goes through the customer's own mailbox. At the cap the in-app
 * notification is still written; only the email copy is skipped.
 */
export const SYSTEM_EMAIL_DAILY_CAP: Record<PlanId, number> = {
  trial: 10,
  starter: 30,
  growth: 60,
  pro: 120,
  enterprise: 500,
};

export function systemEmailDailyCap(plan: string): number {
  return plan in SYSTEM_EMAIL_DAILY_CAP ? SYSTEM_EMAIL_DAILY_CAP[plan as PlanId] : SYSTEM_EMAIL_DAILY_CAP.trial;
}

/** Kept for existing importers; identical to `TRIAL`. */
export const TRIAL_ENTITLEMENTS = TRIAL;

export const TRIAL_DAYS = TRIAL.days;

/**
 * SMS credit bundles (§44). One credit = one UK SMS segment. Priced at >= 75%
 * margin after Stripe fees (unit-costs.ts `bundleMargin`).
 */
export const SMS_CREDIT_BUNDLES = [
  { credits: 100, priceGbp: 24 },
  { credits: 500, priceGbp: 115 },
  { credits: 1000, priceGbp: 220 },
] as const;

/* ------------------------------------------------------- message credits */

export type MessageCreditChannel = "sms" | "whatsapp";

export type MessageCreditBundle = {
  key: string;
  channel: MessageCreditChannel;
  /**
   * SMS: one credit = one UK segment. WhatsApp: WhatsApp TOKENS, spent per
   * message by category (whatsapp-tokens.ts), never a £ amount.
   */
  credits: number;
  priceGbp: number;
};

/**
 * Top-up bundles (8.9). The SMS bundles are exactly the ones the pricing page
 * advertises (`SMS_CREDIT_BUNDLES`). WhatsApp token packs are how the WhatsApp
 * add-on is bought: a conversation reply or utility template spends 2 tokens,
 * a marketing template 5 (whatsapp-tokens.ts). Bought units never expire and
 * are spent after the plan allowance; past both, a send is refused.
 */
export const MESSAGE_CREDIT_BUNDLES: readonly MessageCreditBundle[] = [
  ...SMS_CREDIT_BUNDLES.map((bundle) => ({
    key: `sms_${bundle.credits}`,
    channel: "sms" as const,
    credits: bundle.credits,
    priceGbp: bundle.priceGbp,
  })),
  ...WHATSAPP_TOKEN_PACKS.map((pack) => ({
    key: `whatsapp_tokens_${pack.tokens}`,
    channel: "whatsapp" as const,
    credits: pack.tokens,
    priceGbp: pack.priceGbp,
  })),
];

export function messageCreditBundle(key: string): MessageCreditBundle | null {
  return MESSAGE_CREDIT_BUNDLES.find((bundle) => bundle.key === key) ?? null;
}

/**
 * The bundles a workspace can actually use: WhatsApp token packs only where the
 * plan includes WhatsApp. The Billing view lists these and the credit
 * checkout refuses anything else, so a Starter owner cannot buy credit that
 * could never be spent.
 */
/**
 * Whether top-up credit can be bought on this plan key. Never in a trial
 * (owner, 2026-09-27): a trial's path past its small allowance is "Upgrade
 * now" (end the trial today on the card on file, billing/end-trial.ts), not a
 * pack. Enforced in `createCreditCheckout`; the UI only mirrors it.
 */
export const TRIAL_CREDIT_PURCHASE_REFUSAL =
  "Top-up credit is not available during a trial. Upgrade now to start your plan and its full allowance today.";

export function creditPurchaseAllowed(plan: string): boolean {
  return plan !== "trial";
}

/* ------------------------------------------------------------------ voice */

/**
 * The AI Voice Sales Agent (owner decision OD-2, gap map
 * docs/revenue-engine/12-voice-quote-to-cash-gap-map.md; prices from
 * docs/revenue-engine/12-voice-provider-research.md §8). The ONE source of
 * voice prices: checkout, the entitlement sync and the marketing site
 * (`marketing/voice-offer.ts` re-exports these) all read them from here.
 *
 * Voice is never a plan key. It is a separate Stripe subscription item (the
 * Pro voice item, the dedicated-number item) or a one-off minute pack, and
 * each grants `voice_sales_enabled` through `business_entitlement_grants`.
 * Margins after Stripe are asserted in `tests/plan-margins.test.ts`
 * (unit-costs.ts `voicePackMargin` / `voiceAddonMargin` / `voiceNumberMargin`).
 */

/** Stable keys for the minute packs (checkout, env price ids, metadata). */
export type VoicePackKey = "voice_100" | "voice_250" | "voice_500" | "voice_1000";

/** Prepaid voice minute packs (Starter, Growth, and Pro without the voice item). */
export const VOICE_MINUTE_PACKS = [
  { key: "voice_100", minutes: 100, priceGbp: 49 },
  { key: "voice_250", minutes: 250, priceGbp: 115 },
  { key: "voice_500", minutes: 500, priceGbp: 225 },
  { key: "voice_1000", minutes: 1000, priceGbp: 449 },
] as const satisfies readonly { key: VoicePackKey; minutes: number; priceGbp: number }[];

export type VoiceMinutePack = (typeof VOICE_MINUTE_PACKS)[number];

export function voiceMinutePack(minutes: number): VoiceMinutePack | null {
  return VOICE_MINUTE_PACKS.find((pack) => pack.minutes === minutes) ?? null;
}

/** The dedicated UK business number, bought as a monthly subscription item. */
export const VOICE_NUMBER_MONTHLY_GBP = 11.99;

/**
 * The Pro voice subscription item. Bundled on Pro by default and removable.
 * A separate subscription item, never a new plan: Pro's other limits are
 * unchanged, and the annual discount does NOT apply to it (monthly only).
 */
export const VOICE_ADDON = {
  monthlyPriceGbp: 100,
  includedMinutes: 200,
  includesNumber: true,
  defaultOnPlans: ["pro"],
  availableAsPackOnly: ["starter", "growth"],
  annualDiscount: false,
} as const;

/**
 * Whether voice (a minute pack, the number item) can be bought on this plan
 * key. Never in a trial: trials do not place live calls (voice-offer
 * VOICE_TRIAL_NOTE), and the trial's path is "Upgrade now". Same rule and
 * shape as `creditPurchaseAllowed`; enforced server-side in the voice
 * checkout, the UI only mirrors it.
 */
export const TRIAL_VOICE_PURCHASE_REFUSAL =
  "Voice is not available during a trial. Upgrade now to start your plan, then add voice minutes.";

export function voicePurchaseAllowed(plan: string): boolean {
  return plan !== "trial";
}

export function creditBundlesFor(access: { whatsappEnabled: boolean }): MessageCreditBundle[] {
  return MESSAGE_CREDIT_BUNDLES.filter(
    (bundle) => bundle.channel !== "whatsapp" || access.whatsappEnabled,
  );
}

/* ------------------------------------------------------ plan resolution */

/**
 * The allowances that apply to a plan key, including the trial. Every limit
 * the enforcement path and the Usage & limits view read comes from here, so a
 * number cannot be advertised in one place and enforced as another.
 */
export type PlanAllowances = {
  leadLimit: number;
  userLimit: number;
  smsSegmentAllowance: number;
  whatsappMessageAllowance: number;
  reactivationContactLimit: number;
  aiTokenAllowance: number;
  whatsappEnabled: boolean;
  campaignsEnabled: boolean;
  aiAssistAllowed: boolean;
};

export function allowancesFor(plan: string): PlanAllowances {
  const definition =
    plan in PLANS ? PLANS[plan as Exclude<PlanId, "trial">] : null;
  if (!definition) {
    return {
      leadLimit: TRIAL.leadLimit,
      userLimit: TRIAL.userLimit,
      smsSegmentAllowance: TRIAL.smsSegmentAllowance,
      whatsappMessageAllowance: TRIAL.whatsappMessageAllowance,
      reactivationContactLimit: TRIAL.reactivationContactLimit,
      aiTokenAllowance: TRIAL.aiTokenAllowance,
      whatsappEnabled: TRIAL.whatsappEnabled,
      campaignsEnabled: TRIAL.campaignsEnabled,
      aiAssistAllowed: TRIAL.aiAssistAllowed,
    };
  }
  return {
    leadLimit: definition.leadLimit,
    userLimit: definition.userLimit,
    smsSegmentAllowance: definition.smsSegmentAllowance,
    whatsappMessageAllowance: definition.whatsappMessageAllowance,
    reactivationContactLimit: definition.reactivationContactLimit,
    aiTokenAllowance: definition.aiTokenAllowance,
    whatsappEnabled: definition.whatsappEnabled,
    campaignsEnabled: definition.campaignsEnabled,
    aiAssistAllowed: definition.aiAssistAllowed,
  };
}

/** Features a plan can lock. */
export type PlanFeature = "whatsapp" | "campaigns" | "ai_assist";

/**
 * The cheapest self-serve-or-sales plan that unlocks a feature, for a locked
 * state that names what would unlock it rather than just saying "no".
 */
export function planThatUnlocks(feature: PlanFeature): PlanDefinition | null {
  for (const plan of planOrder()) {
    if (feature === "whatsapp" && plan.whatsappEnabled) return plan;
    if (feature === "campaigns" && plan.campaignsEnabled) return plan;
    if (feature === "ai_assist" && plan.aiAssistAllowed) return plan;
  }
  return null;
}

export function planOrder(): PlanDefinition[] {
  return [PLANS.starter, PLANS.growth, PLANS.pro, PLANS.enterprise];
}

/* --------------------------------------------------------------- upgrades --- */

/**
 * A plan a workspace can be sold. Never "trial": nobody upgrades *to* a trial,
 * and saying so in the type is what lets callers index `PLANS` directly.
 */
export type UpgradeTarget = Exclude<PlanId, "trial">;

/**
 * The tier a workspace moves to next, or null when there is nothing left to
 * sell. Used by the sidebar prompt, so an upgrade is never offered to a
 * workspace already on the top tier or on a plan we do not recognise.
 */
export function nextPlanFor(plan: string): UpgradeTarget | null {
  switch (plan) {
    case "trial":
      return "starter";
    case "starter":
      return "growth";
    case "growth":
      return "pro";
    case "pro":
      return "enterprise";
    default:
      return null;
  }
}

/** "Growth plan": the name of the plan that unlocks a feature, for locked states. */
export function unlockPlanLabel(feature: PlanFeature): string {
  const plan = planThatUnlocks(feature);
  return plan ? `${plan.name} plan` : "a higher plan";
}
