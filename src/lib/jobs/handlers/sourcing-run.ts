import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { parsePlan, type SearchPlan } from "@/lib/find-leads/plan";
import { STAGE_KEYS, STAGES, progressPercent, type StageKey } from "@/lib/find-leads/stages";
import { EMPTY_COUNTERS, type RunCounters } from "@/lib/find-leads/types";
import { runProviderBatch } from "@/lib/find-leads/server/providers/router";
import { capabilityAvailable, unhealthyProviders } from "@/lib/find-leads/server/providers/registry";
import type {
  CompanyCandidate,
  ContactCandidate,
  IntentCategoryQuery,
  IntentResult,
} from "@/lib/find-leads/server/providers/types";
import { withinPlanLocations } from "@/lib/find-leads/server/locations";
import type { UnitCosts } from "@/lib/find-leads/cost-model";
import {
  cheapChecks,
  companyDedupeKey,
  emailDomain,
  isGenericEmailDomain,
  isRoleMailbox,
  normaliseDomain,
  normaliseEmail,
} from "@/lib/prospects/dedupe";
import {
  ENRICHMENT_GATE_SCORE,
  meetsMinimumGrade,
  scoreProspect,
  SCORE_VERSION,
  type ScoreFeature,
} from "@/lib/prospects/scoring";
import { checkSuppressionBatch } from "@/lib/policy/suppression";
import { evaluateAllChannels } from "@/lib/policy/service";
import type { Grade } from "@/lib/prospects/types";

/**
 * The sourcing run worker: the twelve-stage state machine (V4 §11.4-11.18).
 *
 * Four properties matter more than any individual stage, and the structure
 * below exists to hold them:
 *
 *   * **Resumable.** Every stage boundary and every provider batch writes a
 *     checkpoint. A worker that dies, or a run a customer paused, restarts
 *     from the checkpoint — never from stage 1, which would re-spend money.
 *   * **Bounded.** The job is time-boxed. When the box expires it checkpoints
 *     and re-queues itself, so a long run never depends on one invocation
 *     surviving.
 *   * **Cost-ordered.** Cheap discovery and free filtering run before anything
 *     expensive touches a record. Stage 5 exists so stage 6 is small.
 *   * **Honest.** A stage with no configured provider fails visibly. There is
 *     no path in this file that invents a company, a contact or a count.
 */

const payloadSchema = z.object({ runId: z.uuid(), businessId: z.uuid() });

/** How long one invocation works before checkpointing and re-queueing. */
const TIME_BUDGET_MS = 45_000;

/** Provider batch sizes. Small enough that a failure loses little. */
const COMPANY_BATCH = 20;
const CONTACT_BATCH = 20;
const ENRICH_BATCH = 15;
const VERIFY_BATCH = 25;
const INTENT_BATCH = 25;

type Checkpoint = {
  stage: StageKey;
  /** Provider pagination token for the stage that is mid-flight. */
  cursor?: string | null;
  /** Row offset for stages that walk our own tables. */
  offset?: number;
};

type RunContext = {
  agentId: string | null;
  runId: string;
  businessId: string;
  plan: SearchPlan;
  unitCosts: UnitCosts;
  intentEnabled: boolean;
  target: number;
  minimumGrade: Grade;
  unhealthy: Set<string>;
  deadline: number;
};

/** Raised to unwind the stage loop when the run must stop cleanly. */
class RunHalt extends Error {
  constructor(
    readonly kind: "PAUSE" | "BUDGET" | "TIME" | "CANCELLED",
    readonly detail?: string,
  ) {
    super(kind);
  }
}

export async function handleSourcingRun(job: ClaimedJob): Promise<void> {
  const { runId, businessId } = payloadSchema.parse(job.payload);
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("sourcing_runs")
    .select(
      "id, agent_id, status, cancel_requested, target_verified, minimum_grade, limits_json, checkpoint_json",
    )
    .eq("id", runId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!run) throw new PermanentJobError(`Sourcing run ${runId} no longer exists.`);

  // Re-read state rather than trusting the payload: the customer may have
  // stopped this run between it being queued and this worker claiming it.
  if (run.status === "CANCELLED" || run.status === "COMPLETED" || run.status === "FAILED") {
    return;
  }
  if (run.cancel_requested) {
    await parkRun(businessId, runId, "USER_PAUSED");
    return;
  }

  const limits = (run.limits_json ?? {}) as {
    plan?: unknown;
    unitCosts?: UnitCosts;
    intentEnabled?: boolean;
  };
  const plan = parsePlan(limits.plan);

  if (!plan) {
    await failRun(businessId, runId, "INVALID_SEARCH_PLAN", "The search plan is no longer valid.");
    throw new PermanentJobError("Sourcing run has an invalid plan.");
  }

  await admin
    .from("sourcing_runs")
    .update({
      status: "RUNNING",
      started_at: new Date().toISOString(),
      cancel_requested: false,
    })
    .eq("id", runId)
    .eq("business_id", businessId)
    .in("status", ["QUEUED", "RUNNING"]);

  const context: RunContext = {
    agentId: run.agent_id,
    runId,
    businessId,
    plan,
    unitCosts: limits.unitCosts ?? {},
    intentEnabled: limits.intentEnabled ?? plan.intent.categories.length > 0,
    target: run.target_verified,
    minimumGrade: run.minimum_grade as Grade,
    unhealthy: await unhealthyProviders(),
    deadline: Date.now() + TIME_BUDGET_MS,
  };

  const checkpoint = (run.checkpoint_json ?? {}) as Checkpoint;
  const startIndex = checkpoint.stage ? STAGE_KEYS.indexOf(checkpoint.stage) : 0;

  try {
    for (let index = Math.max(0, startIndex); index < STAGE_KEYS.length; index += 1) {
      const stage = STAGE_KEYS[index];
      await assertContinuable(context);
      await runStage(context, stage, index === startIndex ? checkpoint : { stage });
    }

    await completeRun(context);
  } catch (error) {
    if (error instanceof RunHalt) {
      if (error.kind === "TIME") {
        // Not a failure: park the invocation, not the run.
        await enqueue(
          "sourcing.run",
          { runId, businessId },
          {
            businessId,
            idempotencyKey: `sourcing.run:${runId}:${Date.now()}`,
            maxAttempts: 8,
          },
        );
        return;
      }
      if (error.kind === "BUDGET") {
        await parkRun(businessId, runId, "BUDGET_LIMIT_REACHED");
        await raiseIssue(context, {
          severity: "WARNING",
          code: "BUDGET_LIMIT_REACHED",
          message: "This run reached its cost limit and paused.",
          detail: "Raise the run's limit or start a new run to continue.",
          requiresUserAction: true,
        });
        await recordAudit({
          businessId,
          actorType: "system",
          action: "sourcing_run.budget_limit_reached",
          entityType: "sourcing_run",
          entityId: runId,
        });
        return;
      }
      await parkRun(businessId, runId, error.detail ?? "USER_PAUSED");
      return;
    }
    throw error;
  }
}

/* ------------------------------------------------------------ run control */

