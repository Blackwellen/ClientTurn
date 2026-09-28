/**
 * Admin → Economics: the pure model.
 *
 * Prices what each workspace ACTUALLY used (counted by the
 * `admin_economics_usage` RPC, migration 0145) with the unit costs in
 * `billing/unit-costs.ts`, and runs the pricing simulator through the same
 * `planCost()` that `tests/plan-margins.test.ts` asserts. No unit cost and no
 * margin formula is written here a second time: this file only decides WHICH
 * recorded quantity is multiplied by WHICH constant.
 *
 * Pure: no `server-only`, no Supabase, no I/O -- so it can be unit-tested with
 * fixture rows and imported by the (client) simulator. Platform-confidential:
 * raw provider cost is never rendered on a customer surface.
 *
 * Data honesty: a cost line that nothing records returns `value: null`
 * ("not measured"), never 0. Zero means "measured, and nothing was used".
 */

import { ANNUAL_DISCOUNT_PERCENT, PLANS } from "../billing/plans.ts";
import { WHATSAPP_TOKEN_PACKS, type WhatsappBillingCategory } from "../billing/whatsapp-tokens.ts";
import {
  AI_TOKEN_RATE_GBP_PER_MILLION,
  MIN_GROSS_MARGIN,
  WHATSAPP_MIN_MARKUP_ON_COST,
  whatsappMessageEconomics,
  type WhatsappMessageEconomics,
  MODEL_ASSUMPTIONS,
  UNIT_COST_GBP,
  VERIFIED_PROSPECT_HARD_LIMIT,
  planCost,
  type Interval,
  type PlanCostInput,
  type PlanCostLine,
  type Usage,
} from "../billing/unit-costs.ts";

export { MIN_GROSS_MARGIN };

/* ================================================================ inputs */

/** One workspace's recorded usage in a period, as the RPC returns it. */
export type UsageCounts = {
  businessId: string;
  smsOutSegments: number;
  smsOutRows: number;
  smsInSegments: number;
  smsInRows: number;
  aiMiniInput: number;
  aiMiniCached: number;
  aiMiniOutput: number;
  aiNanoInput: number;
  aiNanoCached: number;
  aiNanoOutput: number;
  aiRows: number;
  /** `whatsapp_message` units in the usage ledger (outbound). */
  waOutLedger: number;
  waMarketing: number;
  waUtility: number;
  /** Free-form in-window replies sent before Meta's service charge began. */
  waServiceFree: number;
  waServiceCharged: number;
  waInbound: number;
  resendEmails: number;
  resendRows: number;
  placesRecords: number;
  placesRequests: number;
  otherProviderCostGbp: number;
  leads: number;
  qualifiedLeads: number;
  creditRevenueGbp: number;
  creditCharges: number;
};

export function emptyUsage(businessId: string): UsageCounts {
  return {
    businessId,
    smsOutSegments: 0,
    smsOutRows: 0,
    smsInSegments: 0,
    smsInRows: 0,
    aiMiniInput: 0,
    aiMiniCached: 0,
    aiMiniOutput: 0,
    aiNanoInput: 0,
    aiNanoCached: 0,
    aiNanoOutput: 0,
    aiRows: 0,
    waOutLedger: 0,
    waMarketing: 0,
    waUtility: 0,
    waServiceFree: 0,
    waServiceCharged: 0,
    waInbound: 0,
    resendEmails: 0,
    resendRows: 0,
    placesRecords: 0,
    placesRequests: 0,
    otherProviderCostGbp: 0,
    leads: 0,
    qualifiedLeads: 0,
    creditRevenueGbp: 0,
    creditCharges: 0,
  };
}

