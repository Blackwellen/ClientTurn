import "server-only";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { listRecentInvoices } from "@/lib/billing/invoices";
import { domainFromWebsite, titleise } from "./format";
import {
  adminRead,
  daysAgo,
  namesFor,
  rangeWindow,
  truncate,
  unique,
  type AdminClient,
} from "./shared";
import type { AdminRange } from "./types";
import type {
  BillingEventRow,
  BillingSummary,
  BillingView,
  BillingViewData,
  CreditEntryType,
  CreditRow,
  EntitlementRow,
  InvoiceRow,
  SubscriptionDetail,
  SubscriptionListResult,
  SubscriptionRow,
  SubscriptionStatus,
} from "./billing-types";

/**
 * The Admin Billing surface (V4 §45).
 *
 * Stripe is the source of truth for money; the `subscriptions` table is the
 * mirror its webhooks maintain. This module reads the mirror for lists (a
 * thousand Stripe calls to draw one table would be absurd) and reaches into
 * Stripe itself for the things only Stripe holds — invoices and the customer
 * record. Where a figure is a local mirror it is labelled as one on screen.
 *
 * Nothing here writes. Every controlled change lives in `billing-actions.ts`
 * and goes through the canonical billing service, never through a direct
 * `plan_id` update.
 */

export function planLabel(plan: string): string {
  if (plan === "trial") return "Trial";
  const definition = PLANS[plan as Exclude<PlanId, "trial">];
  return definition?.name ?? titleise(plan);
}

/** Monthly price for a plan, normalised so an annual subscription is comparable. */
function monthlyPriceFor(plan: string, interval: string | null): number {
  if (plan === "trial") return 0;
  const definition = PLANS[plan as Exclude<PlanId, "trial">];
  if (!definition) return 0;
  if (interval === "year") {
    return definition.yearlyPrice ? Math.round(definition.yearlyPrice / 12) : 0;
  }
  return definition.monthlyPrice ?? 0;
}

/** MRR only counts subscriptions that are actually billing. */
function contributesToMrr(status: string): boolean {
  return status === "ACTIVE" || status === "PAST_DUE";
}

type SubscriptionRecord = {
  id: string;
  business_id: string;
  plan: string;
  status: string;
  billing_interval: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  lead_limit: number;
  user_limit: number;
  created_at: string;
};

const SUBSCRIPTION_COLUMNS =
  "id, business_id, plan, status, billing_interval, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, stripe_customer_id, stripe_subscription_id, lead_limit, user_limit, created_at";

function toRow(
  record: SubscriptionRecord,
  business: { name: string; website: string | null } | undefined,
): SubscriptionRow {
  const status = record.status as SubscriptionStatus;
  const mrr = contributesToMrr(status)
    ? monthlyPriceFor(record.plan, record.billing_interval)
    : 0;

  return {
    id: record.id,
    businessId: record.business_id,
    businessName: business?.name ?? "Unknown workspace",
    domain: domainFromWebsite(business?.website ?? null),
    plan: record.plan,
    planLabel: planLabel(record.plan),
    status,
    mrr,
    billingCycle:
      record.billing_interval === "year"
        ? "Annual"
        : record.billing_interval === "month"
          ? "Monthly"
          : "—",
    currentPeriodStart: record.current_period_start,
    currentPeriodEnd: record.current_period_end,
    nextBillingDate: record.cancel_at_period_end ? null : record.current_period_end,
    cancelAtPeriodEnd: record.cancel_at_period_end,
    trialEndsAt: record.trial_ends_at,
    stripeSubscriptionId: record.stripe_subscription_id,
    stripeCustomerId: record.stripe_customer_id,
    // A workspace on trial that has never checked out has no Stripe state at
    // all. Showing "Active" for it would be a fabrication.
    stripeState: record.stripe_subscription_id ? status : null,
  };
}

/* ------------------------------------------------------------------ read --- */

export type BillingFilters = {
  view: BillingView;
  q: string;
  plan: string;
  status: string;
  cycle: string;
  range: AdminRange;
  page: number;
  pageSize: number;
};

export async function getBillingView(
  filters: BillingFilters,
  subscriptionId?: string,
): Promise<BillingViewData> {
  const supabase = await adminRead();

  const [summary, subscriptions] = await Promise.all([
    buildSummary(supabase, filters.range),
    listSubscriptions(supabase, filters),
  ]);

  const [invoicesResult, credits, entitlements, detail] = await Promise.all([
    filters.view === "invoices"
      ? listPlatformInvoices(supabase)
      : Promise.resolve({ rows: [] as InvoiceRow[], error: null as string | null }),
    filters.view === "credits" ? listCredits(supabase) : Promise.resolve([]),
    filters.view === "entitlements" ? listEntitlements(supabase) : Promise.resolve([]),
    subscriptionId ? getSubscriptionDetail(supabase, subscriptionId) : Promise.resolve(null),
  ]);

  return {
    view: filters.view,
    summary,
    subscriptions,
    invoices: invoicesResult.rows,
    invoiceError: invoicesResult.error,
    credits,
    entitlements,
    detail,
    plans: [
      { value: "trial", label: "Trial" },
      ...Object.values(PLANS).map((plan) => ({ value: plan.id, label: plan.name })),
    ],
  };
}

