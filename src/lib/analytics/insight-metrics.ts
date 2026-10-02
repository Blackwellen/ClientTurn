/**
 * Quote analytics (§42), voice analytics (§40) and the ROI chain (§70). Pure.
 *
 * The server queries (insights-query.ts) read the rows; everything that turns
 * rows into a number lives here so it is tested (tests/insight-metrics.test.ts).
 *
 * Rules every figure obeys:
 *   * A rate below MIN_SAMPLE in its denominator is "not enough data"
 *     (`enough: false`) and the UI shows those words instead of a percentage.
 *   * An empty denominator is null, never 0%.
 *   * Durations are ACTUAL recorded `duration_sec` only; a call with no
 *     recorded duration is left out, never estimated.
 *   * Money is recorded money only (attribution.ts revenue rule). Costs are
 *     the provider cost ledger. Nothing is projected.
 *   * Margin and cost figures are marked `restricted` and the query drops them
 *     unless the viewer is an owner or admin.
 */

/** Below this many in the denominator a rate is withheld as "not enough data". */
export const MIN_SAMPLE = 10;

export type Rate = {
  value: number | null;
  numerator: number;
  denominator: number;
  /** False below MIN_SAMPLE: the UI says "not enough data", not a percentage. */
  enough: boolean;
};

export function gatedRate(numerator: number, denominator: number, minSample = MIN_SAMPLE): Rate {
  const value = denominator > 0 ? numerator / denominator : null;
  return { value, numerator, denominator, enough: denominator >= minSample };
}

/** "42%", "Not enough data (n=4)", or "—". */
export function formatRate(rate: Rate): string {
  if (rate.value === null) return "—";
  if (!rate.enough) return `Not enough data (n=${rate.denominator})`;
  return `${Math.round(rate.value * 1000) / 10}%`;
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: readonly number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : null;
}

const HOUR = 3_600_000;
function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms / HOUR : null;
}

/* =================================================================== quotes */

export const QUOTE_AUTHOR_KINDS = ["AI", "HUMAN", "API", "LEAD_REQUEST"] as const;
export type QuoteAuthorKind = (typeof QUOTE_AUTHOR_KINDS)[number];

export type QuoteFact = {
  id: string;
  createdAt: string;
  createdByKind: QuoteAuthorKind;
  currency: string;
  /** The lead's first-touch channel label, or null when the lead has no touch. */
  source: string | null;
  /** The channel the quote link went out on (quote.sent detail), or null. */
  sentVia: string | null;
  requestedAt: string | null;
  sentAt: string | null;
  firstViewedAt: string | null;
  acceptedAt: string | null;
  signedAt: string | null;
  /** First payment against the quote (deposit or full), from quote events. */
  paidAt: string | null;
  declinedAt: string | null;
  expiredAt: string | null;
  revisions: number;
  /** Current revision gross total, minor units. */
  grossMinor: number | null;
  /** Current revision list total before any discount, minor. Null when unknown. */
  listMinor: number | null;
  discountMinor: number | null;
  netMinor: number | null;
  /** Sum of line margins; null when any line's cost is unknown. RESTRICTED. */
  marginMinor: number | null;
  /** The lead raised a price or discount objection before the quote was sent. */
  discountRequested: boolean;
};

export type QuoteSegmentRow = {
  key: string;
  created: number;
  sent: number;
  acceptRate: Rate;
  paidRate: Rate;
};

export type QuoteAnalytics = {
  hasData: boolean;
  counts: {
    requested: number;
    created: number;
    sent: number;
    viewed: number;
    accepted: number;
    signed: number;
    paid: number;
    declined: number;
    expired: number;
  };
  rates: {
    requestToQuote: Rate;
    viewed: Rate;
    accepted: Rate;
    signed: Rate;
    paid: Rate;
    declined: Rate;
    expired: Rate;
  };
  /** Median hours; null when no quote has both ends of the interval. */
  medianHours: { toQuote: number | null; toAccept: number | null; toPay: number | null };
  averageValueMinor: Record<string, number>;
  revisions: { averagePerQuote: number | null; revisedShare: Rate };
  discount: {
    requested: number;
    offeredShare: Rate;
    /** Mean discount as a fraction of list, over discounted quotes. */
    averagePercent: number | null;
  };
  /** RESTRICTED (owner/admin): margin with the discount vs without it. */
  margin: {
    restricted: true;
    quotesWithCost: number;
    averageMarginPercent: number | null;
    averageMarginPercentBeforeDiscount: number | null;
    /** Percentage points the discounts took off margin. */
    impactPoints: number | null;
  };
  byAuthor: QuoteSegmentRow[];
  bySource: QuoteSegmentRow[];
  byChannel: QuoteSegmentRow[];
};