/** Maps one RPC row (snake_case, numerics as strings) to `UsageCounts`. */
export function usageFromRpc(row: Record<string, unknown>): UsageCounts {
  const n = (key: string) => {
    const value = Number(row[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    businessId: String(row.business_id),
    smsOutSegments: n("sms_out_segments"),
    smsOutRows: n("sms_out_rows"),
    smsInSegments: n("sms_in_segments"),
    smsInRows: n("sms_in_rows"),
    aiMiniInput: n("ai_mini_input"),
    aiMiniCached: n("ai_mini_cached"),
    aiMiniOutput: n("ai_mini_output"),
    aiNanoInput: n("ai_nano_input"),
    aiNanoCached: n("ai_nano_cached"),
    aiNanoOutput: n("ai_nano_output"),
    aiRows: n("ai_rows"),
    waOutLedger: n("wa_out_ledger"),
    waMarketing: n("wa_marketing"),
    waUtility: n("wa_utility"),
    waServiceFree: n("wa_service_free"),
    waServiceCharged: n("wa_service_charged"),
    waInbound: n("wa_inbound"),
    resendEmails: n("resend_emails"),
    resendRows: n("resend_rows"),
    placesRecords: n("places_records"),
    placesRequests: n("places_requests"),
    otherProviderCostGbp: n("other_provider_cost_gbp"),
    leads: n("leads"),
    qualifiedLeads: n("qualified_leads"),
    creditRevenueGbp: n("credit_revenue_gbp"),
    creditCharges: n("credit_charges"),
  };
}

/** The workspace's subscription mirror row (Stripe is authoritative). */
export type SubscriptionFacts = {
  plan: string;
  status: string;
  billingInterval: string | null;
  createdAt: string | null;
  cancelledAt: string | null;
  trialEndsAt: string | null;
  /**
   * What the subscription is actually billed a month, in pence, from paid
   * Stripe invoices (0165 `subscriptions.mrr_minor`: discounts applied,
   * before VAT). Null or absent: the plan's list price is used instead.
   */
  mrrMinor?: number | null;
};

export type EconomicsPeriod = {
  key: "mtd" | "last";
  label: string;
  /** Inclusive. */
  start: Date;
  /** Exclusive: the first instant of the next month. */
  end: Date;
  /** Where the data stops: `now` for month to date, `end` for a closed month. */
  asOf: Date;
  open: boolean;
};

/** Month to date and the last full month, in UTC. */
export function economicsPeriods(now: Date): { mtd: EconomicsPeriod; last: EconomicsPeriod } {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const lastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const label = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return {
    mtd: { key: "mtd", label: `${label(monthStart)} to date`, start: monthStart, end: nextMonth, asOf: now, open: true },
    last: { key: "last", label: label(lastStart), start: lastStart, end: monthStart, asOf: monthStart, open: false },
  };
}

/** `YYYY-MM`, the key an alert is deduplicated on. */
export function periodKey(period: EconomicsPeriod): string {
  return period.start.toISOString().slice(0, 7);
}

/** Share of the period elapsed, for projecting an open month to month end. */
export function elapsedShare(period: EconomicsPeriod): number {
  if (!period.open) return 1;
  const total = period.end.getTime() - period.start.getTime();
  const done = period.asOf.getTime() - period.start.getTime();
  // At least one hour, so a check at 00:05 on the 1st does not divide by ~0.
  return Math.min(1, Math.max(done, 3_600_000) / total);
}

/* ============================================================ cost lines */

export type CostLineKey =
  | "smsOut"
  | "smsIn"
  | "whatsapp"
  | "ai"
  | "resend"
  | "places"
  | "otherProviders"
  | "numberShare"
  | "stripe"
  | "infrastructure";

export type CostKind = "usage" | "allocation" | "fee";

/** Label, kind and where each line's quantity comes from. Stated once. */
export const COST_LINES: Record<CostLineKey, { label: string; kind: CostKind; source: string }> = {
  smsOut: { label: "SMS out", kind: "usage", source: "usage_events sms_outbound_segment × Twilio segment rate" },
  smsIn: {
    label: "SMS in",
    kind: "usage",
    source: "usage_events sms_inbound_segment × Twilio inbound rate. No code path writes this metric yet, so it is not measured",
  },
  whatsapp: {
    label: "WhatsApp",
    kind: "usage",
    source: "messages by Meta category (template_category; none = service) × Meta rate + Twilio fee both ways",
  },
  ai: { label: "AI tokens", kind: "usage", source: "usage_events ai_{mini,nano}_{input,cached,output}_token × per-model rate" },
  resend: {
    label: "System email (Resend)",
    kind: "usage",
    source: "cost_events provider resend × Resend rate. System email is capped per day but not metered, so it is not measured",
  },
  places: { label: "Google Places", kind: "usage", source: "cost_events google_places records → ⌈records ÷ 20⌉ requests per batch × request rate" },
  otherProviders: { label: "Other providers", kind: "usage", source: "cost_events for any other provider, as booked (USD at the model rate)" },
  numberShare: { label: "Number rental share", kind: "allocation", source: "One shared platform number, split across workspaces that sent SMS" },
  stripe: { label: "Stripe fees", kind: "fee", source: "Estimated at the premium-card rate on the VAT-inclusive charge + 20p; balance transactions are not stored locally" },
  infrastructure: { label: "Infrastructure", kind: "allocation", source: "ALLOCATION: £2 per paying workspace a month (economics.md §1.1)" },
};

export const COST_LINE_ORDER: CostLineKey[] = [
  "smsOut",
  "smsIn",
  "whatsapp",
  "ai",
  "resend",
  "places",
  "otherProviders",
  "numberShare",
  "stripe",
  "infrastructure",
];

/** A priced line. `value: null` is "not measured", which is not zero. */
export type CostLine = { key: CostLineKey; value: number | null; note?: string };

function aiCost(u: UsageCounts): number {
  const r = AI_TOKEN_RATE_GBP_PER_MILLION;
  return (
    (u.aiMiniInput * r.mini.input +
      u.aiMiniCached * r.mini.cached +
      u.aiMiniOutput * r.mini.output +
      u.aiNanoInput * r.nano.input +
      u.aiNanoCached * r.nano.cached +
      u.aiNanoOutput * r.nano.output) /
    1e6
  );
}

function whatsappCost(u: UsageCounts): { value: number; note?: string } {
  const categorised = u.waMarketing + u.waUtility + u.waServiceFree + u.waServiceCharged;
  // The ledger counts sends the messages table may not have a category for
  // (or a row at all). Those are priced at marketing, the dearest category,
  // rather than dropped: a missing category must not read as cheaper.
  const uncategorised = Math.max(0, u.waOutLedger - categorised);
  const fee = UNIT_COST_GBP.whatsappTwilioFee;
  const value =
    (u.waMarketing + uncategorised) * (UNIT_COST_GBP.whatsappMetaMarketing + fee) +
    u.waUtility * (UNIT_COST_GBP.whatsappMetaUtility + fee) +
    u.waServiceFree * fee +
    u.waServiceCharged * (UNIT_COST_GBP.whatsappMetaServiceFromOct2026 + fee) +
    u.waInbound * fee;
  return uncategorised > 0
    ? { value, note: `${uncategorised} sends without a category priced at the marketing rate` }
    : { value };
}

/* ====================================================== WhatsApp pricing */

export type WhatsappPriceRow = WhatsappMessageEconomics & {
  pack: { tokens: number; priceGbp: number };
  /** At or above the owner's floor: kept after Stripe >= cost × 1.25. */
  aboveFloor: boolean;
};

const WHATSAPP_PRICED_CATEGORIES: WhatsappBillingCategory[] = ["SERVICE", "UTILITY", "MARKETING"];

/**
 * What a WhatsApp message of each category sells for, costs and makes, for
 * every token pack: the SAME tokens-per-category (whatsapp-tokens.ts) and the
 * same all-in cost (`whatsappAllInCost`) the cost lines above use, so the
 * price the customer is charged and the cost this dashboard books cannot
 * drift apart. docs/economics.md §5.4.
 */
export function whatsappPricing(): WhatsappPriceRow[] {
  return WHATSAPP_TOKEN_PACKS.flatMap((pack) =>
    WHATSAPP_PRICED_CATEGORIES.map((category) => {
      const economics = whatsappMessageEconomics(pack, category);
      return {
        ...economics,
        pack: { tokens: pack.tokens, priceGbp: pack.priceGbp },
        aboveFloor: economics.markupOnCost >= WHATSAPP_MIN_MARKUP_ON_COST,
      };
    }),
  );
}

/** The usage-driven lines, priced. Allocations and fees are added by `workspaceEconomics`. */
export function usageCostLines(u: UsageCounts): CostLine[] {
  const wa = whatsappCost(u);
  return [
    { key: "smsOut", value: u.smsOutSegments * UNIT_COST_GBP.smsOutboundSegment },
    // Measured only once something writes the metric; until then, unknown.
    u.smsInRows > 0
      ? { key: "smsIn", value: u.smsInSegments * UNIT_COST_GBP.smsInbound }
      : { key: "smsIn", value: null, note: "Inbound SMS is not metered" },
    { key: "whatsapp", value: wa.value, ...(wa.note ? { note: wa.note } : {}) },
    { key: "ai", value: aiCost(u) },
    u.resendRows > 0
      ? { key: "resend", value: u.resendEmails * UNIT_COST_GBP.resendEmail }
      : { key: "resend", value: null, note: "System email is not metered" },
    { key: "places", value: u.placesRequests * UNIT_COST_GBP.placesTextSearchRequest },
    { key: "otherProviders", value: u.otherProviderCostGbp },
  ];
}

/* =============================================================== revenue */

const PAYING_STATUSES = new Set(["ACTIVE", "PAST_DUE"]);

function wasPayingDuring(sub: SubscriptionFacts, period: EconomicsPeriod): boolean {
  if (sub.plan === "trial") return false;
  const created = sub.createdAt ? new Date(sub.createdAt).getTime() : 0;
  if (created >= period.end.getTime()) return false;
  if (PAYING_STATUSES.has(sub.status)) return true;
  // Cancelled during (or after) the period: it was paying for some of it.
  return (
    sub.status === "CANCELLED" &&
    sub.cancelledAt !== null &&
    new Date(sub.cancelledAt).getTime() >= period.start.getTime()
  );
}

function planKeyOf(plan: string): "starter" | "growth" | "pro" | "enterprise" | null {
  return plan === "starter" || plan === "growth" || plan === "pro" || plan === "enterprise" ? plan : null;
}

/**
 * The subscription's monthly revenue: the plan's list price for its interval
 * (annual ÷ 12). No invoice amounts are stored locally, so this is the price,
 * not the collected amount. `null` when the price is not recorded (Enterprise
 * is contract-priced).
 */
export function subscriptionRevenue(
  sub: SubscriptionFacts | null,
  period: EconomicsPeriod,
): { monthly: number | null; interval: Interval | null; stripeFee: number | null } {
  if (!sub || !wasPayingDuring(sub, period)) return { monthly: 0, interval: null, stripeFee: 0 };
  const key = planKeyOf(sub.plan);
  const plan = key ? PLANS[key] : null;
  const interval: Interval = sub.billingInterval === "year" ? "annual" : "monthly";
  if (!plan || plan.monthlyPrice === null || (interval === "annual" && plan.yearlyPrice === null)) {
    return { monthly: null, interval, stripeFee: null };
  }
  // Stripe on the subscription charge is planCost's own line: the same
  // formula the margin test asserts, not a second copy of it.
  const line = planCost(planInputFor(key as "starter" | "growth" | "pro"), interval, "max");
  // The real billed amount when a paid invoice has recorded it (coupons and
  // discounts included); the fee stays the list-price line's estimate.
  if (sub.mrrMinor !== null && sub.mrrMinor !== undefined && Number.isFinite(sub.mrrMinor)) {
    return { monthly: sub.mrrMinor / 100, interval, stripeFee: line.stripe };
  }
  return { monthly: line.revenue, interval, stripeFee: line.stripe };
}

/** Stripe's fee on one-off top-up charges (their own Checkout, so 20p each). */
export function creditStripeFee(revenueGbp: number, charges: number): number {
  const a = MODEL_ASSUMPTIONS;
  return revenueGbp * a.vatMultiplier * a.stripePercentMax + charges * a.stripeFixedGbp;
}

/* ============================================================= workspace */

export type WorkspaceEconomics = {
  businessId: string;
  name: string;
  plan: string;
  status: string | null;
  interval: Interval | null;
  revenue: {
    subscription: number | null;
    credits: number;
    /** Null when any part of it is not recorded. */
    total: number | null;
  };
  lines: CostLine[];
  /** Usage lines only (the cost of running leads), excluding fees and allocations. */
  variableCost: number;
  totalCost: number;
  grossProfit: number | null;
  /** 0..1, or null with no revenue or unrecorded revenue. */
  margin: number | null;
  belowFloor: boolean;
  /** Month-end projection; only for an open month. */
  projected: { totalCost: number; margin: number | null; belowFloor: boolean } | null;
  notMeasured: CostLineKey[];
  leads: number;
  qualifiedLeads: number;
  isTrial: boolean;
  trialStartedInPeriod: boolean;
};

export type WorkspaceInput = {
  businessId: string;
  name: string;
  subscription: SubscriptionFacts | null;
  usage: UsageCounts;
};

export type PeriodContext = {
  period: EconomicsPeriod;
  /** Workspaces that sent any SMS in the period, for the number-rental split. */
  smsWorkspaces: number;
};

function sumKnown(lines: CostLine[]): number {
  return lines.reduce((sum, line) => sum + (line.value ?? 0), 0);
}

export function workspaceEconomics(input: WorkspaceInput, ctx: PeriodContext): WorkspaceEconomics {
  const { usage: u, subscription: sub } = input;
  const usageLines = usageCostLines(u);
  const variableCost = sumKnown(usageLines);

  const subRevenue = subscriptionRevenue(sub, ctx.period);
  const paying = subRevenue.monthly === null || subRevenue.monthly > 0;
  const isTrial = !!sub && (sub.plan === "trial" || sub.status === "TRIALING");

  const numberShare =
    u.smsOutRows > 0 && ctx.smsWorkspaces > 0 ? UNIT_COST_GBP.numberRentalMonth / ctx.smsWorkspaces : 0;
  const creditFee = creditStripeFee(u.creditRevenueGbp, u.creditCharges);
  const stripe = subRevenue.stripeFee === null ? null : subRevenue.stripeFee + creditFee;
  const infrastructure = paying ? MODEL_ASSUMPTIONS.infrastructurePerCustomerMonth : 0;

  const lines: CostLine[] = [
    ...usageLines,
    { key: "numberShare", value: numberShare },
    stripe === null
      ? { key: "stripe", value: creditFee, note: "Contract charge not recorded; top-up fees only" }
      : { key: "stripe", value: stripe },
    { key: "infrastructure", value: infrastructure },
  ];
  const totalCost = sumKnown(lines);

  const revenueTotal = subRevenue.monthly === null ? null : subRevenue.monthly + u.creditRevenueGbp;
  const grossProfit = revenueTotal === null ? null : revenueTotal - totalCost;
  const margin = revenueTotal !== null && revenueTotal > 0 ? (revenueTotal - totalCost) / revenueTotal : null;

  // Month end: usage runs on at its current daily rate; the month's fixed
  // lines (subscription fee, allocation, number share) are already whole;
  // top-ups are not assumed to recur.
  let projected: WorkspaceEconomics["projected"] = null;
  if (ctx.period.open) {
    const share = elapsedShare(ctx.period);
    const projectedCost = totalCost - variableCost + variableCost / share;
    const projectedMargin =
      revenueTotal !== null && revenueTotal > 0 ? (revenueTotal - projectedCost) / revenueTotal : null;
    projected = {
      totalCost: projectedCost,
      margin: projectedMargin,
      belowFloor: projectedMargin !== null && projectedMargin < MIN_GROSS_MARGIN,
    };
  }

  const created = sub?.createdAt ? new Date(sub.createdAt).getTime() : NaN;
  const trialStartedInPeriod =
    !!sub &&
    (sub.plan === "trial" || sub.trialEndsAt !== null) &&
    created >= ctx.period.start.getTime() &&
    created < ctx.period.end.getTime();

  return {
    businessId: input.businessId,
    name: input.name,
    plan: sub?.plan ?? "none",
    status: sub?.status ?? null,
    interval: subRevenue.interval,
    revenue: { subscription: subRevenue.monthly, credits: u.creditRevenueGbp, total: revenueTotal },
    lines,
    variableCost,
    totalCost,
    grossProfit,
    margin,
    belowFloor: margin !== null && margin < MIN_GROSS_MARGIN,
    projected,
    notMeasured: lines.filter((line) => line.value === null).map((line) => line.key),
    leads: u.leads,
    qualifiedLeads: u.qualifiedLeads,
    isTrial,
    trialStartedInPeriod,
  };
}

/** Every workspace in a period, with the number-rental split worked out once. */
export function periodEconomics(inputs: WorkspaceInput[], period: EconomicsPeriod): WorkspaceEconomics[] {
  const smsWorkspaces = inputs.filter((input) => input.usage.smsOutRows > 0).length;
  return inputs.map((input) => workspaceEconomics(input, { period, smsWorkspaces }));
}

/* ================================================================ totals */

export type DriverTotal = {
  key: CostLineKey;
  value: number;
  /** Share of total cost, 0..1. */
  share: number;
  /** Workspaces for which this line is not measured. */
  notMeasuredIn: number;
};

export type EconomicsTotals = {
  revenue: number;
  /** Workspaces whose revenue is not recorded (left out of revenue AND margin). */
  revenueNotRecorded: number;
  cost: number;
  variableCost: number;
  grossProfit: number;
  margin: number | null;
  workspaces: number;
  belowFloor: number;
  trialsStarted: number;
  costPerTrial: number | null;
  leads: number;
  qualifiedLeads: number;
  costPerLead: number | null;
  costPerQualifiedLead: number | null;
  drivers: DriverTotal[];
};

export function economicsTotals(rows: WorkspaceEconomics[]): EconomicsTotals {
  // Margin is over workspaces with known revenue only; a contract whose price
  // is not stored must not be counted as cost against £0.
  const known = rows.filter((row) => row.revenue.total !== null);
  const revenue = known.reduce((sum, row) => sum + (row.revenue.total ?? 0), 0);
  const costOfKnown = known.reduce((sum, row) => sum + row.totalCost, 0);
  const cost = rows.reduce((sum, row) => sum + row.totalCost, 0);
  const variableCost = rows.reduce((sum, row) => sum + row.variableCost, 0);

  const trials = rows.filter((row) => row.trialStartedInPeriod);
  // A trial's cost is its marginal usage cost, as economics.md §2 defines it:
  // the shared number and the infrastructure allocation are not per trial.
  const trialCost = trials.reduce((sum, row) => sum + row.variableCost, 0);

  const leads = rows.reduce((sum, row) => sum + row.leads, 0);
  const qualifiedLeads = rows.reduce((sum, row) => sum + row.qualifiedLeads, 0);

  const drivers: DriverTotal[] = COST_LINE_ORDER.map((key) => {
    const value = rows.reduce((sum, row) => sum + (row.lines.find((l) => l.key === key)?.value ?? 0), 0);
    return {
      key,
      value,
      share: cost > 0 ? value / cost : 0,
      notMeasuredIn: rows.filter((row) => row.notMeasured.includes(key)).length,
    };
  });

  return {
    revenue,
    revenueNotRecorded: rows.length - known.length,
    cost,
    variableCost,
    grossProfit: revenue - costOfKnown,
    margin: revenue > 0 ? (revenue - costOfKnown) / revenue : null,
    workspaces: rows.length,
    belowFloor: rows.filter((row) => row.belowFloor).length,
    trialsStarted: trials.length,
    costPerTrial: trials.length > 0 ? trialCost / trials.length : null,
    leads,
    qualifiedLeads,
    costPerLead: leads > 0 ? variableCost / leads : null,
    costPerQualifiedLead: qualifiedLeads > 0 ? variableCost / qualifiedLeads : null,
    drivers,
  };
}

/* ========================================================== table helpers */

export type SortKey = "name" | "plan" | "revenue" | "cost" | "margin" | "projected";

/** Sorts a copy. Unknown values (null margin, unrecorded revenue) always sort last. */
export function sortWorkspaces(
  rows: WorkspaceEconomics[],
  key: SortKey,
  direction: "asc" | "desc",
): WorkspaceEconomics[] {
  const value = (row: WorkspaceEconomics): number | string | null => {
    switch (key) {
      case "name":
        return row.name.toLowerCase();
      case "plan":
        return row.plan;
      case "revenue":
        return row.revenue.total;
      case "cost":
        return row.totalCost;
      case "margin":
        return row.margin;
      case "projected":
        return row.projected?.margin ?? null;
    }
  };
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return a.name.localeCompare(b.name);
  });
}

