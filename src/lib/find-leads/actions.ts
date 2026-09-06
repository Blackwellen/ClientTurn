"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireWorkspace, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { checkPlanReadiness, searchPlanSchema, type SearchPlan } from "./plan";
import {
  appendMessage,
  archiveSession,
  createSession,
  duplicateSession,
  getSession,
  renameSession,
  saveStrategy,
} from "./server/sessions";
import { runSearchAgentTurn } from "./server/search-agent";
import { resolveBudget } from "./server/budget";
import { estimateRunCost } from "./cost-model";
import { resolvePlanLocations } from "./server/locations";
import {
  createRun,
  increaseTarget,
  pauseRun,
  resumeRun,
  stopRun,
} from "./server/runs";
import {
  analysisRejectionSentence,
  listAnalysisFacts,
  startAnalysis,
} from "./server/analysis";
import { updateAcquisitionProfile } from "./server/profile";

/**
 * Every Find Leads mutation.
 *
 * Three invariants hold across all of them, and they are enforced here rather
 * than trusted from the caller:
 *
 *   * the workspace comes from the authenticated session, never from an
 *     argument — a session or run id in a URL is checked against it;
 *   * spending money requires the admin role *and* a fresh budget verdict;
 *   * a chat turn cannot start a run. `startSourcingRunAction` is the only
 *     path to provider spend, and it is reachable only from a button press.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function refresh(sessionId?: string, runId?: string) {
  revalidatePath("/app/find-leads");
  if (sessionId) revalidatePath(`/app/find-leads/search/${sessionId}`);
  if (runId) revalidatePath(`/app/find-leads/runs/${runId}`);
}

/** Read access: any member of an entitled workspace. */
async function requireFindLeads(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  const workspace = await requireWorkspace();
  try {
    await assertCapability(workspace.businessId, "sourcing");
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Find Leads is unavailable right now.");
  }
  return { ok: true, workspace };
}

/** Write access: admin and above. Sourcing spends money. */
async function requireFindLeadsAdmin(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return fail("Only owners and admins can run searches.");
  }
  try {
    await assertCapability(workspace.businessId, "sourcing");
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Find Leads is unavailable right now.");
  }
  return { ok: true, workspace };
}

/**
 * Confirms a session belongs to the caller's workspace before anything else
 * touches it. Returning "not found" rather than "forbidden" is deliberate: a
 * cross-tenant probe should not learn that the id exists.
 */
async function loadOwnedSession(businessId: string, sessionId: string) {
  const session = await getSession(businessId, sessionId);
  return session;
}

/* --------------------------------------------------------------- sessions */

const messageSchema = z.string().trim().min(1).max(2000);

export async function createSearchSessionAction(
  firstMessage?: unknown,
): Promise<ActionResult<{ sessionId: string }>> {
  const access = await requireFindLeads();
  if (!access.ok) return access;

  const message = firstMessage === undefined ? null : messageSchema.safeParse(firstMessage);
  if (message && !message.success) return fail("That message is too long.");

  const sessionId = await createSession({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    title: message?.success ? message.data.slice(0, 80) : "New search",
  });

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "search_session.created",
    entityType: "search_session",
    entityId: sessionId,
  });

  if (message?.success) {
    await sendSearchMessageAction(sessionId, message.data);
  }

  refresh(sessionId);
  return ok({ sessionId });
}

/**
 * One conversation turn.
 *
 * This is the expensive-looking path that must remain cheap: it calls the
 * language model and writes rows, and it calls no sourcing provider at all.
 * The plan it produces is inert until someone presses Start sourcing run.
 */
