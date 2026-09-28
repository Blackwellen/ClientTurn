/**
 * "AI SDR vs hiring an SDR": the pure model behind /sdr-cost-calculator.
 *
 * Everything the page shows is computed here from the visitor's inputs and
 * the plan catalogue. No price, allowance or pack size is written into this
 * file: they are read from `billing/plans.ts`, `billing/sourcing-allowances.ts`
 * and `billing/whatsapp-tokens.ts`, so the calculator cannot advertise a
 * number checkout does not charge.
 *
 * UK employment figures are for the 2026/27 tax year, checked on 2026-09-28:
 *  - Employer (secondary) Class 1 NI 15% above the secondary threshold of
 *    £5,000 a year. gov.uk "Rates and thresholds for employers 2026 to 2027"
 *    (page updated 1 September 2026).
 *  - Auto-enrolment: minimum employer contribution 3% of qualifying earnings
 *    between £6,240 and £50,270, for workers earning more than the £10,000
 *    trigger. gov.uk "Workplace pensions: what you, your employer and the
 *    government pay"; The Pensions Regulator "Earnings thresholds" (2026/27
 *    thresholds held at 2025/26 levels).
 *  - Holiday: 28 days statutory for a 5-day week, which may include bank
 *    holidays. gov.uk "Holiday entitlement".
 *  - Sickness: ONS "Sickness absence in the UK labour market: 2022" (published
 *    26 April 2023): 5.7 days lost per worker. The default rounds it to 6.
 *
 * Voice attempt model: docs/economics.md §13.4 (45% of attempts answered, 20%
 * reach voicemail at about 0.5 minute, the rest ring out at zero billed
 * seconds) and §13.6 (one workspace: 2 concurrent calls, 11 calling hours).
 *
 * Pure: no React, no `server-only`, relative imports with `.ts`, so the page
 * and `tests/sdr-calculator.test.ts` run the same code.
 */

import { z } from "zod";
import {
  PLANS,
  SMS_CREDIT_BUNDLES,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  type VoicePackKey,
} from "../billing/plans.ts";
import { SOURCING_ALLOWANCES } from "../billing/sourcing-allowances.ts";
import { WHATSAPP_TOKEN_PACKS, WHATSAPP_TOKENS_PER_MESSAGE } from "../billing/whatsapp-tokens.ts";

/* ----------------------------------------------------------- UK figures --- */

export const TAX_YEAR = "2026/27";
export const FIGURES_CHECKED_ON = "2026-09-28";

export const EMPLOYER_NI = {
  rate: 0.15,
  secondaryThresholdAnnual: 5_000,
  source: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
} as const;

export const AUTO_ENROLMENT = {
  employerMinimumRate: 0.03,
  earningsTrigger: 10_000,
  qualifyingLower: 6_240,
  qualifyingUpper: 50_270,
  source: "https://www.gov.uk/workplace-pensions/what-you-your-employer-and-the-government-pay",
  thresholdsSource:
    "https://www.thepensionsregulator.gov.uk/en/employers/new-employers/im-an-employer-who-has-to-provide-a-pension/declare-your-compliance/ongoing-duties-for-employers/earnings-thresholds",
} as const;

export const STATUTORY_HOLIDAY_DAYS = 28;
export const HOLIDAY_SOURCE = "https://www.gov.uk/holiday-entitlement-rights";

export const ONS_SICK_DAYS_2022 = 5.7;
export const SICKNESS_SOURCE =
  "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/labourproductivity/articles/sicknessabsenceinthelabourmarket/2022";

/** 52 weeks of 5 days. Holiday and sickness come off this. */
export const WORKING_DAYS_PER_YEAR = 260;

/* -------------------------------------------------------- voice model --- */

/** docs/economics.md §13.4. Assumptions, not measurements. */
export const VOICE_ATTEMPT_MODEL = {
  answeredShare: 0.45,
  voicemailShare: 0.2,
  voicemailMinutes: 0.5,
} as const;

/**
 * Billed minutes per unanswered attempt, averaged over voicemails (0.5 min)
 * and ring-outs (0 min): 0.2 x 0.5 / 0.55 = 0.18.
 */
export const DEFAULT_UNANSWERED_ATTEMPT_MINUTES =
  Math.round(
    ((VOICE_ATTEMPT_MODEL.voicemailShare * VOICE_ATTEMPT_MODEL.voicemailMinutes) /
      (1 - VOICE_ATTEMPT_MODEL.answeredShare)) *
      100,
  ) / 100;

/** docs/economics.md §13.6: 2 concurrent calls x 11 calling hours x 60, per weekday. */
export const WORKSPACE_VOICE_MINUTES_PER_WEEKDAY = 2 * 11 * 60;
export const WORKSPACE_VOICE_MINUTES_PER_MONTH = Math.round(
  (WORKSPACE_VOICE_MINUTES_PER_WEEKDAY * WORKING_DAYS_PER_YEAR) / 12,
);

/* -------------------------------------------------------------- plans --- */

