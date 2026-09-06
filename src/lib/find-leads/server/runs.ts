import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit, recordUsage } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { estimateRunCost } from "../cost-model";
import { checkPlanReadiness, describePlan, formatMinor, type SearchPlan } from "../plan";
import { currentStageNumber, progressPercent, STAGES, type StageKey } from "../stages";
import {
  EMPTY_COUNTERS,
  type ProviderActivity,
  type RunControls,
  type RunCounters,
  type RunIssueView,
  type RunMessageView,
  type RunStageView,
  type RunStatus,
  type SourcingRunView,
} from "../types";
import { resolveBudget } from "./budget";
import { CAPABILITY_ACTIVITY, CAPABILITY_UNIT } from "./providers/types";
import { providerByKey } from "./providers/registry";
import type { Capability } from "../cost-model";

/**
 * Sourcing runs: creation, reading, and the four controls a customer has over
 * one in flight.
 *
 * The rule this module exists to hold: a run is authorised once, at creation,
 * against a budget verdict computed server-side — and every later control
 * (resume, increase target) re-checks that authorisation rather than trusting
 * the envelope the run was born with. A workspace that ran out of allowance
 * while a run was paused must not be able to resume into spend it no longer
 * has.
 */

export type CreateRunResult =
  | { ok: true; runId: string }
  | { ok: false; code: CreateRunRejection; message: string };

export type CreateRunRejection =
  | "PLAN_NOT_READY"
  | "BUDGET_DENIED"
  | "NOT_ENTITLED"
  | "AUTO_CONTACT_NOT_PERMITTED";

/**
 * Auto-contact preconditions (V4 §10.14).
 *
 * Sourcing a contact is not permission to message them. Every one of these
 * must hold before a run may be created in AUTO_CONTACT mode, and they are all
 * re-checked at send time as well — this gate stops the run from being created
 * with an expectation the sender can never meet.
 */
async function autoContactPermitted(
  businessId: string,
): Promise<{ permitted: boolean; reason: string }> {
  const admin = createAdminClient();

  const [{ data: sender }, { data: campaign }] = await Promise.all([
    admin
      .from("sender_identities")
      .select("id, status")
      .eq("business_id", businessId)
      .eq("status", "VERIFIED")
      .limit(1)
      .maybeSingle(),
    admin
      .from("outreach_campaigns")
      .select("id, status")
      .eq("business_id", businessId)
      .in("status", ["READY", "ACTIVE"])
      .limit(1)
      .maybeSingle(),
  ]);

  if (!sender) {
    return {
      permitted: false,
      reason: "Connect and verify a sending identity before prospects can be contacted automatically.",
    };
  }
  if (!campaign) {
    return {
      permitted: false,
      reason: "Create an active acquisition campaign before prospects can be contacted automatically.",
    };
  }

  return { permitted: true, reason: "" };
}

/**
 * Creates a run and queues it. This is the only place a sourcing run comes
 * into existence, and it is reachable only from an explicit user action —
 * never from a chat turn.
 */
