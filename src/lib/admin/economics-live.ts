import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { USD_TO_GBP_MODEL, WHATSAPP_SERVICE_CHARGED_FROM } from "@/lib/billing/unit-costs";
import {
  economicsPeriods,
  economicsTotals,
  emptyUsage,
  periodEconomics,
  usageFromRpc,
  type EconomicsPeriod,
  type EconomicsTotals,
  type SubscriptionFacts,
  type UsageCounts,
  type WorkspaceEconomics,
  type WorkspaceInput,
} from "./economics-model";

/**
 * Admin → Economics: the live read.
 *
 * Counts come from `admin_economics_usage` (0145), summed in SQL so nothing is
 * truncated; pricing is `economics-model.ts` over `unit-costs.ts`. Nothing
 * calls Stripe: revenue is the subscription mirror and the locally recorded
 * top-up purchases. Service role, platform-admin callers only.
 */

export type PeriodEconomics = {
  period: { key: EconomicsPeriod["key"]; label: string; start: string; end: string; asOf: string; open: boolean };
  rows: WorkspaceEconomics[];
  totals: EconomicsTotals;
};

export type LiveEconomics =
  | { state: "ready"; mtd: PeriodEconomics; last: PeriodEconomics; generatedAt: string }
  | { state: "unavailable"; reason: string };

function untyped(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

async function usageFor(period: EconomicsPeriod): Promise<Map<string, UsageCounts>> {
  const { data, error } = await untyped().rpc("admin_economics_usage", {
    p_from: period.start.toISOString(),
    p_to: (period.open ? period.asOf : period.end).toISOString(),
    p_whatsapp_service_charged_from: `${WHATSAPP_SERVICE_CHARGED_FROM}T00:00:00.000Z`,
    p_usd_to_gbp: USD_TO_GBP_MODEL,
  });
  // A failed read must never render as a page of zero cost: zero cost is the
  // flattering answer, and nothing on the page would look wrong.
  if (error) throw new EconomicsUnavailableError(error.message, error.code);
  const map = new Map<string, UsageCounts>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const usage = usageFromRpc(row);
    map.set(usage.businessId, usage);
  }
  return map;
}

export class EconomicsUnavailableError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "EconomicsUnavailableError";
  }
}

type WorkspaceFacts = { names: Map<string, string>; subscriptions: Map<string, SubscriptionFacts> };

async function workspaceFacts(): Promise<WorkspaceFacts> {
  const admin = createAdminClient();
  const [businesses, subscriptions] = await Promise.all([
    admin.from("businesses").select("id, name").limit(20_000),
    admin
      .from("subscriptions")
      .select("business_id, plan, status, billing_interval, created_at, cancelled_at, trial_ends_at")
      .limit(20_000),
  ]);
  if (businesses.error) throw new EconomicsUnavailableError(businesses.error.message);
  if (subscriptions.error) throw new EconomicsUnavailableError(subscriptions.error.message);
  // Real billed MRR (0165), read on its own so economics still loads on list
  // prices before the migration is applied.
  const mrrRead = await (admin as unknown as import("@supabase/supabase-js").SupabaseClient)
    .from("subscriptions")
    .select("business_id, mrr_minor")
    .limit(20_000);
  const mrrBy = new Map<string, number | null>(
    mrrRead.error
      ? []
      : ((mrrRead.data ?? []) as { business_id: string; mrr_minor: number | string | null }[]).map((row) => [
          row.business_id,
          row.mrr_minor === null ? null : Number(row.mrr_minor),
        ]),
  );
  return {
    names: new Map((businesses.data ?? []).map((row) => [row.id, row.name])),
    subscriptions: new Map(
      (subscriptions.data ?? []).map((row) => [
        row.business_id,
        {
          plan: row.plan,
          status: row.status,
          billingInterval: row.billing_interval,
          createdAt: row.created_at,
          cancelledAt: row.cancelled_at,
          trialEndsAt: row.trial_ends_at,
          mrrMinor: mrrBy.get(row.business_id) ?? null,
        },
      ]),
    ),
  };
}

