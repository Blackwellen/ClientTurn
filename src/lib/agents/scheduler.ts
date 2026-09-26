import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePlan } from "@/lib/find-leads/plan";
import { createRun } from "@/lib/find-leads/server/runs";
import { runBookingTick, runReengagementTick, type TickResult } from "./ticks";
import {
  AgentBlocked,
  enrolmentScope,
  excludedProvidersFor,
  failureStatus,
  sourcingReviewMode,
  workForType,
  type AgentWork,
} from "./policy";

type DueAgent = {
  id: string;
  business_id: string;
  created_by: string | null;
  agent_type: string;
  autonomy: string;
  service_id: string | null;
  conversion_goal_id: string | null;
  search_strategy_id: string | null;
  next_run_at: string | null;
  cadence: string;
  daily_prospect_cap: number;
  monthly_prospect_cap: number;
};

type Db = ReturnType<typeof createAdminClient>;

/** Compare-and-swap the due timestamp before work: concurrent cron ticks cannot
 * spend twice for the same schedule. Every run rechecks subscription and budget.
 *
 * One tick does every job the agent's type covers (`workForType`): a combined
 * agent sources, then chases stalled bookings, then drafts re-engagement, each
 * behind its own guards and recorded separately on the agent's timeline. A job
 * that is blocked does not stop the others from running this tick. */
