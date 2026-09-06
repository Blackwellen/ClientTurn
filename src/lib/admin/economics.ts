import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin → Usage & Margins (V4 §46).
 *
 * Platform-only. Every number here is raw provider cost or contribution margin,
 * which §90 keeps out of any customer surface — this module is reachable only
 * from `/admin`, behind `requirePlatformAdmin`.
 *
 * All reads go through the service role because the underlying tables
 * (`cost_events`, `business_cost_daily`, `business_margin_monthly`,
 * `provider_price_book`) have RLS forced and no browser grants at all.
 */

export type MarginState = "HEALTHY" | "WATCH" | "WARNING" | "CRITICAL" | "NO_REVENUE";

/** §98.1 — the guardrail bands. Stated once, here. */
export const MARGIN_BANDS: { state: MarginState; label: string; floor: number | null }[] = [
  { state: "HEALTHY", label: "≥ 75%", floor: 75 },
  { state: "WATCH", label: "65 – 74.9%", floor: 65 },
  { state: "WARNING", label: "55 – 64.9%", floor: 55 },
  { state: "CRITICAL", label: "< 55%", floor: null },
];

export function marginTone(
  state: MarginState,
): "success" | "accent" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "HEALTHY":
      return "success";
    case "WATCH":
      return "accent";
    case "WARNING":
      return "warning";
    case "CRITICAL":
      return "danger";
    default:
      return "neutral";
  }
}

export type CustomerEconomicsRow = {
  businessId: string;
  businessName: string;
  planKey: string | null;
  subscriptionRevenue: number;
  overageRevenue: number;
  totalRevenue: number;
  totalCogs: number;
  contribution: number;
  marginPercent: number | null;
  marginState: MarginState;
  breakdown: {
    ai: number;
    sms: number;
    whatsapp: number;
    email: number;
    discovery: number;
    enrichment: number;
    verification: number;
    intent: number;
    stripe: number;
    infrastructure: number;
  };
};

export type ProviderSpendRow = {
  provider: string;
  category: string | null;
  events: number;
  totalCost: number;
  /** Distinct tenants that incurred this provider's cost in the period. */
  businesses: number;
};

