import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getV4Entitlements,
  getV4Usage,
  isOverageEnabled,
} from "@/lib/billing/v4-entitlements";
import {
  CAPABILITIES,
  costBand,
  estimateRunCost,
  targetAffordableWithin,
  type Capability,
  type CostBand,
  type UnitCosts,
} from "../cost-model";

/**
 * The single budget and entitlement authority for Find Leads (V4 §11.11).
 *
 * Every path that could cause provider spend calls `resolveBudget` and obeys
 * what it returns: the Sourcing controls panel, the Start Run action, Increase
 * target, and the recurring scheduler. That is the point of putting it here —
 * four callers agreeing by convention is how a cap gets bypassed.
 *
 * Nothing in this module trusts a number that came from the browser. The
 * customer's requested cap is an input to a `min()`, never the answer.
 */

/**
 * Platform ceiling per run, regardless of plan or overage. A workspace whose
 * entitlement somehow permits more still cannot commit more than this to a
 * single run without an admin acting deliberately — one misconfigured row
 * should not be able to authorise unbounded spend.
 */
export const PLATFORM_RUN_COST_CEILING_MINOR = 50_000; // £500

/** Below this, a run cannot produce anything useful, so it is refused. */
const MINIMUM_VIABLE_RUN_COST_MINOR = 100; // £1

export type BudgetVerdict = {
  allowed: boolean;
  /** The largest target this workspace may run right now. */
  maxTarget: number;
  /** The enforceable provider cap for the run, in pence. */
  maxProviderCostMinor: number;
  /** Verified-prospect allowance left in the current period. */
  includedRemaining: number;
  overageAvailable: boolean;
  /** Machine code; the UI maps it to a sentence. */
  reason: BudgetReason;
  /** What the requested target is expected to cost. */
  estimateMinor: number;
  band: CostBand;
  /** Unit costs used, so the worker's reservation matches this estimate. */
  unitCosts: UnitCosts;
};

export type BudgetReason =
  | "OK"
  | "SUBSCRIPTION_INACTIVE"
  | "FEATURE_NOT_ENTITLED"
  | "PROSPECT_ALLOWANCE_EXHAUSTED"
  | "SEARCH_RUN_ALLOWANCE_EXHAUSTED"
  | "BUDGET_TOO_SMALL"
  | "TARGET_CLAMPED"
  | "COST_CLAMPED";

const REASON_SENTENCES: Record<BudgetReason, string> = {
  OK: "This run is within your plan.",
  SUBSCRIPTION_INACTIVE: "This workspace does not have an active subscription.",
  FEATURE_NOT_ENTITLED: "Find Leads is not included on your plan.",
  PROSPECT_ALLOWANCE_EXHAUSTED:
    "You have used your verified prospect allowance for this billing period.",
  SEARCH_RUN_ALLOWANCE_EXHAUSTED:
    "You have used your sourcing runs for this billing period.",
  BUDGET_TOO_SMALL: "There is not enough remaining allowance to run a search.",
  TARGET_CLAMPED:
    "Your target was reduced to what your remaining allowance can cover.",
  COST_CLAMPED: "Your cost cap was reduced to your remaining allowance.",
};

export function budgetReasonSentence(reason: BudgetReason): string {
  return REASON_SENTENCES[reason] ?? "This run cannot start right now.";
}

/**
 * Live unit costs from the price book, falling back inside the cost model
 * where a provider/capability has no current row.
 */
export async function loadUnitCosts(): Promise<UnitCosts> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("provider_price_book")
    .select("product, unit_cost, effective_from, effective_to")
    .in("product", CAPABILITIES)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false });

  const costs: UnitCosts = {};
  const now = Date.now();

  for (const row of data ?? []) {
    const capability = row.product as Capability;
    if (!CAPABILITIES.includes(capability)) continue;
    // Rows arrive newest-first, so the first live row per capability wins.
    if (costs[capability] !== undefined) continue;
    if (row.effective_to && new Date(row.effective_to).getTime() <= now) continue;
    costs[capability] = Math.ceil(Number(row.unit_cost) * 100);
  }

  return costs;
}

