/**
 * Plan catalogue. Shared by the pricing page, checkout and entitlement checks.
 * Prices are display values in GBP; Stripe holds the authoritative amounts.
 *
 * Pricing per CLAUDE.md build brief §42-43 (2026-09-05 repricing): Starter
 * £99, Growth £199, Pro £399, 15% annual discount (not two-months-free).
 */

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
   * Included outbound WhatsApp messages per month. 0 on a plan without
   * WhatsApp. Seeded into `plan_entitlements.whatsapp_message` (0128).
   */
  whatsappMessageAllowance: number;
  /**
   * What one unit past the allowance costs when the workspace has switched
   * overage on, in GBP pence. Null = no overage on this plan for that channel:
   * the send is refused at the limit (top-up credit still applies). Seeded
   * into `plan_entitlements.overage_price` (0128), so the two agree.
   */
  smsOveragePence: number | null;
  whatsappOveragePence: number | null;
  reactivationContactLimit: number;
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
    smsSegmentAllowance: 250,
    whatsappMessageAllowance: 0,
    smsOveragePence: 9,
    whatsappOveragePence: null,
    reactivationContactLimit: 100,
    whatsappEnabled: false,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 1_000_000,
    recommended: false,
    selfServe: true,
    features: [
      "100 new leads per month",
      "250 included outbound UK SMS segments",
      "1 user",
      "Meta Lead Ads",
      "AI conversation handling",
      "1M AI tokens a month (about 590 assistant replies)",
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
    smsSegmentAllowance: 800,
    whatsappMessageAllowance: 1000,
    smsOveragePence: 8,
    whatsappOveragePence: 6,
    reactivationContactLimit: 500,
    whatsappEnabled: true,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 4_000_000,
    recommended: true,
    selfServe: true,
    features: [
      "400 new leads per month",
      "800 included outbound UK SMS segments",
      "3 users",
      "SMS + WhatsApp",
      "AI conversation handling",
      "4M AI tokens a month (about 2,350 assistant replies)",
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
    smsSegmentAllowance: 1800,
    whatsappMessageAllowance: 3000,
    smsOveragePence: 7.5,
    whatsappOveragePence: 5,
    reactivationContactLimit: 2500,
    whatsappEnabled: true,
    campaignsEnabled: true,
    aiAssistAllowed: true,
    aiTokenAllowance: 12_000_000,
    recommended: false,
    selfServe: true,
    features: [
      "1,000 new leads per month",
      "1,800 included outbound UK SMS segments",
      "10 users",
      "SMS + WhatsApp",
      "2,500 reactivation contacts",
      "Advanced handover / routing",
      "Full reporting",
      "Priority support",
      "12M AI tokens a month (about 7,050 assistant replies)",
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
    whatsappMessageAllowance: 100000,
    smsOveragePence: 7,
    whatsappOveragePence: 4,
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
      "40M AI tokens a month",
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
 */
export const TRIAL = {
  days: 14,
  leadLimit: 25,
  userLimit: 1,
  smsSegmentAllowance: 50,
  whatsappMessageAllowance: 0,
  reactivationContactLimit: 0,
  whatsappEnabled: false,
  campaignsEnabled: false,
  aiAssistAllowed: true,
  aiTokenAllowance: 100_000,
} as const;

/** Kept for existing importers; identical to `TRIAL`. */
export const TRIAL_ENTITLEMENTS = TRIAL;

export const TRIAL_DAYS = TRIAL.days;

/** Overage SMS credit bundles (§44). One credit = one UK SMS segment. */
export const SMS_OVERAGE_BUNDLES = [
  { credits: 100, priceGbp: 9 },
  { credits: 500, priceGbp: 40 },
  { credits: 1000, priceGbp: 75 },
] as const;

/* ------------------------------------------------------- message credits */

export type MessageCreditChannel = "sms" | "whatsapp";

export type MessageCreditBundle = {
  key: string;
  channel: MessageCreditChannel;
  /** SMS: one credit = one UK segment. WhatsApp: one credit = one message. */
  credits: number;
  priceGbp: number;
};

/**
 * Top-up message credit bundles (8.9). The SMS bundles are exactly the ones
 * the pricing page advertises (`SMS_OVERAGE_BUNDLES`); WhatsApp bundles are
 * priced at the Growth overage rate or better. Credits are bought, so unlike
 * the monthly allowance they never expire, and they are spent after the
 * plan allowance and before any overage.
 */
export const MESSAGE_CREDIT_BUNDLES: readonly MessageCreditBundle[] = [
  ...SMS_OVERAGE_BUNDLES.map((bundle) => ({
    key: `sms_${bundle.credits}`,
    channel: "sms" as const,
    credits: bundle.credits,
    priceGbp: bundle.priceGbp,
  })),
  { key: "whatsapp_250", channel: "whatsapp", credits: 250, priceGbp: 15 },
  { key: "whatsapp_1000", channel: "whatsapp", credits: 1000, priceGbp: 50 },
];

export function messageCreditBundle(key: string): MessageCreditBundle | null {
  return MESSAGE_CREDIT_BUNDLES.find((bundle) => bundle.key === key) ?? null;
}

/**
 * The bundles a workspace can actually use: WhatsApp credit only where the
 * plan includes WhatsApp. The Billing view lists these and the credit
 * checkout refuses anything else, so a Starter owner cannot buy credit that
 * could never be spent.
 */
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
  smsOveragePence: number | null;
  whatsappOveragePence: number | null;
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
      // No overage in a trial: nothing is billed before the first invoice.
      smsOveragePence: null,
      whatsappOveragePence: null,
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
    smsOveragePence: definition.smsOveragePence,
    whatsappOveragePence: definition.whatsappOveragePence,
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
