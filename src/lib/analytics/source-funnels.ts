/**
 * Per-source conversion funnels (coverage tracker 8.16).
 *
 * Every source has its own natural first stage: LinkedIn outreach starts when
 * a connection request is sent, a lead form when it is submitted, Find Leads
 * when a prospect is found, an import when the record is added. After that
 * the journeys converge on the same lead stages (replied, qualified, booked,
 * showed, won), so one engine assembles them all.
 *
 * Pure — no `server-only`, no Supabase — so the rules are unit-tested
 * (tests/source-funnels.test.ts). The server read is `source-funnels-query.ts`.
 *
 * Three rules, the same as every other Analytics surface:
 *   * Nothing is inferred. A lead counts at a stage only when that stage's own
 *     timestamp or record exists; a qualified lead that never replied is not
 *     counted as having replied.
 *   * Step conversion is "of those who reached the previous stage, how many
 *     reached this one" — both stages observed on the same lead — so it can
 *     never exceed 100% even where stages happen out of order.
 *   * A stage with no data source is "not tracked", never 0, and a rate on an
 *     empty denominator is null ("—"), via `rate()`. Denominators under 30 are
 *     flagged, as everywhere else.
 */

import { rate } from "./v4-metrics.ts";
import { sampledRate, type SampledRate } from "./revenue-surfaces.ts";

/* ------------------------------------------------------------- families */

export type FunnelFamily =
  | "SOCIAL_OUTREACH"
  | "COLD_EMAIL"
  | "LEAD_FORM"
  | "SOCIAL_INBOUND"
  | "IMPORTED"
  | "UNKNOWN";

export type StageKey =
  | "entry"
  | "accepted"
  | "messaged"
  | "contactable"
  | "first_email"
  | "contacted"
  | "replied"
  | "promoted"
  | "qualified"
  | "booked"
  | "showed"
  | "won";

export type StageSpec = {
  key: StageKey;
  label: string;
  /** False where the stage is observed without a time, so no duration exists. */
  timed: boolean;
  /**
   * The system cannot observe this; a person records it (a booking marked as
   * attended, an opportunity closed won). Shown as "recorded by your team".
   */
  manual?: boolean;
};

const LEAD_TAIL: StageSpec[] = [
  { key: "qualified", label: "Qualified", timed: true },
  { key: "booked", label: "Meeting booked", timed: true },
  { key: "showed", label: "Showed", timed: true, manual: true },
  { key: "won", label: "Won", timed: true, manual: true },
];

export const FAMILY_STAGES: Record<FunnelFamily, StageSpec[]> = {
  SOCIAL_OUTREACH: [
    { key: "entry", label: "Connection request sent", timed: true },
    { key: "accepted", label: "Accepted", timed: true },
    { key: "messaged", label: "Messaged", timed: true },
    { key: "replied", label: "Replied", timed: true },
    { key: "promoted", label: "Became a lead", timed: true },
    ...LEAD_TAIL,
  ],
  COLD_EMAIL: [
    { key: "entry", label: "Prospect found", timed: true },
    // Eligibility and the first send are recorded as facts, not as moments:
    // the prospect row has no "became contactable" time and the recipient run
    // keeps only its latest send. Counted, never timed.
    { key: "contactable", label: "Contactable", timed: false },
    { key: "first_email", label: "First email sent", timed: false },
    { key: "replied", label: "Replied", timed: true },
    { key: "promoted", label: "Became a lead", timed: true },
    ...LEAD_TAIL,
  ],
  LEAD_FORM: [
    { key: "entry", label: "Form submitted", timed: true },
    { key: "contacted", label: "Contacted", timed: true },
    { key: "replied", label: "Replied", timed: true },
    ...LEAD_TAIL,
  ],
  SOCIAL_INBOUND: [
    { key: "entry", label: "Message received", timed: true },
    { key: "contacted", label: "Answered", timed: true },
    ...LEAD_TAIL,
  ],
  IMPORTED: [
    { key: "entry", label: "Imported", timed: true },
    { key: "contacted", label: "Contacted", timed: true },
    { key: "replied", label: "Replied", timed: true },
    ...LEAD_TAIL,
  ],
  UNKNOWN: [
    { key: "entry", label: "Created", timed: true },
    { key: "contacted", label: "Contacted", timed: true },
    { key: "replied", label: "Replied", timed: true },
    ...LEAD_TAIL,
  ],
};