/**
 * The workspace's own ceiling, if it set one. `overage_cap_minor` is the
 * customer's money in the customer's own units, which is why (unlike provider
 * cost) it is not withheld from them.
 */
async function loadWorkspaceCeiling(businessId: string): Promise<number | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_usage_allocations")
    .select("overage_cap_minor, overage_enabled")
    .eq("business_id", businessId)
    .order("billing_period", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.overage_enabled) return null;
  return data.overage_cap_minor ?? null;
}

/** Provider spend already committed this billing period, from cost_events. */
async function spendThisPeriod(
  businessId: string,
  since: string | null,
): Promise<number> {
  const admin = createAdminClient();
  const from = since ?? new Date(Date.now() - 30 * 864e5).toISOString();

  const { data } = await admin
    .from("cost_events")
    .select("total_cost")
    .eq("business_id", businessId)
    .eq("metric", "sourcing")
    .gte("occurred_at", from);

  return (data ?? []).reduce(
    (total, row) => total + Math.ceil(Number(row.total_cost) * 100),
    0,
  );
}

export type BudgetRequest = {
  businessId: string;
  /** What the customer asked for. Treated as a request, never as authority. */
  requestedTarget: number;
  requestedCostCapMinor: number;
  intentEnabled?: boolean;
  /**
   * Verified prospects an in-flight run has already produced. Increase-target
   * passes this so the delta, not the whole run, is charged against what is
   * left.
   */
  alreadyProduced?: number;
};

/**
 * Resolves what this workspace may actually run, right now.
 *
 *   maxProviderCost = min(
 *     customer's requested cap,
 *     what the remaining allowance can fund,
 *     the workspace's own overage ceiling,
 *     the platform per-run ceiling
 *   )
 *
 * and the target is then clamped to what that cap buys.
 */
export async function resolveBudget(
  request: BudgetRequest,
): Promise<BudgetVerdict> {
  const {
    businessId,
    requestedTarget,
    requestedCostCapMinor,
    intentEnabled = true,
    alreadyProduced = 0,
  } = request;

  const entitlements = await getV4Entitlements(businessId);
  const unitCosts = await loadUnitCosts();
  const options = { intentEnabled };

  const deny = (reason: BudgetReason): BudgetVerdict => ({
    allowed: false,
    maxTarget: 0,
    maxProviderCostMinor: 0,
    includedRemaining: 0,
    overageAvailable: false,
    reason,
    estimateMinor: 0,
    band: "EXCEEDS_PLAN",
    unitCosts,
  });

  if (!entitlements.active) return deny("SUBSCRIPTION_INACTIVE");
  if (!entitlements.sourcingEnabled) return deny("FEATURE_NOT_ENTITLED");

  const [prospectsUsed, runsUsed, overageOn, workspaceCeiling] = await Promise.all([
    getV4Usage(businessId, "verified_prospect", entitlements.periodStart),
    getV4Usage(businessId, "search_run", entitlements.periodStart),
    isOverageEnabled(businessId),
    loadWorkspaceCeiling(businessId),
  ]);

  const prospectAllowance = entitlements.allowances.verified_prospect;
  const runAllowance = entitlements.allowances.search_run;

  const includedRemaining = Math.max(0, prospectAllowance.hardLimit - prospectsUsed);
  const overageAvailable = overageOn && prospectAllowance.overageAllowed;

  if (runsUsed >= runAllowance.hardLimit && !runAllowance.overageAllowed) {
    return { ...deny("SEARCH_RUN_ALLOWANCE_EXHAUSTED"), includedRemaining };
  }

  if (includedRemaining <= 0 && !overageAvailable) {
    return { ...deny("PROSPECT_ALLOWANCE_EXHAUSTED"), includedRemaining };
  }

  // Money available for provider work, before the customer's own cap applies.
  const spent = await spendThisPeriod(businessId, entitlements.periodStart);
  const ceilings: number[] = [PLATFORM_RUN_COST_CEILING_MINOR];
  if (workspaceCeiling !== null) {
    ceilings.push(Math.max(0, workspaceCeiling - spent));
  }
  const availableMinor = Math.max(0, Math.min(...ceilings));

  if (availableMinor < MINIMUM_VIABLE_RUN_COST_MINOR) {
    return { ...deny("BUDGET_TOO_SMALL"), includedRemaining, overageAvailable };
  }

  // The enforceable cap: the customer never gets more than they asked for, and
  // never more than the system can fund.
  const requestedCap = Math.max(0, Math.floor(requestedCostCapMinor));
  const maxProviderCostMinor = Math.min(requestedCap, availableMinor);

  // Target is bounded by both the allowance (a head count) and the cap (money).
  const allowanceCeiling = overageAvailable
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, includedRemaining - alreadyProduced);
  const affordable = targetAffordableWithin(maxProviderCostMinor, unitCosts, options);
  const maxTarget = Math.max(
    0,
    Math.min(Math.floor(requestedTarget), allowanceCeiling, affordable),
  );

  const estimate = estimateRunCost(maxTarget, unitCosts, options);

  const reason: BudgetReason =
    maxTarget < Math.floor(requestedTarget)
      ? "TARGET_CLAMPED"
      : maxProviderCostMinor < requestedCap
        ? "COST_CLAMPED"
        : "OK";

  return {
    allowed: maxTarget > 0,
    maxTarget,
    maxProviderCostMinor,
    includedRemaining,
    overageAvailable,
    reason,
    estimateMinor: estimate.totalMinor,
    band: costBand(estimate.totalMinor, availableMinor, overageAvailable),
    unitCosts,
  };
}

