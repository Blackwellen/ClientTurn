import "server-only";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { domainFromWebsite, jobLabel } from "./format";
import { getProviderHealth } from "./providers";
import {
  adminRead,
  changeRatio,
  namesFor,
  rangeWindow,
  unique,
  truncate,
  type AdminClient,
  type RangeWindow,
} from "./shared";
import type {
  ActionRequiredRow,
  AdminMetric,
  AdminOverview,
  AdminRange,
  FailedJobRow,
  RecentCustomerRow,
} from "./types";

/**
 * Overview is the most-loaded admin page, so every read below is either a
 * bounded query or a single pre-aggregated round trip, and they all run in
 * parallel. Nothing here scans the raw message table row by row: the
 * sparklines come from the admin_event_series aggregate (migration 0024).
 */

type SeriesRow = { metric: string; bucket: number; event_count: number };

/** Splits the doubled window the RPC returns into [previous, current]. */
function splitSeries(
  rows: SeriesRow[],
  metric: string,
  buckets: number,
): { previous: number[]; current: number[] } {
  const all = new Array<number>(buckets * 2).fill(0);
  for (const row of rows) {
    if (row.metric !== metric) continue;
    const index = row.bucket - 1;
    if (index >= 0 && index < all.length) all[index] = Number(row.event_count);
  }
  return { previous: all.slice(0, buckets), current: all.slice(buckets) };
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

function flowMetric(
  key: string,
  label: string,
  rows: SeriesRow[],
  window: RangeWindow,
  options: { invert?: boolean; hint?: string } = {},
): AdminMetric {
  const { previous, current } = splitSeries(rows, key, window.buckets);
  const value = sum(current);
  const previousValue = sum(previous);
  return {
    key,
    label,
    value,
    previous: previousValue,
    changeRatio: changeRatio(value, previousValue),
    series: current,
    invert: options.invert,
    hint: options.hint,
  };
}

/** Running total of items created at or before the end of each bucket. */
function cumulativeSeries(
  createdAt: string[],
  window: RangeWindow,
  weightOf: (index: number) => number = () => 1,
): { series: number[]; atStart: number } {
  const startMs = window.start.getTime();
  let atStart = 0;
  const perBucket = new Array<number>(window.buckets).fill(0);

  createdAt.forEach((value, index) => {
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) return;
    const weight = weightOf(index);
    if (t < startMs) {
      atStart += weight;
      return;
    }
    const bucket = Math.min(
      window.buckets - 1,
      Math.floor((t - startMs) / window.bucketMs),
    );
    if (bucket >= 0) perBucket[bucket] += weight;
  });

  let running = atStart;
  const series = perBucket.map((added) => {
    running += added;
    return running;
  });
  return { series, atStart };
}

function monthlyValueOf(plan: string, interval: string | null): number {
  const definition = PLANS[plan as Exclude<PlanId, "trial">];
  if (!definition || definition.monthlyPrice === null) return 0;
  return interval === "year" && definition.yearlyPrice !== null
    ? definition.yearlyPrice / 12
    : definition.monthlyPrice;
}

