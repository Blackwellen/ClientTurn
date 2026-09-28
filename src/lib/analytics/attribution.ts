/**
 * One revenue journey across every channel (brief §41). Pure.
 *
 * A journey is the ordered list of a lead's touches -- the ad or form that
 * brought them, the SMS, WhatsApp and email the business sent, voice calls,
 * quotes viewed, accepted and signed, bookings -- and the revenue they led to.
 *
 * THE REVENUE RULE (tests/attribution.test.ts, "no fabrication"):
 *   Revenue is only ever one of three recorded facts:
 *     * CHECKOUT_PAYMENT  a matched/linked `checkout_payments` row (0143);
 *     * INVOICE_PAYMENT   an `invoice_payments` row (0154);
 *     * WON_OPPORTUNITY   an opportunity closed WON with a value a person
 *                         entered, used ONLY when that opportunity has no
 *                         recorded payment (otherwise it would count twice),
 *                         and always labelled "won value, not yet paid".
 *   Nothing is estimated from pipeline, service averages or quote totals. A
 *   quote that was signed but not paid is a touch, never revenue. When there
 *   is no revenue the aggregates say so (`hasRevenue: false`); they never
 *   return a zero that looks like a measurement.
 *
 * Models, each crediting only touches at or before the revenue moment:
 *   first     100% to the earliest touch.
 *   last      100% to the latest touch.
 *   linear    equal shares.
 *   position  40% first, 40% last, 20% split across the middle (U-shaped).
 *             One touch takes 100%; two touches split 50/50.
 * Money is split in integer minor units by largest remainder, so the credited
 * amounts always add up to exactly the revenue.
 */

export const JOURNEY_MODELS = ["first", "last", "linear", "position"] as const;
export type JourneyModel = (typeof JOURNEY_MODELS)[number];

export const JOURNEY_MODEL_LABEL: Record<JourneyModel, string> = {
  first: "First touch",
  last: "Last touch",
  linear: "Linear",
  position: "Position-based (40/20/40)",
};

export const JOURNEY_CHANNELS = [
  "AD_FORM",
  "WEB_FORM",
  "OTHER_SOURCE",
  "SMS",
  "WHATSAPP",
  "EMAIL",
  "SOCIAL",
  "VOICE",
  "QUOTE",
  "BOOKING",
] as const;
export type JourneyChannel = (typeof JOURNEY_CHANNELS)[number];

export const JOURNEY_CHANNEL_LABEL: Record<JourneyChannel, string> = {
  AD_FORM: "Ad / lead form",
  WEB_FORM: "Website form",
  OTHER_SOURCE: "Other source",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SOCIAL: "Social DM",
  VOICE: "Voice call",
  QUOTE: "Quote",
  BOOKING: "Booking",
};

export type JourneyTouchKind =
  | "SOURCE"
  | "OUTBOUND_MESSAGE"
  | "CALL"
  | "QUOTE_SENT"
  | "QUOTE_VIEWED"
  | "QUOTE_ACCEPTED"
  | "QUOTE_SIGNED"
  | "BOOKING";

export type JourneyTouch = {
  id: string;
  leadId: string;
  opportunityId: string | null;
  /** ISO timestamp. */
  at: string;
  channel: JourneyChannel;
  kind: JourneyTouchKind;
  /** A short, non-personal label ("Meta lead form: Spring offer", "Call: 3m 12s"). */
  label: string;
};

export const REVENUE_KINDS = ["CHECKOUT_PAYMENT", "INVOICE_PAYMENT", "WON_OPPORTUNITY"] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];

export type RevenueEvent = {
  id: string;
  leadId: string;
  opportunityId: string | null;
  at: string;
  amountMinor: number;
  currency: string;
  kind: RevenueKind;
};

/* ----------------------------------------------------- mapping helpers */