export async function sendSearchMessageAction(
  sessionId: unknown,
  message: unknown,
): Promise<ActionResult<{ planChanged: boolean }>> {
  const id = z.uuid().safeParse(sessionId);
  const text = messageSchema.safeParse(message);
  if (!id.success) return fail("That search session could not be found.");
  if (!text.success) return fail("Type a message first.");

  const access = await requireFindLeads();
  if (!access.ok) return access;

  const session = await loadOwnedSession(access.workspace.businessId, id.data);
  if (!session) return fail("That search session could not be found.");

  await appendMessage({
    businessId: access.workspace.businessId,
    sessionId: id.data,
    role: "USER",
    content: text.data,
  });

  const turn = await runSearchAgentTurn({
    businessId: access.workspace.businessId,
    plan: session.plan,
    history: session.messages.map((m) => ({ role: m.role, content: m.content })),
    message: text.data,
  });

  await appendMessage({
    businessId: access.workspace.businessId,
    sessionId: id.data,
    role: "ASSISTANT",
    content: turn.clarifyingQuestion
      ? `${turn.reply}\n\n${turn.clarifyingQuestion}`
      : turn.reply,
    structured: turn.planChanged ? { planSummary: turn.summaryLines } : null,
  });

  if (turn.planChanged) {
    await persistPlan({
      businessId: access.workspace.businessId,
      sessionId: id.data,
      plan: turn.plan,
      changedBy: "SEARCH_AGENT",
      userId: null,
    });

    // The session's name follows the plan until a person renames it, so the
    // rail reads as a list of searches rather than a list of "New search".
    if (session.title === "New search" || session.title === text.data.slice(0, 80)) {
      await renameSession(
        access.workspace.businessId,
        id.data,
        turn.plan.industries.length && turn.plan.locations.length
          ? `${turn.plan.industries[0]} in ${turn.plan.locations[0].city ?? turn.plan.locations[0].region ?? turn.plan.locations[0].country}`
          : text.data.slice(0, 80),
      );
    }
  }

  refresh(id.data);
  return ok({ planChanged: turn.planChanged });
}

/** Writes a plan version with a fresh cost estimate attached. */
async function persistPlan(input: {
  businessId: string;
  sessionId: string;
  plan: SearchPlan;
  changedBy: "USER" | "SEARCH_AGENT";
  userId: string | null;
}): Promise<void> {
  const intentEnabled = input.plan.intent.categories.length > 0;
  const verdict = await resolveBudget({
    businessId: input.businessId,
    requestedTarget: input.plan.targetVerifiedProspects,
    requestedCostCapMinor: input.plan.maxProviderCostMinor,
    intentEnabled,
  });

  const estimate = estimateRunCost(input.plan.targetVerifiedProspects, verdict.unitCosts, {
    intentEnabled,
  });

  await saveStrategy({
    businessId: input.businessId,
    sessionId: input.sessionId,
    plan: input.plan,
    changedBy: input.changedBy,
    changedByUserId: input.userId,
    estimateMinor: estimate.totalMinor,
    estimatedCalls: estimate.callsByCapability,
    costBand: verdict.band,
  });

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    actorType: input.changedBy === "SEARCH_AGENT" ? "system" : "user",
    action: "search_plan.modified",
    entityType: "search_session",
    entityId: input.sessionId,
  });
}

/**
 * A direct plan edit from the structured panel.
 *
 * The whole plan is re-validated through the schema — the browser sends a
 * candidate, not an authority — and the cost cap it proposes is clamped by the
 * budget engine before it is stored.
 */
export async function updateSearchPlanAction(
  sessionId: unknown,
  plan: unknown,
): Promise<ActionResult<{ plan: SearchPlan }>> {
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return fail("That search session could not be found.");

  const parsed = searchPlanSchema.safeParse(plan);
  if (!parsed.success) return fail("Those search criteria are not valid.");

  const access = await requireFindLeads();
  if (!access.ok) return access;

  const session = await loadOwnedSession(access.workspace.businessId, id.data);
  if (!session) return fail("That search session could not be found.");

  // Any new or edited location is resolved before it can become part of a
  // runnable plan.
  const resolved = await resolvePlanLocations(parsed.data);

  const verdict = await resolveBudget({
    businessId: access.workspace.businessId,
    requestedTarget: resolved.targetVerifiedProspects,
    requestedCostCapMinor: resolved.maxProviderCostMinor,
    intentEnabled: resolved.intent.categories.length > 0,
  });

  // Clamped, not rejected: the customer sees the figure the system will
  // actually honour rather than a validation error they cannot act on.
  const clamped: SearchPlan = {
    ...resolved,
    targetVerifiedProspects: Math.max(1, Math.min(resolved.targetVerifiedProspects, Math.max(1, verdict.maxTarget))),
    maxProviderCostMinor: Math.min(resolved.maxProviderCostMinor, Math.max(0, verdict.maxProviderCostMinor)),
  };

  await persistPlan({
    businessId: access.workspace.businessId,
    sessionId: id.data,
    plan: clamped,
    changedBy: "USER",
    userId: access.workspace.userId,
  });

  refresh(id.data);
  return ok({ plan: clamped });
}