export async function getAdminOverview(
  range: AdminRange = "24h",
): Promise<AdminOverview> {
  const supabase = await adminRead();
  const now = new Date();
  const window = rangeWindow(range, now);

  const [
    seriesResult,
    businessRows,
    subscriptionRows,
    recentRows,
    failedJobRows,
    integrationRows,
    providers,
  ] = await Promise.all([
    supabase.rpc("admin_event_series", {
      p_start: window.previousStart.toISOString(),
      p_end: window.end.toISOString(),
      p_buckets: window.buckets * 2,
    }),
    supabase
      .from("businesses")
      .select("id, status, created_at")
      .order("created_at", { ascending: true })
      .limit(20000),
    supabase
      .from("subscriptions")
      .select(
        "business_id, plan, status, billing_interval, created_at, trial_ends_at, updated_at",
      )
      .limit(20000),
    supabase
      .from("businesses")
      .select("id, name, website, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("jobs")
      .select("id, type, business_id, last_error, attempts, created_at, state")
      .in("state", ["failed", "dead"])
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("integrations")
      .select("business_id, provider_type, status, last_error_at, last_error_message")
      .in("status", ["ACTION_REQUIRED", "DISCONNECTED", "DEGRADED"])
      .order("last_error_at", { ascending: false, nullsFirst: false })
      .limit(200),
    getProviderHealth(supabase),
  ]);

  const series = (seriesResult.data ?? []) as SeriesRow[];

  /* -------------------------------------------------------------- stocks */

  const activeBusinesses = (businessRows.data ?? []).filter(
    (row) => row.status === "active",
  );
  const activeCustomers = cumulativeSeries(
    activeBusinesses.map((row) => row.created_at),
    window,
  );

  const subscriptions = subscriptionRows.data ?? [];
  const trialing = subscriptions.filter((row) => row.status === "TRIALING");
  const trials = cumulativeSeries(
    trialing.map((row) => row.created_at),
    window,
  );

  const paying = subscriptions.filter((row) => row.status === "ACTIVE");
  const mrr = cumulativeSeries(
    paying.map((row) => row.created_at),
    window,
    (index) => monthlyValueOf(paying[index].plan, paying[index].billing_interval),
  );

  const suffix = range === "24h" ? " today" : "";

  const metrics: AdminMetric[] = [
    {
      key: "active_customers",
      label: "Active customers",
      value: activeCustomers.series[window.buckets - 1] ?? activeCustomers.atStart,
      previous: activeCustomers.atStart,
      changeRatio: changeRatio(
        activeCustomers.series[window.buckets - 1] ?? activeCustomers.atStart,
        activeCustomers.atStart,
      ),
      series: activeCustomers.series,
      hint: "Workspaces with status active. The line is the running total across the selected window.",
    },
    {
      key: "trials",
      label: "Trials",
      value: trials.series[window.buckets - 1] ?? trials.atStart,
      previous: trials.atStart,
      changeRatio: changeRatio(
        trials.series[window.buckets - 1] ?? trials.atStart,
        trials.atStart,
      ),
      series: trials.series,
      hint: "Subscriptions currently in TRIALING, plotted by the date each trial started.",
    },
    {
      key: "mrr",
      label: "MRR (mirror)",
      value: Math.round(mrr.series[window.buckets - 1] ?? mrr.atStart),
      money: true,
      previous: Math.round(mrr.atStart),
      changeRatio: changeRatio(
        mrr.series[window.buckets - 1] ?? mrr.atStart,
        mrr.atStart,
      ),
      series: mrr.series.map((value) => Math.round(value)),
      hint: "Local mirror of Stripe-backed subscriptions, priced from the plan catalogue. Stripe remains the source of truth for billing. The line plots subscriptions by start date and does not replay historic plan changes.",
    },
    flowMetric("signups", "New signups", series, window, {
      hint: "Workspaces created within the selected window.",
    }),
    // "today" is only true on the 24-hour window, so the noun follows the
    // selected range rather than being hard-coded to the reference screen.
    flowMetric("leads", "Leads processed", series, window, {
      hint: "Non-test leads received across every workspace.",
    }),
    flowMetric("messages", `Messages${suffix}`, series, window, {
      hint: "Inbound and outbound messages across every workspace.",
    }),
    flowMetric("bookings", `Bookings${suffix}`, series, window, {
      hint: "Bookings created across every workspace.",
    }),
    flowMetric("failed_jobs", "Failed jobs", series, window, {
      invert: true,
      hint: "Background jobs that entered a failed or dead state within the window.",
    }),
  ];

  /* ------------------------------------------------------------- panels */

  const subByBusiness = new Map(subscriptions.map((row) => [row.business_id, row]));

  const recentCustomers: RecentCustomerRow[] = (recentRows.data ?? []).map(
    (row) => {
      const sub = subByBusiness.get(row.id);
      return {
        id: row.id,
        name: row.name,
        domain: domainFromWebsite(row.website),
        planLabel: planLabelOf(sub?.plan ?? "trial"),
        subscriptionStatus: sub?.status ?? "TRIALING",
        joinedAt: row.created_at,
      };
    },
  );

  const actionRequired = await buildActionRequired(
    supabase,
    subscriptions,
    integrationRows.data ?? [],
    businessRows.data ?? [],
  );

  const jobNames = await namesFor(
    supabase,
    unique((failedJobRows.data ?? []).map((row) => row.business_id)),
  );

  const failedJobs: FailedJobRow[] = (failedJobRows.data ?? []).map((row) => ({
    id: row.id,
    jobType: row.type,
    jobLabel: jobLabel(row.type),
    businessId: row.business_id,
    businessName: row.business_id
      ? (jobNames.get(row.business_id) ?? "Unknown workspace")
      : null,
    error: truncate(row.last_error ?? "No error message recorded", 90),
    attempts: row.attempts,
    occurredAt: row.created_at,
    href: `/admin/system?view=events&type=job&status=FAILED&q=${encodeURIComponent(row.id)}`,
  }));

  return {
    range,
    generatedAt: now.toISOString(),
    metrics,
    providers,
    recentCustomers,
    actionRequired,
    failedJobs,
  };
}

function planLabelOf(plan: string): string {
  if (plan === "trial") return "Trial";
  return PLANS[plan as Exclude<PlanId, "trial">]?.name ?? plan;
}

type SubscriptionRow = {
  business_id: string;
  plan: string;
  status: string;
  billing_interval: string | null;
  created_at: string;
  trial_ends_at: string | null;
  updated_at: string;
};

type IntegrationRow = {
  business_id: string;
  provider_type: string;
  status: string;
  last_error_at: string | null;
  last_error_message: string | null;
};

/**
 * Every row here is a real, currently-true condition with somewhere to go.
 * Nothing is listed that an operator cannot act on from the destination.
 */
async function buildActionRequired(
  supabase: AdminClient,
  subscriptions: SubscriptionRow[],
  integrations: IntegrationRow[],
  businesses: { id: string; status: string; created_at: string }[],
): Promise<ActionRequiredRow[]> {
  const rows: ActionRequiredRow[] = [];
  const businessById = new Map(businesses.map((row) => [row.id, row]));

  const pastDue = subscriptions.filter(
    (row) => row.status === "PAST_DUE" || row.status === "UNPAID",
  );
  const endingSoon = subscriptions.filter((row) => {
    if (row.status !== "TRIALING" || !row.trial_ends_at) return false;
    const endsIn = new Date(row.trial_ends_at).getTime() - Date.now();
    return endsIn > 0 && endsIn <= 3 * 86_400_000;
  });

  const usageWatch = await highUsageWorkspaces(supabase, subscriptions);

  const names = await namesFor(
    supabase,
    unique([
      ...pastDue.map((row) => row.business_id),
      ...endingSoon.map((row) => row.business_id),
      ...usageWatch.map((row) => row.businessId),
      ...integrations.map((row) => row.business_id),
    ]),
  );
  const nameOf = (id: string) => names.get(id) ?? "Unknown workspace";
  const supportHref = (id: string) => `/admin/customers?customer=${id}`;

  for (const row of pastDue) {
    rows.push({
      id: `payment-${row.business_id}`,
      kind: "payment_failed",
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      detail:
        row.status === "UNPAID"
          ? "Subscription unpaid after repeated attempts"
          : "Invoice payment failed",
      occurredAt: row.updated_at,
      href: supportHref(row.business_id),
    });
  }

  for (const row of endingSoon) {
    const days = Math.max(
      0,
      Math.round(
        (new Date(row.trial_ends_at!).getTime() - Date.now()) / 86_400_000,
      ),
    );
    rows.push({
      id: `trial-${row.business_id}`,
      kind: "trial_ending",
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      detail: days <= 1 ? "Trial ends within a day" : `Trial ends in ${days} days`,
      occurredAt: row.trial_ends_at,
      href: supportHref(row.business_id),
    });
  }

  for (const row of usageWatch) {
    rows.push({
      id: `usage-${row.businessId}`,
      kind: "high_usage",
      businessId: row.businessId,
      businessName: nameOf(row.businessId),
      detail: `Workspace at ${Math.round(row.ratio * 100)}% of its lead allowance`,
      occurredAt: null,
      href: supportHref(row.businessId),
    });
  }

  const seenIntegration = new Set<string>();
  for (const row of integrations) {
    if (seenIntegration.has(row.business_id)) continue;
    if (row.status === "DEGRADED" && !row.last_error_at) continue;
    seenIntegration.add(row.business_id);
    const business = businessById.get(row.business_id);
    rows.push({
      id: `integration-${row.business_id}`,
      kind: business?.status === "suspended" ? "workspace_health" : "integration_error",
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      detail: truncate(
        row.last_error_message ??
          `${row.provider_type} connection ${row.status === "DISCONNECTED" ? "disconnected" : "needs attention"}`,
        80,
      ),
      occurredAt: row.last_error_at,
      href: supportHref(row.business_id),
    });
  }

  rows.sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
  return rows.slice(0, 8);
}

/**
 * Lead usage against the plan allowance for the current billing period.
 * Counted with head-only COUNT queries over an indexed range, bounded to the
 * workspaces that could plausibly be near a limit.
 */
async function highUsageWorkspaces(
  supabase: AdminClient,
  subscriptions: SubscriptionRow[],
): Promise<{ businessId: string; ratio: number }[]> {
  const candidates = subscriptions
    .filter((row) => row.status === "ACTIVE" || row.status === "TRIALING")
    .slice(0, 60);
  if (candidates.length === 0) return [];

  const { data: counters } = await supabase
    .from("usage_counters")
    .select("business_id, metric, quantity, period_start")
    .eq("metric", "lead_processed")
    .in(
      "business_id",
      candidates.map((row) => row.business_id),
    )
    .order("period_start", { ascending: false })
    .limit(500);

  const latestByBusiness = new Map<string, number>();
  for (const row of counters ?? []) {
    if (!latestByBusiness.has(row.business_id)) {
      latestByBusiness.set(row.business_id, Number(row.quantity ?? 0));
    }
  }

  const out: { businessId: string; ratio: number }[] = [];
  for (const subscription of candidates) {
    const used = latestByBusiness.get(subscription.business_id);
    if (used === undefined) continue;
    const limit =
      PLANS[subscription.plan as Exclude<PlanId, "trial">]?.leadLimit ?? 0;
    if (limit <= 0) continue;
    const ratio = used / limit;
    if (ratio >= 0.85) out.push({ businessId: subscription.business_id, ratio });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 3);
}

/* -------------------------------------------------------------- top bar --- */

export type AdminTopBarData = {
  recentCustomers: { id: string; name: string }[];
  /** Count of live action-required items, used by the notification bell. */
  alertCount: number;
};

/**
 * Two cheap reads for the shell. Kept separate from getAdminOverview so the
 * top bar does not pay for the whole Overview aggregate on every page.
 */
export async function getAdminTopBarData(): Promise<AdminTopBarData> {
  const supabase = await adminRead();

  const [recent, pastDue, integrationIssues] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("subscriptions")
      .select("business_id", { count: "exact", head: true })
      .in("status", ["PAST_DUE", "UNPAID"]),
    supabase
      .from("integrations")
      .select("business_id", { count: "exact", head: true })
      .in("status", ["ACTION_REQUIRED", "DISCONNECTED"]),
  ]);

  return {
    recentCustomers: (recent.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    alertCount: (pastDue.count ?? 0) + (integrationIssues.count ?? 0),
  };
}