function segment(quotes: readonly QuoteFact[], keyOf: (q: QuoteFact) => string): QuoteSegmentRow[] {
  const groups = new Map<string, QuoteFact[]>();
  for (const q of quotes) {
    const key = keyOf(q);
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sent = list.filter((q) => q.sentAt);
      return {
        key,
        created: list.length,
        sent: sent.length,
        acceptRate: gatedRate(sent.filter((q) => q.acceptedAt || q.signedAt).length, sent.length),
        paidRate: gatedRate(sent.filter((q) => q.paidAt).length, sent.length),
      };
    })
    .sort((a, b) => b.created - a.created || a.key.localeCompare(b.key));
}

export function computeQuoteAnalytics(quotes: readonly QuoteFact[]): QuoteAnalytics {
  const sent = quotes.filter((q) => q.sentAt);
  const requested = quotes.filter((q) => q.requestedAt || q.createdByKind === "LEAD_REQUEST");
  const accepted = sent.filter((q) => q.acceptedAt || q.signedAt);
  const signed = sent.filter((q) => q.signedAt);
  const paid = sent.filter((q) => q.paidAt);
  const viewed = sent.filter((q) => q.firstViewedAt);
  const declined = sent.filter((q) => q.declinedAt);
  const expired = sent.filter((q) => q.expiredAt);

  const values: Record<string, number[]> = {};
  for (const q of sent) {
    if (q.grossMinor !== null && q.grossMinor > 0) (values[q.currency] ??= []).push(q.grossMinor);
  }
  const averageValueMinor: Record<string, number> = {};
  for (const [currency, list] of Object.entries(values)) averageValueMinor[currency] = Math.round(mean(list) ?? 0);

  const discounted = sent.filter((q) => (q.discountMinor ?? 0) > 0 && (q.listMinor ?? 0) > 0);
  const withCost = sent.filter((q) => q.marginMinor !== null && (q.netMinor ?? 0) > 0);
  const marginAfter = withCost.map((q) => (q.marginMinor as number) / (q.netMinor as number));
  const marginBefore = withCost.map(
    (q) => ((q.marginMinor as number) + (q.discountMinor ?? 0)) / ((q.netMinor as number) + (q.discountMinor ?? 0)),
  );
  const after = mean(marginAfter);
  const before = mean(marginBefore);

  return {
    hasData: quotes.length > 0,
    counts: {
      requested: requested.length,
      created: quotes.length,
      sent: sent.length,
      viewed: viewed.length,
      accepted: accepted.length,
      signed: signed.length,
      paid: paid.length,
      declined: declined.length,
      expired: expired.length,
    },
    rates: {
      requestToQuote: gatedRate(requested.filter((q) => q.sentAt).length, requested.length),
      viewed: gatedRate(viewed.length, sent.length),
      accepted: gatedRate(accepted.length, sent.length),
      signed: gatedRate(signed.length, sent.length),
      paid: gatedRate(paid.length, sent.length),
      declined: gatedRate(declined.length, sent.length),
      expired: gatedRate(expired.length, sent.length),
    },
    medianHours: {
      toQuote: median(requested.map((q) => hoursBetween(q.requestedAt, q.sentAt)).filter((v): v is number => v !== null)),
      toAccept: median(sent.map((q) => hoursBetween(q.sentAt, q.acceptedAt ?? q.signedAt)).filter((v): v is number => v !== null)),
      toPay: median(sent.map((q) => hoursBetween(q.acceptedAt ?? q.signedAt, q.paidAt)).filter((v): v is number => v !== null)),
    },
    averageValueMinor,
    revisions: {
      averagePerQuote: mean(quotes.map((q) => q.revisions)),
      revisedShare: gatedRate(quotes.filter((q) => q.revisions > 1).length, quotes.length),
    },
    discount: {
      requested: quotes.filter((q) => q.discountRequested).length,
      offeredShare: gatedRate(discounted.length, sent.length),
      averagePercent: mean(discounted.map((q) => (q.discountMinor as number) / (q.listMinor as number))),
    },
    margin: {
      restricted: true,
      quotesWithCost: withCost.length,
      averageMarginPercent: after,
      averageMarginPercentBeforeDiscount: before,
      impactPoints: after !== null && before !== null ? Math.round((after - before) * 10000) / 100 : null,
    },
    byAuthor: segment(quotes, (q) => q.createdByKind),
    bySource: segment(quotes, (q) => q.source ?? "Unknown source"),
    byChannel: segment(quotes, (q) => q.sentVia ?? "Not recorded"),
  };
}

/* ==================================================================== voice */

export const VOICE_ROUTES = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "INBOUND"] as const;
export type VoiceRoute = (typeof VOICE_ROUTES)[number];

