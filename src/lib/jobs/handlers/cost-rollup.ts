import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { parsePayload } from "./parse";
import { costRollupDailyPayload, costRollupMonthlyPayload } from "./payloads";

/**
 * Daily/monthly cost rollups (§39-40). Derived, never authoritative: both
 * jobs recompute from cost_events (daily) or business_cost_daily (monthly)
 * on every run, so a re-run produces the same numbers rather than doubling
 * them — same invariant as usage-aggregate.ts.
 *
 * `allocated_platform_cost` and `overage_revenue` are left at 0: nothing in
 * this codebase yet tracks shared infrastructure allocation (§50) or metered
 * overage billing (§49), so reporting a number there would be invented, not
 * derived. subscription_revenue is the plan's list price, not a real Stripe
 * invoice total — an approximation until a billing_events ledger exists.
 */

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function lastMonthUtc(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function categoryFor(row: { provider: string; metric: string }): keyof CostBuckets {
  if (row.provider === "azure") return "ai_cost";
  if (row.provider === "twilio" && row.metric.includes("whatsapp")) return "whatsapp_cost";
  if (row.provider === "twilio") return "sms_cost";
  if (row.provider === "resend") return "email_cost";
  if (row.provider === "stripe") return "stripe_cost";
  return "other_cost";
}

type CostBuckets = {
  ai_cost: number;
  sms_cost: number;
  whatsapp_cost: number;
  email_cost: number;
  stripe_cost: number;
  other_cost: number;
};

function emptyBuckets(): CostBuckets {
  return { ai_cost: 0, sms_cost: 0, whatsapp_cost: 0, email_cost: 0, stripe_cost: 0, other_cost: 0 };
}

async function activeBusinessIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("businesses")
    .select("id")
    .in("status", ["active", "onboarding"])
    .limit(5000);
  return (data ?? []).map((row) => row.id);
}

export async function handleCostRollupDaily(job: ClaimedJob) {
  const payload = parsePayload(costRollupDailyPayload, job.payload);
  const admin = createAdminClient();

  const date = payload.date ?? yesterdayUtc();
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const businessIds = payload.businessId ? [payload.businessId] : await activeBusinessIds();

  for (const businessId of businessIds) {
    const { data } = await admin
      .from("cost_events")
      .select("provider, metric, total_cost")
      .eq("business_id", businessId)
      .gte("occurred_at", dayStart.toISOString())
      .lt("occurred_at", dayEnd.toISOString())
      .limit(20000);

    const buckets = emptyBuckets();
    for (const row of data ?? []) {
      buckets[categoryFor(row)] += Number(row.total_cost ?? 0);
    }
    const total_cost = Object.values(buckets).reduce((sum, v) => sum + v, 0);

    await admin.from("business_cost_daily").upsert(
      {
        business_id: businessId,
        date,
        ...buckets,
        infrastructure_allocated_cost: 0,
        total_cost,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,date" },
    );
  }
}

export async function handleCostRollupMonthly(job: ClaimedJob) {
  const payload = parsePayload(costRollupMonthlyPayload, job.payload);
  const admin = createAdminClient();

  const billingPeriod = payload.billingPeriod ?? lastMonthUtc();
  const periodStart = new Date(`${billingPeriod}T00:00:00.000Z`);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  const businessIds = payload.businessId ? [payload.businessId] : await activeBusinessIds();

  for (const businessId of businessIds) {
    const [daily, subscription] = await Promise.all([
      admin
        .from("business_cost_daily")
        .select("ai_cost, sms_cost, whatsapp_cost, email_cost, stripe_cost, infrastructure_allocated_cost")
        .eq("business_id", businessId)
        .gte("date", periodStart.toISOString().slice(0, 10))
        .lt("date", periodEnd.toISOString().slice(0, 10)),
      admin
        .from("subscriptions")
        .select("plan, status, billing_interval")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

    const totals = (daily.data ?? []).reduce(
      (sum, row) => ({
        ai_cost: sum.ai_cost + Number(row.ai_cost ?? 0),
        sms_cost: sum.sms_cost + Number(row.sms_cost ?? 0),
        whatsapp_cost: sum.whatsapp_cost + Number(row.whatsapp_cost ?? 0),
        stripe_cost: sum.stripe_cost + Number(row.stripe_cost ?? 0),
        allocated_platform_cost:
          sum.allocated_platform_cost + Number(row.infrastructure_allocated_cost ?? 0),
      }),
      { ai_cost: 0, sms_cost: 0, whatsapp_cost: 0, stripe_cost: 0, allocated_platform_cost: 0 },
    );

    const plan = subscription.data?.plan as PlanId | undefined;
    const interval = subscription.data?.billing_interval;
    const planDefinition = plan && plan !== "trial" ? PLANS[plan] : null;
    const subscriptionRevenue =
      subscription.data?.status && ["ACTIVE", "PAST_DUE"].includes(subscription.data.status)
        ? interval === "year"
          ? (planDefinition?.yearlyPrice ?? 0) / 12
          : planDefinition?.monthlyPrice ?? 0
        : 0;

    const overageRevenue = 0; // No metered-overage billing ledger exists yet (§49).
    const totalRevenue = subscriptionRevenue + overageRevenue;
    const totalCogs =
      totals.sms_cost + totals.whatsapp_cost + totals.ai_cost + totals.stripe_cost +
      totals.allocated_platform_cost;
    const grossContribution = totalRevenue - totalCogs;

    await admin.from("business_margin_monthly").upsert(
      {
        business_id: businessId,
        billing_period: billingPeriod,
        subscription_revenue: subscriptionRevenue,
        overage_revenue: overageRevenue,
        total_revenue: totalRevenue,
        sms_cost: totals.sms_cost,
        whatsapp_cost: totals.whatsapp_cost,
        ai_cost: totals.ai_cost,
        stripe_cost: totals.stripe_cost,
        allocated_platform_cost: totals.allocated_platform_cost,
        total_cogs: totalCogs,
        gross_contribution: grossContribution,
        gross_margin_percent: totalRevenue > 0 ? (grossContribution / totalRevenue) * 100 : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,billing_period" },
    );
  }
}
