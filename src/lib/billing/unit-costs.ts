/**
 * What things cost ClientTurn, and the margin model built on it.
 *
 * Pure: no `server-only`, no Supabase, no I/O. Platform-confidential -- this
 * is never rendered on a customer surface. It exists so the owner's margin
 * rule ("every plan and billing interval at least 75% gross margin at MAXIMUM
 * use of every included allowance") is a unit test, not a spreadsheet:
 * `tests/plan-margins.test.ts` recomputes every plan from `plans.ts` and these
 * constants, so an allowance or price change that breaks the rule fails CI.
 *
 * Method: docs/economics.md §1.1. All figures GBP ex-VAT. USD converted at
 * £0.7549 per $1 (GBP/USD 1.3246, mid-market 2026-09-27, economics.md A21).
 * Every provider price was checked on 2026-09-27 against the source named on
 * its line (economics.md Appendix). `provider_price_book` holds the same rates
 * (0018, 0138); change both together.
 */

import { whatsappTokensFor, type WhatsappBillingCategory } from "./whatsapp-tokens.ts";
import { VOICE_ADDON, VOICE_MINUTE_PACKS, VOICE_NUMBER_MONTHLY_GBP } from "./plans.ts";

export const USD_TO_GBP_MODEL = 0.7549;

const usd = (dollars: number) => dollars * USD_TO_GBP_MODEL;

/** Unit costs in GBP. */
export const UNIT_COST_GBP = {
  /** Twilio UK outbound SMS per segment, $0.056 (economics.md A1). */
  smsOutboundSegment: usd(0.056),
  /** Twilio UK inbound SMS per message, $0.0075 (A1). */
  smsInbound: usd(0.0075),
  /** Twilio UK mobile number per month, $2.50 (A1). */
  numberRentalMonth: usd(2.5),
  /** Twilio's own WhatsApp fee per message, sent OR received, $0.005 (A2). */
  whatsappTwilioFee: usd(0.005),
  /** Meta UK marketing template, $0.0635 (A4, A5; rate card 2026-07-01). */
  whatsappMetaMarketing: usd(0.0635),
  /** Meta UK utility template (outside the window), $0.0220 (A4, A5). */
  whatsappMetaUtility: usd(0.022),
  /** Meta service (free-form in the 24h window): $0 until 2026-09-30, the utility rate from 2026-10-01 (A3b). */
  whatsappMetaServiceFromOct2026: usd(0.022),
  /**
   * Azure OpenAI tokens, per 1M, at the economics.md blend: mini, uncached,
   * 80% input ($0.75) / 20% output ($4.50) = $1.50 per 1M (A6, A7).
   */
  aiPerMillionTokens: usd(0.8 * 0.75 + 0.2 * 4.5),
  /** The absolute AI bound: every token billed as mini output, $4.50 per 1M. */
  aiPerMillionTokensAbsolute: usd(4.5),
  /** Resend at Pro volume, $0.0004 per email (A8). */
  resendEmail: usd(0.0004),
  /** Google Places Text Search Enterprise SKU, $35 per 1,000 requests (A9, A10). */
  placesTextSearchRequest: usd(0.035),
  /** Email through the customer's own mailbox (Gmail API, Graph, SMTP). */
  customerMailboxEmail: 0,
} as const;

/** Model assumptions (economics.md §1.1). Change them here, with the doc. */
export const MODEL_ASSUMPTIONS = {
  /** Inbound SMS as a share of outbound segments (replies). */
  inboundSmsPerOutboundSegment: 0.5,
  /** Inbound WhatsApp as a share of outbound messages. */
  inboundWhatsappPerOutbound: 0.5,
  /** AI tokens may overdraw the allowance by 10% (`ai/tokens.ts` OVERDRAW_CEILING_RATIO). */
  aiOverdrawRatio: 1.1,
  /** System emails per lead (owner alert, booking confirmation, reminder) plus 100 others a month. */
  systemEmailsPerLead: 3,
  systemEmailsFixedPerMonth: 100,
  /** Companies searched per verified prospect (`FUNNEL_MULTIPLIER.COMPANY_SEARCH`) and results per request. */
  placesCompaniesPerProspect: 9,
  placesResultsPerRequest: 20,
  /** Supabase Pro + Vercel Pro + Resend Pro + one number = £50.96/month, allocated at ~25 customers. */
  infrastructurePerCustomerMonth: 2,
  /** Stripe at MAX: premium/commercial UK card 2.8% + Billing 0.7%, on the VAT-inclusive amount, + 20p. */
  stripePercentMax: 0.028 + 0.007,
  /** Stripe TYPICAL: standard UK card 1.5% + Billing 0.7%. */
  stripePercentTypical: 0.015 + 0.007,
  stripeFixedGbp: 0.2,
  vatMultiplier: 1.2,
  /** Typical = 50% of every allowance. */
  typicalUsageShare: 0.5,
  /** Typical AI tokens are priced at the agent_decision envelope mix, $1.09 per 1M. */
  aiTypicalPerMillionTokens: usd(1.09),
} as const;

