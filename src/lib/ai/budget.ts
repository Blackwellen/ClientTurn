/**
 * The AI budget manager (Phase 4, brief §§70-71). Pure: `decideSpend` takes
 * everything it needs as input and returns SKIP | TIER_n | HUMAN with a reason.
 * The server wrapper that reads budgets and usage and records the decision is
 * `budget-service.ts`.
 *
 * ## The rules, in order
 *
 *  1. **EMERGENCY is a hard stop.** A workspace past its emergency ceiling makes
 *     no model call of any kind. A live conversation goes to a person (HUMAN);
 *     anything else takes its deterministic path (SKIP).
 *  2. **Safety classification never drops below tier 1.** Reply/intent
 *     classification decides opt-outs and hand-overs; it runs at its route's
 *     tier whatever the value or the soft budgets say.
 *  3. **Pre-reply work is capped low.** Before a lead has replied, no tier
 *     above PRE_REPLY_MAX_TIER, and the PRE_REPLY ceiling applies.
 *  4. **Soft budgets.** A tier is usable only if its estimated cost fits every
 *     applicable ceiling (workspace month, plan, lead / opportunity,
 *     pre-reply).
 *  5. **Value-aware.** Spend only while expected value × lift > AI cost +
 *     channel cost. Expected value = deal-size band value × score-derived
 *     probability × stage factor. Unknown value (no band or no score) does not
 *     block: the caller has not given us the facts, so the old behaviour holds.
 *  6. Try the route's default tier, then cheaper allowed tiers. An OPPORTUNITY
 *     whose value clears the upgrade margin may use a higher allowed tier.
 *  7. Nothing fits: HUMAN when a conversation is live and the reason is budget
 *     (a person should answer rather than nobody), otherwise SKIP.
 *
 * **Research depth** (Settings -> AI & selling) moves the ceiling for research
 * tasks only (RESEARCH_TASKS): LIGHT caps them at the cheapest allowed tier,
 * DEEP lets them try the next allowed tier above the default when every soft
 * budget and the value rule still pass, STANDARD changes nothing. It never
 * touches the emergency stop, the safety floor or the pre-reply cap.
 */

import type { TaskType } from "./schemas.ts";
import type { DealSizeBand } from "../sales-library/types.ts";
import { gradeForLeadScore, type LeadGrade } from "../scoring/lead-score.ts";
import {
  SAFETY_CLASSIFICATION_TASKS,
  TASK_TOKEN_ENVELOPES,
  type ModelTier,
  type TierConfig,
  type TierNumber,
} from "./tiers.ts";

export const BUDGET_SCOPES = [
  "WORKSPACE_MONTH",
  "LEAD",
  "PRE_REPLY",
  "OPPORTUNITY",
  "PLAN",
  "EMERGENCY",
] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/** Where the lead is in its lifecycle. Null = the caller did not say. */
export const SPEND_STAGES = ["PRE_REPLY", "ENGAGED", "OPPORTUNITY"] as const;
export type SpendStage = (typeof SPEND_STAGES)[number];

export type SpendDecisionCode = "SKIP" | "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | "HUMAN";

export type SpendReason =
  | "DEFAULT_TIER"
  | "DOWNGRADED_BUDGET"
  | "DOWNGRADED_VALUE"
  | "UPGRADED_VALUE"
  | "SAFETY_FLOOR"
  | "EMERGENCY_CEILING"
  | "BUDGET_WORKSPACE_MONTH"
  | "BUDGET_PLAN"
  | "BUDGET_LEAD"
  | "BUDGET_PRE_REPLY"
  | "BUDGET_OPPORTUNITY"
  | "LOW_VALUE"
  | "NO_ENABLED_TIER"
  | "RESEARCH_DEPTH_LIGHT"
  | "RESEARCH_DEPTH_DEEP";

/** Tasks whose tier the workspace's research depth moves. */
export const RESEARCH_TASKS: ReadonlySet<TaskType> = new Set<TaskType>([
  "search_planning",
  "research_summary",
  "website_contacts",
]);

export type ResearchDepthSetting = "LIGHT" | "STANDARD" | "DEEP";