export type VoiceCallFact = {
  id: string;
  leadId: string;
  route: string;
  direction: "OUTBOUND" | "INBOUND";
  outcome: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  /** ACTUAL recorded duration. Null = not recorded; never estimated. */
  durationSec: number | null;
  disposition: string | null;
  /** Provider cost, GBP, from the cost ledger. Null = none recorded. RESTRICTED. */
  costGbp: number | null;
  /** Whether the lead booked / got a quote / bought AFTER this call started. */
  bookedAfter: boolean;
  quotedAfter: boolean;
  soldAfter: boolean;
};

export type ObjectionFact = { key: string; handledOutcome: string | null; channel: string };

/** A call counts as attempted once it has an outcome other than CANCELLED. */
export function isAttempted(call: Pick<VoiceCallFact, "outcome">): boolean {
  return call.outcome !== null && call.outcome !== "CANCELLED";
}

/** Connected: someone (not a voicemail) answered. */
export function isConnected(call: Pick<VoiceCallFact, "outcome" | "answeredAt">): boolean {
  if (call.outcome === "VOICEMAIL" || call.outcome === "NO_ANSWER" || call.outcome === "BUSY" || call.outcome === "FAILED") return false;
  return call.outcome === "COMPLETED" || call.outcome === "TRANSFERRED" || Boolean(call.answeredAt);
}

export type VoiceRouteRow = {
  route: string;
  attempted: number;
  connected: number;
  voicemail: number;
  noAnswer: number;
  failed: number;
  connectRate: Rate;
};

export type VoiceAnalytics = {
  hasData: boolean;
  calls: number;
  attempted: number;
  connectRate: Rate;
  voicemailRate: Rate;
  /** Mean of ACTUAL durations of connected calls; null when none recorded. */
  averageDurationSec: number | null;
  durationSample: number;
  byRoute: VoiceRouteRow[];
  objections: { key: string; count: number; resolvedRate: Rate }[];
  conversion: { connectedLeads: number; booking: Rate; quote: Rate; sale: Rate };
  /** RESTRICTED (owner/admin). Null per field when there is no cost or no outcome. */
  costPerOutcome: {
    restricted: true;
    totalCostGbp: number | null;
    perConnectedCall: number | null;
    perBooking: number | null;
    perQuote: number | null;
    perSale: number | null;
  };
};