export async function renameSearchSessionAction(
  sessionId: unknown,
  title: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(sessionId);
  const name = z.string().trim().min(1).max(120).safeParse(title);
  if (!id.success || !name.success) return fail("That name cannot be used.");

  const access = await requireFindLeads();
  if (!access.ok) return access;

  const session = await loadOwnedSession(access.workspace.businessId, id.data);
  if (!session) return fail("That search session could not be found.");

  await renameSession(access.workspace.businessId, id.data, name.data);
  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "search_session.renamed",
    entityType: "search_session",
    entityId: id.data,
  });

  refresh(id.data);
  return ok(undefined);
}

export async function archiveSearchSessionAction(
  sessionId: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return fail("That search session could not be found.");

  const access = await requireFindLeads();
  if (!access.ok) return access;

  const session = await loadOwnedSession(access.workspace.businessId, id.data);
  if (!session) return fail("That search session could not be found.");

  await archiveSession(access.workspace.businessId, id.data);
  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "search_session.archived",
    entityType: "search_session",
    entityId: id.data,
  });

  refresh();
  return ok(undefined);
}

export async function duplicateSearchSessionAction(
  sessionId: unknown,
): Promise<ActionResult<{ sessionId: string }>> {
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return fail("That search session could not be found.");

  const access = await requireFindLeads();
  if (!access.ok) return access;

  const created = await duplicateSession({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    sessionId: id.data,
  });

  if (!created) return fail("That search session could not be found.");

  refresh();
  return ok({ sessionId: created });
}

/* ------------------------------------------------------------------- runs */

/**
 * The one path to provider spend.
 *
 * Admin role, live entitlement, a plan that passes readiness, a fresh budget
 * verdict, and an explicit user action — all five, every time.
 */