export type CalcPlanKey = "starter" | "growth" | "pro_voice" | "pro" | "enterprise";

export const CALC_PLAN_KEYS: readonly CalcPlanKey[] = [
  "starter",
  "growth",
  "pro_voice",
  "pro",
  "enterprise",
];

type CatalogueId = "starter" | "growth" | "pro" | "enterprise";

function catalogueId(plan: CalcPlanKey): CatalogueId {
  return plan === "pro_voice" ? "pro" : plan;
}

export function planLabel(plan: CalcPlanKey): string {
  if (plan === "pro_voice") return `${PLANS.pro.name} with Voice`;
  if (plan === "pro") return `${PLANS.pro.name} without Voice`;
  return PLANS[plan].name;
}

/** Monthly platform price, or null for Enterprise (contact sales). */
export function planMonthlyPrice(plan: CalcPlanKey): number | null {
  const base = PLANS[catalogueId(plan)].monthlyPrice;
  if (base === null) return null;
  return plan === "pro_voice" ? base + VOICE_ADDON.monthlyPriceGbp : base;
}

export type PlanAllowanceSummary = {
  plan: CalcPlanKey;
  label: string;
  monthlyPrice: number | null;
  emailSends: number;
  leadsProcessed: number;
  verifiedProspects: number;
  smsSegments: number;
  includedVoiceMinutes: number;
  includesNumber: boolean;
  whatsappEnabled: boolean;
};

export function planAllowances(plan: CalcPlanKey): PlanAllowanceSummary {
  const id = catalogueId(plan);
  const definition = PLANS[id];
  const sourcing = SOURCING_ALLOWANCES[id];
  const voice = plan === "pro_voice";
  return {
    plan,
    label: planLabel(plan),
    monthlyPrice: planMonthlyPrice(plan),
    emailSends: sourcing.emailSends,
    leadsProcessed: definition.leadLimit,
    verifiedProspects: sourcing.verifiedProspects,
    smsSegments: definition.smsSegmentAllowance,
    includedVoiceMinutes: voice ? VOICE_ADDON.includedMinutes : 0,
    includesNumber: voice && VOICE_ADDON.includesNumber,
    whatsappEnabled: definition.whatsappEnabled,
  };
}

/* ------------------------------------------------------------- inputs --- */

export const VOICE_PACK_KEYS = VOICE_MINUTE_PACKS.map((pack) => pack.key) as VoicePackKey[];
export const WHATSAPP_PACK_TOKENS = WHATSAPP_TOKEN_PACKS.map((pack) => pack.tokens) as number[];

export type VolumeMode = "sdr" | "allowance";

export type CalculatorInputs = {
  /* ClientTurn */
  plan: CalcPlanKey;
  /** Quantity of each voice minute pack bought per month. */
  voicePacks: Record<string, number>;
  /** Quantity of each WhatsApp token pack per month, keyed by tokens. */
  whatsappPacks: Record<string, number>;
  avgCallMinutes: number;
  unansweredAttemptMinutes: number;
  /**
   * "sdr": ClientTurn runs the same volume as the SDR, capped at the plan's
   * allowances (like for like, the default). "allowance": the plan's full
   * monthly allowance is used.
   */
  volume: VolumeMode;

  /* The SDR */
  salary: number;
  employerNi: boolean;
  pension: boolean;
  holidayDays: number;
  sickDays: number;
  recruitmentPct: number;
  rampMonths: number;
  rampOutputPct: number;
  toolDialler: number;
  toolData: number;
  toolSalesNav: number;
  toolCrm: number;
  managementPct: number;
  equipmentMonthly: number;
  callsPerDay: number;
  messagesPerDay: number;
  emailsPerDay: number;
  leadsPerDay: number;

  /* Conversion rates (percent), the same on both sides */
  callConnectPct: number;
  connectToMeetingPct: number;
  emailReplyPct: number;
  emailReplyToMeetingPct: number;
  messageReplyPct: number;
  messageReplyToMeetingPct: number;
  meetingToSalePct: number;
};

export const DEFAULT_INPUTS: CalculatorInputs = {
  plan: "growth",
  voicePacks: {},
  whatsappPacks: {},
  avgCallMinutes: 5,
  unansweredAttemptMinutes: DEFAULT_UNANSWERED_ATTEMPT_MINUTES,
  volume: "sdr",

  salary: 30_000,
  employerNi: true,
  pension: true,
  holidayDays: STATUTORY_HOLIDAY_DAYS,
  sickDays: Math.round(ONS_SICK_DAYS_2022),
  recruitmentPct: 15,
  rampMonths: 3,
  rampOutputPct: 50,
  toolDialler: 50,
  toolData: 75,
  toolSalesNav: 80,
  toolCrm: 45,
  managementPct: 10,
  equipmentMonthly: 150,
  callsPerDay: 60,
  messagesPerDay: 20,
  emailsPerDay: 40,
  leadsPerDay: 25,

  callConnectPct: 10,
  connectToMeetingPct: 15,
  emailReplyPct: 3,
  emailReplyToMeetingPct: 30,
  messageReplyPct: 8,
  messageReplyToMeetingPct: 20,
  meetingToSalePct: 20,
};