/** The owner's rule: at least 75% gross margin, at maximum usage, every plan and interval. */
export const MIN_GROSS_MARGIN = 0.75;

/**
 * Verified-prospect hard limits per plan, as seeded in `plan_entitlements`
 * (0038, revised in 0138). The pricing page shows the soft limits
 * (`sourcing-allowances.ts`); the cost model uses what the server enforces.
 */
export const VERIFIED_PROSPECT_HARD_LIMIT = {
  trial: 0,
  starter: 100,
  growth: 500,
  pro: 1000,
  enterprise: 10000,
} as const;

/* ---------------------------------------------------------------- per unit */

/** All-in cost of one outbound SMS segment, including its share of inbound replies. */
export function smsSegmentAllInCost(): number {
  return (
    UNIT_COST_GBP.smsOutboundSegment +
    MODEL_ASSUMPTIONS.inboundSmsPerOutboundSegment * UNIT_COST_GBP.smsInbound
  );
}

export type WhatsappCategory = "MARKETING" | "UTILITY" | "SERVICE";

/**
 * All-in cost of one outbound WhatsApp message of a category, after the
 * 1 October 2026 service charge, including Twilio's fee both ways and the
 * inbound share.
 */
export function whatsappAllInCost(category: WhatsappCategory): number {
  const meta =
    category === "MARKETING"
      ? UNIT_COST_GBP.whatsappMetaMarketing
      : category === "UTILITY"
        ? UNIT_COST_GBP.whatsappMetaUtility
        : UNIT_COST_GBP.whatsappMetaServiceFromOct2026;
  return (
    meta +
    UNIT_COST_GBP.whatsappTwilioFee +
    MODEL_ASSUMPTIONS.inboundWhatsappPerOutbound * UNIT_COST_GBP.whatsappTwilioFee
  );
}

/**
 * Margin on a unit sold as overage: added to the subscription invoice, so
 * Stripe takes its percentage (on the VAT-inclusive amount) but no extra 20p.
 */
export function overageMargin(pricePence: number, unitCostGbp: number): number {
  const price = pricePence / 100;
  const stripe = price * MODEL_ASSUMPTIONS.vatMultiplier * MODEL_ASSUMPTIONS.stripePercentMax;
  return (price - unitCostGbp - stripe) / price;
}

/** Margin on a one-off credit bundle: its own Checkout, so Stripe's 20p applies too. */
export function bundleMargin(priceGbp: number, units: number, unitCostGbp: number): number {
  const stripe =
    priceGbp * MODEL_ASSUMPTIONS.vatMultiplier * MODEL_ASSUMPTIONS.stripePercentMax + MODEL_ASSUMPTIONS.stripeFixedGbp;
  return (priceGbp - units * unitCostGbp - stripe) / priceGbp;
}

/* ------------------------------------------------------ WhatsApp tokens */

/**
 * WhatsApp is the one purchase allowed below the 75% rule (owner,
 * 2026-09-27: "we must be competitive with WhatsApp specialists"). Its floor:
 * what ClientTurn keeps per message after Stripe must be at least the all-in
 * cost plus 25%. docs/economics.md §5.4 sets the per-category token prices
 * from the specialist research and this floor.
 */
export const WHATSAPP_MIN_MARKUP_ON_COST = 1.25;

