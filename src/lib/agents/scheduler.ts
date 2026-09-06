import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePlan } from "@/lib/find-leads/plan";
import { createRun } from "@/lib/find-leads/server/runs";

/** Compare-and-swap the due timestamp before work: concurrent cron ticks cannot
 * spend twice for the same schedule. Every run rechecks subscription and budget. */
export async function scheduleAgents() {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: due, error } = await db.from("agents").select("id, business_id, created_by, search_strategy_id, next_run_at, cadence, daily_prospect_cap, monthly_prospect_cap")
    .eq("status", "ACTIVE").eq("agent_type", "SOURCING").lte("next_run_at", now).limit(3);
  if (error) throw error;
  for (const agent of due ?? []) {
    const hours = ({ HOURLY: 1, DAILY: 24, WEEKLY: 168 } as Record<string, number>)[agent.cadence];
    const next = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null;
    const { data: claimed, error: claimError } = await db.from("agents").update({ next_run_at: next, last_run_at: now }).eq("id", agent.id).eq("status", "ACTIVE").eq("next_run_at", agent.next_run_at!).select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    try {
      const { data: current } = await db.from("agents").select("status").eq("id", agent.id).eq("business_id", agent.business_id).single();
      if (current?.status !== "ACTIVE") continue;
      const { data: strategy } = await db.from("search_strategies").select("strategy_json, status").eq("id", agent.search_strategy_id ?? "").eq("business_id", agent.business_id).maybeSingle();
      const plan = strategy?.status === "APPROVED" ? parsePlan(strategy.strategy_json) : null;
      if (!plan) throw new Error("The search plan needs approval in Find Leads.");
      const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
      const day = new Date(); day.setUTCHours(0, 0, 0, 0);
      const { data: runs, error: runsError } = await db.from("sourcing_runs").select("target_verified, created_at, status").eq("business_id", agent.business_id).eq("agent_id", agent.id).gte("created_at", month.toISOString());
      if (runsError) throw runsError;
      if (runs?.some(r => ["QUEUED", "RUNNING", "PAUSED"].includes(r.status))) throw new Error("A previous sourcing run is still open. Review it in Find Leads.");
      const monthly = (runs ?? []).reduce((n, r) => n + r.target_verified, 0);
      const daily = (runs ?? []).filter(r => r.created_at >= day.toISOString()).reduce((n, r) => n + r.target_verified, 0);
      const target = Math.min(plan.targetVerifiedProspects, agent.daily_prospect_cap - daily, agent.monthly_prospect_cap - monthly);
      if (target < 1) throw new Error("The agent has reached its prospect limit. Review limits before restarting.");
      const result = await createRun({ businessId: agent.business_id, userId: agent.created_by!, sessionId: null, strategyId: agent.search_strategy_id, agentId: agent.id, plan: { ...plan, targetVerifiedProspects: target, reviewMode: "HUMAN_REVIEW" }, triggerSource: "RECURRING" });
      if (!result.ok) throw new Error(result.message);
      await db.from("agent_activity_events").insert({ business_id: agent.business_id, agent_id: agent.id, event_type: "RUN_QUEUED", title: "Sourcing run queued", detail: `Searching for up to ${target} prospects. Results require review in Find Leads.`, subject_type: "sourcing_run", subject_id: result.runId });
      await db.from("agents").update({ last_run_status: "QUEUED" }).eq("id", agent.id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "The run could not be started.";
      await db.from("agents").update({ status: "NEEDS_ATTENTION", status_reason: reason, last_run_status: "BLOCKED" }).eq("id", agent.id);
      await db.from("agent_activity_events").insert({ business_id: agent.business_id, agent_id: agent.id, event_type: "RUN_BLOCKED", severity: "WARNING", title: "Run needs attention", detail: reason });
    }
  }
}
