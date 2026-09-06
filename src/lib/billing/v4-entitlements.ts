import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements, EntitlementError } from "./entitlements";

/**
 * V4 capacity entitlements (V4 §52, §96-97).
 *
 * Resolved from `plan_entitlements` rows rather than from a constant, so
 * confirming an allowance against real provider COGS is a row edit and not a
 * deploy. A per-tenant grant in `business_entitlement_grants` overrides the
 * plan default — that is how a support-approved trial extension or temporary
 * uplift works without editing the plan everyone else is on.
 *
 * Customers see allowances (prospects, searches, monitors, sends). They never
 * see the token or provider costs behind them, which is why nothing in this
 * module returns a cost.
 */

export type V4Metric =
  | "verified_prospect"
  | "search_run"
  | "saved_search"
  | "intent_monitor"
  | "sender_identity"
  | "email_sent"
  | "sourcing_enabled"
  | "cold_email_enabled";

export type MetricAllowance = {
  metric: V4Metric;
  /** Where the UI starts warning. */
  softLimit: number;
  /** What the server enforces. */
  hardLimit: number;
  overageAllowed: boolean;
  overagePrice: number | null;
  unit: string | null;
  /** True when a per-tenant grant replaced the plan default. */
  granted: boolean;
};

export type V4Entitlements = {
  plan: string;
  active: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  allowances: Record<V4Metric, MetricAllowance>;
  /** Capability switches, stored as 1/0 hard limits with unit 'boolean'. */
  sourcingEnabled: boolean;
  coldEmailEnabled: boolean;
};

const METRICS: V4Metric[] = [
  "verified_prospect",
  "search_run",
  "saved_search",
  "intent_monitor",
  "sender_identity",
  "email_sent",
  "sourcing_enabled",
  "cold_email_enabled",
];

/** Everything off. Used when a plan has no rows at all, so a misconfiguration
 *  denies capacity rather than granting it. */
function zeroAllowance(metric: V4Metric): MetricAllowance {
  return {
    metric,
    softLimit: 0,
    hardLimit: 0,
    overageAllowed: false,
    overagePrice: null,
    unit: null,
    granted: false,
  };
}

export const getV4Entitlements = cache(
  async (businessId: string): Promise<V4Entitlements> => {
    const base = await getEntitlements(businessId);
    const admin = createAdminClient();

    const [planRows, grantRows] = await Promise.all([
      admin
        .from("plan_entitlements")
        .select("metric, soft_limit, hard_limit, overage_allowed, overage_price, unit")
        .eq("plan_key", base.plan)
        .in("metric", METRICS),
      admin
        .from("business_entitlement_grants")
        .select("entitlement_key, numeric_value, boolean_value, expires_at, revoked_at")
        .eq("business_id", businessId)
        .is("revoked_at", null),
    ]);

    const allowances = Object.fromEntries(
      METRICS.map((m) => [m, zeroAllowance(m)]),
    ) as Record<V4Metric, MetricAllowance>;

    for (const row of planRows.data ?? []) {
      const metric = row.metric as V4Metric;
      if (!METRICS.includes(metric)) continue;
      allowances[metric] = {
        metric,
        softLimit: Number(row.soft_limit ?? 0),
        hardLimit: Number(row.hard_limit ?? 0),
        overageAllowed: Boolean(row.overage_allowed),
        overagePrice: row.overage_price === null ? null : Number(row.overage_price),
        unit: row.unit,
        granted: false,
      };
    }

    // A grant only ever raises a limit. A "grant" that lowered one would be a
    // downgrade dressed up as a favour, and support has no reason to issue it.
    const now = Date.now();
    for (const grant of grantRows.data ?? []) {
      const metric = grant.entitlement_key as V4Metric;
      if (!METRICS.includes(metric)) continue;
      if (grant.expires_at && new Date(grant.expires_at).getTime() <= now) continue;

      const current = allowances[metric];
      const value =
        grant.numeric_value !== null
          ? Number(grant.numeric_value)
          : grant.boolean_value
            ? 1
            : 0;

      if (value > current.hardLimit) {
        allowances[metric] = {
          ...current,
          softLimit: Math.max(current.softLimit, value),
          hardLimit: value,
          granted: true,
        };
      }
    }

    return {
      plan: base.plan,
      active: base.active,
      periodStart: base.periodStart,
      periodEnd: base.periodEnd,
      allowances,
      sourcingEnabled: allowances.sourcing_enabled.hardLimit > 0,
      coldEmailEnabled: allowances.cold_email_enabled.hardLimit > 0,
    };
  },
);