/** Stripe's share of a one-off pack Checkout: 3.5% of the VAT-inclusive charge + 20p. */
export function packStripeShare(priceGbp: number): number {
  const a = MODEL_ASSUMPTIONS;
  return (priceGbp * a.vatMultiplier * a.stripePercentMax + a.stripeFixedGbp) / priceGbp;
}

export type WhatsappMessageEconomics = {
  category: WhatsappBillingCategory;
  tokens: number;
  /** What the customer pays for one message of this category, in GBP. */
  priceGbp: number;
  /** All-in cost (Meta + Twilio both ways + the inbound share), GBP. */
  costGbp: number;
  stripeGbp: number;
  /** After Stripe. */
  margin: number;
  /** Price net of Stripe ÷ cost: must be >= WHATSAPP_MIN_MARKUP_ON_COST. */
  markupOnCost: number;
};

/** One message of a category bought through a pack, priced and costed. */
export function whatsappMessageEconomics(
  pack: { tokens: number; priceGbp: number },
  category: WhatsappBillingCategory,
): WhatsappMessageEconomics {
  const tokens = whatsappTokensFor(category);
  const priceGbp = (pack.priceGbp / pack.tokens) * tokens;
  // Authentication is priced by Meta at the utility rate.
  const costGbp = whatsappAllInCost(category === "AUTHENTICATION" ? "UTILITY" : category);
  const stripeGbp = priceGbp * packStripeShare(pack.priceGbp);
  return {
    category,
    tokens,
    priceGbp,
    costGbp,
    stripeGbp,
    margin: (priceGbp - costGbp - stripeGbp) / priceGbp,
    markupOnCost: (priceGbp - stripeGbp) / costGbp,
  };
}

/* ---------------------------------------------------------------- per plan */

export type PlanCostInput = {
  monthlyPrice: number;
  /** Annual price as billed (monthly × 12 × 0.85, rounded), or null for monthly only. */
  yearlyPrice: number | null;
  leadLimit: number;
  smsSegmentAllowance: number;
  whatsappMessageAllowance: number;
  aiTokenAllowance: number;
  verifiedProspects: number;
};

export type PlanCostLine = {
  ai: number;
  smsOut: number;
  smsIn: number;
  number: number;
  whatsapp: number;
  resend: number;
  places: number;
  variable: number;
  stripe: number;
  infrastructure: number;
  total: number;
  revenue: number;
  grossProfit: number;
  margin: number;
};

export type Interval = "monthly" | "annual";
export type Usage = "max" | "typical";

/**
 * One plan's monthly cost at maximum (every allowance used to 100%) or typical
 * (50%) usage, on the economics.md §1.1 method. WhatsApp is priced at the
 * marketing rate, the worst case.
 */
export function planCost(plan: PlanCostInput, interval: Interval, usage: Usage): PlanCostLine {
  const a = MODEL_ASSUMPTIONS;
  const share = usage === "max" ? 1 : a.typicalUsageShare;
  const ai =
    usage === "max"
      ? (plan.aiTokenAllowance / 1e6) * a.aiOverdrawRatio * UNIT_COST_GBP.aiPerMillionTokens
      : (plan.aiTokenAllowance / 1e6) * share * a.aiTypicalPerMillionTokens;
  const smsOut = plan.smsSegmentAllowance * share * UNIT_COST_GBP.smsOutboundSegment;
  const smsIn =
    plan.smsSegmentAllowance * share * a.inboundSmsPerOutboundSegment * (usage === "max" ? 1 : 0.5) *
    UNIT_COST_GBP.smsInbound;
  const number = usage === "max" ? UNIT_COST_GBP.numberRentalMonth : 0;
  const whatsapp = plan.whatsappMessageAllowance * share * whatsappAllInCost("MARKETING");
  const resend =
    (plan.leadLimit * a.systemEmailsPerLead + a.systemEmailsFixedPerMonth) * share * UNIT_COST_GBP.resendEmail;
  const places =
    Math.ceil((plan.verifiedProspects * share * a.placesCompaniesPerProspect) / a.placesResultsPerRequest) *
    UNIT_COST_GBP.placesTextSearchRequest;
  const variable = ai + smsOut + smsIn + number + whatsapp + resend + places;

  const annual = interval === "annual";
  if (annual && plan.yearlyPrice === null) throw new Error("This plan has no annual price.");
  const revenue = annual ? (plan.yearlyPrice as number) / 12 : plan.monthlyPrice;
  const billed = annual ? (plan.yearlyPrice as number) : plan.monthlyPrice;
  const percent = usage === "max" ? a.stripePercentMax : a.stripePercentTypical;
  const stripeOnCharge = billed * a.vatMultiplier * percent + a.stripeFixedGbp;
  const stripe = annual ? stripeOnCharge / 12 : stripeOnCharge;

  const infrastructure = a.infrastructurePerCustomerMonth;
  const total = variable + stripe + infrastructure;
  const grossProfit = revenue - total;
  return {
    ai,
    smsOut,
    smsIn,
    number,
    whatsapp,
    resend,
    places,
    variable,
    stripe,
    infrastructure,
    total,
    revenue,
    grossProfit,
    margin: grossProfit / revenue,
  };
}