function periodDto(period: EconomicsPeriod): PeriodEconomics["period"] {
  return {
    key: period.key,
    label: period.label,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    asOf: period.asOf.toISOString(),
    open: period.open,
  };
}

/**
 * One period. A workspace appears when it used anything in the period, or
 * when it was on a paid plan in it (a paying workspace with no usage still
 * has revenue, fees and an allocation, and belongs in the margin).
 */
function buildPeriod(
  period: EconomicsPeriod,
  usage: Map<string, UsageCounts>,
  facts: WorkspaceFacts,
): PeriodEconomics {
  const ids = new Set(usage.keys());
  for (const [businessId, sub] of facts.subscriptions) {
    if (sub.plan !== "trial" && ["ACTIVE", "PAST_DUE", "CANCELLED"].includes(sub.status)) ids.add(businessId);
    if (sub.createdAt && sub.createdAt >= period.start.toISOString() && sub.createdAt < period.end.toISOString()) {
      ids.add(businessId);
    }
  }
  const inputs: WorkspaceInput[] = [...ids].map((businessId) => ({
    businessId,
    name: facts.names.get(businessId) ?? "Unknown workspace",
    subscription: facts.subscriptions.get(businessId) ?? null,
    usage: usage.get(businessId) ?? emptyUsage(businessId),
  }));
  const rows = periodEconomics(inputs, period).filter(
    // A cancelled workspace outside the period contributes nothing; drop it.
    (row) => row.revenue.total !== 0 || row.totalCost > 0 || row.trialStartedInPeriod || row.leads > 0,
  );
  return { period: periodDto(period), rows, totals: economicsTotals(rows) };
}

export async function loadLiveEconomics(now = new Date()): Promise<LiveEconomics> {
  const periods = economicsPeriods(now);
  try {
    const [mtdUsage, lastUsage, facts] = await Promise.all([
      usageFor(periods.mtd),
      usageFor(periods.last),
      workspaceFacts(),
    ]);
    return {
      state: "ready",
      mtd: buildPeriod(periods.mtd, mtdUsage, facts),
      last: buildPeriod(periods.last, lastUsage, facts),
      generatedAt: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof EconomicsUnavailableError) {
      // PGRST202: the function is not in the schema cache -- 0145 not applied.
      const missing = error.code === "PGRST202" || /admin_economics_usage/.test(error.message);
      return {
        state: "unavailable",
        reason: missing
          ? "The economics read model is not installed. Apply migration 0145_live_economics.sql."
          : `Usage could not be read: ${error.message}`,
      };
    }
    throw error;
  }
}

/** Month to date only: what the daily margin check needs. */
export async function loadMonthToDate(now = new Date()): Promise<{ period: EconomicsPeriod; rows: WorkspaceEconomics[] }> {
  const periods = economicsPeriods(now);
  const [usage, facts] = await Promise.all([usageFor(periods.mtd), workspaceFacts()]);
  return { period: periods.mtd, rows: buildPeriod(periods.mtd, usage, facts).rows };
}

export type MarginAlertRow = {
  id: string;
  businessId: string | null;
  businessName: string | null;
  severity: string;
  title: string;
  detail: string | null;
  createdAt: string;
};

/** Open "margin below 75%" alerts, newest first, for the Economics page. */
export async function loadOpenMarginAlerts(): Promise<MarginAlertRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("economics_alerts")
    .select("id, business_id, severity, title, detail, created_at")
    .eq("alert_type", "MARGIN_BELOW_THRESHOLD")
    .eq("status", "OPEN")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(`Could not read margin alerts: ${error.message}`);
  const ids = [...new Set((data ?? []).map((row) => row.business_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: businesses } = await admin.from("businesses").select("id, name").in("id", ids);
    for (const row of businesses ?? []) names.set(row.id, row.name);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_id ? (names.get(row.business_id) ?? null) : null,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