/** Remaining headroom per scope. null on a field = that ceiling is unset. */
export type ScopeRemaining = { remainingMinor: number | null; remainingTokens: number | null };
export type BudgetRemaining = Partial<Record<BudgetScope, ScopeRemaining>>;

/** Defaults. Every one can be overridden per call. */
export const DEFAULT_LIFT = 0.1;
/** Conservative: rounds USD prices up slightly when converted to GBP. */
export const USD_TO_GBP = 0.8;
export const PRE_REPLY_MAX_TIER: TierNumber = 2;
/** An upgrade must clear its cost by this factor, not merely beat it. */
export const UPGRADE_MARGIN = 20;

/** Representative deal value per band, GBP (roughly the geometric middle). */
export const DEAL_VALUE_GBP: Record<DealSizeBand, number> = {
  MICRO: 250,
  SMALL: 2_000,
  MID: 15_000,
  LARGE: 100_000,
  ENTERPRISE: 400_000,
};

/** Probability the lead converts, by grade. Deliberately modest. */
export const GRADE_PROBABILITY: Record<LeadGrade, number> = {
  A: 0.4,
  B: 0.2,
  C: 0.08,
  D: 0.02,
};

/** How much of the lead's value is in play at each stage. */
export const STAGE_FACTOR: Record<SpendStage, number> = {
  PRE_REPLY: 0.25,
  ENGAGED: 1,
  OPPORTUNITY: 1.5,
};

export type DecideSpendInput = {
  taskType: TaskType;
  stage?: SpendStage | null;
  /** Lead score 0-100. Used when `grade` is absent. */
  score?: number | null;
  grade?: LeadGrade | null;
  dealSizeBand?: DealSizeBand | null;
  config: TierConfig;
  remaining: BudgetRemaining;
  lift?: number;
  /** What sending the result will cost on its channel (SMS etc.), minor GBP. */
  channelCostMinor?: number;
  fxUsdToGbp?: number;
  /** Override the task's envelope (e.g. a caller that knows its context is large). */
  envelope?: { input: number; output: number };
  /** Applies to RESEARCH_TASKS only. Absent = STANDARD. */
  researchDepth?: ResearchDepthSetting | null;
};

export type SpendDecision = {
  decision: SpendDecisionCode;
  tier: TierNumber | null;
  reason: SpendReason;
  expectedValueMinor: number | null;
  /** Estimated cost of the chosen tier (or the default tier when refused). */
  estCostMinor: number;
};

/** Estimated cost of one call at a tier, in GBP minor units (pence). */
export function estimateCostMinor(
  tier: ModelTier,
  envelope: { input: number; output: number },
  fxUsdToGbp = USD_TO_GBP,
): number {
  const major =
    (envelope.input * tier.inputPricePer1m + envelope.output * tier.outputPricePer1m) / 1_000_000;
  const gbp = tier.priceCurrency === "GBP" ? major : major * fxUsdToGbp;
  return gbp * 100;
}

/** Expected value in pence, or null when the facts to compute it are missing. */
export function expectedValueMinor(input: {
  dealSizeBand?: DealSizeBand | null;
  score?: number | null;
  grade?: LeadGrade | null;
  stage?: SpendStage | null;
}): number | null {
  if (!input.dealSizeBand) return null;
  const grade =
    input.grade ??
    (typeof input.score === "number" && Number.isFinite(input.score)
      ? gradeForLeadScore(input.score)
      : null);
  if (!grade) return null;
  const stageFactor = input.stage ? STAGE_FACTOR[input.stage] : 1;
  return DEAL_VALUE_GBP[input.dealSizeBand] * 100 * GRADE_PROBABILITY[grade] * stageFactor;
}

function isLive(stage: SpendStage | null | undefined): boolean {
  return stage === "ENGAGED" || stage === "OPPORTUNITY";
}

function tierCode(tier: TierNumber): SpendDecisionCode {
  return tier === 0 ? "SKIP" : (`TIER_${tier}` as SpendDecisionCode);
}