/* ---------------------------------------------------------------- trial */

export type TrialCostInput = {
  days: number;
  leadLimit: number;
  smsSegmentAllowance: number;
  aiTokenAllowance: number;
  /** The trial's AI £ ceiling (`ai_budgets` PLAN, trial), in pence. */
  aiCeilingPence: number;
  /** Daily cap on system email (Resend) for a trial workspace. */
  systemEmailDailyCap: number;
};

/**
 * Worst-case MARGINAL cost of one trial: what ClientTurn actually spends.
 * Number rental and the infrastructure allocation are not per-trial spends
 * (one shared platform number; fixed stack) and are shown separately in
 * economics.md §2. Inbound SMS is assumed one reply per outbound segment --
 * inbound cannot be capped, so this is an assumption, not a bound.
 */
export function trialWorstCase(trial: TrialCostInput) {
  const smsOut = trial.smsSegmentAllowance * UNIT_COST_GBP.smsOutboundSegment;
  const smsIn = trial.smsSegmentAllowance * UNIT_COST_GBP.smsInbound;
  const aiModel =
    (trial.aiTokenAllowance / 1e6) * MODEL_ASSUMPTIONS.aiOverdrawRatio * UNIT_COST_GBP.aiPerMillionTokens;
  const ai = Math.min(aiModel, trial.aiCeilingPence / 100);
  // The daily system-email cap is the hard bound, so the worst case is the
  // cap on every day of the trial, not the expected 3 per lead.
  const resendEmails = trial.systemEmailDailyCap * trial.days;
  const resend = resendEmails * UNIT_COST_GBP.resendEmail;
  const total = smsOut + smsIn + ai + resend;
  return { smsOut, smsIn, ai, aiModel, resend, resendEmails, total };
}

/* ------------------------------------------------------ for measured usage */
/*
 * Additive exports for the admin Economics dashboard, which prices ACTUAL
 * recorded usage rather than allowances. Nothing above reads them, so the plan
 * model (and `tests/plan-margins.test.ts`) is unchanged by their presence.
 */

/** The date every provider price in this file was checked (economics.md Appendix). */
export const UNIT_COSTS_CHECKED_ON = "2026-09-27";

/**
 * Azure OpenAI per-model token rates, GBP per 1M (economics.md U10, U11; A6,
 * A7): the ledger records tokens by model and kind, so actual usage is priced
 * per model rather than at the §1.1 blend.
 */
export const AI_TOKEN_RATE_GBP_PER_MILLION = {
  /** gpt-5.4-mini: $0.75 input / $0.075 cached / $4.50 output (U10). */
  mini: { input: usd(0.75), cached: usd(0.075), output: usd(4.5) },
  /** gpt-5.4-nano: $0.20 input / $0.02 cached / $1.25 output (U11). */
  nano: { input: usd(0.2), cached: usd(0.02), output: usd(1.25) },
} as const;

/** Meta charges in-window service messages from this UTC date (A3b); free before it. */
export const WHATSAPP_SERVICE_CHARGED_FROM = "2026-10-01";