/** `lead_touches.source_type` -> channel. */
export function channelForSourceType(sourceType: string | null | undefined): JourneyChannel {
  switch (sourceType) {
    case "AD_FORM":
      return "AD_FORM";
    case "WEB_FORM":
      return "WEB_FORM";
    case "SOCIAL_DM":
      return "SOCIAL";
    default:
      return "OTHER_SOURCE";
  }
}

/** `messages.channel` (lower or upper case) -> channel, or null when not a journey channel. */
export function channelForMessage(channel: string | null | undefined): JourneyChannel | null {
  switch ((channel ?? "").toUpperCase()) {
    case "SMS":
      return "SMS";
    case "WHATSAPP":
      return "WHATSAPP";
    case "EMAIL":
      return "EMAIL";
    case "MESSENGER":
    case "INSTAGRAM":
    case "LINKEDIN":
    case "TIKTOK":
    case "SOCIAL":
      return "SOCIAL";
    default:
      return null;
  }
}

/* ----------------------------------------------------- revenue facts */

export type CheckoutPaymentFact = {
  id: string;
  lead_id: string | null;
  opportunity_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  paid_at: string;
};

export type InvoicePaymentFact = {
  id: string;
  lead_id: string | null;
  opportunity_id: string | null;
  amount_minor: number;
  currency: string;
  received_at: string;
  /** Set when the same money also arrived as a checkout_payments row. */
  checkout_payment_id: string | null;
};

export type WonOpportunityFact = {
  id: string;
  lead_id: string | null;
  /** numeric(14,2) in major units, as entered by a person. Null = no value. */
  value: number | string | null;
  currency: string | null;
  outcome: string;
  closed_at: string | null;
};

/** Checkout payments that belong to a lead: the ones a person or the matcher tied to one. */
const ATTRIBUTABLE_PAYMENT_STATUS = new Set(["MATCHED", "LINKED"]);

/**
 * The revenue events for attribution, deduplicated:
 *   * an invoice payment that is also a checkout payment is counted once (as
 *     the invoice payment);
 *   * a won opportunity's value counts only if no payment is recorded against
 *     that opportunity;
 *   * anything without a lead, a positive amount or a date is dropped.
 */
export function revenueEventsFrom(input: {
  checkoutPayments: readonly CheckoutPaymentFact[];
  invoicePayments: readonly InvoicePaymentFact[];
  wonOpportunities: readonly WonOpportunityFact[];
  /**
   * Opportunities with a payment recorded OUTSIDE the rows passed in (for
   * example before the period). Their won value is not counted either.
   */
  paidOpportunityIds?: ReadonlySet<string>;
}): RevenueEvent[] {
  const events: RevenueEvent[] = [];
  const viaInvoice = new Set(
    input.invoicePayments.map((p) => p.checkout_payment_id).filter((id): id is string => Boolean(id)),
  );
  const paidOpportunities = new Set<string>(input.paidOpportunityIds ?? []);

  for (const p of input.invoicePayments) {
    if (!p.lead_id || !(p.amount_minor > 0) || !p.received_at) continue;
    events.push({
      id: `inv:${p.id}`,
      leadId: p.lead_id,
      opportunityId: p.opportunity_id,
      at: p.received_at,
      amountMinor: Math.round(p.amount_minor),
      currency: p.currency,
      kind: "INVOICE_PAYMENT",
    });
    if (p.opportunity_id) paidOpportunities.add(p.opportunity_id);
  }
  for (const p of input.checkoutPayments) {
    if (viaInvoice.has(p.id)) continue;
    if (!ATTRIBUTABLE_PAYMENT_STATUS.has(p.status)) continue;
    if (!p.lead_id || !(p.amount_minor > 0) || !p.paid_at) continue;
    events.push({
      id: `pay:${p.id}`,
      leadId: p.lead_id,
      opportunityId: p.opportunity_id,
      at: p.paid_at,
      amountMinor: Math.round(p.amount_minor),
      currency: p.currency,
      kind: "CHECKOUT_PAYMENT",
    });
    if (p.opportunity_id) paidOpportunities.add(p.opportunity_id);
  }
  for (const o of input.wonOpportunities) {
    if (o.outcome !== "WON" || !o.lead_id || !o.closed_at) continue;
    if (paidOpportunities.has(o.id)) continue;
    const value = o.value === null || o.value === undefined ? NaN : Number(o.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    events.push({
      id: `won:${o.id}`,
      leadId: o.lead_id,
      opportunityId: o.id,
      at: o.closed_at,
      amountMinor: Math.round(value * 100),
      currency: o.currency ?? "GBP",
      kind: "WON_OPPORTUNITY",
    });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/* ----------------------------------------------------- the models */

/**
 * Fractional weights per touch position (they sum to 1). Exported so the
 * golden tests can assert the shape of each model directly.
 */
export function modelWeights(model: JourneyModel, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  switch (model) {
    case "first":
      return Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));
    case "last":
      return Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0));
    case "linear":
      return Array.from({ length: n }, () => 1 / n);
    case "position": {
      if (n === 2) return [0.5, 0.5];
      const middle = 0.2 / (n - 2);
      return Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? 0.4 : middle));
    }
  }
}