async function assertContinuable(context: RunContext): Promise<void> {
  if (Date.now() > context.deadline) throw new RunHalt("TIME");

  const admin = createAdminClient();
  if (context.agentId) {
    const { data: agent } = await admin.from("agents").select("status").eq("id", context.agentId).eq("business_id", context.businessId).maybeSingle();
    if (!agent || agent.status === "STOPPED") throw new RunHalt("CANCELLED");
    if (agent.status !== "ACTIVE") throw new RunHalt("PAUSE", "AGENT_PAUSED");
  }
  const { data } = await admin
    .from("sourcing_runs")
    .select("status, cancel_requested, spent_cost_minor, max_provider_cost_minor")
    .eq("id", context.runId)
    .eq("business_id", context.businessId)
    .maybeSingle();

  if (!data) throw new RunHalt("CANCELLED");
  if (data.status === "CANCELLED") throw new RunHalt("CANCELLED");
  if (data.cancel_requested) throw new RunHalt("PAUSE", "USER_PAUSED");
  if (Number(data.spent_cost_minor) >= Number(data.max_provider_cost_minor)) {
    throw new RunHalt("BUDGET");
  }
}

async function parkRun(
  businessId: string,
  runId: string,
  reason: string,
): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("sourcing_runs")
    .update({
      status: "PAUSED",
      paused_at: new Date().toISOString(),
      paused_reason: reason,
      cancel_requested: false,
      budget_state: reason === "BUDGET_LIMIT_REACHED" ? "BUDGET_LIMIT_REACHED" : "WITHIN_BUDGET",
    })
    .eq("id", runId)
    .eq("business_id", businessId)
    .in("status", ["QUEUED", "RUNNING"]);

  // A stage caught mid-flight shows as paused rather than as still running,
  // so the run page never claims work is happening when nothing is.
  await admin
    .from("sourcing_run_stages")
    .update({ status: "PAUSED" })
    .eq("run_id", runId)
    .eq("business_id", businessId)
    .eq("status", "RUNNING");
}

