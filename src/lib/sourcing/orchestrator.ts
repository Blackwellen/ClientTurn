import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAGE_KEYS } from "@/lib/find-leads/stages";
import { checkSuppression } from "@/lib/policy/suppression";
import { evaluateAllChannels } from "@/lib/policy/service";
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
  gradeForScore,
  scoreProspect,
  passesContactDiscoveryGate,
  type ScoreFeature,
} from "@/lib/prospects/scoring";
import {
  applySpend,
  budgetState,
  canSpend,
  deriveLimits,
  EMPTY_SPEND,
  recordVerified,
  resultState,
  type BudgetLimits,
  type BudgetSpend,
} from "./budget";
import { chainFor, usingStubProviders } from "./registry";
import type { CompanyCandidate, ContactCandidate } from "./provider-types";

/**
 * SourcingOrchestrator (V4 §11, §53, §59).
 *
 * Implements the cost-efficient waterfall: free and deterministic checks first,
 * then cheap company enrichment, then expensive contact discovery — and each
 * step only for candidates that survived the previous gate. The point is that
 * a run spends its budget on prospects it will actually contact.
 *
 *   candidate company
 *     → free/cheap deterministic filters
 *     → fit gate            (stop if too low)
 *     → cheap company enrichment
 *     → enrichment gate     (stop if below threshold)
 *     → contact discovery / enrichment
 *     → email verification
 *     → compliance and contactability
 *     → final score and grade
 *
 * Three properties matter more than throughput:
 *
 *   1. **It stops gracefully.** Hitting a ceiling produces a PARTIAL run that
 *      keeps everything found so far, never a failure that discards it.
 *   2. **It is resumable and idempotent.** Every provider call carries a stable
 *      idempotency key, so a retried worker cannot double-charge.
 *   3. **It never creates a Lead.** Everything it produces is a Prospect;
 *      crossing that boundary is LeadPromotionService's job alone.
 */

export type RunContext = {
  runId: string;
  businessId: string;
  strategy: SearchStrategy;
  limits: BudgetLimits;
};

/** The validated structured plan. Mirrors the Zod schema in search-sessions. */
export type SearchStrategy = {
  industries: string[];
  locations: { country?: string; region?: string; city?: string; radiusMiles?: number }[];
  companyFilters: { employeeMin?: number; employeeMax?: number };
  decisionRoles: string[];
  intentCategoryIds: string[];
  exclusions: { domains?: string[]; keywords?: string[] };
  minimumGrade: "A+" | "A" | "B" | "C" | "D";
  targetVerifiedProspects: number;
  conversionGoalId: string | null;
  reviewBeforeOutreach: boolean;
  icpProfileId: string | null;
};

// Derived from the canonical stage list rather than restated, so the run page,
// the worker and this orchestrator cannot drift apart. DONE is the terminal
// state the twelve working stages resolve into.
type Stage = (typeof STAGE_KEYS)[number] | "DONE";

/* ------------------------------------------------------------------ entry */

export type RunOutcome = {
  status: "COMPLETED" | "PARTIAL" | "CANCELLED" | "FAILED";
  verified: number;
  ready: number;
  spend: BudgetSpend;
};

/**
 * Executes one sourcing run to completion, its budget, or its cancellation.
 *
 * Designed to be called from a job handler. It re-reads the run row at each
 * stage boundary so a pause or cancel issued from the UI takes effect within a
 * stage rather than at the end of the run.
 */