/** The "below 75%" filter: month to date OR projected month end. */
export function belowFloorOnly(rows: WorkspaceEconomics[]): WorkspaceEconomics[] {
  return rows.filter((row) => row.belowFloor || row.projected?.belowFloor === true);
}

/* ================================================================ alerts */

export type MarginAlert = {
  businessId: string;
  period: string;
  severity: "WARNING" | "CRITICAL";
  title: string;
  detail: string;
  metrics: Record<string, number | string | null>;
};

/** The critical band from the platform margin guardrails (V4 §98.1: below 55%). */
const CRITICAL_MARGIN = 0.55;

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/**
 * Whether today's check raises an alert for this workspace: its month-to-date
 * margin, or its projected month-end margin, is below 75%, and no alert has
 * been raised for it this month. `alreadyRaised` holds `businessId:YYYY-MM`.
 */
export function marginAlertFor(
  row: WorkspaceEconomics,
  period: EconomicsPeriod,
  alreadyRaised: ReadonlySet<string>,
): MarginAlert | null {
  const key = periodKey(period);
  if (alreadyRaised.has(`${row.businessId}:${key}`)) return null;
  const projected = row.projected?.margin ?? null;
  if (!row.belowFloor && !row.projected?.belowFloor) return null;

  const worst = Math.min(row.margin ?? Infinity, projected ?? Infinity);
  const which = row.belowFloor ? "Month-to-date" : "Projected month-end";
  return {
    businessId: row.businessId,
    period: key,
    severity: worst < CRITICAL_MARGIN ? "CRITICAL" : "WARNING",
    title: `${which} margin below 75% for ${row.name}`,
    detail:
      `${period.label}: margin ${pct(row.margin)} to date, ${pct(projected)} projected at month end ` +
      `(revenue £${(row.revenue.total ?? 0).toFixed(2)}, cost £${row.totalCost.toFixed(2)}).`,
    metrics: {
      period: key,
      margin_mtd: row.margin,
      margin_projected: projected,
      revenue: row.revenue.total,
      cost: row.totalCost,
      projected_cost: row.projected?.totalCost ?? null,
      plan: row.plan,
    },
  };
}