async function failRun(
  businessId: string,
  runId: string,
  code: string,
  message: string,
): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("sourcing_runs")
    .update({
      status: "FAILED",
      error_code: code,
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("business_id", businessId);

  await recordAudit({
    businessId,
    actorType: "system",
    action: "sourcing_run.failed",
    entityType: "sourcing_run",
    entityId: runId,
    metadata: { code },
  });
}

async function saveCheckpoint(
  context: RunContext,
  checkpoint: Checkpoint,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("sourcing_runs")
    .update({
      checkpoint_json: checkpoint as never,
      current_stage: checkpoint.stage,
    })
    .eq("id", context.runId)
    .eq("business_id", context.businessId);
}

/* --------------------------------------------------------------- stages */

async function runStage(
  context: RunContext,
  stage: StageKey,
  checkpoint: Checkpoint,
): Promise<void> {
  const admin = createAdminClient();
  const startedAt = Date.now();

  await admin
    .from("sourcing_run_stages")
    .update({ status: "RUNNING", started_at: new Date().toISOString() })
    .eq("run_id", context.runId)
    .eq("business_id", context.businessId)
    .eq("stage_key", stage);

  await saveCheckpoint(context, { ...checkpoint, stage });

  let summary: StageSummary;
  try {
    summary = await executeStage(context, stage, checkpoint);
  } catch (error) {
    if (error instanceof RunHalt) throw error;
    await admin
      .from("sourcing_run_stages")
      .update({ status: "FAILED", error_code: "INTERNAL_ERROR" })
      .eq("run_id", context.runId)
      .eq("business_id", context.businessId)
      .eq("stage_key", stage);
    throw error;
  }

  await admin
    .from("sourcing_run_stages")
    .update({
      status: summary.skipped ? "SKIPPED" : "COMPLETED",
      safe_summary: summary.text,
      record_count: summary.count,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("run_id", context.runId)
    .eq("business_id", context.businessId)
    .eq("stage_key", stage);

  await refreshProgress(context);

  if (summary.milestone) await postMilestone(context, summary.milestone);
}

type StageSummary = {
  text: string;
  count: number;
  skipped?: boolean;
  /** A sentence worth posting into the run's conversation. */
  milestone?: string;
};

async function executeStage(
  context: RunContext,
  stage: StageKey,
  checkpoint: Checkpoint,
): Promise<StageSummary> {
  switch (stage) {
    case "UNDERSTANDING_TARGET":
      return understandTarget(context);
    case "PLANNING_SEARCH":
      return planSearch(context);
    case "FINDING_COMPANIES":
      return findCompanies(context, checkpoint);
    case "FINDING_CONTACTS":
      return findContacts(context);
    case "PRE_FILTERING":
      return preFilter(context);
    case "ENRICHING":
      return enrich(context);
    case "VERIFYING":
      return verify(context);
    case "DEDUPLICATING":
      return deduplicate(context);
    case "CLASSIFYING":
      return classify(context);
    case "SCORING":
      return score(context);
    case "INTENT_MATCHING":
      return matchIntent(context);
    case "PREPARING_OUTREACH":
      return prepareOutreach(context);
    default:
      return { text: "", count: 0, skipped: true };
  }
}

/* ------------------------------------------------------- 1. understanding */

async function understandTarget(context: RunContext): Promise<StageSummary> {
  const { plan } = context;
  return {
    text: `Looking for ${plan.decisionMakerRoles.slice(0, 3).join(", ") || "decision makers"} at ${plan.industries.slice(0, 3).join(", ") || "businesses"}.`,
    count: 0,
  };
}

/* ------------------------------------------------------------ 2. planning */

async function planSearch(context: RunContext): Promise<StageSummary> {
  // The honesty gate. A run that cannot find companies must say so now, before
  // it renders eleven stages of nothing happening.
  if (!capabilityAvailable("COMPANY_SEARCH", context.unhealthy)) {
    await raiseIssue(context, {
      severity: "ERROR",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "No company data source is connected.",
      detail: "Connect a sourcing data provider in Settings before running a search.",
      requiresUserAction: true,
    });
    await failRun(
      context.businessId,
      context.runId,
      "PROVIDER_NOT_CONFIGURED",
      "No company data source is connected for this workspace.",
    );
    throw new RunHalt("CANCELLED");
  }

  if (context.plan.locations.some((location) => !location.resolved)) {
    await failRun(
      context.businessId,
      context.runId,
      "INVALID_SEARCH_PLAN",
      "One of the locations in this plan could not be resolved.",
    );
    throw new RunHalt("CANCELLED");
  }

  return {
    text: `Prepared queries across ${context.plan.locations.length} location(s).`,
    count: context.plan.locations.length,
  };
}

/* --------------------------------------------------- 3. finding companies */

async function findCompanies(
  context: RunContext,
  checkpoint: Checkpoint,
): Promise<StageSummary> {
  // Discovery over-collects deliberately: most candidates die in the free
  // pre-filter, and refilling later costs another paid search.
  const wanted = context.target * 9;
  let cursor = checkpoint.cursor ?? null;
  let found = await countResults(context, "COMPANY_FOUND");
  let batch = 0;

  while (found < wanted) {
    await assertContinuable(context);

    const outcome = await runProviderBatch<CompanyCandidate>({
      runId: context.runId,
      businessId: context.businessId,
      stage: "FINDING_COMPANIES",
      capability: "COMPANY_SEARCH",
      recordCount: COMPANY_BATCH,
      unitCosts: context.unitCosts,
      unhealthy: context.unhealthy,
      idempotencyKey: `companies:${cursor ?? "start"}:${batch}`,
      invoke: (provider) =>
        provider.searchCompanies?.({
          plan: context.plan,
          limit: COMPANY_BATCH,
          cursor,
        }) ??
        Promise.resolve({
          ok: false,
          records: [],
          costMinor: 0,
          cursor: null,
          latencyMs: 0,
          errorCode: "PROVIDER_NOT_CONFIGURED" as const,
        }),
    });

    if (outcome.budgetExhausted) throw new RunHalt("BUDGET");

    if (!outcome.ok) {
      await raiseIssue(context, {
        severity: found > 0 ? "WARNING" : "ERROR",
        code: outcome.errorCode ?? "PROVIDER_UNAVAILABLE",
        message: "A company data source could not be reached.",
        detail: "The run continued with the sources that responded.",
        requiresUserAction: found === 0,
      });
      break;
    }

    for (const candidate of outcome.records) {
      const inserted = await upsertCompany(context, candidate);
      if (inserted) found += 1;
    }

    cursor = outcome.cursor;
    batch += 1;
    await saveCheckpoint(context, { stage: "FINDING_COMPANIES", cursor });

    if (!cursor || outcome.records.length === 0) break;
  }

  return {
    text: `Searched across ${context.plan.industries.length || 1} categories.`,
    count: found,
    milestone:
      found > 0
        ? `Found ${found.toLocaleString("en-GB")} companies so far. Looking for the right people to contact at each one.`
        : undefined,
  };
}

async function upsertCompany(
  context: RunContext,
  candidate: CompanyCandidate,
): Promise<boolean> {
  const admin = createAdminClient();
  const domain = normaliseDomain(candidate.domain ?? candidate.websiteUrl);

  const dedupeKey = companyDedupeKey({
    name: candidate.name,
    domain,
    postcode: candidate.location.postcode,
  });

  const { data: company, error } = await admin
    .from("prospect_companies")
    .upsert(
      {
        business_id: context.businessId,
        name: candidate.name,
        domain,
        website_url: candidate.websiteUrl,
        industry: candidate.industry,
        employee_count: candidate.employeeCount,
        company_size: candidate.companySize,
        description: candidate.description,
        location_json: candidate.location as never,
        external_ids: candidate.externalId ? { source: candidate.externalId } : {},
        dedupe_key: dedupeKey,
      },
      { onConflict: "business_id,dedupe_key", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();

  if (error || !company) return false;

  await admin.from("sourcing_run_results").insert({
    business_id: context.businessId,
    run_id: context.runId,
    company_id: company.id,
    candidate_name: candidate.name,
    candidate_domain: domain,
    outcome: "COMPANY_FOUND",
  });

  return true;
}

/* ---------------------------------------------------- 4. finding contacts */

async function findContacts(context: RunContext): Promise<StageSummary> {
  if (!capabilityAvailable("CONTACT_DISCOVERY", context.unhealthy)) {
    await raiseIssue(context, {
      severity: "ERROR",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "No contact data source is connected.",
      detail: "Connect a contact discovery provider to find decision makers.",
      requiresUserAction: true,
    });
    return { text: "No contact data source is connected.", count: 0, skipped: true };
  }

  const companies = await loadRunCompanies(context);
  let contacts = 0;

  for (let index = 0; index < companies.length; index += CONTACT_BATCH) {
    await assertContinuable(context);
    const slice = companies.slice(index, index + CONTACT_BATCH);

    const outcome = await runProviderBatch<ContactCandidate>({
      runId: context.runId,
      businessId: context.businessId,
      stage: "FINDING_CONTACTS",
      capability: "CONTACT_DISCOVERY",
      recordCount: slice.length,
      unitCosts: context.unitCosts,
      unhealthy: context.unhealthy,
      idempotencyKey: `contacts:${index}`,
      invoke: (provider) =>
        provider.findContacts?.({
          companies: slice.map((company) => ({
            externalId: null,
            name: company.name,
            domain: company.domain,
            websiteUrl: null,
            industry: company.industry,
            employeeCount: company.employee_count,
            companySize: null,
            description: null,
            location: {
              country: null,
              region: null,
              city: null,
              postcode: null,
              lat: null,
              lon: null,
            },
          })),
          roles: context.plan.decisionMakerRoles,
          limit: slice.length * 3,
        }) ??
        Promise.resolve({
          ok: false,
          records: [],
          costMinor: 0,
          cursor: null,
          latencyMs: 0,
          errorCode: "PROVIDER_NOT_CONFIGURED" as const,
        }),
    });

    if (outcome.budgetExhausted) throw new RunHalt("BUDGET");
    if (!outcome.ok) continue;

    for (const candidate of outcome.records) {
      const company = slice.find(
        (row) => row.domain && row.domain === normaliseDomain(candidate.companyDomain),
      );
      if (await insertProspect(context, candidate, company?.id ?? null)) contacts += 1;
    }

    await saveCheckpoint(context, { stage: "FINDING_CONTACTS", offset: index + CONTACT_BATCH });
  }

  return {
    text: "Identified decision makers at the companies found.",
    count: contacts,
  };
}

async function insertProspect(
  context: RunContext,
  candidate: ContactCandidate,
  companyId: string | null,
): Promise<boolean> {
  const admin = createAdminClient();
  const email = normaliseEmail(candidate.email);

  const { data: prospect, error } = await admin
    .from("prospects")
    .insert({
      business_id: context.businessId,
      company_id: companyId,
      first_name: candidate.firstName,
      last_name: candidate.lastName,
      role_title: candidate.roleTitle,
      email,
      phone_e164: candidate.phone,
      linkedin_url: candidate.linkedinUrl,
      status: "DISCOVERED",
      source_run_id: context.runId,
      agent_id: context.agentId,
      // Cold sourced records are never eligible until the compliance stage
      // says so. REVIEW is the safe default, not ELIGIBLE.
      outreach_eligibility: "REVIEW",
    })
    .select("id")
    .maybeSingle();

  // The unique index on (business_id, email) means an address we already hold
  // arrives here as a conflict. That is a duplicate, and it is counted as one.
  if (error?.code === "23505") {
    await admin.from("sourcing_run_results").insert({
      business_id: context.businessId,
      run_id: context.runId,
      company_id: companyId,
      candidate_name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
      candidate_domain: candidate.companyDomain,
      outcome: "DUPLICATE",
      reason: "This contact is already in your workspace",
    });
    return false;
  }

  if (error || !prospect) return false;

  await admin.from("sourcing_run_results").insert([
    {
      business_id: context.businessId,
      run_id: context.runId,
      company_id: companyId,
      prospect_id: prospect.id,
      candidate_name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
      candidate_domain: candidate.companyDomain,
      outcome: "CONTACT_FOUND",
    },
    ...(email
      ? [
          {
            business_id: context.businessId,
            run_id: context.runId,
            company_id: companyId,
            prospect_id: prospect.id,
            candidate_domain: candidate.companyDomain,
            outcome: "EMAIL_FOUND" as const,
          },
        ]
      : []),
  ]);

  return true;
}

/* ------------------------------------------------------ 5. pre-filtering */

/**
 * The free filter. Everything here is arithmetic on data already held — no
 * provider is called — which is exactly why it runs before enrichment.
 */
async function preFilter(context: RunContext): Promise<StageSummary> {
  const admin = createAdminClient();
  const prospects = await loadRunProspects(context, ["DISCOVERED"]);
  let rejected = 0;

  for (const prospect of prospects) {
    const company = prospect.company;
    const reasons: string[] = [];

    const geo = withinPlanLocations(context.plan, {
      lat: (company?.location_json as { lat?: number } | null)?.lat ?? null,
      lon: (company?.location_json as { lon?: number } | null)?.lon ?? null,
      city: (company?.location_json as { city?: string } | null)?.city ?? null,
      region: (company?.location_json as { region?: string } | null)?.region ?? null,
      country: (company?.location_json as { country?: string } | null)?.country ?? null,
    });
    if (!geo.inside) reasons.push("REJECTED_GEOGRAPHY");

    const employees = company?.employee_count ?? null;
    const { minEmployees, maxEmployees } = context.plan.company;
    if (employees !== null) {
      if (minEmployees !== null && employees < minEmployees) reasons.push("REJECTED_FIT");
      if (maxEmployees !== null && employees > maxEmployees) reasons.push("REJECTED_FIT");
    }

    if (context.plan.decisionMakerRoles.length > 0 && prospect.role_title) {
      const title = prospect.role_title.toLowerCase();
      const matches = context.plan.decisionMakerRoles.some((role) =>
        title.includes(role.toLowerCase().split(" ")[0]),
      );
      if (!matches) reasons.push("REJECTED_ROLE");
    }

    const cheap = cheapChecks({
      email: prospect.email,
      domain: company?.domain ?? null,
      companyName: company?.name ?? null,
    });
    if (cheap.reject) reasons.push("REJECTED_FIT");

    if (reasons.length > 0) {
      rejected += 1;
      await admin
        .from("prospects")
        .update({ status: "DISQUALIFIED", eligibility_reason: reasons[0] })
        .eq("id", prospect.id)
        .eq("business_id", context.businessId);

      await admin.from("sourcing_run_results").insert({
        business_id: context.businessId,
        run_id: context.runId,
        prospect_id: prospect.id,
        outcome: reasons[0] as "REJECTED_FIT",
        reason: "Did not match the plan's criteria",
      });
    }
  }

  return {
    text: `Filtered ${prospects.length.toLocaleString("en-GB")} candidates for relevance.`,
    count: prospects.length - rejected,
  };
}

/* ---------------------------------------------------------- 6. enriching */

async function enrich(context: RunContext): Promise<StageSummary> {
  if (!capabilityAvailable("COMPANY_ENRICHMENT", context.unhealthy)) {
    return { text: "No enrichment source is connected.", count: 0, skipped: true };
  }

  const admin = createAdminClient();
  const companies = await loadSurvivingCompanies(context);
  let enriched = 0;

  for (let index = 0; index < companies.length; index += ENRICH_BATCH) {
    await assertContinuable(context);
    const slice = companies.slice(index, index + ENRICH_BATCH);

    const outcome = await runProviderBatch<CompanyCandidate>({
      runId: context.runId,
      businessId: context.businessId,
      stage: "ENRICHING",
      capability: "COMPANY_ENRICHMENT",
      recordCount: slice.length,
      unitCosts: context.unitCosts,
      unhealthy: context.unhealthy,
      idempotencyKey: `enrich:${index}`,
      invoke: (provider) =>
        provider.enrichCompanies?.({
          companies: slice.map((company) => ({
            externalId: null,
            name: company.name,
            domain: company.domain,
            websiteUrl: null,
            industry: company.industry,
            employeeCount: company.employee_count,
            companySize: null,
            description: null,
            location: {
              country: null,
              region: null,
              city: null,
              postcode: null,
              lat: null,
              lon: null,
            },
          })),
        }) ??
        Promise.resolve({
          ok: false,
          records: [],
          costMinor: 0,
          cursor: null,
          latencyMs: 0,
          errorCode: "PROVIDER_NOT_CONFIGURED" as const,
        }),
    });

    if (outcome.budgetExhausted) throw new RunHalt("BUDGET");
    if (!outcome.ok) continue;

    for (const record of outcome.records) {
      const company = slice.find((row) => row.domain === normaliseDomain(record.domain));
      if (!company) continue;

      await admin
        .from("prospect_companies")
        .update({
          industry: record.industry ?? company.industry,
          employee_count: record.employeeCount ?? company.employee_count,
          company_size: record.companySize,
          description: record.description,
          location_json: record.location as never,
        })
        .eq("id", company.id)
        .eq("business_id", context.businessId);

      // Provenance: every enriched field is traceable to who supplied it.
      await admin.from("prospect_data_sources").insert({
        business_id: context.businessId,
        company_id: company.id,
        field_name: "company_profile",
        value_json: record as never,
        provider: outcome.provider ?? "unknown",
        source_type: "LICENSED_PROVIDER",
        confidence: 0.8,
        policy_tags: ["B2B_ENRICHMENT"] as never,
      });

      enriched += 1;
    }

    await saveCheckpoint(context, { stage: "ENRICHING", offset: index + ENRICH_BATCH });
  }

  return {
    text: "Added company detail to the best-fit records.",
    count: enriched,
    milestone:
      enriched > 0
        ? `Enriched ${enriched.toLocaleString("en-GB")} high-fit companies with additional data.`
        : undefined,
  };
}

/* ---------------------------------------------------------- 7. verifying */

async function verify(context: RunContext): Promise<StageSummary> {
  if (!capabilityAvailable("EMAIL_VERIFICATION", context.unhealthy)) {
    await raiseIssue(context, {
      severity: "WARNING",
      code: "VERIFICATION_PROVIDER_UNAVAILABLE",
      message: "Email verification is not available.",
      detail: "Prospects were kept for review rather than marked deliverable.",
      requiresUserAction: false,
    });
    return { text: "No verification source is connected.", count: 0, skipped: true };
  }

  const admin = createAdminClient();
  const prospects = (await loadRunProspects(context, ["DISCOVERED"])).filter(
    (prospect) => prospect.email,
  );
  let verified = 0;

  for (let index = 0; index < prospects.length; index += VERIFY_BATCH) {
    await assertContinuable(context);
    const slice = prospects.slice(index, index + VERIFY_BATCH);

    const outcome = await runProviderBatch<{
      email: string;
      status: string;
      score: number | null;
    }>({
      runId: context.runId,
      businessId: context.businessId,
      stage: "VERIFYING",
      capability: "EMAIL_VERIFICATION",
      recordCount: slice.length,
      unitCosts: context.unitCosts,
      unhealthy: context.unhealthy,
      idempotencyKey: `verify:${index}`,
      invoke: (provider) =>
        provider.verifyEmails?.({
          emails: slice.map((prospect) => prospect.email as string),
        }) ??
        Promise.resolve({
          ok: false,
          records: [],
          costMinor: 0,
          cursor: null,
          latencyMs: 0,
          errorCode: "PROVIDER_NOT_CONFIGURED" as const,
        }),
    });

    if (outcome.budgetExhausted) throw new RunHalt("BUDGET");
    if (!outcome.ok) continue;

    for (const result of outcome.records) {
      const prospect = slice.find(
        (row) => normaliseEmail(row.email) === normaliseEmail(result.email),
      );
      if (!prospect) continue;

      const deliverable = result.status === "VALID";

      await admin
        .from("prospects")
        .update({
          verification_status: result.status,
          status: deliverable ? "VERIFIED" : "REVIEW",
        })
        .eq("id", prospect.id)
        .eq("business_id", context.businessId);

      await admin.from("prospect_verifications").insert({
        business_id: context.businessId,
        prospect_id: prospect.id,
        channel: "EMAIL",
        provider: outcome.provider ?? "unknown",
        result: result.status,
        score: result.score,
      });

      if (deliverable) {
        verified += 1;
        await admin.from("sourcing_run_results").insert({
          business_id: context.businessId,
          run_id: context.runId,
          prospect_id: prospect.id,
          outcome: "VERIFIED",
        });
      }
    }

    await saveCheckpoint(context, { stage: "VERIFYING", offset: index + VERIFY_BATCH });
  }

  return {
    text: "Checked email deliverability.",
    count: verified,
    milestone:
      verified > 0
        ? `${verified.toLocaleString("en-GB")} contacts have now passed verification.`
        : undefined,
  };
}

/* ------------------------------------------------------ 8. deduplicating */

/**
 * Dedupe against everything the workspace already holds.
 *
 * The Prospect/Lead boundary means a person who is already a Lead must not
 * come back as a cold prospect: they are a warm relationship, and contacting
 * them as a stranger is both wrong and embarrassing.
 */
async function deduplicate(context: RunContext): Promise<StageSummary> {
  const admin = createAdminClient();
  const prospects = await loadRunProspects(context, ["DISCOVERED", "VERIFIED", "REVIEW"]);
  const emails = prospects
    .map((prospect) => normaliseEmail(prospect.email))
    .filter((email): email is string => Boolean(email));

  if (emails.length === 0) return { text: "Nothing to deduplicate.", count: 0 };

  const [{ data: leads }, { data: existing }] = await Promise.all([
    admin
      .from("leads")
      .select("email")
      .eq("business_id", context.businessId)
      .in("email", emails),
    admin
      .from("prospects")
      .select("id, email, source_run_id")
      .eq("business_id", context.businessId)
      .in("email", emails)
      .neq("source_run_id", context.runId),
  ]);

  const known = new Set<string>();
  for (const lead of leads ?? []) {
    const email = normaliseEmail(lead.email);
    if (email) known.add(email);
  }
  for (const row of existing ?? []) {
    const email = normaliseEmail(row.email);
    if (email) known.add(email);
  }

  let duplicates = 0;

  for (const prospect of prospects) {
    const email = normaliseEmail(prospect.email);
    if (!email || !known.has(email)) continue;

    duplicates += 1;
    await admin
      .from("prospects")
      .update({
        status: "DISQUALIFIED",
        eligibility_reason: "Already in your workspace",
      })
      .eq("id", prospect.id)
      .eq("business_id", context.businessId);

    await admin.from("sourcing_run_results").insert({
      business_id: context.businessId,
      run_id: context.runId,
      prospect_id: prospect.id,
      outcome: "DUPLICATE",
      reason: "Already a lead, customer or prospect",
    });
  }

  return {
    text: "Removed contacts you already hold.",
    count: duplicates,
  };
}

/* --------------------------------------------------------- 9. classifying */

/**
 * Contactability. Finding an address is not permission to use it — this stage
 * is what turns a sourced record into one of READY / REVIEW / SUPPRESSED, and
 * nothing downstream may override it.
 */
async function classify(context: RunContext): Promise<StageSummary> {
  const admin = createAdminClient();
  const prospects = await loadRunProspects(context, ["DISCOVERED", "VERIFIED", "REVIEW"]);

  const destinations = prospects.map((prospect) => normaliseEmail(prospect.email));

  // A failed suppression lookup must never read as "nothing is suppressed".
  // An empty map here would let suppressed people through, so a failure is
  // escalated into a run failure rather than swallowed.
  let suppressed: Awaited<ReturnType<typeof checkSuppressionBatch>>;
  try {
    suppressed = await checkSuppressionBatch(context.businessId, destinations);
  } catch {
    await raiseIssue(context, {
      severity: "ERROR",
      code: "COMPLIANCE_ENGINE_FAILURE",
      message: "Contactability could not be checked.",
      detail: "The run paused rather than treating unchecked contacts as safe to message.",
      requiresUserAction: true,
    });
    throw new RunHalt("PAUSE", "COMPLIANCE_ENGINE_FAILURE");
  }

  let suppressedCount = 0;
  let reviewCount = 0;

  for (const prospect of prospects) {
    const email = normaliseEmail(prospect.email);
    const hit = email ? suppressed.get(email) : null;

    if (hit) {
      suppressedCount += 1;
      await admin
        .from("prospects")
        .update({
          status: "SUPPRESSED",
          outreach_eligibility: "SUPPRESSED",
          eligibility_reason: "On your suppression list",
        })
        .eq("id", prospect.id)
        .eq("business_id", context.businessId);

      await admin.from("sourcing_run_results").insert({
        business_id: context.businessId,
        run_id: context.runId,
        prospect_id: prospect.id,
        outcome: "SUPPRESSED",
        reason: "Opt-out or suppression",
      });

      await recordAudit({
        businessId: context.businessId,
        actorType: "system",
        action: "prospect.suppressed",
        entityType: "prospect",
        entityId: prospect.id,
        metadata: { runId: context.runId },
      });
      continue;
    }

    // No usable address, a role mailbox, or a personal-domain address on a B2B
    // plan are all "a person has to decide", not "send it".
    const domain = emailDomain(email);
    const ambiguous =
      !email ||
      isRoleMailbox(email) ||
      (context.plan.exclusions.nonBusinessEmail && isGenericEmailDomain(domain)) ||
      prospect.verification_status === "CATCH_ALL" ||
      prospect.verification_status === "RISKY" ||
      prospect.verification_status === "UNKNOWN";

    if (ambiguous) {
      reviewCount += 1;
      await admin
        .from("prospects")
        .update({
          status: "REVIEW",
          outreach_eligibility: "REVIEW",
          eligibility_reason: !email
            ? "No usable contact address"
            : "Contactability could not be confirmed automatically",
        })
        .eq("id", prospect.id)
        .eq("business_id", context.businessId);

      await admin.from("sourcing_run_results").insert({
        business_id: context.businessId,
        run_id: context.runId,
        prospect_id: prospect.id,
        outcome: "REVIEW_REQUIRED",
        reason: "Ambiguous contactability",
      });
      continue;
    }

    // Surviving the screens above is necessary but not sufficient. The
    // versioned policy pack is the authority on whether a cold email may be
    // sent to this person in this country, and evaluating it here is also what
    // writes `contactability_results` — the policy_version + evidence snapshot
    // that lets an audit reconstruct the decision later (V4 §91.3).
    const company = prospect.company;
    const country =
      (company?.location_json as { country?: string } | null)?.country ?? null;

    const { eligibility, byChannel } = await evaluateAllChannels(
      context.businessId,
      {
        type: "PROSPECT",
        id: prospect.id,
        email,
        country,
        // A generic or role address is not a confirmed corporate subscriber, so
        // it stays UNKNOWN and the pack decides. Only a real company domain
        // asserts CORPORATE.
        subscriberType:
          domain && !isGenericEmailDomain(domain) && !isRoleMailbox(email)
            ? "CORPORATE"
            : "UNKNOWN",
        relationshipType: "FOUND_BY_US",
      },
      "COLD",
      { record: true },
    );

    const emailDecision = byChannel.EMAIL;

    await admin
      .from("prospects")
      .update({
        status: eligibility === "ELIGIBLE" ? "VERIFIED" : "REVIEW",
        outreach_eligibility: eligibility,
        eligibility_reason:
          eligibility === "ELIGIBLE" ? null : (emailDecision?.message ?? null),
      })
      .eq("id", prospect.id)
      .eq("business_id", context.businessId);

    if (eligibility !== "ELIGIBLE") {
      reviewCount += 1;
      await admin.from("sourcing_run_results").insert({
        business_id: context.businessId,
        run_id: context.runId,
        prospect_id: prospect.id,
        outcome: "REVIEW_REQUIRED",
        reason: emailDecision?.reasonCode ?? "Policy review",
      });
    }
  }

  if (suppressedCount + reviewCount > 0) {
    await raiseIssue(context, {
      severity: "INFO",
      code: "CONTACTABILITY_SUMMARY",
      message: `${suppressedCount} records suppressed`,
      detail: "Due to opt-out lists, invalid contacts or non-business emails.",
      requiresUserAction: false,
    });
  }

  return {
    text: "Classified contactability and checked opt-outs.",
    count: prospects.length - suppressedCount,
    milestone:
      suppressedCount > 0
        ? `${suppressedCount.toLocaleString("en-GB")} records were suppressed due to opt-out, invalid contact data, or platform policy.`
        : undefined,
  };
}

/* ------------------------------------------------------------ 10. scoring */

async function score(context: RunContext): Promise<StageSummary> {
  const admin = createAdminClient();
  const prospects = await loadRunProspects(context, ["DISCOVERED", "VERIFIED", "REVIEW"]);
  let scored = 0;

  for (const prospect of prospects) {
    const company = prospect.company;
    const location = (company?.location_json ?? {}) as {
      lat?: number;
      lon?: number;
      city?: string;
      region?: string;
      country?: string;
    };

    const geo = withinPlanLocations(context.plan, {
      lat: location.lat ?? null,
      lon: location.lon ?? null,
      city: location.city ?? null,
      region: location.region ?? null,
      country: location.country ?? null,
    });

    const industryMatch =
      company?.industry && context.plan.industries.length
        ? context.plan.industries.some((industry) =>
            company.industry?.toLowerCase().includes(industry.toLowerCase().split(" ")[0]),
          )
        : false;

    const roleMatch =
      prospect.role_title && context.plan.decisionMakerRoles.length
        ? context.plan.decisionMakerRoles.some((role) =>
            prospect.role_title?.toLowerCase().includes(role.toLowerCase().split(" ")[0]),
          )
        : false;

    const features: ScoreFeature[] = [
      {
        factor: "ICP_FIT",
        value: industryMatch ? 1 : 0.3,
        confidence: company?.industry ? 0.9 : 0.3,
        evidenceSummary: company?.industry ?? "Industry not established",
      },
      {
        factor: "ROLE_AUTHORITY",
        value: roleMatch ? 1 : 0.4,
        confidence: prospect.role_title ? 0.9 : 0.2,
        evidenceSummary: prospect.role_title ?? "Role not established",
      },
      {
        factor: "GEOGRAPHY",
        value: geo.inside ? 1 : 0,
        confidence: geo.confident ? 1 : 0.4,
        evidenceSummary: geo.confident
          ? "Confirmed inside the target area"
          : "Location inferred from text",
      },
      {
        factor: "NEED",
        value: 0.5,
        confidence: 0.3,
        evidenceSummary: "No direct need signal observed",
      },
      {
        factor: "DATA_QUALITY",
        value: prospect.verification_status === "VALID" ? 1 : 0.4,
        confidence: 0.9,
        evidenceSummary:
          prospect.verification_status === "VALID"
            ? "Verified deliverable address"
            : "Address not confirmed deliverable",
      },
    ];

    const result = scoreProspect(features);

    await admin
      .from("prospects")
      .update({ score: result.totalScore, grade: result.grade })
      .eq("id", prospect.id)
      .eq("business_id", context.businessId);

    // Supersede any previous score so "current" means exactly one row.
    await admin
      .from("prospect_scores")
      .update({ is_current: false })
      .eq("business_id", context.businessId)
      .eq("prospect_id", prospect.id)
      .eq("is_current", true);

    const { data: scoreRow } = await admin
      .from("prospect_scores")
      .insert({
        business_id: context.businessId,
        prospect_id: prospect.id,
        score_version: SCORE_VERSION,
        total_score: result.totalScore,
        grade: result.grade,
        explanation: result.explanation,
        factor_json: result.factors as never,
      })
      .select("id")
      .maybeSingle();

    if (scoreRow) {
      await admin.from("prospect_score_factors").insert(
        result.factors.map((factor) => ({
          business_id: context.businessId,
          prospect_score_id: scoreRow.id,
          factor: factor.factor,
          weight: factor.weight,
          raw_value: factor.rawValue,
          contribution: factor.contribution,
          direction: factor.direction,
          evidence_summary: factor.evidenceSummary,
          evidence_source: factor.evidenceSource,
          evidence_url: factor.evidenceUrl,
          observed_at: factor.observedAt,
          confidence: factor.confidence,
        })),
      );
    }

    scored += 1;
  }

  return { text: "Scored prospects by fit and intent.", count: scored };
}

/* ----------------------------------------------------- 11. intent matching */

async function matchIntent(context: RunContext): Promise<StageSummary> {
  if (!context.intentEnabled) {
    return { text: "No intent signals were requested.", count: 0, skipped: true };
  }
  if (!capabilityAvailable("INTENT", context.unhealthy)) {
    await raiseIssue(context, {
      severity: "WARNING",
      code: "INTENT_PROVIDER_UNAVAILABLE",
      message: "Intent data is not available.",
      detail:
        context.plan.intent.required
          ? "Intent was set to required, so prospects were kept for review instead of marked ready."
          : "Prospects were scored on fit alone.",
      requiresUserAction: context.plan.intent.required,
    });
    return { text: "No intent source is connected.", count: 0, skipped: true };
  }

  const admin = createAdminClient();
  const prospects = await loadRunProspects(context, ["DISCOVERED", "VERIFIED", "REVIEW"]);

  // Categories are per-workspace rows, so a plan naming a category the
  // workspace has never defined matches nothing rather than inventing one.
  const { data: categoryRows } = await admin
    .from("intent_categories")
    .select("id, name, score_impact, freshness_days, keywords_entities")
    .eq("business_id", context.businessId)
    .eq("active", true);

  const categories = new Map(
    (categoryRows ?? []).map((row) => [row.name.trim().toLowerCase(), row]),
  );

  // The plan names categories; the workspace defines what they mean. A plan
  // naming a category the workspace has never configured matches nothing,
  // rather than being invented here.
  const categoryQueries: IntentCategoryQuery[] = context.plan.intent.categories
    .map((name) => {
      const row = categories.get(name.trim().toLowerCase());
      if (!row) return null;
      const configured = row.keywords_entities as { keywords?: unknown } | null;
      const keywords = Array.isArray(configured?.keywords)
        ? configured.keywords.filter((k): k is string => typeof k === "string")
        : [];
      return { name: row.name, keywords };
    })
    .filter((entry): entry is IntentCategoryQuery => entry !== null);

  if (categoryQueries.length === 0) {
    await raiseIssue(context, {
      severity: "WARNING",
      code: "INTENT_CATEGORIES_NOT_CONFIGURED",
      message: "None of the requested buying signals are set up.",
      detail:
        "Define these intent categories in your workspace so we know what to look for.",
      requiresUserAction: true,
    });
    return { text: "No matching intent categories are configured.", count: 0, skipped: true };
  }

  const byDomain = new Map<string, RunProspect[]>();
  for (const prospect of prospects) {
    const domain = prospect.company?.domain;
    if (!domain) continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), prospect]);
  }

  const domains = [...byDomain.keys()];
  if (domains.length === 0) {
    return { text: "No company domains to check for signals.", count: 0, skipped: true };
  }

  let matched = 0;

  for (let index = 0; index < domains.length; index += INTENT_BATCH) {
    await assertContinuable(context);
    const slice = domains.slice(index, index + INTENT_BATCH);

    const outcome = await runProviderBatch<IntentResult>({
      runId: context.runId,
      businessId: context.businessId,
      stage: "INTENT_MATCHING",
      capability: "INTENT",
      recordCount: slice.length,
      unitCosts: context.unitCosts,
      unhealthy: context.unhealthy,
      idempotencyKey: `intent:${index}`,
      invoke: (provider) =>
        provider.fetchIntent?.({
          domains: slice,
          // Only the categories this plan asked for, carrying the keywords the
          // workspace configured for each.
          categories: categoryQueries,
          freshnessDays: context.plan.intent.freshnessDays,
        }) ??
        Promise.resolve({
          ok: false,
          records: [],
          costMinor: 0,
          cursor: null,
          latencyMs: 0,
          errorCode: "PROVIDER_NOT_CONFIGURED" as const,
        }),
    });

    if (outcome.budgetExhausted) throw new RunHalt("BUDGET");
    if (!outcome.ok) continue;

    for (const signal of outcome.records) {
      const category = categories.get(signal.category.trim().toLowerCase());
      if (!category) continue;

      const targets = byDomain.get(signal.domain) ?? [];
      if (targets.length === 0) continue;

      const expiresAt = new Date(
        new Date(signal.observedAt).getTime() + category.freshness_days * 864e5,
      ).toISOString();

      for (const prospect of targets) {
        // dedupe_key collapses the same underlying signal arriving twice, from
        // a retry or from two providers.
        const dedupeKey = `${signal.domain}:${category.id}:${signal.observedAt}`;

        const { data: event } = await admin
          .from("intent_events")
          .upsert(
            {
              business_id: context.businessId,
              intent_category_id: category.id,
              company_id: prospect.company?.id ?? null,
              prospect_id: prospect.id,
              signal_type: "SOURCING_RUN",
              source: outcome.provider ?? "unknown",
              source_url: signal.sourceUrl,
              observed_at: signal.observedAt,
              expires_at: expiresAt,
              confidence: Math.max(0, Math.min(1, signal.strength)),
              score_impact: category.score_impact,
              dedupe_key: dedupeKey,
            },
            { onConflict: "business_id,dedupe_key", ignoreDuplicates: false },
          )
          .select("id")
          .maybeSingle();

        if (!event) continue;

        const { error } = await admin.from("prospect_intent_matches").insert({
          business_id: context.businessId,
          prospect_id: prospect.id,
          intent_category_id: category.id,
          intent_event_id: event.id,
          expires_at: expiresAt,
          score_impact: category.score_impact,
        });

        // 23505 is the (prospect_id, intent_event_id) unique index: the same
        // match already recorded, which is success, not failure.
        if (!error) matched += 1;
      }
    }

    await saveCheckpoint(context, { stage: "INTENT_MATCHING", offset: index + INTENT_BATCH });
  }

  return {
    text: "Analysed signals for buying intent.",
    count: matched,
    milestone:
      matched > 0
        ? `Found buying signals for ${matched.toLocaleString("en-GB")} prospects.`
        : undefined,
  };
}

/**
 * Prospects with a live (unexpired) intent match from this run.
 *
 * Read once and cached in a Set rather than queried per prospect, because
 * stage 12 walks every surviving record.
 */
async function prospectsWithLiveIntent(context: RunContext): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("prospect_intent_matches")
    .select("prospect_id, prospects!inner(source_run_id)")
    .eq("business_id", context.businessId)
    .eq("prospects.source_run_id", context.runId)
    .gt("expires_at", new Date().toISOString());

  return new Set((data ?? []).map((row) => row.prospect_id));
}

/* ------------------------------------------------- 12. preparing outreach */

async function prepareOutreach(context: RunContext): Promise<StageSummary> {
  const admin = createAdminClient();
  const prospects = await loadRunProspects(context, ["DISCOVERED", "VERIFIED", "REVIEW"]);

  // "Intent required" means an actual buying signal, not a deliverable mailbox.
  // Conflating the two would mark every verified prospect ready on a run the
  // customer deliberately restricted to businesses showing intent.
  const withIntent = context.plan.intent.required
    ? await prospectsWithLiveIntent(context)
    : new Set<string>();

  let ready = 0;

  for (const prospect of prospects) {
    const grade = prospect.grade as Grade | null;

    // Three independent gates, all of which must pass. Intent-required is the
    // one that can hold back an otherwise perfect record, deliberately.
    const gradeOk = meetsMinimumGrade(grade, context.minimumGrade);
    const eligible = prospect.outreach_eligibility === "ELIGIBLE";
    const intentOk = !context.plan.intent.required || withIntent.has(prospect.id);

    if (gradeOk && eligible && intentOk && prospect.status !== "SUPPRESSED") {
      ready += 1;
      await admin
        .from("prospects")
        .update({ status: "READY" })
        .eq("id", prospect.id)
        .eq("business_id", context.businessId);

      await admin.from("sourcing_run_results").insert({
        business_id: context.businessId,
        run_id: context.runId,
        prospect_id: prospect.id,
        outcome: "READY",
        score: prospect.score,
        grade: prospect.grade,
      });
    } else if (prospect.status !== "SUPPRESSED" && prospect.status !== "DISQUALIFIED") {
      await admin
        .from("prospects")
        .update({
          status: "REVIEW",
          eligibility_reason:
            prospect.eligibility_reason ??
            (!gradeOk
              ? "Below your minimum grade"
              : !intentOk
                ? "No buying signal found, and this search required one"
                : "Needs a decision before outreach"),
        })
        .eq("id", prospect.id)
        .eq("business_id", context.businessId);
    }
  }

  return {
    text:
      context.plan.reviewMode === "HUMAN_REVIEW"
        ? "Prepared the list for your review."
        : "Prepared the list for outreach.",
    count: ready,
  };
}

/* --------------------------------------------------------------- helpers */

type RunProspect = {
  id: string;
  email: string | null;
  role_title: string | null;
  status: string;
  grade: string | null;
  score: number | null;
  verification_status: string;
  outreach_eligibility: string;
  eligibility_reason: string | null;
  company: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    employee_count: number | null;
    location_json: unknown;
  } | null;
};