export async function scheduleAgents() {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: due, error } = await db.from("agents").select("id, business_id, created_by, agent_type, autonomy, service_id, conversion_goal_id, search_strategy_id, next_run_at, cadence, daily_prospect_cap, monthly_prospect_cap")
    .eq("status", "ACTIVE")
    .in("agent_type", ["SOURCING", "BOOKING", "REENGAGEMENT", "COMBINED"])
    .lte("next_run_at", now)
    // Longest-overdue first, then by id to break a tie deterministically.
    //
    // This claims at most three agents per tick, and without an ORDER BY
    // Postgres was free to return any three of the due set -- in practice the
    // same ones, in physical order, every tick. A workspace whose agents
    // happened to sit later in the heap could wait indefinitely while the same
    // three ran on the half-minute, and nothing would report it: each of those
    // three looks perfectly healthy, and a starved agent has no failure to log.
    //
    // Ordering by how overdue an agent is makes the queue fair by construction:
    // an agent that has waited longest is next, so the maximum wait is bounded
    // by the number of due agents rather than by where they sit on disk.
    .order("next_run_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(3);
  if (error) throw error;
  for (const agent of (due ?? []) as DueAgent[]) {
    const hours = ({ HOURLY: 1, DAILY: 24, WEEKLY: 168 } as Record<string, number>)[agent.cadence];
    // MANUAL has no next run: after this one the agent reads as idle until
    // someone presses Run once again (see `agentRunState`).
    const next = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null;
    const { data: claimed, error: claimError } = await db.from("agents").update({ next_run_at: next, last_run_at: now }).eq("id", agent.id).eq("status", "ACTIVE").eq("next_run_at", agent.next_run_at!).select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    const { data: current, error: currentError } = await db.from("agents").select("status").eq("id", agent.id).eq("business_id", agent.business_id).single();
    if (currentError || current?.status !== "ACTIVE") continue;

    let attention: { status: "NEEDS_ATTENTION" | "ERROR"; reason: string } | null = null;
    let lastRunStatus = "COMPLETED";

    for (const work of workForType(agent.agent_type as never)) {
      try {
        if (work === "SOURCING") {
          await runSourcing(db, agent);
          lastRunStatus = "QUEUED";
        } else {
          const result = work === "BOOKING" ? await runBookingTick(agent) : await runReengagementTick(agent);
          await recordTick(db, agent, work, result);
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "The run could not be started.";
        const status = failureStatus(e);
        // The most serious failure wins the agent's status; every failure is
        // on the timeline.
        if (!attention || status === "ERROR") attention = { status, reason };
        await db.from("agent_activity_events").insert({
          business_id: agent.business_id,
          agent_id: agent.id,
          event_type: "RUN_BLOCKED",
          severity: status === "ERROR" ? "ERROR" : "WARNING",
          title: `${WORK_LABELS[work]} needs attention`,
          detail: reason,
        });
      }
    }

    if (attention) {
      await db.from("agents").update({ status: attention.status, status_reason: attention.reason, last_run_status: attention.status === "ERROR" ? "FAILED" : "BLOCKED" }).eq("id", agent.id).eq("business_id", agent.business_id);
    } else {
      await db.from("agents").update({ last_run_status: lastRunStatus }).eq("id", agent.id).eq("business_id", agent.business_id);
    }
  }
}

const WORK_LABELS: Record<AgentWork, string> = {
  SOURCING: "Sourcing",
  BOOKING: "Booking follow-up",
  REENGAGEMENT: "Re-engagement",
};

async function recordTick(db: Db, agent: DueAgent, work: AgentWork, result: TickResult) {
  await db.from("agent_activity_events").insert({
    business_id: agent.business_id,
    agent_id: agent.id,
    event_type: "TICK_COMPLETED",
    severity: result.blocked > 0 ? "WARNING" : "SUCCESS",
    title: work === "BOOKING" ? "Checked for stalled bookings" : "Checked for quiet leads",
    detail: result.detail,
    metadata: {
      work,
      examined: result.examined,
      actioned: result.actioned,
      blocked: result.blocked,
    } as never,
  });
}

/**
 * Queues one sourcing run for the agent's approved plan, inside its caps,
 * restricted to the sources it allows, with the review mode its approval
 * setting asks for. Throws `AgentBlocked` for anything a person must fix.
 */
async function runSourcing(db: Db, agent: DueAgent) {
  const { data: strategy, error: strategyError } = await db.from("search_strategies").select("strategy_json, status").eq("id", agent.search_strategy_id ?? "").eq("business_id", agent.business_id).maybeSingle();
  if (strategyError) throw strategyError;
  const plan = strategy?.status === "APPROVED" ? parsePlan(strategy.strategy_json) : null;
  if (!plan) throw new AgentBlocked("The search plan needs approval in Find Leads.");

  const { data: sourceRows, error: sourceError } = await db.from("agent_sources").select("source_key").eq("business_id", agent.business_id).eq("agent_id", agent.id).eq("enabled", true);
  if (sourceError) throw sourceError;
  const enabled = (sourceRows ?? []).map((row) => row.source_key);

  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const { data: runs, error: runsError } = await db.from("sourcing_runs").select("target_verified, created_at, status").eq("business_id", agent.business_id).eq("agent_id", agent.id).gte("created_at", month.toISOString());
  if (runsError) throw runsError;
  if (runs?.some(r => ["QUEUED", "RUNNING", "PAUSED"].includes(r.status))) throw new AgentBlocked("A previous sourcing run is still open. Review it in Find Leads.");
  const monthly = (runs ?? []).reduce((n, r) => n + r.target_verified, 0);
  const daily = (runs ?? []).filter(r => r.created_at >= day.toISOString()).reduce((n, r) => n + r.target_verified, 0);
  const target = Math.min(plan.targetVerifiedProspects, agent.daily_prospect_cap - daily, agent.monthly_prospect_cap - monthly);
  if (target < 1) throw new AgentBlocked("The agent has reached its prospect limit. Review limits before restarting.");

  const reviewMode = sourcingReviewMode(agent.autonomy);
  const scope = enrolmentScope(agent.autonomy);
  const base = {
    businessId: agent.business_id,
    userId: agent.created_by!,
    sessionId: null,
    strategyId: agent.search_strategy_id,
    agentId: agent.id,
    triggerSource: "RECURRING" as const,
    excludedProviders: excludedProvidersFor(enabled),
  };

  let result = await createRun({
    ...base,
    plan: { ...plan, targetVerifiedProspects: target, reviewMode },
    ...(reviewMode === "AUTO_CONTACT" && scope !== "NONE" ? { enrolment: scope } : {}),
  });
  let fellBack: string | null = null;

  // Auto-contact needs a verified sender and an active acquisition campaign.
  // Without them the agent still runs, and everything waits for review.
  if (!result.ok && result.code === "AUTO_CONTACT_NOT_PERMITTED") {
    fellBack = result.message;
    result = await createRun({ ...base, plan: { ...plan, targetVerifiedProspects: target, reviewMode: "HUMAN_REVIEW" } });
  }
  if (!result.ok) throw new AgentBlocked(result.message);

  const reviewNote =
    fellBack !== null
      ? `Results wait for your review in Find Leads: ${fellBack}`
      : reviewMode === "HUMAN_REVIEW"
        ? "Results wait for your review in Find Leads."
        : scope === "KNOWN_COMPANIES"
          ? "Prospects at companies already in your workspace go to your active campaign; new companies wait for review."
          : "Prospects that match the plan go to your active campaign. Every message is checked before it sends.";

  await db.from("agent_activity_events").insert({ business_id: agent.business_id, agent_id: agent.id, event_type: "RUN_QUEUED", title: "Sourcing run queued", detail: `Searching for up to ${target} prospects. ${reviewNote}`, subject_type: "sourcing_run", subject_id: result.runId });
}
