import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePlan } from "@/lib/find-leads/plan";
import { createRun } from "@/lib/find-leads/server/runs";

/**
 * Recurring sourcing.
 *
 * A schedule re-runs a plan the customer already approved — it never
 * re-derives targeting, and it never runs a plan that has been edited since
 * approval (an edit sets the strategy back to DRAFT, and DRAFT plans are
 * skipped here). Each run still passes the full budget and entitlement check
 * in `createRun`, so a workspace that has run out of allowance simply produces
 * no run this cycle rather than overspending on a schedule nobody is watching.
 */

const CADENCE_DAYS: Record<string, number> = {
  DAILY: 1,
  WEEKLY: 7,
  FORTNIGHTLY: 14,
  MONTHLY: 30,
};

// The tick carries no payload: it sweeps every schedule that is due, so the
// job row is only a trigger.
export async function handleRecurringSearchTick(): Promise<void> {
  const admin = createAdminClient();

  const { data: due } = await admin
    .from("recurring_searches")
    .select(
      "id, business_id, session_id, search_strategy_id, cadence, target_per_run, max_cost_per_run_minor, approved_by, next_run_at",
    )
    .eq("status", "ACTIVE")
    .lte("next_run_at", new Date().toISOString())
    .limit(25);

  for (const schedule of due ?? []) {
    const { data: strategy } = await admin
      .from("search_strategies")
      .select("id, strategy_json, status")
      .eq("business_id", schedule.business_id)
      .eq("id", schedule.search_strategy_id)
      .maybeSingle();

    // Only an approved plan may run unattended. A superseded or draft plan
    // means the customer changed something and has not re-approved it.
    const plan = strategy?.status === "APPROVED" ? parsePlan(strategy.strategy_json) : null;

    if (plan) {
      await createRun({
        businessId: schedule.business_id,
        userId: schedule.approved_by ?? "",
        sessionId: schedule.session_id,
        strategyId: schedule.search_strategy_id,
        plan: {
          ...plan,
          targetVerifiedProspects: schedule.target_per_run || plan.targetVerifiedProspects,
          maxProviderCostMinor:
            Number(schedule.max_cost_per_run_minor) || plan.maxProviderCostMinor,
        },
        triggerSource: "RECURRING",
      }).catch(() => null);
    }

    const days = CADENCE_DAYS[schedule.cadence] ?? 7;
    await admin
      .from("recurring_searches")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: new Date(Date.now() + days * 864e5).toISOString(),
      })
      .eq("id", schedule.id);
  }
}