export async function createRun(input: {
  businessId: string;
  userId: string;
  sessionId: string | null;
  strategyId: string | null;
  agentId?: string;
  plan: SearchPlan;
  triggerSource?: "MANUAL" | "RECURRING";
}): Promise<CreateRunResult> {
  const readiness = checkPlanReadiness(input.plan);
  if (!readiness.ready) {
    return {
      ok: false,
      code: "PLAN_NOT_READY",
      message: "The search plan is not complete enough to run yet.",
    };
  }

  if (input.plan.reviewMode === "AUTO_CONTACT") {
    const auto = await autoContactPermitted(input.businessId);
    if (!auto.permitted) {
      return { ok: false, code: "AUTO_CONTACT_NOT_PERMITTED", message: auto.reason };
    }
  }

  const intentEnabled = input.plan.intent.categories.length > 0;
  const budget = await resolveBudget({
    businessId: input.businessId,
    requestedTarget: input.plan.targetVerifiedProspects,
    requestedCostCapMinor: input.plan.maxProviderCostMinor,
    intentEnabled,
  });

  if (!budget.allowed) {
    return {
      ok: false,
      code: budget.reason === "FEATURE_NOT_ENTITLED" ? "NOT_ENTITLED" : "BUDGET_DENIED",
      message: budgetMessage(budget.reason),
    };
  }

  const admin = createAdminClient();
  const estimate = estimateRunCost(budget.maxTarget, budget.unitCosts, { intentEnabled });
  const title = describePlan(input.plan);

  const { data: run, error } = await admin
    .from("sourcing_runs")
    .insert({
      business_id: input.businessId,
      agent_id: input.agentId ?? null,
      search_strategy_id: input.strategyId,
      session_id: input.sessionId,
      started_by: input.userId,
      trigger_source: input.triggerSource ?? "MANUAL",
      status: "QUEUED",
      title,
      current_stage: "UNDERSTANDING_TARGET",
      // The clamped values, never what the browser asked for.
      target_verified: budget.maxTarget,
      minimum_grade: input.plan.minimumGrade,
      review_before_outreach: input.plan.reviewMode === "HUMAN_REVIEW",
      max_total_cost_minor: budget.maxProviderCostMinor,
      max_provider_cost_minor: budget.maxProviderCostMinor,
      spent_cost_minor: 0,
      limits_json: {
        plan: input.plan,
        estimate: estimate.byCapability,
        unitCosts: budget.unitCosts,
        intentEnabled,
      } as never,
      counts_json: EMPTY_COUNTERS as never,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Twelve stage rows up front, so the run page can render the whole plan of
  // work from the first render rather than growing a list as it goes.
  await admin.from("sourcing_run_stages").insert(
    STAGES.map((stage) => ({
      business_id: input.businessId,
      run_id: run.id,
      stage_number: stage.number,
      stage_key: stage.key,
      status: "PENDING" as const,
    })),
  );

  if (input.strategyId) {
    await admin
      .from("search_strategies")
      .update({
        status: "APPROVED",
        approved_by: input.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", input.strategyId);
  }

  if (input.sessionId) {
    await admin
      .from("search_sessions")
      .update({ last_run_id: run.id })
      .eq("business_id", input.businessId)
      .eq("id", input.sessionId);

    await admin.from("search_messages").insert({
      business_id: input.businessId,
      session_id: input.sessionId,
      role: "SYSTEM_EVENT",
      content: `Sourcing run started for ${budget.maxTarget} verified prospects.`,
      structured_data: { runId: run.id } as never,
    });
  }

  await recordUsage({
    businessId: input.businessId,
    metric: "ai_call",
    quantity: 0,
    source: "sourcing_run_created",
    metadata: { runId: run.id },
  });

  await admin.from("usage_events").insert({
    business_id: input.businessId,
    metric: "search_run",
    quantity: 1,
    source: "find_leads",
    metadata: { runId: run.id } as never,
  });

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "sourcing_run.created",
    entityType: "sourcing_run",
    entityId: run.id,
    metadata: {
      target: budget.maxTarget,
      capMinor: budget.maxProviderCostMinor,
      sessionId: input.sessionId,
      triggerSource: input.triggerSource ?? "MANUAL",
    },
  });

  await enqueue(
    "sourcing.run",
    { runId: run.id, businessId: input.businessId },
    { businessId: input.businessId, idempotencyKey: `sourcing.run:${run.id}`, maxAttempts: 8 },
  );

  return { ok: true, runId: run.id };
}

function budgetMessage(reason: string): string {
  switch (reason) {
    case "PROSPECT_ALLOWANCE_EXHAUSTED":
      return "You have used your verified prospect allowance for this billing period.";
    case "SEARCH_RUN_ALLOWANCE_EXHAUSTED":
      return "You have used your sourcing runs for this billing period.";
    case "SUBSCRIPTION_INACTIVE":
      return "This workspace does not have an active subscription.";
    case "FEATURE_NOT_ENTITLED":
      return "Find Leads is not included on your plan.";
    default:
      return "There is not enough remaining allowance to start this run.";
  }
}

/* ------------------------------------------------------------------ reads */

/** Counters, read from the per-candidate outcome rows the run wrote. */
export async function readCounters(
  businessId: string,
  runId: string,
): Promise<RunCounters> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_run_results")
    .select("outcome")
    .eq("business_id", businessId)
    .eq("run_id", runId);

  const counters: RunCounters = { ...EMPTY_COUNTERS };

  for (const row of data ?? []) {
    switch (row.outcome) {
      case "COMPANY_FOUND":
        counters.companiesFound += 1;
        break;
      case "CONTACT_FOUND":
        counters.contactsFound += 1;
        break;
      case "EMAIL_FOUND":
        counters.emailsDiscovered += 1;
        break;
      case "VERIFIED":
        counters.verified += 1;
        break;
      case "DUPLICATE":
        counters.duplicates += 1;
        break;
      case "SUPPRESSED":
        counters.suppressed += 1;
        break;
      case "REVIEW_REQUIRED":
        counters.reviewRequired += 1;
        break;
      case "READY":
        counters.ready += 1;
        break;
      default:
        break;
    }
  }

  return counters;
}

/** Provider activity, aggregated from the run's own query log. */
async function readProviderActivity(
  businessId: string,
  runId: string,
  live: boolean,
): Promise<ProviderActivity[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_run_queries")
    .select("provider, capability, status, result_count")
    .eq("business_id", businessId)
    .eq("run_id", runId);

  const byProvider = new Map<
    string,
    { capability: Capability; count: number; failed: boolean; active: boolean }
  >();

  for (const row of data ?? []) {
    const entry = byProvider.get(row.provider) ?? {
      capability: row.capability as Capability,
      count: 0,
      failed: false,
      active: false,
    };
    entry.count += row.result_count;
    entry.capability = row.capability as Capability;
    if (row.status === "FAILED" || row.status === "RATE_LIMITED") entry.failed = true;
    if (row.status === "PENDING") entry.active = true;
    byProvider.set(row.provider, entry);
  }

  return [...byProvider.entries()].map(([key, entry]): ProviderActivity => {
    const provider = providerByKey(key);
    return {
      provider: key,
      displayName: provider?.displayName ?? key,
      // Present tense only while the run is live, so a finished run does not
      // claim to still be searching.
      activity: `${CAPABILITY_ACTIVITY[entry.capability]}${live && entry.active ? "…" : ""}`,
      resultCount: entry.count,
      unit: CAPABILITY_UNIT[entry.capability],
      state: entry.failed
        ? "DEGRADED"
        : entry.active && live
          ? "ACTIVE"
          : "DONE",
    };
  });
}

export async function getRun(
  businessId: string,
  runId: string,
  role: { canManage: boolean },
): Promise<SourcingRunView | null> {
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("sourcing_runs")
    // One string literal, not a concatenation: supabase-js infers the row
    // type from the literal, and a computed string loses that inference.
    .select(
      "id, title, status, session_id, target_verified, minimum_grade, review_before_outreach, progress_percent, started_at, completed_at, paused_reason, error_code, error_message, spent_cost_minor, max_provider_cost_minor, budget_state, limits_json",
    )
    .eq("business_id", businessId)
    .eq("id", runId)
    .maybeSingle();

  if (!run) return null;

  const live = run.status === "RUNNING" || run.status === "QUEUED";

  const [stages, issues, counters, providers, messages] = await Promise.all([
    admin
      .from("sourcing_run_stages")
      .select(
        "stage_number, stage_key, status, safe_summary, record_count, started_at, completed_at, duration_ms",
      )
      .eq("business_id", businessId)
      .eq("run_id", runId)
      .order("stage_number", { ascending: true }),
    admin
      .from("sourcing_run_issues")
      .select("id, severity, code, message, detail_json, requires_user_action, created_at")
      .eq("business_id", businessId)
      .eq("run_id", runId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    readCounters(businessId, runId),
    readProviderActivity(businessId, runId, live),
    run.session_id
      ? admin
          .from("search_messages")
          .select("id, role, content, created_at")
          .eq("business_id", businessId)
          .eq("session_id", run.session_id)
          .order("created_at", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const stageRows = (stages.data ?? []) as RunStageView[];
  const spent = Number(run.spent_cost_minor);
  const cap = Number(run.max_provider_cost_minor);

  return {
    id: run.id,
    title: run.title ?? "Sourcing run",
    status: run.status as RunStatus,
    sessionId: run.session_id,
    targetVerified: run.target_verified,
    minimumGrade: run.minimum_grade,
    reviewBeforeOutreach: run.review_before_outreach,
    progressPercent: run.progress_percent || progressPercent(stageRows),
    currentStageNumber: currentStageNumber(stageRows),
    startedAt: run.started_at,
    completedAt: run.completed_at,
    pausedReason: run.paused_reason,
    errorCode: run.error_code,
    errorMessage: run.error_message,
    providerCount: providers.length,
    counters,
    // Formatted server-side: §112 keeps raw provider figures out of the
    // browser, and the customer's own cap in their own money is what belongs
    // on the meter.
    budget: {
      spent: formatMinor(spent),
      cap: formatMinor(cap),
      percentUsed: cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0,
      state: run.budget_state as SourcingRunView["budget"]["state"],
    },
    stages: stageRows,
    providers,
    issues: (issues.data ?? []).map(
      (row): RunIssueView => ({
        id: row.id,
        severity: row.severity as RunIssueView["severity"],
        code: row.code,
        message: row.message,
        detail:
          typeof (row.detail_json as { detail?: unknown })?.detail === "string"
            ? ((row.detail_json as { detail: string }).detail)
            : null,
        requiresUserAction: row.requires_user_action,
        createdAt: row.created_at,
      }),
    ),
    messages: ((messages.data ?? []) as { id: string; role: string; content: string; created_at: string }[]).map(
      (row): RunMessageView => ({
        id: row.id,
        role: row.role as RunMessageView["role"],
        content: row.content,
        createdAt: row.created_at,
      }),
    ),
    controls: await resolveControls(businessId, run.status as RunStatus, role.canManage, counters),
  };
}

async function resolveControls(
  businessId: string,
  status: RunStatus,
  canManage: boolean,
  counters: RunCounters,
): Promise<RunControls> {
  const live = status === "RUNNING" || status === "QUEUED";
  const paused = status === "PAUSED";

  if (!canManage) {
    return {
      canPause: false,
      canResume: false,
      canStop: false,
      canIncreaseTarget: false,
      increaseTargetReason: "You need the admin role to change a sourcing run.",
    };
  }

  // Increase-target is a fresh authorisation, not a continuation of the one
  // the run started with: the workspace may have spent its allowance since.
  let increaseReason: string | null = null;
  let canIncrease = false;

  if (live || paused) {
    const budget = await resolveBudget({
      businessId,
      requestedTarget: 50,
      requestedCostCapMinor: 100_000,
      alreadyProduced: counters.ready,
    });
    canIncrease = budget.allowed && budget.maxTarget > 0;
    if (!canIncrease) increaseReason = budgetMessage(budget.reason);
  } else {
    increaseReason = "This run has finished.";
  }

  return {
    canPause: live,
    canResume: paused,
    canStop: live || paused,
    canIncreaseTarget: canIncrease,
    increaseTargetReason: increaseReason,
  };
}

export type RecentRun = {
  id: string;
  title: string;
  status: RunStatus;
  prospects: number;
  createdAt: string;
};

export async function listRecentRuns(
  businessId: string,
  limit = 6,
): Promise<RecentRun[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_runs")
    .select("id, title, status, counts_json, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const counts = (row.counts_json ?? {}) as Partial<RunCounters>;
    return {
      id: row.id,
      title: row.title ?? "Sourcing run",
      status: row.status as RunStatus,
      prospects: counts.ready ?? 0,
      createdAt: row.created_at,
    };
  });
}

/* --------------------------------------------------------------- controls */

export type ControlResult = { ok: boolean; message: string };

/**
 * Pause requests a stop; it does not abort mid-operation.
 *
 * The worker finishes the atomic operation it is inside — a provider batch
 * that has already been paid for — writes its checkpoint, and only then parks.
 * Killing it mid-batch would spend money and keep nothing.
 */
export async function pauseRun(input: {
  businessId: string;
  userId: string;
  runId: string;
}): Promise<ControlResult> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_runs")
    .update({ cancel_requested: true, paused_reason: "USER_PAUSED" })
    .eq("business_id", input.businessId)
    .eq("id", input.runId)
    .in("status", ["QUEUED", "RUNNING"])
    .select("id");

  if (!data?.length) return { ok: false, message: "This run cannot be paused." };

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "sourcing_run.paused",
    entityType: "sourcing_run",
    entityId: input.runId,
  });

  return { ok: true, message: "Pausing after the current step finishes." };
}

/** Resume re-checks entitlement before re-queueing: a paused run is not a
 *  standing authorisation to spend whatever it had left. */
export async function resumeRun(input: {
  businessId: string;
  userId: string;
  runId: string;
}): Promise<ControlResult> {
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("sourcing_runs")
    .select("id, status, target_verified, max_provider_cost_minor, spent_cost_minor")
    .eq("business_id", input.businessId)
    .eq("id", input.runId)
    .maybeSingle();

  if (!run || run.status !== "PAUSED") {
    return { ok: false, message: "This run cannot be resumed." };
  }

  const remaining = Number(run.max_provider_cost_minor) - Number(run.spent_cost_minor);
  const budget = await resolveBudget({
    businessId: input.businessId,
    requestedTarget: run.target_verified,
    requestedCostCapMinor: Math.max(0, remaining),
  });

  if (!budget.allowed) {
    return { ok: false, message: budgetMessage(budget.reason) };
  }

  await admin
    .from("sourcing_runs")
    .update({
      status: "QUEUED",
      cancel_requested: false,
      paused_reason: null,
      paused_at: null,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.runId);

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "sourcing_run.resumed",
    entityType: "sourcing_run",
    entityId: input.runId,
  });

  // A fresh idempotency key: the original job row is completed, and reusing
  // its key would silently drop the resume.
  await enqueue(
    "sourcing.run",
    { runId: input.runId, businessId: input.businessId },
    {
      businessId: input.businessId,
      idempotencyKey: `sourcing.run:${input.runId}:${Date.now()}`,
      maxAttempts: 8,
    },
  );

  return { ok: true, message: "Resuming from where it stopped." };
}