/**
 * The pre-batch guard the worker calls before every cost-bearing provider
 * call (V4 §11.13).
 *
 * It reserves atomically against `sourcing_runs.spent_cost_minor` with a
 * conditional update, so two workers racing on the same run cannot both see
 * room and both spend it. A losing racer gets `false` and pauses the run
 * rather than proceeding.
 */
export async function reserveRunSpend(
  runId: string,
  businessId: string,
  estimatedMinor: number,
): Promise<boolean> {
  if (estimatedMinor <= 0) return true;
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("sourcing_runs")
    .select("spent_cost_minor, max_provider_cost_minor, status, cancel_requested")
    .eq("id", runId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!run) return false;
  if (run.cancel_requested || run.status !== "RUNNING") return false;

  const current = Number(run.spent_cost_minor);
  const next = current + estimatedMinor;
  if (next > Number(run.max_provider_cost_minor)) return false;

  // Conditional on the value we read: if another worker moved it, this update
  // matches no rows and we report failure rather than overwriting their spend.
  const { data: updated } = await admin
    .from("sourcing_runs")
    .update({ spent_cost_minor: next })
    .eq("id", runId)
    .eq("business_id", businessId)
    .eq("spent_cost_minor", current)
    .select("id");

  return (updated?.length ?? 0) > 0;
}

/**
 * Records what a provider batch actually cost, and corrects the reservation.
 *
 * Reservations are estimates; this is the truth. Releasing the difference is
 * what stops a run from exhausting its cap on paper while the provider charged
 * less than expected.
 */
export async function settleRunSpend(input: {
  runId: string;
  businessId: string;
  provider: string;
  capability: Capability;
  reservedMinor: number;
  actualMinor: number;
  recordCount: number;
}): Promise<void> {
  const admin = createAdminClient();
  const delta = input.actualMinor - input.reservedMinor;

  if (delta !== 0) {
    const { data: run } = await admin
      .from("sourcing_runs")
      .select("spent_cost_minor")
      .eq("id", input.runId)
      .eq("business_id", input.businessId)
      .maybeSingle();

    if (run) {
      await admin
        .from("sourcing_runs")
        .update({
          spent_cost_minor: Math.max(0, Number(run.spent_cost_minor) + delta),
        })
        .eq("id", input.runId)
        .eq("business_id", input.businessId);
    }
  }

  // The append-only ledger the admin cost views and the monthly rollup read.
  await admin.from("cost_events").insert({
    business_id: input.businessId,
    provider: input.provider,
    metric: "sourcing",
    quantity: input.recordCount,
    currency: "GBP",
    unit_cost: input.recordCount > 0 ? input.actualMinor / 100 / input.recordCount : 0,
    total_cost: input.actualMinor / 100,
    source_event_id: input.runId,
    estimated: false,
    reconciled: true,
  });
}