async function buildSummary(
  supabase: AdminClient,
  range: AdminRange,
): Promise<BillingSummary> {
  const window = rangeWindow(range);

  const { data } = await supabase
    .from("subscriptions")
    .select("plan, status, billing_interval, cancelled_at, created_at")
    .limit(20_000);

  const rows = data ?? [];
  let mrr = 0;
  let active = 0;
  let trials = 0;
  let pastDue = 0;
  let cancelled = 0;
  const byPlan = new Map<string, { count: number; mrr: number }>();

  for (const row of rows) {
    if (row.status === "ACTIVE") active += 1;
    else if (row.status === "TRIALING") trials += 1;
    else if (row.status === "PAST_DUE" || row.status === "UNPAID") pastDue += 1;
    else if (row.status === "CANCELLED") cancelled += 1;

    const value = contributesToMrr(row.status)
      ? monthlyPriceFor(row.plan, row.billing_interval)
      : 0;
    mrr += value;

    const slot = byPlan.get(row.plan) ?? { count: 0, mrr: 0 };
    slot.count += 1;
    slot.mrr += value;
    byPlan.set(row.plan, slot);
  }

  // Churn over the last 30 days: cancellations divided by the subscriptions
  // that existed at the start of the window. Null when there were none, rather
  // than a misleading 0%.
  const since = daysAgo(30);
  const churned = rows.filter(
    (row) => row.cancelled_at && row.cancelled_at >= since,
  ).length;
  const baseAtStart = rows.filter((row) => row.created_at < since).length;

  // The trend is the count of subscriptions created in each bucket, priced at
  // today's plan prices — the mirror does not keep a per-day MRR history, and
  // inventing one would be worse than showing growth in additions.
  const mrrSeries = new Array<number>(window.buckets).fill(0);
  for (const row of rows) {
    const created = new Date(row.created_at).getTime();
    if (created < window.start.getTime()) continue;
    const index = Math.min(
      window.buckets - 1,
      Math.floor((created - window.start.getTime()) / window.bucketMs),
    );
    mrrSeries[index] += monthlyPriceFor(row.plan, row.billing_interval);
  }

  return {
    totalSubscriptions: rows.length,
    active,
    trials,
    pastDue,
    cancelled,
    mrr,
    churnRate30d: baseAtStart === 0 ? null : churned / baseAtStart,
    mrrSeries,
    byPlan: [...byPlan.entries()]
      .map(([plan, slot]) => ({
        plan,
        label: planLabel(plan),
        count: slot.count,
        mrr: slot.mrr,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

async function listSubscriptions(
  supabase: AdminClient,
  filters: BillingFilters,
): Promise<SubscriptionListResult> {
  // A search term matches a workspace, so the business ids are resolved first
  // and the subscription query is narrowed to them.
  let businessIds: string[] | null = null;
  if (filters.q) {
    const { data: matches } = await supabase
      .from("businesses")
      .select("id")
      .or(`name.ilike.%${filters.q}%,website.ilike.%${filters.q}%`)
      .limit(200);
    businessIds = (matches ?? []).map((row) => row.id);
    if (businessIds.length === 0) {
      return { rows: [], total: 0, page: filters.page, pageSize: filters.pageSize };
    }
  }

  let query = supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS, { count: "exact" });

  if (businessIds) query = query.in("business_id", businessIds);
  if (filters.plan !== "all") query = query.eq("plan", filters.plan);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.cycle !== "all") query = query.eq("billing_interval", filters.cycle);

  const from = (filters.page - 1) * filters.pageSize;
  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + filters.pageSize - 1);

  const records = (data ?? []) as unknown as SubscriptionRecord[];
  const businesses = await businessesFor(
    supabase,
    records.map((row) => row.business_id),
  );

  return {
    rows: records.map((row) => toRow(row, businesses.get(row.business_id))),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

async function businessesFor(
  supabase: AdminClient,
  ids: string[],
): Promise<Map<string, { name: string; website: string | null }>> {
  const unique_ids = unique(ids);
  if (unique_ids.length === 0) return new Map();
  const { data } = await supabase
    .from("businesses")
    .select("id, name, website")
    .in("id", unique_ids);
  return new Map(
    (data ?? []).map((row) => [row.id, { name: row.name, website: row.website }]),
  );
}

/* -------------------------------------------------------------- invoices --- */

/**
 * Invoices come from Stripe, one customer at a time, so the platform-wide list
 * is deliberately capped at the most recently active workspaces. An operator
 * looking for one customer's invoices opens that customer.
 */
async function listPlatformInvoices(
  supabase: AdminClient,
): Promise<{ rows: InvoiceRow[]; error: string | null }> {
  const { data } = await supabase
    .from("subscriptions")
    .select("business_id, stripe_customer_id, current_period_end")
    .not("stripe_customer_id", "is", null)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(12);

  const records = data ?? [];
  const names = await namesFor(
    supabase,
    unique(records.map((row) => row.business_id)),
  );

  const rows: InvoiceRow[] = [];
  let failed = 0;

  for (const record of records) {
    const result = await listRecentInvoices(record.business_id, 3);
    if (!result.ok) {
      failed += 1;
      continue;
    }
    for (const invoice of result.invoices) {
      rows.push({
        id: invoice.id,
        number: invoice.number,
        businessId: record.business_id,
        businessName: names.get(record.business_id) ?? "Unknown workspace",
        createdAt: invoice.created,
        amount: invoice.amountDue,
        currency: invoice.currency,
        status: invoice.status,
        hostedUrl: invoice.hostedUrl,
        pdfUrl: invoice.pdfUrl,
      });
    }
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    rows,
    error:
      failed > 0
        ? `${failed} customer${failed === 1 ? "" : "s"} could not be read from Stripe just now. Billing is unaffected.`
        : null,
  };
}

/* --------------------------------------------------------------- credits --- */

async function listCredits(
  supabase: AdminClient,
  businessId?: string,
): Promise<CreditRow[]> {
  let query = supabase
    .from("billing_credit_entries")
    .select(
      "id, business_id, entry_type, amount_minor, currency, reason, support_reference, state, created_by_email, created_at, reverses_entry_id",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (businessId) query = query.eq("business_id", businessId);

  const { data } = await query;
  const rows = data ?? [];
  const names = await namesFor(supabase, unique(rows.map((row) => row.business_id)));

  // A reversal already posted against an entry makes that entry final.
  const reversed = new Set(
    rows.map((row) => row.reverses_entry_id).filter((id): id is string => !!id),
  );

  return rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    businessName: names.get(row.business_id) ?? "Unknown workspace",
    entryType: row.entry_type as CreditEntryType,
    amount: Number(row.amount_minor) / 100,
    currency: row.currency,
    reason: truncate(row.reason, 120),
    supportReference: row.support_reference,
    state: row.state as CreditRow["state"],
    createdBy: row.created_by_email,
    createdAt: row.created_at,
    reversible:
      row.state === "APPLIED" &&
      row.entry_type !== "REVERSAL" &&
      !reversed.has(row.id),
  }));
}

/* ---------------------------------------------------------- entitlements --- */

const ENTITLEMENT_LABELS: Record<string, string> = {
  lead_limit: "Lead allowance",
  user_limit: "Users",
  message_limit: "Message allowance",
  sms_segments: "SMS segments",
  ai_tokens: "AI tokens",
  sourcing_credits: "Sourcing allowance",
  intent_monitors: "Intent monitors",
  search_runs: "Search runs",
  whatsapp_enabled: "WhatsApp",
  campaigns_enabled: "Campaigns",
  ai_assist_allowed: "AI assist",
};

function entitlementLabel(key: string): string {
  return ENTITLEMENT_LABELS[key] ?? titleise(key);
}

async function listEntitlements(
  supabase: AdminClient,
  businessId?: string,
): Promise<EntitlementRow[]> {
  let query = supabase
    .from("business_entitlement_grants")
    .select(
      "id, business_id, entitlement_key, numeric_value, boolean_value, reason, granted_at, expires_at, revoked_at",
    )
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(50);

  if (businessId) query = query.eq("business_id", businessId);

  const { data } = await query;
  const rows = data ?? [];
  const ids = unique(rows.map((row) => row.business_id));
  const names = await namesFor(supabase, ids);

  const { data: subs } = ids.length
    ? await supabase
        .from("subscriptions")
        .select("business_id, plan, lead_limit, user_limit")
        .in("business_id", ids)
    : { data: [] };

  const planByBusiness = new Map(
    (subs ?? []).map((row) => [
      row.business_id,
      { plan: row.plan, leadLimit: row.lead_limit, userLimit: row.user_limit },
    ]),
  );

  const now = Date.now();

  return rows.map((row) => {
    const subscription = planByBusiness.get(row.business_id);
    const plan = subscription?.plan ?? "trial";
    const baseLimit =
      row.entitlement_key === "lead_limit"
        ? (subscription?.leadLimit ?? null)
        : row.entitlement_key === "user_limit"
          ? (subscription?.userLimit ?? null)
          : null;

    return {
      id: row.id,
      businessId: row.business_id,
      businessName: names.get(row.business_id) ?? "Unknown workspace",
      plan,
      planLabel: planLabel(plan),
      key: row.entitlement_key,
      keyLabel: entitlementLabel(row.entitlement_key),
      baseLimit,
      override: row.numeric_value === null ? null : Number(row.numeric_value),
      booleanValue: row.boolean_value,
      reason: truncate(row.reason, 120),
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
      expired: !!row.expires_at && new Date(row.expires_at).getTime() < now,
      source: "Admin grant" as const,
    };
  });
}

/* ---------------------------------------------------------------- detail --- */

async function getSubscriptionDetail(
  supabase: AdminClient,
  subscriptionId: string,
): Promise<SubscriptionDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) return null;

  const { data } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("id", subscriptionId)
    .maybeSingle();
  if (!data) return null;

  const record = data as unknown as SubscriptionRecord;
  const businesses = await businessesFor(supabase, [record.business_id]);
  const row = toRow(record, businesses.get(record.business_id));

  const [invoiceResult, credits, entitlements, events, usage] = await Promise.all([
    listRecentInvoices(record.business_id, 6),
    listCredits(supabase, record.business_id),
    listEntitlements(supabase, record.business_id),
    listBillingEvents(supabase, record.business_id),
    listUsage(supabase, record),
  ]);

  const invoices: InvoiceRow[] = invoiceResult.ok
    ? invoiceResult.invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        businessId: record.business_id,
        businessName: row.businessName,
        createdAt: invoice.created,
        amount: invoice.amountDue,
        currency: invoice.currency,
        status: invoice.status,
        hostedUrl: invoice.hostedUrl,
        pdfUrl: invoice.pdfUrl,
      }))
    : [];

  const noStripe = !record.stripe_subscription_id;

  return {
    ...row,
    // Card details are never read by an admin screen. Stripe's own dashboard
    // is the place to see them, which is what "View in Stripe" is for.
    paymentMethod: null,
    createdAt: record.created_at,
    price: monthlyPriceFor(record.plan, record.billing_interval),
    stripeDashboardUrl: record.stripe_customer_id
      ? `https://dashboard.stripe.com/customers/${record.stripe_customer_id}`
      : null,
    invoices,
    credits,
    entitlements,
    events,
    usage,
    canChangePlan: !noStripe && record.status !== "CANCELLED",
    canCancelAtPeriodEnd:
      !noStripe && !record.cancel_at_period_end && record.status !== "CANCELLED",
    canRevertCancellation: !noStripe && record.cancel_at_period_end,
    cancellationEffectiveOn: record.cancel_at_period_end
      ? record.current_period_end
      : null,
    actionBlockedReason: noStripe
      ? "This workspace has no Stripe subscription yet, so billing changes have nothing to act on."
      : record.status === "CANCELLED"
        ? "This subscription is cancelled. Changes must start from a new checkout."
        : null,
  };
}

