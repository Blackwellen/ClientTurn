/**
 * Canonical V4 metric definitions (V4 §21.7).
 *
 * The rule this file exists to enforce: **every metric has exactly one backend
 * definition**, and no client component computes a different one. A card that
 * shows "reply rate" and a table that shows "reply rate" must be showing the
 * same number, derived the same way, or the whole Analytics module is
 * untrustworthy.
 *
 * Pure — no `server-only`, no Supabase — so the definitions can be unit-tested
 * and reused by the export route without dragging a client into scope.
 *
 * Two exclusions apply everywhere (§21.7): test leads/messages, and internal
 * support traffic. They are applied in the queries, not here, but every
 * definition below assumes they are already gone.
 */

export type AnalyticsView = "overview" | "acquisition" | "outreach" | "conversion";

export const ANALYTICS_VIEWS: AnalyticsView[] = [
  "overview",
  "acquisition",
  "outreach",
  "conversion",
];

export type MetricFormat = "count" | "percent" | "currency" | "duration";

export type MetricDefinition = {
  key: string;
  label: string;
  /** Shown in the UI so a number is never unexplained. */
  definition: string;
  format: MetricFormat;
  /** Higher is better. Drives the trend arrow's colour. */
  higherIsBetter: boolean;
};

/**
 * A ratio that returns null rather than 0 when the denominator is empty.
 *
 * This matters more than it looks: "0% reply rate" on a campaign that has sent
 * nothing is a lie that reads as failure. Null renders as "—".
 */
export function rate(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  return numerator / denominator;
}

/** Period-over-period change. Null when the baseline is empty, for the same
 *  reason: growth from zero is not "+100%", it is undefined. */
export function delta(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return (current - previous) / previous;
}

export const METRICS: Record<string, MetricDefinition> = {
  /* ---------------------------------------------------------- acquisition */
  prospects_discovered: {
    key: "prospects_discovered",
    label: "Prospects discovered",
    definition: "Unique prospect records created in the period, excluding duplicates and test data.",
    format: "count",
    higherIsBetter: true,
  },
  prospects_verified: {
    key: "prospects_verified",
    label: "Verified prospects",
    definition: "Prospects whose email passed the configured verification threshold.",
    format: "count",
    higherIsBetter: true,
  },
  prospects_ready: {
    key: "prospects_ready",
    label: "Ready for outreach",
    definition: "Verified prospects meeting the grade and eligibility gates, awaiting approval or send.",
    format: "count",
    higherIsBetter: true,
  },
  verification_rate: {
    key: "verification_rate",
    label: "Verification rate",
    definition: "Verified prospects divided by prospects with a discovered email address.",
    format: "percent",
    higherIsBetter: true,
  },
  a_grade_share: {
    key: "a_grade_share",
    label: "A/A+ share",
    definition: "Share of scored prospects graded A or A+.",
    format: "percent",
    higherIsBetter: true,
  },
  intent_matches: {
    key: "intent_matches",
    label: "Intent matches",
    definition: "Prospects with at least one unexpired intent signal at the end of the period.",
    format: "count",
    higherIsBetter: true,
  },
  sourcing_runs: {
    key: "sourcing_runs",
    label: "Sourcing runs",
    definition: "Sourcing runs started in the period, whatever their outcome.",
    format: "count",
    higherIsBetter: true,
  },

  /* -------------------------------------------------------------- outreach */
  emails_sent: {
    key: "emails_sent",
    label: "Emails sent",
    definition: "Outbound email messages that reached the provider, warm and cold combined.",
    format: "count",
    higherIsBetter: true,
  },
  sms_segments: {
    key: "sms_segments",
    label: "SMS segments",
    definition: "Billable outbound SMS segments. A long message counts as more than one.",
    format: "count",
    higherIsBetter: true,
  },
  whatsapp_messages: {
    key: "whatsapp_messages",
    label: "WhatsApp messages",
    definition: "Outbound WhatsApp messages accepted by the provider.",
    format: "count",
    higherIsBetter: true,
  },
  delivery_rate: {
    key: "delivery_rate",
    label: "Delivery rate",
    definition: "Messages confirmed delivered divided by messages sent.",
    format: "percent",
    higherIsBetter: true,
  },
  bounce_rate: {
    key: "bounce_rate",
    label: "Bounce rate",
    definition: "Messages that hard- or soft-bounced divided by messages sent.",
    format: "percent",
    higherIsBetter: false,
  },
  reply_rate: {
    key: "reply_rate",
    label: "Reply rate",
    definition: "Contacts who sent at least one inbound reply divided by contacts messaged.",
    format: "percent",
    higherIsBetter: true,
  },
  positive_reply_rate: {
    key: "positive_reply_rate",
    label: "Positive reply rate",
    definition:
      "Replies classified as positive interest or a meaningful question, divided by all replies.",
    format: "percent",
    higherIsBetter: true,
  },
  opt_out_rate: {
    key: "opt_out_rate",
    label: "Opt-out rate",
    definition: "Contacts who opted out divided by contacts messaged.",
    format: "percent",
    higherIsBetter: false,
  },

  /* ------------------------------------------------------------ conversion */
  leads: {
    key: "leads",
    label: "Leads",
    definition: "Lead records created in the period from every source, excluding test leads.",
    format: "count",
    higherIsBetter: true,
  },
  leads_promoted: {
    key: "leads_promoted",
    label: "Promoted from prospects",
    definition: "Leads created by promoting an engaged prospect.",
    format: "count",
    higherIsBetter: true,
  },
  qualified: {
    key: "qualified",
    label: "Qualified",
    definition: "Leads whose qualification reached QUALIFIED in the period.",
    format: "count",
    higherIsBetter: true,
  },
  booked: {
    key: "booked",
    label: "Booked",
    definition: "Leads with a confirmed booking created in the period.",
    format: "count",
    higherIsBetter: true,
  },
  won: {
    key: "won",
    label: "Won",
    definition: "Leads marked won in the period.",
    format: "count",
    higherIsBetter: true,
  },
  lead_to_qualified: {
    key: "lead_to_qualified",
    label: "Lead → qualified",
    definition: "Qualified leads divided by leads created in the period.",
    format: "percent",
    higherIsBetter: true,
  },
  qualified_to_goal: {
    key: "qualified_to_goal",
    label: "Qualified → goal",
    definition: "Leads reaching their conversion goal divided by qualified leads.",
    format: "percent",
    higherIsBetter: true,
  },
  lead_to_won: {
    key: "lead_to_won",
    label: "Lead → won",
    definition: "Leads marked won divided by leads created in the period.",
    format: "percent",
    higherIsBetter: true,
  },
  time_to_conversion: {
    key: "time_to_conversion",
    label: "Time to conversion",
    definition: "Median time from lead creation to reaching the conversion goal.",
    format: "duration",
    higherIsBetter: false,
  },
};