/** Each unit cost with the source it was checked against, for display. */
export const UNIT_COST_SOURCES: readonly { key: string; label: string; gbp: number; unit: string; source: string }[] = [
  { key: "smsOutboundSegment", label: "Twilio UK SMS out", gbp: UNIT_COST_GBP.smsOutboundSegment, unit: "segment", source: "Twilio UK SMS pricing, $0.056 (U1, A1)" },
  { key: "smsInbound", label: "Twilio UK SMS in", gbp: UNIT_COST_GBP.smsInbound, unit: "message", source: "Twilio UK SMS pricing, $0.0075 (U2, A1)" },
  { key: "numberRentalMonth", label: "Twilio UK mobile number", gbp: UNIT_COST_GBP.numberRentalMonth, unit: "month", source: "Twilio UK SMS pricing, $2.50 (U3, A1)" },
  { key: "whatsappTwilioFee", label: "Twilio WhatsApp fee", gbp: UNIT_COST_GBP.whatsappTwilioFee, unit: "message, sent or received", source: "Twilio WhatsApp pricing, $0.005 (U5, A2)" },
  { key: "whatsappMetaMarketing", label: "Meta WhatsApp marketing", gbp: UNIT_COST_GBP.whatsappMetaMarketing, unit: "message", source: "Meta UK rate card 2026-07-01, $0.0635 (U6, A4, A5)" },
  { key: "whatsappMetaUtility", label: "Meta WhatsApp utility / authentication", gbp: UNIT_COST_GBP.whatsappMetaUtility, unit: "message", source: "Meta UK rate card 2026-07-01, $0.022 (U7, U8, A4, A5)" },
  { key: "whatsappMetaServiceFromOct2026", label: "Meta WhatsApp service (from 2026-10-01)", gbp: UNIT_COST_GBP.whatsappMetaServiceFromOct2026, unit: "message", source: "Meta non-template pricing, utility rate from 2026-10-01; free before (U9, A3b)" },
  { key: "aiMiniInput", label: "Azure gpt-5.4-mini input", gbp: AI_TOKEN_RATE_GBP_PER_MILLION.mini.input, unit: "1M tokens", source: "OpenAI list price $0.75; Azure secondary (U10, A6, A7)" },
  { key: "aiMiniCached", label: "Azure gpt-5.4-mini cached input", gbp: AI_TOKEN_RATE_GBP_PER_MILLION.mini.cached, unit: "1M tokens", source: "$0.075 (U10, A6, A7)" },
  { key: "aiMiniOutput", label: "Azure gpt-5.4-mini output", gbp: AI_TOKEN_RATE_GBP_PER_MILLION.mini.output, unit: "1M tokens", source: "$4.50 (U10, A6, A7)" },
  { key: "aiNanoInput", label: "Azure gpt-5.4-nano input", gbp: AI_TOKEN_RATE_GBP_PER_MILLION.nano.input, unit: "1M tokens", source: "$0.20 (U11, A6, A7)" },
  { key: "aiNanoCached", label: "Azure gpt-5.4-nano cached input", gbp: AI_TOKEN_RATE_GBP_PER_MILLION.nano.cached, unit: "1M tokens", source: "$0.02 (U11, A6, A7)" },
  { key: "aiNanoOutput", label: "Azure gpt-5.4-nano output", gbp: AI_TOKEN_RATE_GBP_PER_MILLION.nano.output, unit: "1M tokens", source: "$1.25 (U11, A6, A7)" },
  { key: "resendEmail", label: "Resend system email", gbp: UNIT_COST_GBP.resendEmail, unit: "email", source: "Resend Pro volume, $0.0004 (U12, A8)" },
  { key: "placesTextSearchRequest", label: "Google Places Text Search", gbp: UNIT_COST_GBP.placesTextSearchRequest, unit: "request (up to 20 results)", source: "Text Search Enterprise SKU, $35 per 1,000 (U14, A9, A10)" },
  { key: "infrastructurePerCustomerMonth", label: "Infrastructure allocation", gbp: MODEL_ASSUMPTIONS.infrastructurePerCustomerMonth, unit: "paying customer / month", source: "ASSUMPTION: £50.96 fixed stack ÷ ~25 customers (§1.1)" },
  { key: "stripe", label: "Stripe fee (premium card + Billing)", gbp: MODEL_ASSUMPTIONS.stripePercentMax, unit: "share of VAT-inclusive charge, + 20p", source: "Stripe UK 2.8% + 0.7% Billing + 20p (U17, U18, A12)" },
];