/* ============================================================= simulator */

export type SimulatorPlan = "starter" | "growth" | "pro";
export const SIMULATOR_PLANS: SimulatorPlan[] = ["starter", "growth", "pro"];

/**
 * A self-serve plan's cost-model input, exactly as `tests/plan-margins.test.ts`
 * builds it: plans.ts allowances plus the server-enforced prospect limit.
 */
export function planInputFor(plan: SimulatorPlan): PlanCostInput {
  const definition = PLANS[plan];
  return {
    monthlyPrice: definition.monthlyPrice as number,
    yearlyPrice: definition.yearlyPrice,
    leadLimit: definition.leadLimit,
    smsSegmentAllowance: definition.smsSegmentAllowance,
    whatsappMessageAllowance: definition.whatsappMessageAllowance,
    aiTokenAllowance: definition.aiTokenAllowance,
    verifiedProspects: VERIFIED_PROSPECT_HARD_LIMIT[plan],
  };
}

/** The annual price plans.ts would set for a monthly price (−15%, rounded). */
export function annualPriceFor(monthly: number): number {
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100));
}

export type SimulatorCell = { interval: Interval; usage: Usage; line: PlanCostLine; pass: boolean };

export type SimulatorResult = {
  cells: SimulatorCell[];
  /** The thinnest cell: the one the ≥75% rule is decided on. */
  binding: SimulatorCell;
  pass: boolean;
};

/**
 * Read-only: runs `planCost()` for each interval at max and typical usage. It
 * never writes a plan. With an unchanged input it returns exactly what the
 * margin test asserts, because it is the same function on the same input.
 */
export function simulatePlan(input: PlanCostInput): SimulatorResult {
  const intervals: Interval[] = input.yearlyPrice === null ? ["monthly"] : ["monthly", "annual"];
  const cells: SimulatorCell[] = [];
  for (const interval of intervals) {
    for (const usage of ["max", "typical"] as Usage[]) {
      const line = planCost(input, interval, usage);
      cells.push({ interval, usage, line, pass: line.margin >= MIN_GROSS_MARGIN });
    }
  }
  const binding = cells.reduce((min, cell) => (cell.line.margin < min.line.margin ? cell : min));
  return { cells, binding, pass: cells.every((cell) => cell.pass) };
}
