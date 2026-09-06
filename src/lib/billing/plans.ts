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

export const TRIAL_ENTITLEMENTS = {
  leadLimit: 25,
  userLimit: 1,
  smsSegmentAllowance: 50,
  reactivationContactLimit: 0,
  whatsappEnabled: false,
  campaignsEnabled: false,
  aiAssistAllowed: true,
} as const;

export const TRIAL_DAYS = 14;

/** Overage SMS credit bundles (§44). One credit = one UK SMS segment. */
export const SMS_OVERAGE_BUNDLES = [
  { credits: 100, priceGbp: 9 },
  { credits: 500, priceGbp: 40 },
  { credits: 1000, priceGbp: 75 },
] as const;

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