/** The scopes that apply to a call at this stage. */
export function applicableScopes(stage: SpendStage | null | undefined, remaining: BudgetRemaining): BudgetScope[] {
  const scopes: BudgetScope[] = ["WORKSPACE_MONTH", "PLAN"];
  if (stage === "OPPORTUNITY") {
    // An opportunity has earned a larger allowance than an ordinary lead: its
    // own ceiling replaces the lead ceiling rather than stacking under it.
    scopes.push(remaining.OPPORTUNITY ? "OPPORTUNITY" : "LEAD");
  } else {
    scopes.push("LEAD");
  }
  if (stage === "PRE_REPLY") scopes.push("PRE_REPLY");
  return scopes;
}

/** The first scope the estimate does not fit, or null when it fits all. */
function exceededScope(
  scopes: BudgetScope[],
  remaining: BudgetRemaining,
  costMinor: number,
  tokens: number,
): BudgetScope | null {
  for (const scope of scopes) {
    const r = remaining[scope];
    if (!r) continue;
    if (r.remainingMinor !== null && costMinor > r.remainingMinor) return scope;
    if (r.remainingTokens !== null && tokens > r.remainingTokens) return scope;
  }
  return null;
}

export function decideSpend(input: DecideSpendInput): SpendDecision {
  const { config, remaining, stage } = input;
  const route = config.routes[input.taskType];
  const envelope = input.envelope ?? TASK_TOKEN_ENVELOPES[input.taskType];
  const tokens = envelope.input + envelope.output;
  const fx = input.fxUsdToGbp ?? USD_TO_GBP;
  const lift = input.lift ?? DEFAULT_LIFT;
  const channelCost = input.channelCostMinor ?? 0;
  const ev = expectedValueMinor(input);
  const costOf = (t: TierNumber) => estimateCostMinor(config.tiers[t], envelope, fx);

  const candidates = route.allowedTiers
    .filter((t) => t > 0 && config.tiers[t].enabled)
    .sort((a, b) => a - b);
  const defaultTier: TierNumber =
    route.defaultTier > 0 && config.tiers[route.defaultTier].enabled
      ? route.defaultTier
      : (candidates[candidates.length - 1] ?? 0);
  const defaultCost = defaultTier > 0 ? costOf(defaultTier) : 0;

  const refuse = (reason: SpendReason, human: boolean): SpendDecision => ({
    decision: human ? "HUMAN" : "SKIP",
    tier: null,
    reason,
    expectedValueMinor: ev,
    estCostMinor: defaultCost,
  });

  if (candidates.length === 0 || defaultTier === 0) return refuse("NO_ENABLED_TIER", false);

  const safety = SAFETY_CLASSIFICATION_TASKS.has(input.taskType);

  // 1. Emergency: a hard stop, whatever the task.
  const emergency = remaining.EMERGENCY;
  if (emergency) {
    const cheapest = costOf(candidates[0]);
    const overMinor = emergency.remainingMinor !== null && emergency.remainingMinor < cheapest;
    const overTokens = emergency.remainingTokens !== null && emergency.remainingTokens < tokens;
    if (overMinor || overTokens) {
      return refuse("EMERGENCY_CEILING", isLive(stage) && !safety);
    }
  }

  // 2. Safety floor: never below tier 1, never gated on value or soft budgets.
  if (safety) {
    const tier = Math.max(defaultTier, 1) as TierNumber;
    return {
      decision: tierCode(tier),
      tier,
      reason: "SAFETY_FLOOR",
      expectedValueMinor: ev,
      estCostMinor: costOf(tier),
    };
  }

  // 3. Stage cap.
  const capped = stage === "PRE_REPLY" ? candidates.filter((t) => t <= PRE_REPLY_MAX_TIER) : candidates;
  if (capped.length === 0) return refuse("BUDGET_PRE_REPLY", false);

  const scopes = applicableScopes(stage, remaining);
  const valueOk = (cost: number, margin = 1) => ev === null || ev * lift > margin * (cost + channelCost);

  const depth: ResearchDepthSetting = RESEARCH_TASKS.has(input.taskType)
    ? (input.researchDepth ?? "STANDARD")
    : "STANDARD";

  // 6a. Upgrade: an opportunity worth enough may use a higher allowed tier.
  if (stage === "OPPORTUNITY" && ev !== null) {
    const higher = capped.filter((t) => t > defaultTier).sort((a, b) => b - a);
    for (const t of higher) {
      const cost = costOf(t);
      if (exceededScope(scopes, remaining, cost, tokens) === null && valueOk(cost, UPGRADE_MARGIN)) {
        return { decision: tierCode(t), tier: t, reason: "UPGRADED_VALUE", expectedValueMinor: ev, estCostMinor: cost };
      }
    }
  }

  // Research depth DEEP: the next allowed tier above the default, if it fits.
  if (depth === "DEEP") {
    const next = capped.filter((t) => t > defaultTier)[0];
    if (next !== undefined) {
      const cost = costOf(next);
      if (exceededScope(scopes, remaining, cost, tokens) === null && valueOk(cost)) {
        return { decision: tierCode(next), tier: next, reason: "RESEARCH_DEPTH_DEEP", expectedValueMinor: ev, estCostMinor: cost };
      }
    }
  }

  // 6b. Default, then cheaper. Research depth LIGHT lowers the ceiling to the
  // cheapest allowed tier.
  const ceiling = (depth === "LIGHT" ? Math.min(defaultTier, capped[0]) : defaultTier) as TierNumber;
  const order = capped.filter((t) => t <= ceiling).sort((a, b) => b - a);
  let firstFailure: SpendReason | null = null;
  let budgetFailure = false;
  for (const t of order) {
    const cost = costOf(t);
    const over = exceededScope(scopes, remaining, cost, tokens);
    const failure: SpendReason | null = over ? (`BUDGET_${over}` as SpendReason) : valueOk(cost) ? null : "LOW_VALUE";
    if (failure === null) {
      const reason: SpendReason =
        t === defaultTier
          ? "DEFAULT_TIER"
          : t === ceiling && firstFailure === null
            ? "RESEARCH_DEPTH_LIGHT"
            : firstFailure === "LOW_VALUE"
            ? "DOWNGRADED_VALUE"
            : "DOWNGRADED_BUDGET";
      return { decision: tierCode(t), tier: t, reason, expectedValueMinor: ev, estCostMinor: cost };
    }
    firstFailure ??= failure;
    if (over) budgetFailure = true;
  }

  // 7. Nothing fits.
  const reason = firstFailure ?? "NO_ENABLED_TIER";
  return refuse(reason, budgetFailure && isLive(stage));
}