async function loadRunProspects(
  context: RunContext,
  statuses: string[],
): Promise<RunProspect[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("prospects")
    .select(
      "id, email, role_title, status, grade, score, verification_status, outreach_eligibility, eligibility_reason, company:prospect_companies(id, name, domain, industry, employee_count, location_json)",
    )
    .eq("business_id", context.businessId)
    .eq("source_run_id", context.runId)
    .in("status", statuses)
    .limit(5000);

  return (data ?? []) as unknown as RunProspect[];
}

async function loadRunCompanies(context: RunContext) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sourcing_run_results")
    .select("company_id, prospect_companies(id, name, domain, industry, employee_count)")
    .eq("business_id", context.businessId)
    .eq("run_id", context.runId)
    .eq("outcome", "COMPANY_FOUND")
    .limit(2000);

  return (data ?? [])
    .map((row) => row.prospect_companies)
    .filter(
      (company): company is {
        id: string;
        name: string;
        domain: string | null;
        industry: string | null;
        employee_count: number | null;
      } => Boolean(company),
    );
}

/** Companies with at least one candidate that survived the cheap filter. */
async function loadSurvivingCompanies(context: RunContext) {
  const prospects = await loadRunProspects(context, ["DISCOVERED", "VERIFIED"]);
  const byId = new Map<
    string,
    { id: string; name: string; domain: string | null; industry: string | null; employee_count: number | null }
  >();

  for (const prospect of prospects) {
    if (!prospect.company) continue;
    // Only companies whose best candidate clears the enrichment gate are worth
    // paying to enrich (§59.3).
    if ((prospect.score ?? 100) < ENRICHMENT_GATE_SCORE) continue;
    byId.set(prospect.company.id, {
      id: prospect.company.id,
      name: prospect.company.name,
      domain: prospect.company.domain,
      industry: prospect.company.industry,
      employee_count: prospect.company.employee_count,
    });
  }

  return [...byId.values()];
}