/** Stop is terminal, and deliberately non-destructive: results already
 *  produced stay, because the customer paid for them. */
export async function stopRun(input: {
  businessId: string;
  userId: string;
  runId: string;
}): Promise<ControlResult> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sourcing_runs")
    .update({
      status: "CANCELLED",
      cancel_requested: true,
      stopped_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("id", input.runId)
    .in("status", ["QUEUED", "RUNNING", "PAUSED"])
    .select("id");

  if (!data?.length) return { ok: false, message: "This run has already finished." };

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "sourcing_run.stopped",
    entityType: "sourcing_run",
    entityId: input.runId,
  });

  return { ok: true, message: "Run stopped. The prospects already found are kept." };
}

export async function increaseTarget(input: {
  businessId: string;
  userId: string;
  runId: string;
  additional: number;
}): Promise<ControlResult> {
  const admin = createAdminClient();
  const additional = Math.max(1, Math.min(1000, Math.floor(input.additional)));

  const { data: run } = await admin
    .from("sourcing_runs")
    .select("id, status, target_verified, max_provider_cost_minor, limits_json, counts_json")
    .eq("business_id", input.businessId)
    .eq("id", input.runId)
    .maybeSingle();

  if (!run || !["QUEUED", "RUNNING", "PAUSED"].includes(run.status)) {
    return { ok: false, message: "This run can no longer be re-targeted." };
  }

  const produced = ((run.counts_json ?? {}) as Partial<RunCounters>).ready ?? 0;

  const budget = await resolveBudget({
    businessId: input.businessId,
    requestedTarget: additional,
    requestedCostCapMinor: 1_000_000,
    alreadyProduced: produced,
  });

  if (!budget.allowed || budget.maxTarget <= 0) {
    return { ok: false, message: budgetMessage(budget.reason) };
  }

  // Only the granted delta is added — never what was asked for.
  const granted = Math.min(additional, budget.maxTarget);

  await admin
    .from("sourcing_runs")
    .update({
      target_verified: run.target_verified + granted,
      max_provider_cost_minor:
        Number(run.max_provider_cost_minor) + budget.maxProviderCostMinor,
      max_total_cost_minor:
        Number(run.max_provider_cost_minor) + budget.maxProviderCostMinor,
      budget_state: "WITHIN_BUDGET",
    })
    .eq("business_id", input.businessId)
    .eq("id", input.runId);

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "sourcing_run.target_increased",
    entityType: "sourcing_run",
    entityId: input.runId,
    metadata: { requested: additional, granted },
  });

  if (run.status === "PAUSED") {
    return resumeRun({ businessId: input.businessId, userId: input.userId, runId: input.runId });
  }

  return {
    ok: true,
    message:
      granted < additional
        ? `Target raised by ${granted}, which is what your remaining allowance covers.`
        : `Target raised by ${granted} prospects.`,
  };
}

export type { StageKey };