export type EconomicsData = {
  period: string;
  totals: {
    revenue: number;
    cogs: number;
    contribution: number;
    marginPercent: number | null;
    customers: number;
  };
  bandCounts: Record<MarginState, number>;
  customers: CustomerEconomicsRow[];
  providers: ProviderSpendRow[];
  alerts: {
    id: string;
    businessId: string | null;
    businessName: string | null;
    alertType: string;
    severity: string;
    title: string;
    detail: string | null;
    createdAt: string;
  }[];
  /** True when no margin snapshot exists for the period yet. */
  awaitingRollup: boolean;
};

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** First day of the month, as the `billing_period` column stores it. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function loadEconomics(period?: string): Promise<EconomicsData> {
  const admin = createAdminClient();
  const billingPeriod = period ?? currentPeriod();

  const periodStart = new Date(`${billingPeriod}T00:00:00.000Z`);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  const [margins, businesses, costs, alerts] = await Promise.all([
    admin
      .from("business_margin_monthly")
      .select(
        `business_id, plan_key, subscription_revenue, overage_revenue, total_revenue,
         total_cogs, gross_contribution, gross_margin_percent, margin_state,
         ai_cost, sms_cost, whatsapp_cost, email_cost, stripe_cost,
         discovery_cost, enrichment_cost, verification_cost, intent_cost,
         allocated_platform_cost`,
      )
      .eq("billing_period", billingPeriod),
    admin.from("businesses").select("id, name"),
    // Provider spend is aggregated from the raw ledger so a provider that has
    // not yet been rolled into a margin snapshot still shows up.
    admin
      .from("cost_events")
      .select("provider, category, total_cost, business_id")
      .gte("occurred_at", periodStart.toISOString())
      .lt("occurred_at", periodEnd.toISOString())
      .limit(20000),
    admin
      .from("economics_alerts")
      .select("id, business_id, alert_type, severity, title, detail, created_at")
      .eq("status", "OPEN")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const nameById = new Map((businesses.data ?? []).map((row) => [row.id, row.name]));

  const customers: CustomerEconomicsRow[] = (margins.data ?? []).map((row) => ({
    businessId: row.business_id,
    businessName: nameById.get(row.business_id) ?? "Unknown workspace",
    planKey: row.plan_key,
    subscriptionRevenue: num(row.subscription_revenue),
    overageRevenue: num(row.overage_revenue),
    totalRevenue: num(row.total_revenue),
    totalCogs: num(row.total_cogs),
    contribution: num(row.gross_contribution),
    marginPercent: row.gross_margin_percent === null ? null : num(row.gross_margin_percent),
    marginState: (row.margin_state ?? "NO_REVENUE") as MarginState,
    breakdown: {
      ai: num(row.ai_cost),
      sms: num(row.sms_cost),
      whatsapp: num(row.whatsapp_cost),
      email: num(row.email_cost),
      discovery: num(row.discovery_cost),
      enrichment: num(row.enrichment_cost),
      verification: num(row.verification_cost),
      intent: num(row.intent_cost),
      stripe: num(row.stripe_cost),
      infrastructure: num(row.allocated_platform_cost),
    },
  }));

  // Worst margin first: this page exists to find the tenants losing money.
  customers.sort((a, b) => {
    if (a.marginPercent === null) return 1;
    if (b.marginPercent === null) return -1;
    return a.marginPercent - b.marginPercent;
  });

  const bandCounts: Record<MarginState, number> = {
    HEALTHY: 0,
    WATCH: 0,
    WARNING: 0,
    CRITICAL: 0,
    NO_REVENUE: 0,
  };
  for (const customer of customers) bandCounts[customer.marginState] += 1;

  const providerMap = new Map<string, ProviderSpendRow & { tenants: Set<string> }>();
  for (const row of costs.data ?? []) {
    const key = `${row.provider}:${row.category ?? "UNCATEGORISED"}`;
    const existing =
      providerMap.get(key) ??
      {
        provider: row.provider,
        category: row.category,
        events: 0,
        totalCost: 0,
        businesses: 0,
        tenants: new Set<string>(),
      };
    existing.events += 1;
    existing.totalCost += num(row.total_cost);
    if (row.business_id) existing.tenants.add(row.business_id);
    providerMap.set(key, existing);
  }

  const providers: ProviderSpendRow[] = [...providerMap.values()]
    .map(({ tenants, ...rest }) => ({ ...rest, businesses: tenants.size }))
    .sort((a, b) => b.totalCost - a.totalCost);

  const revenue = customers.reduce((sum, c) => sum + c.totalRevenue, 0);
  const cogs = customers.reduce((sum, c) => sum + c.totalCogs, 0);
  const contribution = revenue - cogs;

  return {
    period: billingPeriod,
    totals: {
      revenue,
      cogs,
      contribution,
      // Null rather than 0 when nothing has been billed: a platform with no
      // revenue this period has an undefined margin, not a catastrophic one.
      marginPercent: revenue > 0 ? (contribution / revenue) * 100 : null,
      customers: customers.length,
    },
    bandCounts,
    customers,
    providers,
    alerts: (alerts.data ?? []).map((row) => ({
      id: row.id,
      businessId: row.business_id,
      businessName: row.business_id ? (nameById.get(row.business_id) ?? null) : null,
      alertType: row.alert_type,
      severity: row.severity,
      title: row.title,
      detail: row.detail,
      createdAt: row.created_at,
    })),
    // The monthly rollup runs on the 1st, so the current month is normally
    // empty until then. Saying so beats showing a page of zeroes.
    awaitingRollup: customers.length === 0 && (costs.data ?? []).length > 0,
  };
}
