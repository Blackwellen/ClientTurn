import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Signal, SignalKind } from "../signals";

/**
 * Reading and running signals.
 *
 * The health figures on each row are denormalised on `sourcing_signals` rather
 * than derived here, and that is deliberate: the Sources list renders every
 * signal on every visit, and deriving "how many leads did this produce" from
 * `prospects` per row is a scan per signal per render. They are written by the
 * run that produced them, which is the only place that knows.
 */

export async function listSignals(businessId: string): Promise<Signal[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_signals")
    .select(
      "id, name, kind, query, active, leads_found, leads_found_this_week, last_run_at, next_run_at, last_result",
    )
    .eq("business_id", businessId)
    // Active first, then by what they are actually producing. A dead signal
    // sinking to the bottom is the correct ordering for a list somebody scans
    // to decide what to fix.
    .order("active", { ascending: false })
    .order("leads_found_this_week", { ascending: false })
    .limit(60);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as SignalKind,
    query: row.query,
    active: row.active,
    leadsFound: row.leads_found,
    leadsFoundThisWeek: row.leads_found_this_week,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastResult: row.last_result,
  }));
}

/**
 * Records what a run found for one signal.
 *
 * Called by the sourcing run. `leadsFoundThisWeek` is recomputed rather than
 * incremented, because an incremented weekly counter never decreases and would
 * report a signal as productive months after it stopped producing.
 */
export async function recordSignalRun(input: {
  businessId: string;
  signalId: string;
  leadsFound: number;
  nextRunAt: Date | null;
  result: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const { data: current } = await admin
    .from("sourcing_signals")
    .select("leads_found, leads_found_this_week, last_run_at")
    .eq("business_id", input.businessId)
    .eq("id", input.signalId)
    .maybeSingle();

  // If the last run was over a week ago the weekly figure is stale, so it
  // restarts from this run rather than accumulating across a gap.
  const withinWeek =
    current?.last_run_at !== null &&
    current?.last_run_at !== undefined &&
    current.last_run_at >= weekAgo;

  await admin
    .from("sourcing_signals")
    .update({
      leads_found: (current?.leads_found ?? 0) + input.leadsFound,
      leads_found_this_week: withinWeek
        ? (current?.leads_found_this_week ?? 0) + input.leadsFound
        : input.leadsFound,
      last_run_at: now.toISOString(),
      next_run_at: input.nextRunAt?.toISOString() ?? null,
      last_result: input.result,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.signalId);
}

/**
 * Creates or updates the signal row for an approved strategy.
 *
 * Called when a plan is approved, which is the only moment a signal can
 * meaningfully come into existence: before approval there is nothing runnable
 * to point at, and `search_strategies` is where the runnable thing lives.
 *
 * Upserts on the natural key rather than inserting, so re-approving an edited
 * plan updates the existing signal instead of accumulating a row per approval —
 * which would fill the Sources list with duplicates named after the same search.
 */
export async function upsertStrategySignal(input: {
  businessId: string;
  strategyId: string;
  sessionId: string | null;
  agentId: string | null;
  name: string;
  kind: SignalKind;
  query: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_signals")
    .upsert(
      {
        business_id: input.businessId,
        agent_id: input.agentId,
        name: input.name,
        kind: input.kind,
        query: input.query,
        search_strategy_id: input.strategyId,
        session_id: input.sessionId,
        active: true,
      },
      { onConflict: "business_id,agent_id,name" },
    )
    .select("id")
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * The signal a run belongs to, if any.
 *
 * Looked up by strategy rather than carried on the run, because a run is
 * created by several paths — manual, recurring, signal launch — and only some
 * of them know about signals. Resolving from the strategy means every path
 * updates the signal's health without each having to remember to.
 */
export async function signalForStrategy(
  businessId: string,
  strategyId: string | null,
): Promise<string | null> {
  if (!strategyId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("sourcing_signals")
    .select("id")
    .eq("business_id", businessId)
    .eq("search_strategy_id", strategyId)
    .maybeSingle();

  return data?.id ?? null;
}