/* ------------------------------------------------------------------ voice */
/*
 * Voice (OD-2) cost and margin model. Source:
 * docs/revenue-engine/12-voice-provider-research.md §3 to §8. Additive:
 * nothing above reads these, so the plan model is unchanged.
 *
 * COGS is the blended Stack A cost per connected minute (telephony, speech to
 * text, LLM, text to speech, orchestration): £0.0821 base, and the research
 * doc's combined FX + provider stress of x1.21 (£0.0994). A dedicated UK
 * number costs £1.887/month base, £2.283 stressed.
 *
 * STRIPE MODEL FOR VOICE (deliberate): the voice 75% assertions use a
 * STANDARD UK card. One-off pack Checkout: 1.5% of the VAT-inclusive amount
 * + 20p. Subscription item: 1.5% + 0.7% Billing on the VAT-inclusive amount,
 * with no extra 20p when it is a line on the existing subscription invoice.
 * That is the research doc §8 method, made stricter by applying the
 * percentage to the VAT-inclusive charge (the doc applied it to the ex-VAT
 * price). On that model every pack, the £100 Pro item and the £11.99 number
 * clear 75% under stress.
 *
 * On the repo's MAX model (premium/commercial card 2.8% + Billing 0.7% on the
 * VAT-inclusive amount, + 20p; `MODEL_ASSUMPTIONS.stripePercentMax`) the
 * 250/500/1000 packs and the £100 item fall just BELOW 75% under stress.
 * `voiceMarginReport()` reports both models so the gap stays visible. Prices
 * are unchanged (owner decision OD-2).
 */

/** The research doc's combined FX + provider stress multiplier. */
export const VOICE_STRESS_FACTOR = 1.21;

/** Blended Stack A COGS per connected minute, GBP. */
export const VOICE_COGS_GBP_PER_MIN = {
  base: 0.0821,
  stress: 0.0821 * VOICE_STRESS_FACTOR,
} as const;

/** A dedicated UK voice number, GBP per month. */
export const VOICE_NUMBER_COST_GBP_MONTH = {
  base: 1.887,
  stress: 1.887 * VOICE_STRESS_FACTOR,
} as const;

export type VoiceScenario = "base" | "stress";
/** "standard": UK consumer card 1.5%. "premium": premium/commercial card 2.8% (the repo's MAX model). */
export type VoiceCardModel = "standard" | "premium";
/**
 * How a charge reaches Stripe:
 *  - one_off:      a one-off Checkout payment (a minute pack): card % + 20p;
 *  - own_payment:  a recurring item charged on its own: card % + Billing 0.7% + 20p;
 *  - invoice_line: a line on the existing subscription invoice: card % + Billing 0.7%, no extra 20p.
 */
export type VoiceChargeMode = "one_off" | "own_payment" | "invoice_line";

export const VOICE_STRIPE_CARD_PERCENT: Readonly<Record<VoiceCardModel, number>> = {
  standard: 0.015,
  premium: 0.028,
};
export const STRIPE_BILLING_PERCENT = 0.007;

/** Stripe's fee on a voice charge, GBP. Percentages apply to the VAT-inclusive amount. */
export function voiceStripeFeeGbp(priceGbp: number, mode: VoiceChargeMode, card: VoiceCardModel = "standard"): number {
  const a = MODEL_ASSUMPTIONS;
  const percent = VOICE_STRIPE_CARD_PERCENT[card] + (mode === "one_off" ? 0 : STRIPE_BILLING_PERCENT);
  const fixed = mode === "invoice_line" ? 0 : a.stripeFixedGbp;
  return priceGbp * a.vatMultiplier * percent + fixed;
}

export type VoiceMargin = {
  priceGbp: number;
  cogsGbp: number;
  stripeGbp: number;
  grossProfitGbp: number;
  margin: number;
};

function voiceMargin(priceGbp: number, cogsGbp: number, stripeGbp: number): VoiceMargin {
  const grossProfitGbp = priceGbp - cogsGbp - stripeGbp;
  return { priceGbp, cogsGbp, stripeGbp, grossProfitGbp, margin: grossProfitGbp / priceGbp };
}

