/**
 * Sourcing run budgets (V4 §52.2, §53).
 *
 * A run carries an explicit envelope — how many provider calls of each kind it
 * may make, how much it may spend, and when it must stop regardless. The
 * orchestrator asks this module before every costed step and stops *gracefully*
 * when an answer is no: a run that hits its ceiling is PARTIAL, not FAILED, and
 * keeps everything it found up to that point.
 *
 * Pure and unit-testable. The persistence lives in `orchestrator.ts`.
 */

export type BudgetLimits = {
  maxCompaniesChecked: number;
  maxContactsRequested: number;
  targetVerifiedProspects: number;
  maxSearchCalls: number;
  maxEnrichmentCalls: number;
  maxVerificationCalls: number;
  maxProviderCostMinor: number;
  maxTotalCostMinor: number;
  /** Wall-clock stop, so a stuck provider cannot hold a run open forever. */
  deadlineAt: string | null;
};

export type BudgetSpend = {
  companiesChecked: number;
  contactsRequested: number;
  verifiedProspects: number;
  searchCalls: number;
  enrichmentCalls: number;
  verificationCalls: number;
  providerCostMinor: number;
  totalCostMinor: number;
};

export type BudgetState =
  | "WITHIN_BUDGET"
  | "NEAR_LIMIT"
  | "BUDGET_LIMIT_REACHED"
  | "PLAN_LIMIT_REACHED"
  | "PROVIDER_LIMIT_REACHED";

/** §52.3. How a run ended, in the run's own vocabulary. */
export type BudgetResultState =
  | "COMPLETED"
  | "PARTIAL_TARGET_REACHED"
  | "BUDGET_LIMIT_REACHED"
  | "PLAN_LIMIT_REACHED"
  | "PROVIDER_LIMIT_REACHED"
  | "PAUSED"
  | "FAILED";

export type CostedStep =
  | "SEARCH"
  | "COMPANY_ENRICHMENT"
  | "CONTACT_DISCOVERY"
  | "CONTACT_ENRICHMENT"
  | "VERIFICATION"
  | "INTENT"
  | "AI";

export const EMPTY_SPEND: BudgetSpend = {
  companiesChecked: 0,
  contactsRequested: 0,
  verifiedProspects: 0,
  searchCalls: 0,
  enrichmentCalls: 0,
  verificationCalls: 0,
  providerCostMinor: 0,
  totalCostMinor: 0,
};

export type BudgetVerdict =
  | { allowed: true }
  | { allowed: false; state: BudgetState; reason: string };

/** Warn once spend passes this share of the ceiling, so the UI can show the
 *  meter turning amber before the run stops. */
const NEAR_LIMIT_RATIO = 0.85;

/**
 * May the run take one more step of this kind, costing at most `costMinor`?
 *
 * Checks are ordered so the most informative answer wins: a run that has both
 * reached its target and exhausted its budget should report the target, because
 * that is success rather than a limit.
 */
export function canSpend(
  limits: BudgetLimits,
  spend: BudgetSpend,
  step: CostedStep,
  costMinor: number,
  now: Date = new Date(),
): BudgetVerdict {
  if (limits.deadlineAt && new Date(limits.deadlineAt).getTime() <= now.getTime()) {
    return {
      allowed: false,
      state: "BUDGET_LIMIT_REACHED",
      reason: "The run reached its time limit.",
    };
  }

  if (spend.verifiedProspects >= limits.targetVerifiedProspects) {
    return {
      allowed: false,
      state: "WITHIN_BUDGET",
      reason: "The run reached its target number of verified prospects.",
    };
  }

  if (spend.totalCostMinor + costMinor > limits.maxTotalCostMinor) {
    return {
      allowed: false,
      state: "BUDGET_LIMIT_REACHED",
      reason: "The run reached its cost ceiling.",
    };
  }

  if (spend.providerCostMinor + costMinor > limits.maxProviderCostMinor) {
    return {
      allowed: false,
      state: "PROVIDER_LIMIT_REACHED",
      reason: "The run reached its provider cost ceiling.",
    };
  }

  const stepVerdict = checkStepLimit(limits, spend, step);
  if (stepVerdict) return stepVerdict;

  return { allowed: true };
}

function checkStepLimit(
  limits: BudgetLimits,
  spend: BudgetSpend,
  step: CostedStep,
): BudgetVerdict | null {
  switch (step) {
    case "SEARCH":
      if (spend.searchCalls >= limits.maxSearchCalls) {
        return limit("The run made its maximum number of search calls.");
      }
      if (spend.companiesChecked >= limits.maxCompaniesChecked) {
        return limit("The run checked its maximum number of companies.");
      }
      return null;
    case "CONTACT_DISCOVERY":
      if (spend.contactsRequested >= limits.maxContactsRequested) {
        return limit("The run requested its maximum number of contacts.");
      }
      return null;
    case "COMPANY_ENRICHMENT":
    case "CONTACT_ENRICHMENT":
      if (spend.enrichmentCalls >= limits.maxEnrichmentCalls) {
        return limit("The run made its maximum number of enrichment calls.");
      }
      return null;
    case "VERIFICATION":
      if (spend.verificationCalls >= limits.maxVerificationCalls) {
        return limit("The run made its maximum number of verification calls.");
      }
      return null;
    default:
      return null;
  }
}