export function computeVoiceAnalytics(calls: readonly VoiceCallFact[], objections: readonly ObjectionFact[]): VoiceAnalytics {
  const attempted = calls.filter(isAttempted);
  const connected = attempted.filter(isConnected);
  const durations = connected
    .map((c) => c.durationSec)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d >= 0);

  const routes = new Map<string, VoiceRouteRow>();
  for (const call of attempted) {
    const row = routes.get(call.route) ?? {
      route: call.route,
      attempted: 0,
      connected: 0,
      voicemail: 0,
      noAnswer: 0,
      failed: 0,
      connectRate: gatedRate(0, 0),
    };
    row.attempted += 1;
    if (isConnected(call)) row.connected += 1;
    if (call.outcome === "VOICEMAIL") row.voicemail += 1;
    if (call.outcome === "NO_ANSWER" || call.outcome === "BUSY") row.noAnswer += 1;
    if (call.outcome === "FAILED") row.failed += 1;
    routes.set(call.route, row);
  }
  const byRoute = [...routes.values()]
    .map((r) => ({ ...r, connectRate: gatedRate(r.connected, r.attempted) }))
    .sort((a, b) => b.attempted - a.attempted || a.route.localeCompare(b.route));

  const objectionGroups = new Map<string, ObjectionFact[]>();
  for (const o of objections) objectionGroups.set(o.key, [...(objectionGroups.get(o.key) ?? []), o]);
  const objectionRows = [...objectionGroups.entries()]
    .map(([key, list]) => ({
      key,
      count: list.length,
      resolvedRate: gatedRate(list.filter((o) => o.handledOutcome === "RESOLVED").length, list.filter((o) => o.handledOutcome).length),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  // Conversion per lead: a lead counts once, however many calls it took.
  const leads = new Map<string, { booked: boolean; quoted: boolean; sold: boolean }>();
  for (const call of connected) {
    const entry = leads.get(call.leadId) ?? { booked: false, quoted: false, sold: false };
    entry.booked ||= call.bookedAfter;
    entry.quoted ||= call.quotedAfter;
    entry.sold ||= call.soldAfter;
    leads.set(call.leadId, entry);
  }
  const leadList = [...leads.values()];
  const bookings = leadList.filter((l) => l.booked).length;
  const quotes = leadList.filter((l) => l.quoted).length;
  const sales = leadList.filter((l) => l.sold).length;

  const costs = calls.map((c) => c.costGbp).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  const totalCost = costs.length ? Math.round(costs.reduce((s, v) => s + v, 0) * 10000) / 10000 : null;
  // Money per outcome, rounded to the penny (not a rate).
  const toPenny = (gbp: number) => Math.round(gbp * 100) / 100;
  const per = (n: number) => (totalCost !== null && n > 0 ? toPenny(totalCost / n) : null);

  return {
    hasData: calls.length > 0,
    calls: calls.length,
    attempted: attempted.length,
    connectRate: gatedRate(connected.length, attempted.length),
    voicemailRate: gatedRate(attempted.filter((c) => c.outcome === "VOICEMAIL").length, attempted.length),
    averageDurationSec: durations.length ? Math.round(mean(durations) as number) : null,
    durationSample: durations.length,
    byRoute,
    objections: objectionRows,
    conversion: {
      connectedLeads: leadList.length,
      booking: gatedRate(bookings, leadList.length),
      quote: gatedRate(quotes, leadList.length),
      sale: gatedRate(sales, leadList.length),
    },
    costPerOutcome: {
      restricted: true,
      totalCostGbp: totalCost,
      perConnectedCall: per(connected.length),
      perBooking: per(bookings),
      perQuote: per(quotes),
      perSale: per(sales),
    },
  };
}

/**
 * What a customer sees of voice: minutes used and outcomes, never a cost
 * (owner decision, 2026-09-30: "Hide voice call cost from customers"). The
 * cost-per-outcome block is dropped here, not just hidden, so it cannot reach
 * a browser; Admin reads voice costs from its own surfaces.
 */
export type CustomerVoiceAnalytics = Omit<VoiceAnalytics, "costPerOutcome"> & {
  /** Billed voice minutes in the period: the unit the customer buys. */
  minutesUsed: number;
};

export function toCustomerVoiceAnalytics(analytics: VoiceAnalytics, billedSeconds: number): CustomerVoiceAnalytics {
  const { costPerOutcome: _cost, ...rest } = analytics;
  void _cost;
  return { ...rest, minutesUsed: Math.round(Math.max(billedSeconds, 0) / 60) };
}

/** "3m 12s". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/* ====================================================================== ROI */

export type RoiInput = {
  /** Billed voice minutes in the period (settled ledger seconds / 60). */
  voiceMinutes: number;
  qualified: number;
  booked: number;
  quotes: number;
  sales: number;
  /** Recorded revenue, minor units per currency (attribution.ts rule). */
  attributedRevenueMinor: Record<string, number>;
  /** The attribution model the revenue figure was credited under. */
  model: string;
};

/** The ROI chain in minutes and outcomes. No voice spend, no return multiple: voice money is admin-only. */
export type RoiCard =
  | { status: "empty"; reason: string }
  | {
      status: "ready";
      steps: { key: "minutes" | "qualified" | "booked" | "quotes" | "sales" | "revenue"; label: string; value: string }[];
      revenueMinor: Record<string, number>;
      model: string;
    };

/**
 * The ROI chain renders ONLY with real data: at least one billed voice minute
 * AND at least one recorded revenue event. Anything less is an honest empty
 * state with the reason, never a row of zeroes.
 */
export function buildRoiCard(input: RoiInput): RoiCard {
  const revenueTotal = Object.values(input.attributedRevenueMinor).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (!(input.voiceMinutes > 0) && revenueTotal <= 0) {
    return { status: "empty", reason: "No voice minutes have been used and no payments have been recorded in this period." };
  }
  if (!(input.voiceMinutes > 0)) {
    return { status: "empty", reason: "No voice minutes have been used in this period, so there is nothing to measure a return on yet." };
  }
  if (revenueTotal <= 0) {
    return {
      status: "empty",
      reason: "No payment or won deal value has been recorded in this period. Revenue appears here once a payment is recorded; it is never estimated.",
    };
  }
  const money = Object.entries(input.attributedRevenueMinor)
    .filter(([, v]) => v > 0)
    .map(([currency, v]) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(v / 100))
    .join(" + ");
  return {
    status: "ready",
    steps: [
      { key: "minutes", label: "Voice minutes", value: Math.round(input.voiceMinutes).toLocaleString("en-GB") },
      { key: "qualified", label: "Qualified", value: input.qualified.toLocaleString("en-GB") },
      { key: "booked", label: "Booked", value: input.booked.toLocaleString("en-GB") },
      { key: "quotes", label: "Quotes sent", value: input.quotes.toLocaleString("en-GB") },
      { key: "sales", label: "Sales", value: input.sales.toLocaleString("en-GB") },
      { key: "revenue", label: "Attributed revenue", value: money },
    ],
    revenueMinor: input.attributedRevenueMinor,
    model: input.model,
  };
}