/**
 * Splits an integer amount by weights, exactly: floor each share, then hand
 * the leftover units to the largest remainders (ties to the earlier touch).
 */
export function splitMinor(amountMinor: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const total = Math.round(amountMinor);
  const raw = weights.map((w) => w * total);
  const floors = raw.map((r) => Math.floor(r));
  let leftover = total - floors.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; leftover > 0 && k < order.length; k++, leftover--) floors[order[k].i] += 1;
  return floors;
}

/** Touches that can earn credit for revenue at `at`: same lead, not after it, in time order. */
export function creditableTouches(touches: readonly JourneyTouch[], revenue: RevenueEvent): JourneyTouch[] {
  return touches
    .filter((t) => t.leadId === revenue.leadId && t.at <= revenue.at)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export type TouchCredit = { touch: JourneyTouch; weight: number; amountMinor: number };

/** One revenue event's credit under one model. Empty when no touch preceded it. */
export function creditRevenue(
  touches: readonly JourneyTouch[],
  revenue: RevenueEvent,
  model: JourneyModel,
): TouchCredit[] {
  const eligible = creditableTouches(touches, revenue);
  const weights = modelWeights(model, eligible.length);
  const amounts = splitMinor(revenue.amountMinor, weights);
  return eligible.map((touch, i) => ({ touch, weight: weights[i], amountMinor: amounts[i] }));
}

/* ----------------------------------------------------- aggregates */

export type ChannelAttributionRow = {
  channel: JourneyChannel;
  label: string;
  /** Credited revenue, minor units, per currency. */
  revenueMinor: Record<string, number>;
  /** Credited conversions (fractional under linear / position). */
  conversions: number;
  /** Share of converting journeys in which this channel appeared at all. */
  influence: number;
  /** Converting journeys that included this channel. */
  journeysTouched: number;
};

export type AttributionSummary = {
  model: JourneyModel;
  /** False when there is no recorded revenue: the UI shows an empty state, never zeroes. */
  hasRevenue: boolean;
  totalRevenueMinor: Record<string, number>;
  /** Revenue with no touch before it (for example a lead recorded after it paid). */
  unattributedRevenueMinor: Record<string, number>;
  convertingJourneys: number;
  rows: ChannelAttributionRow[];
  revenueByKind: Record<RevenueKind, Record<string, number>>;
};

function addTo(map: Record<string, number>, currency: string, amount: number) {
  map[currency] = (map[currency] ?? 0) + amount;
}

export function attributeRevenue(
  touches: readonly JourneyTouch[],
  revenue: readonly RevenueEvent[],
  model: JourneyModel,
): AttributionSummary {
  const byChannel = new Map<JourneyChannel, ChannelAttributionRow>();
  const row = (channel: JourneyChannel) => {
    let r = byChannel.get(channel);
    if (!r) {
      r = { channel, label: JOURNEY_CHANNEL_LABEL[channel], revenueMinor: {}, conversions: 0, influence: 0, journeysTouched: 0 };
      byChannel.set(channel, r);
    }
    return r;
  };

  const total: Record<string, number> = {};
  const unattributed: Record<string, number> = {};
  const byKind: AttributionSummary["revenueByKind"] = {
    CHECKOUT_PAYMENT: {},
    INVOICE_PAYMENT: {},
    WON_OPPORTUNITY: {},
  };
  const convertingLeads = new Set<string>();
  const channelsByLead = new Map<string, Set<JourneyChannel>>();

  for (const event of revenue) {
    if (!(event.amountMinor > 0)) continue;
    addTo(total, event.currency, event.amountMinor);
    addTo(byKind[event.kind], event.currency, event.amountMinor);
    const credits = creditRevenue(touches, event, model);
    if (credits.length === 0) {
      addTo(unattributed, event.currency, event.amountMinor);
      continue;
    }
    convertingLeads.add(event.leadId);
    const seen = channelsByLead.get(event.leadId) ?? new Set<JourneyChannel>();
    for (const credit of credits) {
      const r = row(credit.touch.channel);
      addTo(r.revenueMinor, event.currency, credit.amountMinor);
      r.conversions += credit.weight;
      seen.add(credit.touch.channel);
    }
    channelsByLead.set(event.leadId, seen);
  }

  for (const channels of channelsByLead.values()) {
    for (const channel of channels) row(channel).journeysTouched += 1;
  }
  const journeys = convertingLeads.size;
  const rows = [...byChannel.values()]
    .map((r) => ({
      ...r,
      conversions: Math.round(r.conversions * 1000) / 1000,
      influence: journeys > 0 ? r.journeysTouched / journeys : 0,
    }))
    .sort((a, b) => sumValues(b.revenueMinor) - sumValues(a.revenueMinor) || a.channel.localeCompare(b.channel));

  return {
    model,
    hasRevenue: Object.values(total).some((v) => v > 0),
    totalRevenueMinor: total,
    unattributedRevenueMinor: unattributed,
    convertingJourneys: journeys,
    rows,
    revenueByKind: byKind,
  };
}

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((s, v) => s + v, 0);
}

