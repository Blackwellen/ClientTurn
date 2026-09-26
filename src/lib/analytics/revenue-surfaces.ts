/**
 * Pure rules behind the Phase 5 surfaces: the Dashboard's revenue-control
 * cards, the Analytics slices and the admin stuck-lead queue.
 *
 * No `server-only`, no Supabase, so every rule here is unit-tested
 * (tests/phase5-surfaces.test.ts) and shared by the server queries and the
 * components that render them. Every ratio goes through `rate()` from the
 * metric registry, so an empty denominator is "—" and never 0%.
 */

import {
  buildFunnel,
  formatMetric,
  rate,
  type FunnelStage,
} from "./v4-metrics.ts";

/* -------------------------------------------------------------- low sample */

/**
 * Below this many in the denominator a rate is shown with its denominator and
 * a "small sample" marker. 30 is the conventional floor below which a
 * proportion's interval is too wide to act on (design doc 05, Phase 5).
 */
export const LOW_SAMPLE_N = 30;

export type SampledRate = {
  /** numerator / denominator as a fraction, or null on an empty denominator. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** True when the denominator is positive but under LOW_SAMPLE_N. */
  lowSample: boolean;
};

export function sampledRate(
  numerator: number,
  denominator: number,
): SampledRate {
  const value = rate(numerator, denominator);
  return {
    value,
    numerator,
    denominator,
    lowSample: value !== null && denominator < LOW_SAMPLE_N,
  };
}

/** "12%", "—", or "40% (n=5)" when the sample is small. */
export function formatSampledRate(sample: SampledRate): string {
  const text = formatMetric(sample.value, "percent");
  if (sample.value === null || !sample.lowSample) return text;
  return `${text} (n=${sample.denominator})`;
}

/* ------------------------------------------------------------------ funnel */

export const REVENUE_FUNNEL_STAGES = [
  { key: "source", label: "Arrived" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "qualified", label: "Qualified" },
  { key: "booked", label: "Booked" },
  { key: "showed", label: "Showed" },
  { key: "won", label: "Won" },
] as const;

export type RevenueFunnelKey = (typeof REVENUE_FUNNEL_STAGES)[number]["key"];

export type RevenueFunnelStage = FunnelStage & {
  /** Step conversion with its denominator, for the small-sample marker. */
  step: SampledRate | null;
};

/**
 * The source -> won funnel. Counts are taken as given (a cohort's leads that
 * reached each stage); a stage with no data source is null and rendered as
 * "not tracked" rather than as zero, which would read as a collapse.
 */
export function assembleRevenueFunnel(
  counts: Record<RevenueFunnelKey, number | null>,
): (RevenueFunnelStage & { tracked: boolean })[] {
  const stages = REVENUE_FUNNEL_STAGES.map((stage) => ({
    key: stage.key as string,
    label: stage.label as string,
    count: counts[stage.key] ?? 0,
    tracked: counts[stage.key] !== null && counts[stage.key] !== undefined,
  }));
  const built = buildFunnel(stages);
  return built.map((stage, index) => {
    const tracked = stages[index].tracked;
    const previous = index > 0 ? stages[index - 1] : null;
    const step =
      tracked && previous && previous.tracked
        ? sampledRate(stage.count, previous.count)
        : null;
    return {
      ...stage,
      tracked,
      shareOfTop: tracked ? stage.shareOfTop : null,
      shareOfPrevious: step ? step.value : null,
      step,
    };
  });
}

/* ------------------------------------------------------------- stuck leads */

export const STUCK_AFTER_MS = 48 * 60 * 60 * 1000;

/** Statuses where there is nothing left to chase. */
const TERMINAL_STATUSES = new Set(["WON", "LOST", "BOOKED"]);

export type StuckLeadFacts = {
  status: string;
  optedOut: boolean;
  archivedAt: string | null;
  isTest: boolean;
  /** When the lead first replied: the definition of "engaged". */
  firstRepliedAt: string | null;
  /** The last outbound message on any of the lead's conversations. */
  lastOutboundAt: string | null;
  /** The last inbound message on any of the lead's conversations. */
  lastInboundAt: string | null;
};

/**
 * A stuck lead: contactable, engaged, and nothing has been done for it for
 * 48 hours. "Done" is the business's side of the conversation — the lead
 * writing again is not an action on it, it is more reason to act.
 */
export function isStuckLead(
  lead: StuckLeadFacts,
  now: Date = new Date(),
): boolean {
  if (lead.isTest || lead.optedOut || lead.archivedAt) return false;
  if (TERMINAL_STATUSES.has(lead.status)) return false;
  if (!lead.firstRepliedAt) return false;

  const lastAction = latest(lead.lastOutboundAt, null);
  // Never acted on since they engaged: measure from when they engaged, or
  // from their latest message if that is newer.
  const since =
    lastAction && lastAction >= Date.parse(lead.firstRepliedAt)
      ? lastAction
      : latest(lead.lastInboundAt, lead.firstRepliedAt);
  if (since === null) return false;
  return now.getTime() - since >= STUCK_AFTER_MS;
}

