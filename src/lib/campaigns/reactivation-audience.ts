/**
 * The single audience + suppression engine behind the reactivation wizard.
 *
 * Deliberately free of `server-only` and of any Supabase import: the same
 * functions power the Step 1 estimate, the Step 2 audience summary, the
 * Step 3 review, the server-side revalidation at launch and the unit tests.
 * There is exactly one implementation of "who would this campaign reach".
 */

import { LEAD_STATUSES, type LeadStatus } from "../leads/filters.ts";

/* --------------------------------------------------------- suppression --- */

/**
 * Ordered by priority. A lead can match several rules; the first match in
 * this order is the reason recorded, so per-reason counts are mutually
 * exclusive and always sum to the unique suppressed total. The order mirrors
 * how a human would explain the exclusion — a consent problem outranks a data
 * problem, which outranks an "already a customer" problem.
 */
export const SUPPRESSION_REASONS = [
  "opted_out",
  "invalid_number",
  "active_conversation",
  "contacted_recently",
  "already_booked",
  "won",
  "suppressed",
] as const;

export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

const REASON_LABELS: Record<SuppressionReason, string> = {
  opted_out: "Opted out",
  invalid_number: "Invalid number",
  active_conversation: "Active conversation",
  contacted_recently: "Recently contacted",
  already_booked: "Already booked",
  won: "Won customers",
  suppressed: "Deleted / suppressed",
};

/** The cooldown reason carries its own window, so the label is a function. */
export function suppressionReasonLabel(
  reason: SuppressionReason,
  cooldownDays?: number,
): string {
  if (reason === "contacted_recently" && cooldownDays !== undefined) {
    return `Recently contacted (${cooldownDays} days)`;
  }
  return REASON_LABELS[reason];
}

/** Copy for the "these are always excluded" panel on Step 1. */
export function suppressionRuleCards(cooldownDays: number) {
  return [
    { reason: "opted_out" as const, label: "Opted out of marketing" },
    { reason: "invalid_number" as const, label: "Invalid phone number" },
    { reason: "active_conversation" as const, label: "Active conversation" },
    {
      reason: "contacted_recently" as const,
      label: `Contacted in last ${cooldownDays} days (cooldown)`,
    },
    { reason: "already_booked" as const, label: "Already booked" },
    { reason: "won" as const, label: "Marked as won / closed" },
    { reason: "suppressed" as const, label: "Deleted or suppressed" },
  ];
}

/* --------------------------------------------------------- eligibility --- */

/** The minimum a lead row must carry to be judged. */
export type EligibilityLead = {
  id: string;
  status: string;
  optedOut: boolean;
  humanTakeover: boolean;
  /** Normalised address for the campaign channel, or null when unusable. */
  contact: string | null;
  lastContactAt: string | null;
  bookedAt: string | null;
  wonAt: string | null;
};

export type EligibilityContext = {
  /** Epoch millis, passed in so the same input always gives the same output. */
  now: number;
  cooldownDays: number;
  /** Normalised contacts on the workspace suppression list. */
  suppressedContacts: ReadonlySet<string>;
};

export type EligibilityVerdict =
  | { eligible: true; reason: null }
  | { eligible: false; reason: SuppressionReason };

/**
 * The authority on whether one contact may receive a reactivation message.
 * Used by the wizard estimate, the launch revalidation and the campaign
 * expansion job — never re-implemented at a call site.
 */
export function evaluateReactivationEligibility(
  lead: EligibilityLead,
  context: EligibilityContext,
): EligibilityVerdict {
  const deny = (reason: SuppressionReason): EligibilityVerdict => ({
    eligible: false,
    reason,
  });

  if (lead.optedOut) return deny("opted_out");
  if (!lead.contact) return deny("invalid_number");
  if (context.suppressedContacts.has(lead.contact)) return deny("suppressed");
  if (lead.humanTakeover) return deny("active_conversation");

  const cooldownBefore = context.now - context.cooldownDays * 864e5;
  if (
    lead.lastContactAt &&
    new Date(lead.lastContactAt).getTime() > cooldownBefore
  ) {
    return deny("contacted_recently");
  }

  if (lead.status === "WON" || lead.wonAt) return deny("won");
  if (lead.status === "BOOKED" || lead.bookedAt) return deny("already_booked");

  return { eligible: true, reason: null };
}

/* ---------------------------------------------------------- breakdowns --- */

export type BreakdownEntry = {
  key: string;
  label: string;
  count: number;
  /** 0–100, rounded. */
  share: number;
};

export type AudienceBreakdowns = {
  service: BreakdownEntry[];
  source: BreakdownEntry[];
  status: BreakdownEntry[];
  age: BreakdownEntry[];
};