async function countResults(context: RunContext, outcome: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("sourcing_run_results")
    .select("id", { count: "exact", head: true })
    .eq("business_id", context.businessId)
    .eq("run_id", context.runId)
    .eq("outcome", outcome);
  return count ?? 0;
}

async function refreshProgress(context: RunContext): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sourcing_run_stages")
    .select("status")
    .eq("business_id", context.businessId)
    .eq("run_id", context.runId);

  await admin
    .from("sourcing_runs")
    .update({
      progress_percent: progressPercent(
        (data ?? []) as { status: "PENDING" | "RUNNING" | "COMPLETED" | "SKIPPED" | "FAILED" | "PAUSED" }[],
      ),
    })
    .eq("id", context.runId)
    .eq("business_id", context.businessId);
}

async function raiseIssue(
  context: RunContext,
  issue: {
    severity: "INFO" | "WARNING" | "ERROR";
    code: string;
    message: string;
    detail: string;
    requiresUserAction: boolean;
  },
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("sourcing_run_issues").insert({
    business_id: context.businessId,
    run_id: context.runId,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    detail_json: { detail: issue.detail } as never,
    requires_user_action: issue.requiresUserAction,
  });
}

/**
 * Milestone updates only. A message per record would drown the conversation
 * and tell the customer nothing they could act on.
 */