function limit(reason: string): BudgetVerdict {
  return { allowed: false, state: "BUDGET_LIMIT_REACHED", reason };
}

/** Records one costed step. Pure: returns the next spend rather than mutating. */
export function applySpend(
  spend: BudgetSpend,
  step: CostedStep,
  costMinor: number,
  units = 1,
): BudgetSpend {
  const next: BudgetSpend = { ...spend };

  next.totalCostMinor += costMinor;
  if (step !== "AI") next.providerCostMinor += costMinor;

  switch (step) {
    case "SEARCH":
      next.searchCalls += 1;
      next.companiesChecked += units;
      break;
    case "CONTACT_DISCOVERY":
      next.contactsRequested += units;
      break;
    case "COMPANY_ENRICHMENT":
    case "CONTACT_ENRICHMENT":
      next.enrichmentCalls += 1;
      break;
    case "VERIFICATION":
      next.verificationCalls += 1;
      break;
    default:
      break;
  }

  return next;
}

export function recordVerified(spend: BudgetSpend, count = 1): BudgetSpend {
  return { ...spend, verifiedProspects: spend.verifiedProspects + count };
}

/** The state the run reports while it is still going. */
export function budgetState(limits: BudgetLimits, spend: BudgetSpend): BudgetState {
  if (spend.totalCostMinor >= limits.maxTotalCostMinor) return "BUDGET_LIMIT_REACHED";
  if (spend.providerCostMinor >= limits.maxProviderCostMinor) return "PROVIDER_LIMIT_REACHED";
  if (spend.totalCostMinor >= limits.maxTotalCostMinor * NEAR_LIMIT_RATIO) return "NEAR_LIMIT";
  return "WITHIN_BUDGET";
}

/** How the run ended. */
export function resultState(
  limits: BudgetLimits,
  spend: BudgetSpend,
  cancelled: boolean,
  failed: boolean,
): BudgetResultState {
  if (failed) return "FAILED";
  if (cancelled) return "PAUSED";
  if (spend.verifiedProspects >= limits.targetVerifiedProspects) return "COMPLETED";
  if (spend.totalCostMinor >= limits.maxTotalCostMinor) return "BUDGET_LIMIT_REACHED";
  if (spend.providerCostMinor >= limits.maxProviderCostMinor) return "PROVIDER_LIMIT_REACHED";
  return "PARTIAL_TARGET_REACHED";
}

/**
 * Derives a run's envelope from the plan allowance and the requested target.
 *
 * The multipliers encode the cost-efficient waterfall in §53: the run expects
 * to look at far more companies than it will contact, and to enrich only a
 * fraction of what it looks at, so an unrealistic target is capped by cost long
 * before it is capped by ambition.
 */
export function deriveLimits(input: {
  targetVerified: number;
  remainingPlanAllowance: number;
  maxCostMinor: number;
  deadlineAt?: string | null;
}): BudgetLimits {
  // Never target more than the plan has left. This is what stops a run from
  // producing prospects the workspace has not paid for.
  const target = Math.max(0, Math.min(input.targetVerified, input.remainingPlanAllowance));

  return {
    targetVerifiedProspects: target,
    // Roughly 8 companies examined per verified prospect produced.
    maxCompaniesChecked: target * 8,
    maxContactsRequested: target * 3,
    maxSearchCalls: Math.max(1, Math.ceil(target / 25)),
    maxEnrichmentCalls: target * 2,
    maxVerificationCalls: Math.ceil(target * 1.5),
    maxProviderCostMinor: input.maxCostMinor,
    maxTotalCostMinor: input.maxCostMinor,
    deadlineAt: input.deadlineAt ?? null,
  };
}

/** Customer-facing progress: a percentage, never a cost (§112). */
export function budgetPercent(limits: BudgetLimits, spend: BudgetSpend): number {
  if (limits.maxTotalCostMinor <= 0) return 0;
  return Math.min(100, Math.round((spend.totalCostMinor / limits.maxTotalCostMinor) * 100));
}

export function targetPercent(limits: BudgetLimits, spend: BudgetSpend): number {
  if (limits.targetVerifiedProspects <= 0) return 0;
  return Math.min(
    100,
    Math.round((spend.verifiedProspects / limits.targetVerifiedProspects) * 100),
  );
}