export async function startSourcingRunAction(
  sessionId: unknown,
): Promise<ActionResult<{ runId: string }>> {
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return fail("That search session could not be found.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const session = await loadOwnedSession(access.workspace.businessId, id.data);
  if (!session) return fail("That search session could not be found.");

  const result = await createRun({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    sessionId: id.data,
    strategyId: session.strategyId,
    plan: session.plan,
  });

  if (!result.ok) return fail(result.message);

  refresh(id.data, result.runId);
  return ok({ runId: result.runId });
}

export async function pauseSourcingRunAction(
  runId: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runControl(runId, pauseRun);
}

export async function resumeSourcingRunAction(
  runId: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runControl(runId, resumeRun);
}

export async function stopSourcingRunAction(
  runId: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runControl(runId, stopRun);
}

async function runControl(
  runId: unknown,
  control: (input: {
    businessId: string;
    userId: string;
    runId: string;
  }) => Promise<{ ok: boolean; message: string }>,
): Promise<ActionResult<{ message: string }>> {
  const id = z.uuid().safeParse(runId);
  if (!id.success) return fail("That run could not be found.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  // Ownership check before the control runs: a run id from a URL proves
  // nothing about who may act on it.
  const admin = createAdminClient();
  const { data: run } = await admin
    .from("sourcing_runs")
    .select("id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .maybeSingle();

  if (!run) return fail("That run could not be found.");

  const result = await control({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    runId: id.data,
  });

  refresh(undefined, id.data);
  return result.ok ? ok({ message: result.message }) : fail(result.message);
}

export async function increaseRunTargetAction(
  runId: unknown,
  additional: unknown,
): Promise<ActionResult<{ message: string }>> {
  const id = z.uuid().safeParse(runId);
  const amount = z.number().int().min(1).max(1000).safeParse(additional);
  if (!id.success) return fail("That run could not be found.");
  if (!amount.success) return fail("Choose how many more prospects to look for.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: run } = await admin
    .from("sourcing_runs")
    .select("id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .maybeSingle();

  if (!run) return fail("That run could not be found.");

  const result = await increaseTarget({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    runId: id.data,
    additional: amount.data,
  });

  refresh(undefined, id.data);
  return result.ok ? ok({ message: result.message }) : fail(result.message);
}

/* ------------------------------------------------------- website analysis */

export async function analyseBusinessAction(
  websiteUrl: unknown,
): Promise<ActionResult<{ analysisId: string }>> {
  const url = z.string().trim().min(4).max(2000).safeParse(websiteUrl);
  if (!url.success) return fail("Enter your website address.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  // A bare domain is what people type. Defaulting to https keeps the SSRF
  // checks in charge of what is reachable rather than the scheme guess.
  const candidate = /^https?:\/\//i.test(url.data) ? url.data : `https://${url.data}`;

  const result = await startAnalysis({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    websiteUrl: candidate,
  });

  if (!result.ok) return fail(analysisRejectionSentence(result.code));

  refresh();
  return ok({ analysisId: result.analysisId });
}

/**
 * Accepting analysis facts is what turns a proposal into a fact about the
 * business. It is a deliberate human step, and it is what makes the profile
 * safe for the outreach layer to quote.
 */
export async function acceptAnalysisFactsAction(
  analysisId: unknown,
  factIds: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(analysisId);
  const ids = z.array(z.uuid()).max(50).safeParse(factIds);
  if (!id.success || !ids.success) return fail("Those facts could not be saved.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const facts = await listAnalysisFacts(access.workspace.businessId, id.data);
  const accepted = facts.filter((fact) => ids.data.includes(fact.id));

  if (accepted.length === 0) return fail("Choose at least one thing to save.");

  await updateAcquisitionProfile(access.workspace.businessId, {
    businessType: accepted.find((f) => f.category === "BUSINESS_TYPE")?.values[0] ?? undefined,
    services: accepted.find((f) => f.category === "SERVICES")?.values,
    territories: accepted.find((f) => f.category === "TERRITORIES")?.values,
    targetCustomers: accepted.find((f) => f.category === "TARGET_CUSTOMERS")?.values,
  });

  await admin
    .from("business_analysis_facts")
    .update({ accepted: true, verification_state: "VERIFIED" })
    .eq("business_id", access.workspace.businessId)
    .in("id", ids.data);

  await admin
    .from("business_analysis_jobs")
    .update({ status: "READY", verification_state: "PARTIALLY_VERIFIED" })
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data);

  await admin
    .from("business_profiles")
    .update({ analysis_status: "READY" })
    .eq("business_id", access.workspace.businessId);

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "acquisition_profile.updated",
    entityType: "business_analysis_job",
    entityId: id.data,
    metadata: { accepted: accepted.length },
  });

  refresh();
  return ok(undefined);
}

const profileSchema = z.object({
  businessType: z.string().trim().max(120).nullable().optional(),
  services: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  territories: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  targetCustomers: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export async function updateAcquisitionProfileAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("Those profile details are not valid.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  await updateAcquisitionProfile(access.workspace.businessId, parsed.data);
  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "acquisition_profile.updated",
    entityType: "business_profile",
  });

  refresh();
  return ok(undefined);
}

/* ------------------------------------------------------ recurring sourcing */

const CADENCES = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;

const recurringSchema = z.object({
  sessionId: z.uuid(),
  cadence: z.enum(CADENCES),
  targetPerRun: z.number().int().min(1).max(2000),
});

/**
 * Turns a session's approved plan into a schedule.
 *
 * The plan must be runnable *now* — the same budget verdict a manual run would
 * get. A schedule created against a plan the workspace cannot afford would
 * simply fail silently every cycle, which is worse than refusing it here.
 *
 * The strategy is snapshotted by id, not by value: editing the session
 * afterwards supersedes that strategy and the sweep stops running it, because
 * only an APPROVED strategy is eligible. That is the "no re-deriving targeting
 * without approval" rule, enforced by data rather than by intent.
 */
export async function createRecurringSearchAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = recurringSchema.safeParse(input);
  if (!parsed.success) return fail("Those schedule settings are not valid.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const session = await loadOwnedSession(access.workspace.businessId, parsed.data.sessionId);
  if (!session) return fail("That search session could not be found.");
  if (!session.strategyId) return fail("Save a search plan before scheduling it.");

  const readiness = checkPlanReadiness(session.plan);
  if (!readiness.ready) {
    return fail("The search plan is not complete enough to schedule yet.");
  }

  const budget = await resolveBudget({
    businessId: access.workspace.businessId,
    requestedTarget: parsed.data.targetPerRun,
    requestedCostCapMinor: session.plan.maxProviderCostMinor,
    intentEnabled: session.plan.intent.categories.length > 0,
  });

  if (!budget.allowed) {
    return fail("There is not enough remaining allowance to schedule this search.");
  }

  const admin = createAdminClient();

  // Approving the strategy is what makes it eligible for the unattended sweep.
  await admin
    .from("search_strategies")
    .update({
      status: "APPROVED",
      approved_by: access.workspace.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", session.strategyId);

  const { data, error } = await admin
    .from("recurring_searches")
    .insert({
      business_id: access.workspace.businessId,
      session_id: parsed.data.sessionId,
      search_strategy_id: session.strategyId,
      cadence: parsed.data.cadence,
      target_per_run: Math.min(parsed.data.targetPerRun, budget.maxTarget),
      max_cost_per_run_minor: budget.maxProviderCostMinor,
      status: "ACTIVE",
      // Due immediately, so the customer sees it work rather than wondering
      // whether it took.
      next_run_at: new Date().toISOString(),
      approved_by: access.workspace.userId,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return fail("That schedule could not be created.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "recurring_search.created",
    entityType: "recurring_search",
    entityId: data.id,
    metadata: { cadence: parsed.data.cadence, targetPerRun: parsed.data.targetPerRun },
  });

  refresh(parsed.data.sessionId);
  return ok({ id: data.id });
}

export async function setRecurringSearchStatusAction(
  scheduleId: unknown,
  enabled: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(scheduleId);
  const on = z.boolean().safeParse(enabled);
  if (!id.success || !on.success) return fail("That schedule could not be updated.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data } = await admin
    .from("recurring_searches")
    .update({
      status: on.data ? "ACTIVE" : "PAUSED",
      // Re-arm from now rather than firing every missed cycle at once.
      next_run_at: on.data ? new Date().toISOString() : null,
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .neq("status", "STOPPED")
    .select("id");

  if (!data?.length) return fail("That schedule could not be found.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: on.data ? "recurring_search.resumed" : "recurring_search.paused",
    entityType: "recurring_search",
    entityId: id.data,
  });

  refresh();
  return ok(undefined);
}

/** Stops a schedule for good. Runs it already produced are untouched. */
export async function deleteRecurringSearchAction(
  scheduleId: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(scheduleId);
  if (!id.success) return fail("That schedule could not be found.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data } = await admin
    .from("recurring_searches")
    .update({ status: "STOPPED", next_run_at: null })
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .select("id");

  if (!data?.length) return fail("That schedule could not be found.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "recurring_search.stopped",
    entityType: "recurring_search",
    entityId: id.data,
  });

  refresh();
  return ok(undefined);
}

/* -------------------------------------------------------- prospect moves */

/**
 * Approves a prospect for outreach.
 *
 * Approval is a person taking responsibility for contacting a stranger, which
 * is why it is a deliberate act with a name attached rather than a state the
 * pipeline drifts into. It cannot override contactability: a suppressed or
 * review-required prospect stays where it is, because approval is permission
 * from the *business*, not from the recipient.
 */
export async function approveProspectAction(
  prospectId: unknown,
): Promise<ActionResult<{ status: string }>> {
  const id = z.uuid().safeParse(prospectId);
  if (!id.success) return fail("That prospect could not be found.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select("id, status, outreach_eligibility")
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .maybeSingle();

  if (!prospect) return fail("That prospect could not be found.");

  if (prospect.outreach_eligibility === "SUPPRESSED") {
    return fail("This prospect has opted out and cannot be contacted.");
  }
  if (prospect.outreach_eligibility !== "ELIGIBLE") {
    return fail(
      "This prospect's contactability has not been confirmed, so it cannot be approved yet.",
    );
  }
  if (prospect.status === "SUPPRESSED" || prospect.status === "UNSUBSCRIBED") {
    return fail("This prospect has opted out and cannot be contacted.");
  }

  const { data: updated } = await admin
    .from("prospects")
    .update({
      status: "APPROVED",
      approved_by: access.workspace.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .in("status", ["READY", "REVIEW", "VERIFIED"])
    .select("status");

  if (!updated?.length) {
    return fail("This prospect is not at a stage where it can be approved.");
  }

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.approved",
    entityType: "prospect",
    entityId: id.data,
  });

  refresh();
  return ok({ status: "APPROVED" });
}

/**
 * Prospect → Lead promotion (V4 §11.19).
 *
 * A cold sourced record becomes a Lead only when a person says the
 * relationship has changed. Provenance travels with it: the run, the session,
 * the score and the eligibility history all stay attached, so a promoted lead
 * can still answer "where did this come from".
 */
export async function promoteProspectToLeadAction(
  prospectId: unknown,
): Promise<ActionResult<{ leadId: string }>> {
  const id = z.uuid().safeParse(prospectId);
  if (!id.success) return fail("That prospect could not be found.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select(
      "id, first_name, last_name, email, phone_e164, status, promoted_to_lead_id, outreach_eligibility, source_run_id, source_provider, score, grade, company_id",
    )
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .maybeSingle();

  if (!prospect) return fail("That prospect could not be found.");
  if (prospect.promoted_to_lead_id) {
    return ok({ leadId: prospect.promoted_to_lead_id });
  }
  if (prospect.outreach_eligibility === "SUPPRESSED") {
    return fail("This prospect is suppressed and cannot be promoted.");
  }

  const { data: leadId, error } = await admin.rpc("promote_reviewed_prospect", {
    p_business_id: access.workspace.businessId,
    p_prospect_id: id.data,
    p_user_id: access.workspace.userId,
  });
  if (error || !leadId) return fail("Only engaged, unsuppressed prospects can move to Leads. Review the conversation first.");
  const lead = { id: leadId };

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.promoted_to_lead",
    entityType: "prospect",
    entityId: id.data,
    metadata: {
      leadId: lead.id,
      sourceRunId: prospect.source_run_id,
      score: prospect.score,
      grade: prospect.grade,
    },
  });

  revalidatePath("/app/leads");
  refresh();
  return ok({ leadId: lead.id });
}

/**
 * Campaign handoff. Only READY prospects are added, and membership is not
 * permission — the campaign scheduler re-evaluates contactability at send
 * time regardless of what this wrote.
 */
export async function addProspectsToCampaignAction(
  campaignId: unknown,
  prospectIds: unknown,
): Promise<ActionResult<{ added: number }>> {
  const campaign = z.uuid().safeParse(campaignId);
  const ids = z.array(z.uuid()).min(1).max(500).safeParse(prospectIds);
  if (!campaign.success || !ids.success) return fail("Those prospects could not be added.");

  const access = await requireFindLeadsAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("outreach_campaigns")
    .select("id, status")
    .eq("business_id", access.workspace.businessId)
    .eq("id", campaign.data)
    .maybeSingle();

  if (!target) return fail("That campaign could not be found.");
  if (!["DRAFT", "READY", "ACTIVE"].includes(target.status)) {
    return fail("That campaign is not accepting new prospects.");
  }

  const { data: updated } = await admin
    .from("prospects")
    .update({ campaign_id: campaign.data })
    .eq("business_id", access.workspace.businessId)
    .in("id", ids.data)
    .eq("status", "READY")
    .eq("outreach_eligibility", "ELIGIBLE")
    .is("campaign_id", null)
    .select("id");

  const added = updated?.length ?? 0;

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.added_to_campaign",
    entityType: "outreach_campaign",
    entityId: campaign.data,
    metadata: { requested: ids.data.length, added },
  });

  refresh();
  return added > 0
    ? ok({ added })
    : fail("None of those prospects are ready and eligible for outreach.");
}

/** Used by the sourcing-controls panel to keep its estimate honest. */
export async function previewBudgetAction(
  plan: unknown,
): Promise<
  ActionResult<{
    maxTarget: number;
    maxProviderCostMinor: number;
    band: string;
    allowed: boolean;
    reason: string;
  }>
> {
  const parsed = searchPlanSchema.safeParse(plan);
  if (!parsed.success) return fail("Those search criteria are not valid.");

  const access = await requireFindLeads();
  if (!access.ok) return access;

  const verdict = await resolveBudget({
    businessId: access.workspace.businessId,
    requestedTarget: parsed.data.targetVerifiedProspects,
    requestedCostCapMinor: parsed.data.maxProviderCostMinor,
    intentEnabled: parsed.data.intent.categories.length > 0,
  });

  return ok({
    maxTarget: verdict.maxTarget,
    maxProviderCostMinor: verdict.maxProviderCostMinor,
    band: verdict.band,
    allowed: verdict.allowed,
    reason: verdict.reason,
  });
}