/* ----------------------------------------------------- one journey */

export type JourneyEntry =
  | { type: "touch"; at: string; touch: JourneyTouch }
  | { type: "revenue"; at: string; revenue: RevenueEvent };

export type LeadJourney = {
  entries: JourneyEntry[];
  /** Per model: this lead's revenue credited to each channel. Empty when no revenue. */
  credited: Record<JourneyModel, { channel: JourneyChannel; amountMinor: number; currency: string }[]>;
  hasRevenue: boolean;
};

/**
 * A single lead's (or opportunity's) journey for the lead page card: the
 * merged timeline and how its real revenue splits under each model.
 */
export function buildLeadJourney(
  touches: readonly JourneyTouch[],
  revenue: readonly RevenueEvent[],
): LeadJourney {
  const entries: JourneyEntry[] = [
    ...touches.map((touch) => ({ type: "touch" as const, at: touch.at, touch })),
    ...revenue.map((r) => ({ type: "revenue" as const, at: r.at, revenue: r })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.type === b.type ? 0 : a.type === "touch" ? -1 : 1));

  const credited = {} as LeadJourney["credited"];
  for (const model of JOURNEY_MODELS) {
    const summary = attributeRevenue(touches, revenue, model);
    credited[model] = summary.rows.flatMap((r) =>
      Object.entries(r.revenueMinor).map(([currency, amountMinor]) => ({ channel: r.channel, amountMinor, currency })),
    );
  }
  return { entries, credited, hasRevenue: revenue.some((r) => r.amountMinor > 0) };
}

/** "£1,234.50" from minor units. */
export function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}