/** Cost of a call billed to the second, GBP. For the voice cost ledger. */
export function voiceCallCostGbp(seconds: number, scenario: VoiceScenario = "base"): number {
  return (Math.max(0, seconds) / 60) * VOICE_COGS_GBP_PER_MIN[scenario];
}

/** Cost per connected minute, GBP. */
export function voiceCostPerMinuteGbp(scenario: VoiceScenario = "base"): number {
  return VOICE_COGS_GBP_PER_MIN[scenario];
}

/** A minute pack, worst case every minute used, sold as a one-off Checkout payment. */
export function voicePackMargin(
  pack: { minutes: number; priceGbp: number },
  scenario: VoiceScenario,
  card: VoiceCardModel = "standard",
): VoiceMargin {
  return voiceMargin(
    pack.priceGbp,
    pack.minutes * VOICE_COGS_GBP_PER_MIN[scenario],
    voiceStripeFeeGbp(pack.priceGbp, "one_off", card),
  );
}

/**
 * The Pro voice item: every included minute used plus the dedicated number,
 * billed as a line on the Pro subscription invoice (no extra 20p). Monthly
 * only: the item carries no annual discount.
 */
export function voiceAddonMargin(
  scenario: VoiceScenario,
  card: VoiceCardModel = "standard",
  addon: { monthlyPriceGbp: number; includedMinutes: number; includesNumber: boolean } = VOICE_ADDON,
): VoiceMargin {
  const cogs =
    addon.includedMinutes * VOICE_COGS_GBP_PER_MIN[scenario] +
    (addon.includesNumber ? VOICE_NUMBER_COST_GBP_MONTH[scenario] : 0);
  return voiceMargin(addon.monthlyPriceGbp, cogs, voiceStripeFeeGbp(addon.monthlyPriceGbp, "invoice_line", card));
}

/** The dedicated-number item at a price, charged on its own or as an invoice line. */
export function voiceNumberMargin(
  priceGbp: number = VOICE_NUMBER_MONTHLY_GBP,
  scenario: VoiceScenario = "stress",
  mode: Exclude<VoiceChargeMode, "one_off"> = "own_payment",
  card: VoiceCardModel = "standard",
): VoiceMargin {
  return voiceMargin(priceGbp, VOICE_NUMBER_COST_GBP_MONTH[scenario], voiceStripeFeeGbp(priceGbp, mode, card));
}

export type VoiceMarginRow = {
  item: string;
  priceGbp: number;
  mode: VoiceChargeMode;
  standard: Record<VoiceScenario, number>;
  premium: Record<VoiceScenario, number>;
};

/**
 * Every voice price at base and stress, on the standard-card model (the one
 * the 75% rule is asserted on) AND the premium-card MAX model, so the premium
 * gap is visible to the owner. Platform-confidential.
 */
export function voiceMarginReport(): VoiceMarginRow[] {
  const both = (fn: (scenario: VoiceScenario, card: VoiceCardModel) => VoiceMargin) => ({
    standard: { base: fn("base", "standard").margin, stress: fn("stress", "standard").margin },
    premium: { base: fn("base", "premium").margin, stress: fn("stress", "premium").margin },
  });
  return [
    ...VOICE_MINUTE_PACKS.map((pack) => ({
      item: `${pack.minutes} minute pack`,
      priceGbp: pack.priceGbp,
      mode: "one_off" as const,
      ...both((scenario, card) => voicePackMargin(pack, scenario, card)),
    })),
    {
      item: "Pro voice item",
      priceGbp: VOICE_ADDON.monthlyPriceGbp,
      mode: "invoice_line" as const,
      ...both((scenario, card) => voiceAddonMargin(scenario, card)),
    },
    {
      item: "Dedicated number (own payment)",
      priceGbp: VOICE_NUMBER_MONTHLY_GBP,
      mode: "own_payment" as const,
      ...both((scenario, card) => voiceNumberMargin(VOICE_NUMBER_MONTHLY_GBP, scenario, "own_payment", card)),
    },
    {
      item: "Dedicated number (invoice line)",
      priceGbp: VOICE_NUMBER_MONTHLY_GBP,
      mode: "invoice_line" as const,
      ...both((scenario, card) => voiceNumberMargin(VOICE_NUMBER_MONTHLY_GBP, scenario, "invoice_line", card)),
    },
  ];
}