async function postMilestone(context: RunContext, text: string): Promise<void> {
  const admin = createAdminClient();
  const { data: run } = await admin
    .from("sourcing_runs")
    .select("session_id")
    .eq("id", context.runId)
    .eq("business_id", context.businessId)
    .maybeSingle();

  if (!run?.session_id) return;

  await admin.from("search_messages").insert({
    business_id: context.businessId,
    session_id: run.session_id,
    role: "ASSISTANT",
    content: text,
    structured_data: { runId: context.runId, milestone: true } as never,
  });
}

async function completeRun(context: RunContext): Promise<void> {
  const admin = createAdminClient();
  const counters = await collectCounters(context);

  const status =
    counters.ready >= context.target
      ? "COMPLETED"
      : counters.ready > 0
        ? "PARTIAL"
        : "COMPLETED";

  await admin
    .from("sourcing_runs")
    .update({
      status,
      current_stage: "DONE",
      progress_percent: 100,
      counts_json: counters as never,
      completed_at: new Date().toISOString(),
      checkpoint_json: {} as never,
    })
    .eq("id", context.runId)
    .eq("business_id", context.businessId);

  const { data: run } = await admin
    .from("sourcing_runs")
    .select("session_id")
    .eq("id", context.runId)
    .eq("business_id", context.businessId)
    .maybeSingle();

  if (run?.session_id) {
    // The rail's per-session count is the sum of what its runs produced.
    const { data: session } = await admin
      .from("search_sessions")
      .select("prospects_found")
      .eq("business_id", context.businessId)
      .eq("id", run.session_id)
      .maybeSingle();

    await admin
      .from("search_sessions")
      .update({ prospects_found: (session?.prospects_found ?? 0) + counters.ready })
      .eq("business_id", context.businessId)
      .eq("id", run.session_id);

    await admin.from("search_messages").insert({
      business_id: context.businessId,
      session_id: run.session_id,
      role: "ASSISTANT",
      content: `Sourcing finished. ${counters.ready.toLocaleString("en-GB")} prospects are ready${counters.reviewRequired > 0 ? `, and ${counters.reviewRequired.toLocaleString("en-GB")} need your review` : ""}.`,
      structured_data: { runId: context.runId, milestone: true } as never,
    });
  }

  // Verified prospects are the metered unit, billed on what was produced —
  // never on what was requested.
  if (counters.ready > 0) {
    await admin.from("usage_events").insert({
      business_id: context.businessId,
      metric: "verified_prospect",
      quantity: counters.ready,
      source: "find_leads",
      metadata: { runId: context.runId } as never,
    });
  }

  // Auto-contact: hand the READY prospects to the campaign that will send to
  // them. Enrolment is not permission — the dispatcher re-checks contactability
  // per recipient immediately before each send — but without this the mode did
  // nothing at all, which is worse than refusing it.
  if (context.plan.reviewMode === "AUTO_CONTACT" && counters.ready > 0) {
    await enrolAndDispatch(context, counters.ready);
  }

  await recordAudit({
    businessId: context.businessId,
    actorType: "system",
    action: "sourcing_run.completed",
    entityType: "sourcing_run",
    entityId: context.runId,
    metadata: { ...counters },
  });
}