export function metric(key: string): MetricDefinition {
  const found = METRICS[key];
  if (!found) {
    // Loud rather than silent: an undefined metric key means a surface is
    // inventing a number, which is exactly what §21.7 forbids.
    throw new Error(`Unknown analytics metric: ${key}`);
  }
  return found;
}

/* ---------------------------------------------------------------- shaping */

export type MetricValue = {
  key: string;
  value: number | null;
  previous?: number | null;
  /** Convenience for the card: computed once here rather than per component. */
  change?: number | null;
};

export function metricValue(
  key: string,
  value: number | null,
  previous?: number | null,
): MetricValue {
  return {
    key,
    value,
    previous,
    change:
      value !== null && previous !== null && previous !== undefined
        ? delta(value, previous)
        : null,
  };
}

/* ------------------------------------------------------------- formatting */

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value === null || Number.isNaN(value)) return "—";

  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
    case "currency":
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(value);
    case "duration":
      return formatDuration(value);
    default:
      return value.toLocaleString("en-GB");
  }
}

/** Seconds to a human span. Deliberately coarse: "about 3 days" is more useful
 *  on a dashboard than "3d 4h 12m". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hr`;
  return `${Math.round(hours / 24)} days`;
}

/* ------------------------------------------------------------------ funnel */

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** Share of the first stage, so the bar widths are comparable. */
  shareOfTop: number | null;
  /** Share of the immediately preceding stage, which is the conversion people act on. */
  shareOfPrevious: number | null;
};

/**
 * Builds a funnel where each stage reports both its share of the top and its
 * step conversion. Showing only one of the two is how funnels mislead.
 */
export function buildFunnel(stages: { key: string; label: string; count: number }[]): FunnelStage[] {
  const top = stages[0]?.count ?? 0;
  return stages.map((stage, index) => ({
    ...stage,
    shareOfTop: rate(stage.count, top),
    shareOfPrevious: index === 0 ? null : rate(stage.count, stages[index - 1].count),
  }));
}