/** "TIER_2" -> 2. */
export function tierFromDecision(decision: SpendDecisionCode): TierNumber | null {
  const match = /^TIER_([1-4])$/.exec(decision);
  return match ? (Number(match[1]) as TierNumber) : null;
}

/** The first moment of the calendar month containing `now`, UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Remaining headroom per scope from ceilings and spend. Pure so the arithmetic
 * is tested; budget-service.ts supplies the rows.
 */
export function remainingFromBudgets(input: {
  budgets: ReadonlyArray<{
    scope: BudgetScope;
    businessId: string | null;
    planKey: string | null;
    ceilingMinor: number | null;
    ceilingTokens: number | null;
  }>;
  plan: string | null;
  spend: { workspaceMinor: number; workspaceTokens: number; leadMinor: number; leadTokens: number };
  hasLead: boolean;
}): BudgetRemaining {
  const out: BudgetRemaining = {};
  for (const scope of BUDGET_SCOPES) {
    const rows = input.budgets.filter(
      (b) => b.scope === scope && (scope !== "PLAN" || b.planKey === input.plan),
    );
    // A workspace's own row overrides the platform default of the same scope.
    const row = rows.find((b) => b.businessId !== null) ?? rows.find((b) => b.businessId === null);
    if (!row) continue;
    const leadScoped = scope === "LEAD" || scope === "PRE_REPLY" || scope === "OPPORTUNITY";
    if (leadScoped && !input.hasLead) continue;
    const spentMinor = leadScoped ? input.spend.leadMinor : input.spend.workspaceMinor;
    const spentTokens = leadScoped ? input.spend.leadTokens : input.spend.workspaceTokens;
    out[scope] = {
      remainingMinor: row.ceilingMinor === null ? null : row.ceilingMinor - spentMinor,
      remainingTokens: row.ceilingTokens === null ? null : row.ceilingTokens - spentTokens,
    };
  }
  return out;
}