/**
 * Attaches this run's READY prospects to an active campaign and queues the
 * first send.
 *
 * The campaign has to exist and be active already — `createRun` refuses an
 * AUTO_CONTACT plan without one, so reaching here with none means it was
 * paused mid-run, and the prospects wait for review rather than being sent by
 * some other campaign chosen on their behalf.
 */
async function enrolAndDispatch(
  context: RunContext,
  readyCount: number,
): Promise<void> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("id, status, review_before_outreach")
    .eq("business_id", context.businessId)
    .eq("status", "ACTIVE")
    .eq("review_before_outreach", false)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!campaign) {
    await raiseIssue(context, {
      severity: "WARNING",
      code: "NO_ACTIVE_CAMPAIGN",
      message: `${readyCount.toLocaleString("en-GB")} prospects are ready, but no campaign is active.`,
      detail: "They are waiting for review. Activate a campaign to contact them.",
      requiresUserAction: true,
    });
    return;
  }

  // Only records that are still READY and ELIGIBLE right now.
  await admin
    .from("prospects")
    .update({ campaign_id: campaign.id })
    .eq("business_id", context.businessId)
    .eq("source_run_id", context.runId)
    .eq("status", "READY")
    .eq("outreach_eligibility", "ELIGIBLE")
    .is("campaign_id", null);

  await enqueue(
    "outreach.dispatch",
    { campaignId: campaign.id, businessId: context.businessId },
    {
      businessId: context.businessId,
      idempotencyKey: `outreach.dispatch:${context.runId}`,
    },
  );
}

/**
 * The run's funnel counters.
 *
 * Aggregated by Postgres via `sourcing_run_counters()`, not by reading the rows.
 * A run that produced more results than PostgREST's row cap would otherwise
 * count only the first page and silently under-report every number the customer
 * sees — the exact truncation trap section 21.7 warns about.
 */
async function collectCounters(context: RunContext): Promise<RunCounters> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("sourcing_run_counters", {
    p_business_id: context.businessId,
    p_run_id: context.runId,
  });

  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return { ...EMPTY_COUNTERS };

  return {
    ...EMPTY_COUNTERS,
    companiesFound: row.companies_found,
    contactsFound: row.contacts_found,
    emailsDiscovered: row.emails_discovered,
    verified: row.verified,
    duplicates: row.duplicates,
    suppressed: row.suppressed,
    reviewRequired: row.review_required,
    ready: row.ready,
  };
}

export { STAGES };