/**
 * The billing timeline, assembled from the webhook events Stripe already sent.
 * Raw payloads are deliberately not surfaced here — a summary is what an
 * operator needs, and a payload can carry customer detail.
 */
async function listBillingEvents(
  supabase: AdminClient,
  businessId: string,
): Promise<BillingEventRow[]> {
  const { data } = await supabase
    .from("audit_log")
    .select("id, created_at, action, metadata")
    .eq("business_id", businessId)
    .like("action", "billing.%")
    .order("created_at", { ascending: false })
    .limit(12);

  return (data ?? []).map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      at: row.created_at,
      type: row.action,
      summary:
        typeof metadata.summary === "string"
          ? truncate(metadata.summary, 120)
          : titleise(row.action.replace("billing.", "")),
    };
  });
}

async function listUsage(
  supabase: AdminClient,
  record: SubscriptionRecord,
): Promise<{ label: string; used: number; limit: number | null }[]> {
  const periodStart = record.current_period_start ?? daysAgo(30);

  const [{ count: leads }, { count: messages }, { count: members }] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", record.business_id)
        .gte("created_at", periodStart),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("business_id", record.business_id)
        .gte("created_at", periodStart),
      supabase
        .from("business_members")
        .select("id", { count: "exact", head: true })
        .eq("business_id", record.business_id),
    ]);

  return [
    { label: "Leads this period", used: leads ?? 0, limit: record.lead_limit },
    { label: "Messages this period", used: messages ?? 0, limit: null },
    { label: "Users", used: members ?? 0, limit: record.user_limit },
  ];
}