export const FAMILY_LABEL: Record<FunnelFamily, string> = {
  SOCIAL_OUTREACH: "Social outreach",
  COLD_EMAIL: "Cold email",
  LEAD_FORM: "Lead form",
  SOCIAL_INBOUND: "Inbound message",
  IMPORTED: "Import",
  UNKNOWN: "Unknown source",
};

/* ------------------------------------------------------- classification */

const PROVIDER_LABEL: Record<string, string> = {
  meta: "Meta lead ads",
  facebook: "Meta lead ads",
  google_ads: "Google Ads lead forms",
  linkedin_ads: "LinkedIn Lead Gen Forms",
  tiktok_ads: "TikTok lead ads",
};

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type SourceGroup = {
  family: FunnelFamily;
  /** Stable grouping key. */
  key: string;
  label: string;
  /** Overrides the family's first-stage label where the entry reads differently. */
  entryLabel?: string;
};

/**
 * Which funnel a lead belongs to, from its first touch (the 0123 attribution
 * spine). A lead with no touch predates per-touch attribution and is grouped
 * as such rather than guessed at.
 */
export function classifyTouch(
  touch: { sourceType: string; provider: string } | null,
): SourceGroup {
  if (!touch) return { family: "UNKNOWN", key: "unknown", label: "Source not recorded" };
  const provider = touch.provider.trim().toLowerCase();
  switch (touch.sourceType) {
    case "AD_FORM":
      return {
        family: "LEAD_FORM",
        key: `form:${provider}`,
        label: PROVIDER_LABEL[provider] ?? `${titleCase(provider)} lead forms`,
      };
    case "WEB_FORM":
      return { family: "LEAD_FORM", key: "form:web", label: "Website forms" };
    case "SOCIAL_DM":
      return {
        family: "SOCIAL_INBOUND",
        key: `dm:${provider}`,
        label: `${titleCase(provider)} messages`,
      };
    case "CSV":
      return { family: "IMPORTED", key: "import:csv", label: "CSV import" };
    case "MANUAL":
      return { family: "IMPORTED", key: "import:manual", label: "Added manually", entryLabel: "Added" };
    case "API":
      return { family: "IMPORTED", key: "import:api", label: "API", entryLabel: "Created" };
    case "MCP":
      return { family: "IMPORTED", key: "import:mcp", label: "Connected assistant (MCP)", entryLabel: "Created" };
    case "CRM":
      return { family: "IMPORTED", key: `crm:${provider}`, label: `${titleCase(provider)} (CRM)`, entryLabel: "Synced" };
    case "CONNECTOR":
      return { family: "IMPORTED", key: `connector:${provider}`, label: titleCase(provider), entryLabel: "Received" };
    default:
      return { family: "UNKNOWN", key: `other:${touch.sourceType}`, label: titleCase(touch.sourceType) };
  }
}

const PLATFORM_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
};

export function socialOutreachGroup(platform: string): SourceGroup {
  const upper = platform.toUpperCase();
  return {
    family: "SOCIAL_OUTREACH",
    key: `social:${upper}`,
    label: `${PLATFORM_LABEL[upper] ?? titleCase(platform.toLowerCase())} outreach`,
    entryLabel: upper === "LINKEDIN" ? "Connection request sent" : "Request sent",
  };
}

export const COLD_EMAIL_GROUP: SourceGroup = {
  family: "COLD_EMAIL",
  key: "find_leads:email",
  label: "Find Leads (cold email)",
};

/* ----------------------------------------------------------- close types */

/** `opportunities.close_target` (0121), in the words a report uses. */
export const CLOSE_TYPE_LABEL: Record<string, string> = {
  BOOK: "Meeting booked",
  BUY: "Sale",
  TRIAL: "Sign-up",
  QUOTE: "Quote accepted",
  PROPOSAL: "Proposal accepted",
  APPLY: "Application",
  NEXT_STAGE: "Next stage agreed",
};

/* ------------------------------------------------------------- assembly */

/**
 * One subject's path through a funnel. A stage is reached when its value is a
 * timestamp or `true` (observed without a time); null or absent is not reached.
 */
export type Journey = {
  stages: Partial<Record<StageKey, string | true | null>>;
  /** The won opportunity's close target, when the journey was won. */
  closeType?: string | null;
};

export type FunnelStageResult = {
  key: StageKey;
  label: string;
  /** Null when the stage is not tracked for this source. */
  count: number | null;
  tracked: boolean;
  manual: boolean;
  /** count / entry. */
  shareOfEntry: number | null;
  /** Of those who reached the previous stage, the share who reached this one. */
  step: SampledRate | null;
  /** Median seconds from the previous stage, over journeys with both times. */
  medianSeconds: number | null;
  /** How many journeys the median is taken over. */
  timedSample: number;
  /**
   * Whether a time from the previous stage can exist at all: both stages are
   * recorded with a time. False renders as "not timed", never as a duration.
   */
  timed: boolean;
};