export const BREAKDOWN_DIMENSIONS = [
  { key: "service", label: "Service" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "age", label: "Age" },
] as const;

export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number]["key"];

/** Lead row shape the breakdowns need, on top of eligibility. */
export type BreakdownLead = {
  service: string | null;
  source: string | null;
  status: string;
  createdAt: string;
};

const AGE_BUCKETS = [
  { label: "Under 3 months", maxDays: 90 },
  { label: "3-6 months", maxDays: 182 },
  { label: "6-12 months", maxDays: 365 },
  { label: "1-2 years", maxDays: 730 },
  { label: "Over 2 years", maxDays: Number.POSITIVE_INFINITY },
];

function ageBucket(createdAt: string, now: number): string {
  const days = (now - new Date(createdAt).getTime()) / 864e5;
  return AGE_BUCKETS.find((bucket) => days < bucket.maxDays)?.label ?? "Over 2 years";
}

export function leadStatusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * Top `limit` values plus a rolled-up "Other", so a long tail of services
 * never turns the breakdown card into a scrolling list.
 */
function rank(
  counts: Map<string, number>,
  total: number,
  limit: number,
): BreakdownEntry[] {
  const sorted = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  const tailCount = tail.reduce((sum, [, count]) => sum + count, 0);

  const entries = head.map(([label, count]) => ({ key: label, label, count }));
  if (tailCount > 0) {
    entries.push({ key: "__other", label: "Other", count: tailCount });
  }

  return entries.map((entry) => ({
    ...entry,
    share: total === 0 ? 0 : Math.round((entry.count / total) * 100),
  }));
}

/** Breakdowns are always computed over the *eligible* leads, never the match set. */
export function buildAudienceBreakdowns(
  leads: readonly BreakdownLead[],
  now: number,
): AudienceBreakdowns {
  const service = new Map<string, number>();
  const source = new Map<string, number>();
  const status = new Map<string, number>();
  const age = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);

  for (const lead of leads) {
    bump(service, lead.service ?? "No service");
    bump(source, lead.source ?? "Unknown source");
    bump(status, leadStatusLabel(lead.status));
    bump(age, ageBucket(lead.createdAt, now));
  }

  const total = leads.length;
  const ageOrder = new Map(AGE_BUCKETS.map((bucket, i) => [bucket.label, i]));

  return {
    service: rank(service, total, 4),
    source: rank(source, total, 4),
    status: rank(status, total, 6),
    age: rank(age, total, AGE_BUCKETS.length).sort(
      (a, b) => (ageOrder.get(a.label) ?? 99) - (ageOrder.get(b.label) ?? 99),
    ),
  };
}

/* -------------------------------------------------------------- totals --- */

/**
 * How many messages a campaign could send. The follow-up leg is an upper
 * bound, never a promise: replies, bookings and opt-outs stop it at send time.
 */
export function estimateMessages(input: {
  eligible: number;
  initialSegments: number;
  followupEnabled: boolean;
  followupSegments: number;
}) {
  const initial = input.eligible * Math.max(1, input.initialSegments);
  const followup = input.followupEnabled
    ? input.eligible * Math.max(1, input.followupSegments)
    : 0;
  return { initial, followup, total: initial + followup };
}

/* ------------------------------------------------------ filter summary --- */

export type AudienceFilterSummary = {
  olderThanDays: number;
  statuses: readonly string[];
  serviceName: string | null;
  sourceName: string | null;
  noReply: boolean;
  markedLost: boolean;
  notBooked: boolean;
};

/** The "Ready to continue?" checklist — derived, never hand-written. */
export function audienceChecklist(
  source: "existing" | "csv",
  summary: AudienceFilterSummary,
): string[] {
  if (source === "csv") {
    return [
      "Using an imported CSV list",
      "Every row validated before import",
      "Suppression rules will be applied automatically",
    ];
  }

  const items = [
    "Using existing ClientTurn leads",
    `Leads older than ${summary.olderThanDays} days`,
  ];

  if (summary.statuses.length > 0) {
    items.push(`Status: ${summary.statuses.map(leadStatusLabel).join(", ")}`);
  } else if (summary.notBooked) {
    items.push("Status: Not booked");
  }

  if (summary.serviceName) items.push(`Service: ${summary.serviceName}`);
  if (summary.sourceName) items.push(`Source: ${summary.sourceName}`);
  if (summary.noReply) items.push("No reply required");
  if (summary.markedLost) items.push("Marked as lost only");

  items.push("Suppression rules will be applied automatically");
  return items;
}

export const ALL_LEAD_STATUSES: readonly LeadStatus[] = LEAD_STATUSES;