/** Input bounds. The UI's sliders and the URL parser share them. */
export const BOUNDS = {
  avgCallMinutes: { min: 0.5, max: 30, step: 0.5 },
  unansweredAttemptMinutes: { min: 0, max: 2, step: 0.01 },
  salary: { min: 0, max: 250_000, step: 500 },
  holidayDays: { min: 0, max: 60, step: 1 },
  sickDays: { min: 0, max: 60, step: 0.5 },
  recruitmentPct: { min: 0, max: 50, step: 1 },
  rampMonths: { min: 0, max: 12, step: 1 },
  rampOutputPct: { min: 0, max: 100, step: 5 },
  toolDialler: { min: 0, max: 2_000, step: 5 },
  toolData: { min: 0, max: 2_000, step: 5 },
  toolSalesNav: { min: 0, max: 2_000, step: 5 },
  toolCrm: { min: 0, max: 2_000, step: 5 },
  managementPct: { min: 0, max: 50, step: 1 },
  equipmentMonthly: { min: 0, max: 5_000, step: 10 },
  callsPerDay: { min: 0, max: 300, step: 5 },
  messagesPerDay: { min: 0, max: 300, step: 5 },
  emailsPerDay: { min: 0, max: 500, step: 5 },
  leadsPerDay: { min: 0, max: 300, step: 5 },
  callConnectPct: { min: 0, max: 100, step: 0.5 },
  connectToMeetingPct: { min: 0, max: 100, step: 0.5 },
  emailReplyPct: { min: 0, max: 100, step: 0.5 },
  emailReplyToMeetingPct: { min: 0, max: 100, step: 0.5 },
  messageReplyPct: { min: 0, max: 100, step: 0.5 },
  messageReplyToMeetingPct: { min: 0, max: 100, step: 0.5 },
  meetingToSalePct: { min: 0, max: 100, step: 0.5 },
} as const satisfies Partial<Record<keyof CalculatorInputs, { min: number; max: number; step: number }>>;

export type NumericKey = keyof typeof BOUNDS;
export const MAX_PACK_QUANTITY = 200;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Clamps every numeric input to its bounds; unknown pack keys are dropped. */
export function normaliseInputs(input: CalculatorInputs): CalculatorInputs {
  const out: CalculatorInputs = { ...input, voicePacks: {}, whatsappPacks: {} };
  for (const key of Object.keys(BOUNDS) as NumericKey[]) {
    const { min, max } = BOUNDS[key];
    out[key] = clampNumber(Number(input[key]), min, max);
  }
  if (!CALC_PLAN_KEYS.includes(out.plan)) out.plan = DEFAULT_INPUTS.plan;
  if (out.volume !== "sdr" && out.volume !== "allowance") out.volume = DEFAULT_INPUTS.volume;
  out.employerNi = Boolean(input.employerNi);
  out.pension = Boolean(input.pension);
  for (const key of VOICE_PACK_KEYS) {
    const qty = Math.floor(clampNumber(Number(input.voicePacks[key] ?? 0), 0, MAX_PACK_QUANTITY));
    if (qty > 0) out.voicePacks[key] = qty;
  }
  for (const tokens of WHATSAPP_PACK_TOKENS) {
    const qty = Math.floor(clampNumber(Number(input.whatsappPacks[String(tokens)] ?? 0), 0, MAX_PACK_QUANTITY));
    if (qty > 0) out.whatsappPacks[String(tokens)] = qty;
  }
  return out;
}

/* ------------------------------------------------------ SDR employment --- */

export function employerNi(salary: number): number {
  return round2(Math.max(0, salary - EMPLOYER_NI.secondaryThresholdAnnual) * EMPLOYER_NI.rate);
}

/** Minimum employer auto-enrolment contribution. 0 at or below the trigger. */
export function employerPension(salary: number): number {
  if (salary <= AUTO_ENROLMENT.earningsTrigger) return 0;
  const qualifying =
    Math.min(salary, AUTO_ENROLMENT.qualifyingUpper) - AUTO_ENROLMENT.qualifyingLower;
  return round2(Math.max(0, qualifying) * AUTO_ENROLMENT.employerMinimumRate);
}

export function productiveDaysPerYear(holidayDays: number, sickDays: number): number {
  return Math.max(0, WORKING_DAYS_PER_YEAR - holidayDays - sickDays);
}

/** Year-one output as a share of a fully ramped year. */
export function rampFactor(rampMonths: number, rampOutputPct: number): number {
  const months = clampNumber(rampMonths, 0, 12);
  const output = clampNumber(rampOutputPct, 0, 100) / 100;
  return (12 - months * (1 - output)) / 12;
}

export type SdrCost = {
  salary: number;
  employerNi: number;
  pension: number;
  recruitment: number;
  tools: number;
  management: number;
  equipment: number;
  annual: number;
  monthly: number;
};