/**
 * Metrics the ledger records but the plan does not cap directly.
 *
 * `intent_monitor` is an entitlement on how many monitors may exist at once;
 * `intent_monitor_run` is the ledger event each time one executes. They are
 * deliberately different names because they count different things.
 */
export type V4UsageMetric = V4Metric | "intent_monitor_run" | "cold_email_sent";

/**
 * Usage of a V4 metric in the current billing period, read from the same
 * append-only ledger the rest of billing uses.
 */
export async function getV4Usage(
  businessId: string,
  metric: V4UsageMetric,
  since: string | null,
): Promise<number> {
  const admin = createAdminClient();
  const from = since ?? new Date(Date.now() - 30 * 864e5).toISOString();

  const { data } = await admin
    .from("usage_events")
    .select("quantity")
    .eq("business_id", businessId)
    .eq("metric", metric)
    .gte("occurred_at", from);

  return (data ?? []).reduce((total, row) => total + Number(row.quantity), 0);
}

export type CapacityCheck = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** True once usage passes the soft limit, so the UI can warn before it bites. */
  nearLimit: boolean;
  requiresOverage: boolean;
};

/**
 * Whether there is room for `quantity` more of a metric.
 *
 * Returns a verdict rather than throwing, because most callers want to show a
 * meter or disable a control. `assertCapacity` is the throwing form used at the
 * point of actually spending.
 */
export async function checkCapacity(
  businessId: string,
  metric: V4Metric,
  quantity = 1,
): Promise<CapacityCheck> {
  const entitlements = await getV4Entitlements(businessId);
  const allowance = entitlements.allowances[metric];
  const used = await getV4Usage(businessId, metric, entitlements.periodStart);

  const remaining = Math.max(0, allowance.hardLimit - used);
  const withinHard = used + quantity <= allowance.hardLimit;

  return {
    allowed: withinHard || allowance.overageAllowed,
    used,
    limit: allowance.hardLimit,
    remaining,
    nearLimit: used >= allowance.softLimit,
    requiresOverage: !withinHard && allowance.overageAllowed,
  };
}

/**
 * The gate every path that spends a V4 allowance calls. Overage is never
 * assumed: exceeding a hard limit requires both the plan to permit overage AND
 * the workspace to have switched it on with a cap (§27.3, §110).
 */
export async function assertCapacity(
  businessId: string,
  metric: V4Metric,
  quantity = 1,
): Promise<CapacityCheck> {
  const entitlements = await getV4Entitlements(businessId);

  if (!entitlements.active) {
    throw new EntitlementError(
      "This workspace does not have an active subscription.",
      "SUBSCRIPTION_INACTIVE",
    );
  }

  const check = await checkCapacity(businessId, metric, quantity);

  if (check.requiresOverage) {
    const overageOn = await isOverageEnabled(businessId);
    if (!overageOn) {
      throw new EntitlementError(
        `You have used your ${describeMetric(metric)} for this billing period. Turn on additional usage in Settings → Billing & Usage, or wait for the period to reset.`,
        "PLAN_LIMIT",
      );
    }
    return check;
  }

  if (!check.allowed) {
    throw new EntitlementError(
      `You have used your ${describeMetric(metric)} for this billing period.`,
      "PLAN_LIMIT",
    );
  }

  return check;
}

/** Capability switches, checked separately from quantities. */
export async function assertCapability(
  businessId: string,
  capability: "sourcing" | "cold_email",
): Promise<void> {
  const entitlements = await getV4Entitlements(businessId);

  if (capability === "sourcing" && !entitlements.sourcingEnabled) {
    throw new EntitlementError(
      "Find Leads is available on the Starter plan and above.",
      "FEATURE_LOCKED",
    );
  }
  if (capability === "cold_email" && !entitlements.coldEmailEnabled) {
    throw new EntitlementError(
      "Cold email campaigns are available on the Starter plan and above.",
      "FEATURE_LOCKED",
    );
  }
}

/** Automatic overage is OFF unless the workspace deliberately enabled it. */
export async function isOverageEnabled(businessId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_usage_allocations")
    .select("overage_enabled, overage_cap_minor")
    .eq("business_id", businessId)
    .order("billing_period", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Boolean(data?.overage_enabled && (data.overage_cap_minor ?? 0) > 0);
}

const METRIC_WORDS: Record<V4Metric, string> = {
  verified_prospect: "verified prospect allowance",
  search_run: "sourcing runs",
  saved_search: "saved searches",
  intent_monitor: "intent monitors",
  sender_identity: "sender identities",
  email_sent: "email allowance",
  sourcing_enabled: "sourcing capability",
  cold_email_enabled: "cold email capability",
};

export function describeMetric(metric: V4Metric): string {
  return METRIC_WORDS[metric] ?? metric.replace(/_/g, " ");
}