export type SourceFunnel = {
  family: FunnelFamily;
  key: string;
  label: string;
  entries: number;
  stages: FunnelStageResult[];
  /** Wins by close type, largest first. */
  closeTypes: { type: string; label: string; count: number }[];
};

function reached(value: string | true | null | undefined): boolean {
  return value === true || (typeof value === "string" && value.length > 0);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function assembleSourceFunnel(input: {
  group: SourceGroup;
  journeys: Journey[];
  /** Stages this source has no data for: shown as "not tracked". */
  untracked?: StageKey[];
}): SourceFunnel {
  const { group, journeys } = input;
  const untracked = new Set(input.untracked ?? []);
  const specs = FAMILY_STAGES[group.family].map((spec) =>
    spec.key === "entry" && group.entryLabel ? { ...spec, label: group.entryLabel } : spec,
  );
  const entries = journeys.filter((journey) => reached(journey.stages.entry)).length;

  const stages: FunnelStageResult[] = specs.map((spec, index) => {
    const tracked = !untracked.has(spec.key);
    const prior = index > 0 ? specs[index - 1] : null;
    const base = {
      key: spec.key,
      label: spec.label,
      tracked,
      manual: Boolean(spec.manual),
      timed: spec.timed && (prior ? prior.timed : true),
    };
    if (!tracked) {
      return { ...base, count: null, shareOfEntry: null, step: null, medianSeconds: null, timedSample: 0 };
    }

    const count = journeys.filter((journey) => reached(journey.stages[spec.key])).length;
    const previous = index > 0 ? specs[index - 1] : null;
    const previousTracked = previous ? !untracked.has(previous.key) : false;

    let step: SampledRate | null = null;
    let medianSeconds: number | null = null;
    let timedSample = 0;

    if (previous && previousTracked) {
      const both = journeys.filter(
        (journey) => reached(journey.stages[previous.key]) && reached(journey.stages[spec.key]),
      );
      const before = journeys.filter((journey) => reached(journey.stages[previous.key])).length;
      step = sampledRate(both.length, before);

      if (spec.timed && previous.timed) {
        const gaps: number[] = [];
        for (const journey of both) {
          const from = journey.stages[previous.key];
          const to = journey.stages[spec.key];
          if (typeof from !== "string" || typeof to !== "string") continue;
          const seconds = (Date.parse(to) - Date.parse(from)) / 1000;
          // Out-of-order stages (qualified from form answers before any reply)
          // have no meaningful "time from the previous stage".
          if (Number.isFinite(seconds) && seconds >= 0) gaps.push(seconds);
        }
        medianSeconds = median(gaps);
        timedSample = gaps.length;
      }
    }

    return {
      ...base,
      count,
      shareOfEntry: index === 0 ? null : rate(count, entries),
      step,
      medianSeconds,
      timedSample,
    };
  });

  const closeCounts = new Map<string, number>();
  for (const journey of journeys) {
    if (!reached(journey.stages.won)) continue;
    const type = journey.closeType ?? "UNRECORDED";
    closeCounts.set(type, (closeCounts.get(type) ?? 0) + 1);
  }
  const closeTypes = [...closeCounts.entries()]
    .map(([type, count]) => ({
      type,
      label: CLOSE_TYPE_LABEL[type] ?? "Close type not recorded",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return { family: group.family, key: group.key, label: group.label, entries, stages, closeTypes };
}

/**
 * Groups journeys by source and assembles a funnel per group, largest first.
 * Groups with no entries in the period are dropped rather than shown empty.
 */
export function assembleSourceFunnels(
  rows: { group: SourceGroup; journey: Journey }[],
  untrackedByFamily: Partial<Record<FunnelFamily, StageKey[]>> = {},
): SourceFunnel[] {
  const byKey = new Map<string, { group: SourceGroup; journeys: Journey[] }>();
  for (const row of rows) {
    const bucket = byKey.get(row.group.key) ?? { group: row.group, journeys: [] };
    bucket.journeys.push(row.journey);
    byKey.set(row.group.key, bucket);
  }
  return [...byKey.values()]
    .map(({ group, journeys }) =>
      assembleSourceFunnel({ group, journeys, untracked: untrackedByFamily[group.family] }),
    )
    .filter((funnel) => funnel.entries > 0)
    .sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label));
}