export async function executeRun(runId: string): Promise<RunOutcome> {
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("sourcing_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (!run) throw new Error(`Sourcing run ${runId} not found`);
  if (run.status === "COMPLETED" || run.status === "CANCELLED") {
    // Already terminal. A duplicate job delivery must be a no-op, not a rerun.
    return {
      status: run.status as RunOutcome["status"],
      verified: 0,
      ready: 0,
      spend: EMPTY_SPEND,
    };
  }

  const strategy = await loadStrategy(run.search_strategy_id);
  if (!strategy) {
    await failRun(runId, "NO_STRATEGY", "This run has no approved search plan.");
    return { status: "FAILED", verified: 0, ready: 0, spend: EMPTY_SPEND };
  }

  const limits: BudgetLimits = {
    targetVerifiedProspects: run.target_verified,
    maxCompaniesChecked: readLimit(run.limits_json, "maxCompaniesChecked", run.target_verified * 8),
    maxContactsRequested: readLimit(run.limits_json, "maxContactsRequested", run.target_verified * 3),
    maxSearchCalls: readLimit(run.limits_json, "maxSearchCalls", 10),
    maxEnrichmentCalls: readLimit(run.limits_json, "maxEnrichmentCalls", run.target_verified * 2),
    maxVerificationCalls: readLimit(
      run.limits_json,
      "maxVerificationCalls",
      Math.ceil(run.target_verified * 1.5),
    ),
    maxProviderCostMinor: run.max_provider_cost_minor,
    maxTotalCostMinor: run.max_total_cost_minor,
    deadlineAt: run.deadline_at,
  };

  const context: RunContext = { runId, businessId: run.business_id, strategy, limits };

  let spend: BudgetSpend = { ...EMPTY_SPEND, totalCostMinor: run.spent_cost_minor ?? 0 };
  let failed = false;

  try {
    await setStage(runId, "RUNNING", "FINDING_COMPANIES");
    spend = await sourceCompanies(context, spend);
  } catch (error) {
    failed = true;
    await recordIssue(context, "ERROR", "RUN_FAILED", messageOf(error));
  }

  const cancelled = await isCancelRequested(runId);
  const result = resultState(limits, spend, cancelled, failed);

  const status: RunOutcome["status"] =
    result === "FAILED"
      ? "FAILED"
      : cancelled
        ? "CANCELLED"
        : result === "COMPLETED"
          ? "COMPLETED"
          : "PARTIAL";

  const counts = await countOutcomes(context);

  await admin
    .from("sourcing_runs")
    .update({
      status,
      current_stage: "DONE",
      budget_state: budgetState(limits, spend),
      spent_cost_minor: spend.totalCostMinor,
      counts_json: counts as never,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return {
    status,
    verified: spend.verifiedProspects,
    ready: counts.ready ?? 0,
    spend,
  };
}

/* ------------------------------------------------------------- the funnel */

async function sourceCompanies(
  context: RunContext,
  initialSpend: BudgetSpend,
): Promise<BudgetSpend> {
  let spend = initialSpend;
  const { strategy, limits } = context;

  const searchChain = chainFor("companySearch", strategy.locations[0]?.country ?? null);
  if (searchChain.length === 0) {
    await recordIssue(context, "ERROR", "NO_PROVIDER", "No company search provider is configured.");
    return spend;
  }

  const provider = searchChain[0];
  const batchSize = 25;

  while (true) {
    if (await isCancelRequested(context.runId)) return spend;

    const verdict = canSpend(limits, spend, "SEARCH", provider.descriptor.estimatedUnitCostMinor * batchSize);
    if (!verdict.allowed) {
      await recordIssue(context, "INFO", "BUDGET_STOP", verdict.reason);
      return spend;
    }

    const key = `search:${context.runId}:${spend.searchCalls}`;
    const result = await provider.searchCompanies({
      industries: strategy.industries,
      locations: strategy.locations,
      employeeRange: {
        min: strategy.companyFilters.employeeMin,
        max: strategy.companyFilters.employeeMax,
      },
      excludeDomains: strategy.exclusions.domains ?? [],
      limit: batchSize,
    });

    await recordQuery(context, "FINDING_COMPANIES", provider.descriptor.name, "COMPANY_SEARCH", key, result);

    if (!result.ok) {
      await recordIssue(context, "WARNING", result.errorCode, result.message);
      return spend;
    }

    spend = applySpend(spend, "SEARCH", result.costMinor, result.data.length);
    if (result.data.length === 0) return spend;

    await setStage(context.runId, "RUNNING", "PRE_FILTERING");

    for (const candidate of result.data) {
      if (await isCancelRequested(context.runId)) return spend;
      spend = await processCompany(context, candidate, spend);

      if (spend.verifiedProspects >= limits.targetVerifiedProspects) return spend;
    }

    await persistSpend(context.runId, spend, limits);
  }
}

/**
 * One company through the waterfall.
 *
 * Every early return here is a saved provider call. The order is deliberate:
 * the free checks and the fit gate run before anything is paid for.
 */
async function processCompany(
  context: RunContext,
  candidate: CompanyCandidate,
  initialSpend: BudgetSpend,
): Promise<BudgetSpend> {
  let spend = initialSpend;
  const admin = createAdminClient();

  /* 1. Free deterministic checks (§59.2). */
  const domain = normaliseDomain(candidate.domain ?? candidate.websiteUrl);
  const checks = cheapChecks({ domain, companyName: candidate.name });

  if (checks.reject) {
    await recordResult(context, candidate, "REJECTED_FIT", checks.flags.join(", "));
    return spend;
  }

  /* 2. Existing-customer and duplicate lookup. An existing lead ALWAYS wins over
   *    creating a cold prospect (§60.3) — this is what stops sourcing from
   *    cold-emailing the business's own customers. */
  if (domain) {
    const { data: existingLead } = await admin
      .from("leads")
      .select("id")
      .eq("business_id", context.businessId)
      .ilike("email", `%@${domain}`)
      .limit(1)
      .maybeSingle();

    if (existingLead) {
      await recordResult(context, candidate, "DUPLICATE", "Already a lead in this workspace");
      return spend;
    }
  }

  /* 3. Fit gate before any paid enrichment. */
  const fitFeatures = companyFitFeatures(context.strategy, candidate);
  const fitScore = scoreProspect(fitFeatures);

  if (!passesContactDiscoveryGate(fitScore.totalScore)) {
    await recordResult(context, candidate, "REJECTED_FIT", fitScore.explanation, fitScore.totalScore);
    return spend;
  }

  /* 4. Upsert the company. Deduped by the normalised key, so the same company
   *    found by two runs is one row. */
  const dedupeKey = companyDedupeKey({
    domain,
    name: candidate.name,
    postcode: candidate.location.postcode,
    city: candidate.location.city,
    registrationId: candidate.registrationId,
  });

  const { data: company } = await admin
    .from("prospect_companies")
    .upsert(
      {
        business_id: context.businessId,
        name: candidate.name,
        domain,
        website_url: candidate.websiteUrl,
        industry: candidate.industry,
        company_size: candidate.companySize,
        employee_count: candidate.employeeCount,
        location_json: candidate.location as never,
        description: candidate.description,
        external_ids: candidate.externalIds as never,
        dedupe_key: dedupeKey,
      },
      { onConflict: "business_id,dedupe_key" },
    )
    .select("id")
    .single();

  if (!company) return spend;

  await recordResult(context, candidate, "COMPANY_FOUND", null, fitScore.totalScore, company.id);

  /* 5. Contact discovery — the first genuinely expensive step. */
  const contactChain = chainFor("contactDiscovery", candidate.location.country ?? null);
  if (contactChain.length === 0 || !domain) return spend;

  const contactProvider = contactChain[0];
  const verdict = canSpend(
    context.limits,
    spend,
    "CONTACT_DISCOVERY",
    contactProvider.descriptor.estimatedUnitCostMinor * 3,
  );
  if (!verdict.allowed) return spend;

  await setStage(context.runId, "RUNNING", "FINDING_CONTACTS");

  const contactKey = `contacts:${context.runId}:${company.id}`;
  const contacts = await contactProvider.findContacts({
    companyDomain: domain,
    companyName: candidate.name,
    roles: context.strategy.decisionRoles,
    limit: 3,
  });

  await recordQuery(
    context,
    "FINDING_CONTACTS",
    contactProvider.descriptor.name,
    "CONTACT_DISCOVERY",
    contactKey,
    contacts,
  );

  if (!contacts.ok) return spend;
  spend = applySpend(spend, "CONTACT_DISCOVERY", contacts.costMinor, contacts.data.length);

  for (const contact of contacts.data) {
    spend = await processContact(context, contact, company.id, candidate, fitScore.totalScore, spend);
    if (spend.verifiedProspects >= context.limits.targetVerifiedProspects) break;
  }

  return spend;
}

async function processContact(
  context: RunContext,
  contact: ContactCandidate,
  companyId: string,
  company: CompanyCandidate,
  companyFit: number,
  initialSpend: BudgetSpend,
): Promise<BudgetSpend> {
  let spend = initialSpend;
  const admin = createAdminClient();

  const email = normaliseEmail(contact.email);
  if (!email) return spend;

  /* Free checks again, now that we have an address. */
  const checks = cheapChecks({ email, domain: emailDomain(email), companyName: company.name });
  if (checks.reject) return spend;

  /* Duplicate against existing prospects and leads. */
  const [{ data: existingProspect }, { data: existingLead }] = await Promise.all([
    admin
      .from("prospects")
      .select("id")
      .eq("business_id", context.businessId)
      .eq("email", email)
      .maybeSingle(),
    admin
      .from("leads")
      .select("id")
      .eq("business_id", context.businessId)
      .ilike("email", email)
      .maybeSingle(),
  ]);

  if (existingLead) {
    await recordResult(context, company, "DUPLICATE", "Already a lead", null, companyId);
    return spend;
  }
  if (existingProspect) {
    await recordResult(context, company, "DUPLICATE", "Already a prospect", null, companyId);
    return spend;
  }

  /* Suppression, before spending anything on verification. */
  const suppression = await checkSuppression(context.businessId, "EMAIL", { email });
  if (suppression) {
    await recordResult(context, company, "SUPPRESSED", suppression.reason, null, companyId);
    return spend;
  }

  /* Verification. */
  await setStage(context.runId, "RUNNING", "VERIFYING");

  const verifyChain = chainFor("emailVerification", company.location.country ?? null);
  let verificationStatus = "UNKNOWN";

  if (verifyChain.length > 0) {
    const verifier = verifyChain[0];
    const verdict = canSpend(
      context.limits,
      spend,
      "VERIFICATION",
      verifier.descriptor.estimatedUnitCostMinor,
    );

    if (verdict.allowed) {
      const key = `verify:${context.runId}:${email}`;
      const result = await verifier.verifyEmail(email);
      await recordQuery(context, "VERIFYING", verifier.descriptor.name, "EMAIL_VERIFICATION", key, result);

      if (result.ok) {
        spend = applySpend(spend, "VERIFICATION", result.costMinor);
        verificationStatus = result.data.result;

        // An invalid address is worth nothing and is a deliverability risk, so
        // it is dropped rather than stored as a low-grade prospect.
        if (result.data.result === "INVALID") {
          await recordResult(context, company, "REJECTED_VERIFICATION", "Invalid address", null, companyId);
          return spend;
        }
      }
    }
  }

  /* Final score, now that role and verification are known. */
  const features = [
    ...companyFitFeatures(context.strategy, company),
    ...contactFeatures(context.strategy, contact, verificationStatus, email),
  ];
  const score = scoreProspect(features);

  /* Create the prospect. */
  const { data: prospect } = await admin
    .from("prospects")
    .insert({
      business_id: context.businessId,
      company_id: companyId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      role_title: contact.roleTitle,
      role_classification: classifyRole(contact.roleTitle),
      email,
      phone_e164: contact.phone,
      linkedin_url: contact.linkedinUrl,
      location_json: company.location as never,
      status: "VERIFIED",
      grade: score.grade,
      score: score.totalScore,
      verification_status: verificationStatus,
      icp_profile_id: context.strategy.icpProfileId,
      source_run_id: context.runId,
      source_provider: "stub",
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!prospect) return spend;

  await persistScore(context, prospect.id, score);

  /* Contactability. This is what decides whether the prospect is READY or waits
   * for a human — never the score alone. */
  await setStage(context.runId, "RUNNING", "CLASSIFYING");

  const { eligibility } = await evaluateAllChannels(
    context.businessId,
    {
      type: "PROSPECT",
      id: prospect.id,
      email,
      country: company.location.country ?? null,
      subscriberType: isRoleMailbox(email) || isGenericEmailDomain(emailDomain(email)) ? "UNKNOWN" : "CORPORATE",
      relationshipType: "FOUND_BY_US",
    },
    "COLD",
    { record: true },
  );

  const ready = eligibility === "ELIGIBLE" && meetsGrade(score.grade, context.strategy.minimumGrade);

  await admin
    .from("prospects")
    .update({
      status: ready ? "READY" : eligibility === "SUPPRESSED" ? "SUPPRESSED" : "REVIEW",
      outreach_eligibility: eligibility,
    })
    .eq("id", prospect.id);

  await recordResult(
    context,
    company,
    ready ? "READY" : eligibility === "SUPPRESSED" ? "SUPPRESSED" : "REVIEW_REQUIRED",
    null,
    score.totalScore,
    companyId,
    prospect.id,
  );

  await meterVerifiedProspect(context.businessId, prospect.id);

  return recordVerified(spend);
}

/* ---------------------------------------------------------------- scoring */

function companyFitFeatures(strategy: SearchStrategy, company: CompanyCandidate): ScoreFeature[] {
  const industryMatch = strategy.industries.some(
    (i) => company.industry && company.industry.toLowerCase().includes(i.toLowerCase()),
  );

  const country = company.location.country?.toUpperCase();
  const geoMatch = strategy.locations.some(
    (l) => !l.country || l.country.toUpperCase() === country,
  );

  const size = company.employeeCount;
  const sizeOk =
    size === null ||
    ((strategy.companyFilters.employeeMin === undefined || size >= strategy.companyFilters.employeeMin) &&
      (strategy.companyFilters.employeeMax === undefined || size <= strategy.companyFilters.employeeMax));

  return [
    {
      factor: "ICP_FIT",
      value: industryMatch ? 1 : 0.3,
      confidence: company.industry ? 0.9 : 0.3,
      evidenceSummary: company.industry
        ? `Industry recorded as ${company.industry}`
        : "No industry recorded",
      evidenceSource: "company search",
    },
    {
      factor: "GEOGRAPHY",
      value: geoMatch ? 1 : 0,
      confidence: country ? 0.95 : 0.3,
      evidenceSummary: country ? `Located in ${country}` : "Location unknown",
      evidenceSource: "company search",
    },
    {
      factor: "NEED",
      value: sizeOk ? 0.7 : 0.2,
      confidence: size === null ? 0.3 : 0.7,
      evidenceSummary: size ? `About ${size} employees` : "Company size unknown",
      evidenceSource: "company search",
    },
  ];
}

function contactFeatures(
  strategy: SearchStrategy,
  contact: ContactCandidate,
  verification: string,
  email: string,
): ScoreFeature[] {
  const title = (contact.roleTitle ?? "").toLowerCase();
  const roleMatch = strategy.decisionRoles.some((r) => title.includes(r.toLowerCase()));

  const quality =
    verification === "VALID" ? 1 : verification === "CATCH_ALL" ? 0.5 : verification === "RISKY" ? 0.3 : 0.2;

  return [
    {
      factor: "ROLE_AUTHORITY",
      value: roleMatch ? 1 : title ? 0.4 : 0.1,
      confidence: title ? 0.85 : 0.2,
      evidenceSummary: contact.roleTitle ? `Title: ${contact.roleTitle}` : "No title found",
      evidenceSource: "contact discovery",
    },
    {
      factor: "DATA_QUALITY",
      // A role mailbox is a real address but a weak prospect: nobody owns it.
      value: isRoleMailbox(email) ? Math.min(quality, 0.4) : quality,
      confidence: 0.9,
      evidenceSummary: isRoleMailbox(email)
        ? "Shared role mailbox rather than an individual"
        : `Email verification: ${verification.toLowerCase()}`,
      evidenceSource: "verification",
    },
  ];
}

function classifyRole(title: string | null): string {
  const t = (title ?? "").toLowerCase();
  if (/director|owner|founder|ceo|principal|partner|head of/.test(t)) return "DECISION_MAKER";
  if (/manager|lead|supervisor/.test(t)) return "INFLUENCER";
  if (/assistant|coordinator|reception/.test(t)) return "GATEKEEPER";
  if (t) return "USER";
  return "UNKNOWN";
}

const GRADE_ORDER = ["D", "C", "B", "A", "A+"];
function meetsGrade(grade: string, minimum: string): boolean {
  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(minimum);
}

/* ------------------------------------------------------------ persistence */

async function persistScore(
  context: RunContext,
  prospectId: string,
  score: ReturnType<typeof scoreProspect>,
): Promise<void> {
  const admin = createAdminClient();

  // Only one current score per prospect; older ones stay as history.
  await admin
    .from("prospect_scores")
    .update({ is_current: false })
    .eq("business_id", context.businessId)
    .eq("prospect_id", prospectId);

  const { data: row } = await admin
    .from("prospect_scores")
    .insert({
      business_id: context.businessId,
      prospect_id: prospectId,
      score_version: score.scoreVersion,
      total_score: score.totalScore,
      grade: score.grade,
      factor_json: score.factors as never,
      explanation: score.explanation,
      is_current: true,
    })
    .select("id")
    .single();

  if (!row) return;

  await admin.from("prospect_score_factors").insert(
    score.factors.map((factor) => ({
      business_id: context.businessId,
      prospect_score_id: row.id,
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

/** The parts of a ProviderResult this function needs, whatever `T` was. */
type RecordableResult = {
  ok: boolean;
  costMinor: number;
  latencyMs?: number;
  data?: unknown;
  errorCode?: string;
};

async function recordQuery(
  context: RunContext,
  stage: string,
  provider: string,
  capability: string,
  idempotencyKey: string,
  result: RecordableResult,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("sourcing_run_queries").insert({
    business_id: context.businessId,
    run_id: context.runId,
    stage,
    provider,
    capability,
    status: result.ok ? "SUCCESS" : "FAILED",
    result_count: Array.isArray(result.data) ? result.data.length : 0,
    cost_minor: result.costMinor,
    latency_ms: result.latencyMs ?? null,
    error_code: result.ok ? null : (result.errorCode ?? "ERROR"),
    idempotency_key: idempotencyKey,
    completed_at: new Date().toISOString(),
  });

  // A unique violation means this exact provider call was already recorded by
  // an earlier attempt — the desired outcome for a retried job, not an error.
  if (error && error.code !== "23505") throw error;

  if (result.costMinor > 0) {
    await admin.from("cost_events").insert({
      business_id: context.businessId,
      provider,
      metric: capability.toLowerCase(),
      category: costCategory(capability),
      quantity: 1,
      unit_cost: result.costMinor / 100,
      total_cost: result.costMinor / 100,
      sourcing_run_id: context.runId,
      idempotency_key: `cost:${idempotencyKey}`,
    });
  }
}

function costCategory(capability: string): string {
  if (capability === "COMPANY_SEARCH" || capability === "CONTACT_DISCOVERY") return "DISCOVERY";
  if (capability === "EMAIL_VERIFICATION") return "VERIFICATION";
  if (capability === "INTENT") return "INTENT";
  return "ENRICHMENT";
}

async function recordResult(
  context: RunContext,
  company: CompanyCandidate,
  outcome: string,
  reason: string | null,
  score?: number | null,
  companyId?: string,
  prospectId?: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("sourcing_run_results").insert({
    business_id: context.businessId,
    run_id: context.runId,
    company_id: companyId ?? null,
    prospect_id: prospectId ?? null,
    candidate_name: company.name,
    candidate_domain: company.domain,
    outcome,
    reason,
    score: score ?? null,
    grade: score !== null && score !== undefined ? gradeForScore(score) : null,
  });
}

async function recordIssue(
  context: RunContext,
  severity: "INFO" | "WARNING" | "ERROR",
  code: string,
  message: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("sourcing_run_issues").insert({
    business_id: context.businessId,
    run_id: context.runId,
    severity,
    code,
    message,
    requires_user_action: severity === "ERROR",
  });
}

async function setStage(runId: string, status: string, stage: Stage): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("sourcing_runs")
    .update({ status, current_stage: stage, started_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["QUEUED", "RUNNING"]);
}

async function persistSpend(
  runId: string,
  spend: BudgetSpend,
  limits: BudgetLimits,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("sourcing_runs")
    .update({
      spent_cost_minor: spend.totalCostMinor,
      budget_state: budgetState(limits, spend),
    })
    .eq("id", runId);
}

async function isCancelRequested(runId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sourcing_runs")
    .select("cancel_requested, status")
    .eq("id", runId)
    .maybeSingle();
  return Boolean(data?.cancel_requested) || data?.status === "PAUSED";
}

async function failRun(runId: string, code: string, message: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("sourcing_runs")
    .update({
      status: "FAILED",
      error_code: code,
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function countOutcomes(context: RunContext): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("sourcing_run_counters", {
    p_business_id: context.businessId,
    p_run_id: context.runId,
  });
  const row = Array.isArray(data) ? data[0] : null;
  return {
    companiesFound: row?.companies_found ?? 0,
    contactsFound: row?.contacts_found ?? 0,
    verified: row?.verified ?? 0,
    duplicates: row?.duplicates ?? 0,
    suppressed: row?.suppressed ?? 0,
    reviewRequired: row?.review_required ?? 0,
    ready: row?.ready ?? 0,
    rejected: row?.rejected ?? 0,
  };
}

/** Meters one verified prospect against the plan allowance. */
async function meterVerifiedProspect(businessId: string, prospectId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("usage_events").insert({
    business_id: businessId,
    metric: "verified_prospect",
    quantity: 1,
    source: "sourcing",
    metadata: { prospect_id: prospectId } as never,
  });
}

async function loadStrategy(strategyId: string | null): Promise<SearchStrategy | null> {
  if (!strategyId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("search_strategies")
    .select("strategy_json, status")
    .eq("id", strategyId)
    .maybeSingle();

  // An unapproved plan must never trigger provider spend (§55.2).
  if (!data || data.status !== "APPROVED") return null;
  return data.strategy_json as unknown as SearchStrategy;
}

function readLimit(json: unknown, key: string, fallback: number): number {
  if (json && typeof json === "object" && key in (json as Record<string, unknown>)) {
    const value = (json as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { deriveLimits, usingStubProviders };