function latest(a: string | null, b: string | null): number | null {
  const values = [a, b]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

/* ------------------------------------------------------------ score bands */

export const SCORE_BANDS = ["A", "B", "C", "D", "UNSCORED"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

/** Grades are the bands: one definition, owned by the scoring engine. */
export function scoreBand(grade: string | null | undefined): ScoreBand {
  return grade === "A" || grade === "B" || grade === "C" || grade === "D"
    ? grade
    : "UNSCORED";
}

/* ---------------------------------------------------------- analytics slices */

export const SLICE_DIMENSIONS = [
  "source",
  "archetype",
  "campaign",
  "channel",
  "rep",
  "score_band",
  "method",
  "model",
  "geography",
  "offer",
] as const;
export type SliceDimension = (typeof SLICE_DIMENSIONS)[number];

export const SLICE_LABEL: Record<SliceDimension, string> = {
  source: "Source",
  archetype: "Industry / archetype",
  campaign: "Campaign",
  channel: "Channel",
  rep: "Rep",
  score_band: "Score band",
  method: "Method",
  model: "Model tier",
  geography: "Geography",
  offer: "Offer",
};

/**
 * Whether a slice is backed by data today. The unavailable ones are shown as
 * such with the reason, never filled with a plausible-looking number.
 */
export const SLICE_AVAILABILITY: Record<
  SliceDimension,
  { available: boolean; note: string }
> = {
  source: {
    available: true,
    note: "Attributed from lead touches, by the selected model.",
  },
  archetype: {
    available: true,
    note: "The archetype on the lead's current score.",
  },
  campaign: {
    available: true,
    note: "Ad or UTM campaign on the attributed touch.",
  },
  channel: {
    available: true,
    note: "Channel of the lead's first outbound message.",
  },
  rep: { available: true, note: "The person the lead is assigned to." },
  score_band: { available: true, note: "Grade of the lead's current score." },
  method: {
    available: true,
    note: "Strategy the conversation agent chose on its latest turn for the lead.",
  },
  model: {
    available: true,
    note: "Model tier of AI runs for the lead's workspace, by task.",
  },
  geography: {
    available: false,
    note: "Not yet available: leads carry a postcode but no normalised region to group by.",
  },
  offer: {
    available: false,
    note: "Not yet available: no offer is recorded against a lead or a message yet.",
  },
};

export const ATTRIBUTION_MODELS = ["first", "last", "linear"] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** The 0123 view each model reads. */
export const ATTRIBUTION_VIEW: Record<AttributionModel, string> = {
  first: "lead_first_touch",
  last: "lead_last_touch",
  linear: "lead_touch_linear_credit",
};

export type SliceOutcomeFlags = {
  contacted: boolean;
  replied: boolean;
  qualified: boolean;
  booked: boolean;
  won: boolean;
};

export type SliceRow = {
  key: string;
  label: string;
  /** Leads credited to this slice. Fractional under linear attribution. */
  leads: number;
  contacted: number;
  replied: number;
  qualified: number;
  booked: number;
  won: number;
  replyRate: SampledRate;
  qualifyRate: SampledRate;
  bookRate: SampledRate;
  winRate: SampledRate;
};

/**
 * Credits each lead's outcomes to its slice(s). `credit` is 1 for single-touch
 * models and the linear share otherwise, so a lead split three ways adds a
 * third of itself to each source. Rates are computed on the credited totals.
 */
export function aggregateSlices(
  entries: {
    key: string;
    label: string;
    credit: number;
    outcome: SliceOutcomeFlags;
  }[],
): SliceRow[] {
  const groups = new Map<
    string,
    {
      label: string;
      t: Omit<
        SliceRow,
        "key" | "label" | "replyRate" | "qualifyRate" | "bookRate" | "winRate"
      >;
    }
  >();
  for (const entry of entries) {
    const credit =
      Number.isFinite(entry.credit) && entry.credit > 0 ? entry.credit : 0;
    const group = groups.get(entry.key) ?? {
      label: entry.label,
      t: {
        leads: 0,
        contacted: 0,
        replied: 0,
        qualified: 0,
        booked: 0,
        won: 0,
      },
    };
    group.t.leads += credit;
    if (entry.outcome.contacted) group.t.contacted += credit;
    if (entry.outcome.replied) group.t.replied += credit;
    if (entry.outcome.qualified) group.t.qualified += credit;
    if (entry.outcome.booked) group.t.booked += credit;
    if (entry.outcome.won) group.t.won += credit;
    groups.set(entry.key, group);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return [...groups.entries()]
    .map(([key, { label, t }]) => {
      const leads = round(t.leads);
      const contacted = round(t.contacted);
      const replied = round(t.replied);
      const qualified = round(t.qualified);
      const booked = round(t.booked);
      const won = round(t.won);
      return {
        key,
        label,
        leads,
        contacted,
        replied,
        qualified,
        booked,
        won,
        replyRate: sampledRate(replied, contacted),
        qualifyRate: sampledRate(qualified, leads),
        bookRate: sampledRate(booked, leads),
        winRate: sampledRate(won, leads),
      };
    })
    .sort((a, b) => b.leads - a.leads);
}