export function sdrCost(input: CalculatorInputs): SdrCost {
  const salary = input.salary;
  const ni = input.employerNi ? employerNi(salary) : 0;
  const pension = input.pension ? employerPension(salary) : 0;
  const recruitment = round2((salary * input.recruitmentPct) / 100);
  const tools = round2(
    (input.toolDialler + input.toolData + input.toolSalesNav + input.toolCrm) * 12,
  );
  const management = round2((salary * input.managementPct) / 100);
  const equipment = round2(input.equipmentMonthly * 12);
  const annual = round2(salary + ni + pension + recruitment + tools + management + equipment);
  return {
    salary,
    employerNi: ni,
    pension,
    recruitment,
    tools,
    management,
    equipment,
    annual,
    monthly: round2(annual / 12),
  };
}

/* ------------------------------------------------------------ activity --- */

export type Activity = {
  calls: number;
  emails: number;
  messages: number;
  leadsSourced: number;
};

export type Outcomes = {
  connects: number;
  conversations: number;
  meetings: number;
  sales: number;
};

export type Rates = Pick<
  CalculatorInputs,
  | "callConnectPct"
  | "connectToMeetingPct"
  | "emailReplyPct"
  | "emailReplyToMeetingPct"
  | "messageReplyPct"
  | "messageReplyToMeetingPct"
  | "meetingToSalePct"
>;

/**
 * Outcomes from activity and the shared rates. `callsAreConnected` is true for
 * ClientTurn: its voice minutes buy connected calls, so the connect rate is not
 * applied a second time.
 */
export function outcomesFor(activity: Activity, rates: Rates, callsAreConnected: boolean): Outcomes {
  const pct = (value: number) => value / 100;
  const connects = callsAreConnected ? activity.calls : activity.calls * pct(rates.callConnectPct);
  const emailReplies = activity.emails * pct(rates.emailReplyPct);
  const messageReplies = activity.messages * pct(rates.messageReplyPct);
  const meetings =
    connects * pct(rates.connectToMeetingPct) +
    emailReplies * pct(rates.emailReplyToMeetingPct) +
    messageReplies * pct(rates.messageReplyToMeetingPct);
  return {
    connects: round1(connects),
    conversations: round1(connects + emailReplies + messageReplies),
    meetings: round1(meetings),
    sales: round1(meetings * pct(rates.meetingToSalePct)),
  };
}

/** A fully ramped SDR's month. */
export function sdrMonthlyActivity(input: CalculatorInputs): Activity & { productiveDays: number } {
  const days = productiveDaysPerYear(input.holidayDays, input.sickDays) / 12;
  return {
    productiveDays: round1(days),
    calls: Math.round(input.callsPerDay * days),
    emails: Math.round(input.emailsPerDay * days),
    messages: Math.round(input.messagesPerDay * days),
    leadsSourced: Math.round(input.leadsPerDay * days),
  };
}

/* ------------------------------------------------------ pack maths ------ */

export type Pack = { key: string; size: number; priceGbp: number };
export type PackCombo = {
  counts: Record<string, number>;
  units: number;
  priceGbp: number;
  packs: number;
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The cheapest combination of packs covering `need` units (minutes, credits).
 * Ties go to the fewest packs, then the fewest spare units. Exact: a bounded
 * dynamic programme over the pack grain. For a large need the bulk is first
 * filled with the best-value pack, which is what any cheapest cover uses once
 * the need is many times the largest pack.
 */
export function cheapestPackCombo(packs: readonly Pack[], need: number): PackCombo {
  const counts: Record<string, number> = {};
  if (!(need > 0) || packs.length === 0) return { counts, units: 0, priceGbp: 0, packs: 0 };

  const grain = packs.map((pack) => pack.size).reduce(gcd);
  const best = [...packs].sort(
    (a, b) => a.priceGbp / a.size - b.priceGbp / b.size || b.size - a.size,
  )[0];
  const largest = Math.max(...packs.map((pack) => pack.size));

  let remaining = Math.ceil(need);
  let prefill = 0;
  const window = 20 * largest;
  if (remaining > window) {
    prefill = Math.floor((remaining - window) / best.size);
    remaining -= prefill * best.size;
  }

  const target = Math.ceil(remaining / grain);
  const limit = target + Math.ceil(largest / grain);
  // pence, packs; Infinity = unreachable
  const cost: number[] = new Array(limit + 1).fill(Infinity);
  const count: number[] = new Array(limit + 1).fill(Infinity);
  const via: number[] = new Array(limit + 1).fill(-1);
  cost[0] = 0;
  count[0] = 0;
  const sized = packs.map((pack) => ({
    units: pack.size / grain,
    pence: Math.round(pack.priceGbp * 100),
  }));
  for (let u = 1; u <= limit; u++) {
    for (let i = 0; i < sized.length; i++) {
      const from = u - sized[i].units;
      if (from < 0 || cost[from] === Infinity) continue;
      const c = cost[from] + sized[i].pence;
      const n = count[from] + 1;
      if (c < cost[u] || (c === cost[u] && n < count[u])) {
        cost[u] = c;
        count[u] = n;
        via[u] = i;
      }
    }
  }
  let pick = -1;
  for (let u = target; u <= limit; u++) {
    if (cost[u] === Infinity) continue;
    if (
      pick === -1 ||
      cost[u] < cost[pick] ||
      (cost[u] === cost[pick] && count[u] < count[pick])
    ) {
      pick = u;
    }
  }

  if (prefill > 0) counts[best.key] = prefill;
  let units = prefill * best.size;
  let pence = prefill * Math.round(best.priceGbp * 100);
  let total = prefill;
  for (let u = pick; u > 0; u -= sized[via[u]].units) {
    const pack = packs[via[u]];
    counts[pack.key] = (counts[pack.key] ?? 0) + 1;
    units += pack.size;
    pence += sized[via[u]].pence;
    total += 1;
  }
  return { counts, units, priceGbp: pence / 100, packs: total };
}

export const VOICE_PACKS_AS_PACKS: readonly Pack[] = VOICE_MINUTE_PACKS.map((pack) => ({
  key: pack.key,
  size: pack.minutes,
  priceGbp: pack.priceGbp,
}));

export const SMS_BUNDLES_AS_PACKS: readonly Pack[] = SMS_CREDIT_BUNDLES.map((bundle) => ({
  key: `sms_${bundle.credits}`,
  size: bundle.credits,
  priceGbp: bundle.priceGbp,
}));

/* ------------------------------------------------------ ClientTurn side --- */

export type ClientTurnSide = {
  allowances: PlanAllowanceSummary;
  enterprise: boolean;
  /** null for Enterprise. */
  monthly: number | null;
  annual: number | null;
  breakdown: {
    plan: number | null;
    voicePacks: number;
    number: number;
    whatsapp: number;
  };
  voiceMinutes: number;
  packMinutes: number;
  callsCovered: number;
  whatsappTokens: number;
  whatsappMessages: number;
  /** Packs chosen on a plan they cannot be used on (WhatsApp before Growth). */
  whatsappBlocked: boolean;
  /** The plan's monthly capacity (calls are connected calls). */
  capacity: Activity;
  /** What the outcomes are computed on: capacity, or the SDR's volume capped at it. */
  activity: Activity;
  outcomes: Outcomes;
  costPerMeeting: number | null;
  costPerSale: number | null;
};

export function clientTurnSide(input: CalculatorInputs): ClientTurnSide {
  const allowances = planAllowances(input.plan);
  const enterprise = allowances.monthlyPrice === null;

  let packMinutes = 0;
  let voicePackCost = 0;
  for (const pack of VOICE_MINUTE_PACKS) {
    const qty = input.voicePacks[pack.key] ?? 0;
    packMinutes += qty * pack.minutes;
    voicePackCost += qty * pack.priceGbp;
  }
  const numberCost = packMinutes > 0 && !allowances.includesNumber ? VOICE_NUMBER_MONTHLY_GBP : 0;

  let whatsappTokens = 0;
  let whatsappCost = 0;
  for (const pack of WHATSAPP_TOKEN_PACKS) {
    const qty = input.whatsappPacks[String(pack.tokens)] ?? 0;
    whatsappTokens += qty * pack.tokens;
    whatsappCost += qty * pack.priceGbp;
  }
  const whatsappBlocked = whatsappTokens > 0 && !allowances.whatsappEnabled;
  if (!allowances.whatsappEnabled) {
    whatsappTokens = 0;
    whatsappCost = 0;
  }
  // Conservative: every WhatsApp message costed as a marketing template.
  const whatsappMessages = Math.floor(whatsappTokens / WHATSAPP_TOKENS_PER_MESSAGE.MARKETING);

  const voiceMinutes = allowances.includedVoiceMinutes + packMinutes;
  const callsCovered = input.avgCallMinutes > 0 ? Math.floor(voiceMinutes / input.avgCallMinutes) : 0;

  const monthly = enterprise
    ? null
    : round2((allowances.monthlyPrice as number) + voicePackCost + numberCost + whatsappCost);

  const capacity: Activity = {
    calls: callsCovered,
    emails: allowances.emailSends,
    messages: allowances.smsSegments + whatsappMessages,
    leadsSourced: allowances.verifiedProspects,
  };
  let activity = capacity;
  if (input.volume === "sdr") {
    const sdr = sdrMonthlyActivity(input);
    const sdrConnects = Math.round((sdr.calls * input.callConnectPct) / 100);
    activity = {
      calls: Math.min(capacity.calls, sdrConnects),
      emails: Math.min(capacity.emails, sdr.emails),
      messages: Math.min(capacity.messages, sdr.messages),
      leadsSourced: Math.min(capacity.leadsSourced, sdr.leadsSourced),
    };
  }
  const outcomes = outcomesFor(activity, input, true);

  return {
    allowances,
    enterprise,
    monthly,
    annual: monthly === null ? null : round2(monthly * 12),
    breakdown: {
      plan: allowances.monthlyPrice,
      voicePacks: round2(voicePackCost),
      number: numberCost,
      whatsapp: round2(whatsappCost),
    },
    voiceMinutes,
    packMinutes,
    callsCovered,
    whatsappTokens,
    whatsappMessages,
    whatsappBlocked,
    capacity,
    activity,
    outcomes,
    costPerMeeting: monthly === null ? null : perUnit(monthly, outcomes.meetings),
    costPerSale: monthly === null ? null : perUnit(monthly, outcomes.sales),
  };
}

/* ------------------------------------------------------------- SDR side --- */

export type SdrSide = {
  cost: SdrCost;
  productiveDays: number;
  rampFactor: number;
  /** Fully ramped month. */
  activity: Activity;
  /** Year-one average month, ramp-up included. */
  outcomes: Outcomes;
  costPerMeeting: number | null;
  costPerSale: number | null;
};

export function sdrSide(input: CalculatorInputs): SdrSide {
  const cost = sdrCost(input);
  const { productiveDays, ...activity } = sdrMonthlyActivity(input);
  const factor = rampFactor(input.rampMonths, input.rampOutputPct);
  const yearOne: Activity = {
    calls: activity.calls * factor,
    emails: activity.emails * factor,
    messages: activity.messages * factor,
    leadsSourced: activity.leadsSourced * factor,
  };
  const outcomes = outcomesFor(yearOne, input, false);
  return {
    cost,
    productiveDays,
    rampFactor: round2(factor),
    activity,
    outcomes,
    costPerMeeting: perUnit(cost.monthly, outcomes.meetings),
    costPerSale: perUnit(cost.monthly, outcomes.sales),
  };
}

/* ---------------------------------------------------- matching the SDR --- */

export type CallMatchMode = "connects" | "dials";

export type CallMatch = {
  mode: CallMatchMode;
  /** Minutes needed per month to cover the SDR's calls. */
  minutesNeeded: number;
  /** Minutes the plan already includes. */
  includedMinutes: number;
  combo: PackCombo;
  /** Resulting minutes (included + packs). */
  minutes: number;
  /** Connected calls those minutes cover at the average call length. */
  callsCovered: number;
  /** Added monthly cost: packs, plus the number where the plan has none. */
  addedMonthly: number;
  /** Above one workspace's default calling capacity: talk to sales. */
  beyondWorkspaceCapacity: boolean;
};

/**
 * The fewest-pound set of voice packs that covers a fully ramped SDR's month:
 * either their connected conversations, or every dial (answered calls at the
 * average length plus unanswered attempts at their short billed length).
 */
export function matchSdrCalls(input: CalculatorInputs, mode: CallMatchMode): CallMatch {
  const allowances = planAllowances(input.plan);
  const dials = sdrMonthlyActivity(input).calls;
  const connects = dials * (input.callConnectPct / 100);
  const minutesNeeded = Math.ceil(
    mode === "connects"
      ? connects * input.avgCallMinutes
      : connects * input.avgCallMinutes + (dials - connects) * input.unansweredAttemptMinutes,
  );
  const shortfall = Math.max(0, minutesNeeded - allowances.includedVoiceMinutes);
  const combo = cheapestPackCombo(VOICE_PACKS_AS_PACKS, shortfall);
  const minutes = allowances.includedVoiceMinutes + combo.units;
  const number = combo.units > 0 && !allowances.includesNumber ? VOICE_NUMBER_MONTHLY_GBP : 0;
  return {
    mode,
    minutesNeeded,
    includedMinutes: allowances.includedVoiceMinutes,
    combo,
    minutes,
    callsCovered: input.avgCallMinutes > 0 ? Math.floor(minutes / input.avgCallMinutes) : 0,
    addedMonthly: round2(combo.priceGbp + number),
    beyondWorkspaceCapacity: minutesNeeded > WORKSPACE_VOICE_MINUTES_PER_MONTH,
  };
}

/* --------------------------------------------------- capacity suggestion --- */

export type CapacitySuggestion = {
  /** The smallest self-serve plan whose email and prospect allowances cover the SDR, or enterprise. */
  plan: CalcPlanKey;
  /** True when the chosen plan already covers email and prospects. */
  currentPlanCovers: boolean;
  shortfalls: { metric: "emails" | "leadsSourced" | "messages" | "calls"; sdr: number; plan: number }[];
  smsTopUp: PackCombo;
  voice: CallMatch;
  enterprise: boolean;
};

/** Past this many top-up SMS a month, a contract is the honest suggestion. */
export const SMS_TOP_UP_CEILING = 10 * Math.max(...SMS_CREDIT_BUNDLES.map((bundle) => bundle.credits));

const SELF_SERVE_LADDER: readonly CatalogueId[] = ["starter", "growth", "pro"];

/**
 * ClientTurn is bounded by plan allowances. When a fully ramped SDR does more
 * than the chosen plan allows, this names the plan or packs that would match,
 * rather than pretending capacity is unlimited.
 */
export function capacitySuggestion(input: CalculatorInputs): CapacitySuggestion {
  const sdr = sdrMonthlyActivity(input);
  const current = clientTurnSide(input);
  const shortfalls: CapacitySuggestion["shortfalls"] = [];
  const check = (metric: CapacitySuggestion["shortfalls"][number]["metric"], need: number, have: number) => {
    if (need > have) shortfalls.push({ metric, sdr: need, plan: have });
  };

  const covers = (id: CatalogueId) =>
    SOURCING_ALLOWANCES[id].emailSends >= sdr.emails &&
    SOURCING_ALLOWANCES[id].verifiedProspects >= sdr.leadsSourced;

  let plan: CalcPlanKey;
  const currentId = catalogueId(input.plan);
  if (current.enterprise) {
    plan = "enterprise";
  } else if (covers(currentId)) {
    plan = input.plan;
  } else {
    const start = SELF_SERVE_LADDER.indexOf(currentId);
    const next = SELF_SERVE_LADDER.slice(start + 1).find(covers);
    plan = next ?? "enterprise";
  }

  if (!current.enterprise) {
    check("emails", sdr.emails, current.capacity.emails);
    check("leadsSourced", sdr.leadsSourced, current.capacity.leadsSourced);
    check("messages", sdr.messages, current.capacity.messages);
  }

  const suggested = { ...input, plan };
  const suggestedSide = clientTurnSide(suggested);
  const smsNeed = Math.max(0, sdr.messages - suggestedSide.capacity.messages);
  const tooMuchSms = smsNeed > SMS_TOP_UP_CEILING;
  const smsTopUp = cheapestPackCombo(
    SMS_BUNDLES_AS_PACKS,
    plan === "enterprise" || tooMuchSms ? 0 : smsNeed,
  );

  const voice = matchSdrCalls(input, "connects");
  if (!current.enterprise) check("calls", Math.round((sdr.calls * input.callConnectPct) / 100), current.callsCovered);

  const enterprise = plan === "enterprise" || voice.beyondWorkspaceCapacity || tooMuchSms;

  return {
    plan: enterprise ? "enterprise" : plan,
    currentPlanCovers: plan === input.plan,
    shortfalls,
    smsTopUp,
    voice,
    enterprise,
  };
}

/* ------------------------------------------------------------ results --- */

export type CalculatorResult = {
  inputs: CalculatorInputs;
  clientTurn: ClientTurnSide;
  sdr: SdrSide;
  /** SDR minus ClientTurn. Negative when ClientTurn costs more. null for Enterprise. */
  savingMonthly: number | null;
  savingAnnual: number | null;
  capacity: CapacitySuggestion;
};

export function calculate(raw: CalculatorInputs): CalculatorResult {
  const inputs = normaliseInputs(raw);
  const clientTurn = clientTurnSide(inputs);
  const sdr = sdrSide(inputs);
  return {
    inputs,
    clientTurn,
    sdr,
    savingMonthly: clientTurn.monthly === null ? null : round2(sdr.cost.monthly - clientTurn.monthly),
    savingAnnual: clientTurn.annual === null ? null : round2(sdr.cost.annual - clientTurn.annual),
    capacity: capacitySuggestion(inputs),
  };
}

/* ------------------------------------------------------------- the URL --- */

/** Short query keys, so a shared link stays readable. */
export const QUERY_KEYS: Record<NumericKey | "plan" | "employerNi" | "pension", string> = {
  plan: "plan",
  avgCallMinutes: "call",
  unansweredAttemptMinutes: "miss",
  salary: "salary",
  employerNi: "ni",
  pension: "pen",
  holidayDays: "hol",
  sickDays: "sick",
  recruitmentPct: "rec",
  rampMonths: "ramp",
  rampOutputPct: "rampout",
  toolDialler: "dial",
  toolData: "data",
  toolSalesNav: "nav",
  toolCrm: "crm",
  managementPct: "mgmt",
  equipmentMonthly: "equip",
  callsPerDay: "calls",
  messagesPerDay: "msgs",
  emailsPerDay: "emails",
  leadsPerDay: "leads",
  callConnectPct: "r_conn",
  connectToMeetingPct: "r_connm",
  emailReplyPct: "r_email",
  emailReplyToMeetingPct: "r_emailm",
  messageReplyPct: "r_msg",
  messageReplyToMeetingPct: "r_msgm",
  meetingToSalePct: "r_sale",
};

const numberParam = z.coerce.number().finite();
const packParam = z
  .string()
  .max(200)
  .regex(/^[a-z0-9_]+:\d{1,4}(,[a-z0-9_]+:\d{1,4})*$/);

function parsePacks(value: string | null): Record<string, number> {
  const parsed = packParam.safeParse(value ?? "");
  if (!parsed.success) return {};
  const out: Record<string, number> = {};
  for (const part of parsed.data.split(",")) {
    const [key, qty] = part.split(":");
    out[key] = Number(qty);
  }
  return out;
}

function formatPacks(packs: Record<string, number>): string {
  return Object.entries(packs)
    .filter(([, qty]) => qty > 0)
    .map(([key, qty]) => `${key}:${qty}`)
    .join(",");
}

/** Reads a query string into inputs. Anything invalid falls back to its default. */
export function inputsFromQuery(search: string | URLSearchParams): CalculatorInputs {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const out: CalculatorInputs = { ...DEFAULT_INPUTS, voicePacks: {}, whatsappPacks: {} };

  if (params.get("vol") === "allowance") out.volume = "allowance";
  const plan = z.enum(["starter", "growth", "pro_voice", "pro", "enterprise"]).safeParse(params.get(QUERY_KEYS.plan));
  if (plan.success) out.plan = plan.data;

  for (const key of Object.keys(BOUNDS) as NumericKey[]) {
    const raw = params.get(QUERY_KEYS[key]);
    if (raw === null || raw === "") continue;
    const parsed = numberParam.safeParse(raw);
    if (parsed.success) out[key] = parsed.data;
  }
  for (const key of ["employerNi", "pension"] as const) {
    const raw = params.get(QUERY_KEYS[key]);
    if (raw === "0") out[key] = false;
    else if (raw === "1") out[key] = true;
  }
  out.voicePacks = parsePacks(params.get("vp"));
  out.whatsappPacks = parsePacks(params.get("wa"));
  return normaliseInputs(out);
}

/** Only values that differ from the defaults are written, so the default link is bare. */
export function inputsToQuery(raw: CalculatorInputs): string {
  const input = normaliseInputs(raw);
  const params = new URLSearchParams();
  if (input.plan !== DEFAULT_INPUTS.plan) params.set(QUERY_KEYS.plan, input.plan);
  if (input.volume !== DEFAULT_INPUTS.volume) params.set("vol", input.volume);
  for (const key of Object.keys(BOUNDS) as NumericKey[]) {
    if (input[key] !== DEFAULT_INPUTS[key]) params.set(QUERY_KEYS[key], String(input[key]));
  }
  for (const key of ["employerNi", "pension"] as const) {
    if (input[key] !== DEFAULT_INPUTS[key]) params.set(QUERY_KEYS[key], input[key] ? "1" : "0");
  }
  const vp = formatPacks(input.voicePacks);
  if (vp) params.set("vp", vp);
  const wa = formatPacks(input.whatsappPacks);
  if (wa) params.set("wa", wa);
  return params.toString();
}

/* ------------------------------------------------------------ formatting --- */

const GBP0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/** Whole pounds from £100 up and for whole amounts; pence below, where they matter. */
export function formatGbp(value: number): string {
  const whole = Math.abs(value) >= 100 || Number.isInteger(value);
  const rounded = whole ? GBP0.format(Math.round(value)) : GBP2.format(value);
  return rounded.replace(/^-£0\.00$|^-£0$/, "£0");
}

export function formatCount(value: number): string {
  return NUM.format(value);
}

/** Plain-text summary for "Copy results". */
export function summaryText(result: CalculatorResult, url?: string): string {
  const { clientTurn: ct, sdr } = result;
  const perMeeting = (value: number | null) => (value === null ? "n/a" : formatGbp(value));
  const lines = [
    "AI SDR vs hiring an SDR (ClientTurn estimate)",
    `SDR, fully loaded year one: ${formatGbp(sdr.cost.monthly)}/month, ${formatGbp(sdr.cost.annual)}/year`,
    ct.monthly === null
      ? `ClientTurn ${ct.allowances.label}: custom pricing, contact sales`
      : `ClientTurn ${ct.allowances.label}: ${formatGbp(ct.monthly)}/month, ${formatGbp(ct.annual as number)}/year`,
  ];
  if (result.savingMonthly !== null && result.savingAnnual !== null) {
    lines.push(
      result.savingMonthly >= 0
        ? `Saving: ${formatGbp(result.savingMonthly)}/month, ${formatGbp(result.savingAnnual)}/year`
        : `ClientTurn costs ${formatGbp(-result.savingMonthly)}/month more on these inputs`,
    );
  }
  lines.push(
    `Meetings a month: SDR ${formatCount(sdr.outcomes.meetings)}, ClientTurn ${formatCount(ct.outcomes.meetings)}`,
    `Cost per meeting: SDR ${perMeeting(sdr.costPerMeeting)}, ClientTurn ${perMeeting(ct.costPerMeeting)}`,
    `Estimates from your inputs; UK tax figures for ${TAX_YEAR}. Not financial advice.`,
  );
  if (url) lines.push(url);
  return lines.join("\n");
}

/* --------------------------------------------------------------- utils --- */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function perUnit(cost: number, units: number): number | null {
  return units > 0 ? round2(cost / units) : null;
}
