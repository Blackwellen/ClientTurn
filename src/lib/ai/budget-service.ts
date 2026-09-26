import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { getEntitlements } from "@/lib/billing/entitlements";
import { archetypeFor } from "@/lib/sales-library/archetypes";
import type { DealSizeBand } from "@/lib/sales-library/types";
import type { LeadGrade } from "@/lib/scoring/lead-score";
import type { TaskType } from "./schemas";
import { KeyedTtlCache } from "./tokens";
import { parseSellingPreferences } from "@/lib/settings/ai-selling";
import { loadTierConfig } from "./tier-config";
import {
  BUDGET_SCOPES,
  decideSpend,
  monthStart,
  RESEARCH_TASKS,
  remainingFromBudgets,
  USD_TO_GBP,
  type BudgetScope,
  type ResearchDepthSetting,
  type SpendDecision,
  type SpendStage,
} from "./budget";
import { TASK_TOKEN_ENVELOPES, type TierConfig } from "./tiers";

/**
 * `checkSpend`: the server side of the budget manager. Reads the applicable
 * ceilings and what has been spent, asks the pure `decideSpend`, and records
 * the decision in `ai_budget_decisions` (append-only, every call, allowed or
 * not). Called by `runTask` BEFORE the token reservation.
 *
 * Fails open to the route's default tier when a read fails: the token
 * allowance reservation (0116) still guards the call, so a budget-table outage
 * degrades to the pre-Phase-4 behaviour rather than silencing every workspace.
 */

export type CheckSpendInput = {
  businessId: string;
  taskType: TaskType;
  leadId?: string | null;
  stage?: SpendStage | null;
  /** Supplied by callers that already have them; otherwise read from lead_scores. */
  score?: number | null;
  grade?: LeadGrade | null;
  dealSizeBand?: DealSizeBand | null;
  channelCostMinor?: number;
  /** Measured sizes of THIS call; refine the task's envelope. */
  promptChars?: number;
  maxOutputTokens?: number;
};

export type CheckSpendResult = SpendDecision & { config: TierConfig };

type BudgetRow = {
  scope: BudgetScope;
  businessId: string | null;
  planKey: string | null;
  ceilingMinor: number | null;
  ceilingTokens: number | null;
};

/** 0122 post-dates database.types.ts: one cast, at this seam. */
type Untyped = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const BUDGET_TTL_MS = 60 * 1000;
const researchDepthCache = new KeyedTtlCache<ResearchDepthSetting>(BUDGET_TTL_MS);

/**
 * The workspace's research depth (Settings -> AI & selling), read only for
 * research tasks. A failed read means STANDARD, the pre-setting behaviour.
 */
async function loadResearchDepth(db: Untyped, businessId: string): Promise<ResearchDepthSetting> {
  const cached = researchDepthCache.get(businessId);
  if (cached) return cached;
  const { data, error } = await db
    .from("workspace_sales_overrides")
    .select("payload")
    .eq("business_id", businessId)
    .eq("kind", "ARCHETYPE_SETTINGS")
    .eq("key", "*")
    .maybeSingle();
  if (error) {
    console.error("[budget] research depth read failed", { businessId, message: error.message });
    return "STANDARD";
  }
  const depth = parseSellingPreferences((data as { payload?: unknown } | null)?.payload).researchDepth;
  researchDepthCache.set(businessId, depth);
  return depth;
}
const budgetCache = new KeyedTtlCache<{ rows: BudgetRow[]; plan: string | null }>(BUDGET_TTL_MS);

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function loadBudgets(db: Untyped, businessId: string): Promise<{ rows: BudgetRow[]; plan: string | null } | null> {
  const cached = budgetCache.get(businessId);
  if (cached) return cached;

  const [{ data, error }, entitlements] = await Promise.all([
    db
      .from("ai_budgets")
      .select("scope, business_id, plan_key, ceiling_minor, ceiling_tokens")
      .eq("enabled", true)
      .or(`business_id.is.null,business_id.eq.${businessId}`),
    getEntitlements(businessId).catch(() => null),
  ]);
  if (error) {
    console.error("[budget] ai_budgets read failed", { businessId, message: error.message });
    return null;
  }
  const rows: BudgetRow[] = ((data ?? []) as Record<string, unknown>[])
    .filter((row) => (BUDGET_SCOPES as readonly string[]).includes(String(row.scope)))
    .map((row) => ({
      scope: row.scope as BudgetScope,
      businessId: (row.business_id as string | null) ?? null,
      planKey: (row.plan_key as string | null) ?? null,
      ceilingMinor: num(row.ceiling_minor),
      ceilingTokens: num(row.ceiling_tokens),
    }));
  const value = { rows, plan: entitlements?.plan ?? null };
  budgetCache.set(businessId, value);
  return value;
}

async function loadLeadValue(
  db: Untyped,
  businessId: string,
  leadId: string,
): Promise<{ score: number | null; grade: LeadGrade | null; dealSizeBand: DealSizeBand | null }> {
  const { data, error } = await db
    .from("lead_scores")
    .select("total, grade, archetype_key")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("is_current", true)
    .maybeSingle();
  if (error || !data) return { score: null, grade: null, dealSizeBand: null };
  const row = data as Record<string, unknown>;
  const grade = ["A", "B", "C", "D"].includes(String(row.grade)) ? (row.grade as LeadGrade) : null;
  return {
    score: num(row.total),
    grade,
    dealSizeBand: archetypeFor(row.archetype_key as string | null)?.dealSizeBand ?? null,
  };
}

export async function checkSpend(input: CheckSpendInput): Promise<CheckSpendResult> {
  const config = await loadTierConfig();
  const envelope = {
    input: Math.max(
      TASK_TOKEN_ENVELOPES[input.taskType].input,
      input.promptChars ? Math.ceil(input.promptChars / 4) : 0,
    ),
    output: input.maxOutputTokens ?? TASK_TOKEN_ENVELOPES[input.taskType].output,
  };

  let decision: SpendDecision;
  try {
    const db = createAdminClient() as unknown as Untyped;
    const leadId = input.leadId ?? null;

    const [budgets, value, researchDepth] = await Promise.all([
      loadBudgets(db, input.businessId),
      leadId && ((input.grade == null && input.score == null) || input.dealSizeBand == null)
        ? loadLeadValue(db, input.businessId, leadId)
        : Promise.resolve(null),
      RESEARCH_TASKS.has(input.taskType) ? loadResearchDepth(db, input.businessId) : Promise.resolve(null),
    ]);

    let remaining = {};
    if (budgets && budgets.rows.length > 0) {
      const since = monthStart(new Date()).toISOString();
      const { data, error } = await db.rpc("ai_spend_snapshot", {
        target_business_id: input.businessId,
        target_lead_id: leadId,
        since,
      });
      if (error) {
        console.error("[budget] ai_spend_snapshot failed", { businessId: input.businessId, message: error.message });
      } else {
        const row = ((Array.isArray(data) ? data[0] : data) ?? {}) as Record<string, unknown>;
        // ai_runs prices in USD; budgets are GBP pence.
        const toMinor = (usd: unknown) => (num(usd) ?? 0) * USD_TO_GBP * 100;
        remaining = remainingFromBudgets({
          budgets: budgets.rows,
          plan: budgets.plan,
          hasLead: leadId !== null,
          spend: {
            workspaceMinor: toMinor(row.workspace_cost_usd),
            workspaceTokens: num(row.workspace_tokens) ?? 0,
            leadMinor: toMinor(row.lead_cost_usd),
            leadTokens: num(row.lead_tokens) ?? 0,
          },
        });
      }
    }

    decision = decideSpend({
      taskType: input.taskType,
      stage: input.stage ?? null,
      score: input.score ?? value?.score ?? null,
      grade: input.grade ?? value?.grade ?? null,
      dealSizeBand: input.dealSizeBand ?? value?.dealSizeBand ?? null,
      channelCostMinor: input.channelCostMinor,
      config,
      remaining,
      envelope,
      researchDepth,
    });
  } catch (error) {
    console.error("[budget] checkSpend failed; using the default tier", error);
    decision = decideSpend({ taskType: input.taskType, config, remaining: {}, envelope });
  }

  await recordDecision(input, decision);
  return { ...decision, config };
}

async function recordDecision(input: CheckSpendInput, decision: SpendDecision): Promise<void> {
  try {
    const db = createAdminClient() as unknown as Untyped;
    const result = await db.from("ai_budget_decisions").insert({
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      task_type: input.taskType,
      stage: input.stage ?? null,
      decision: decision.decision,
      reason: decision.reason,
      expected_value_minor: decision.expectedValueMinor,
      est_cost_minor: Number(decision.estCostMinor.toFixed(6)),
    });
    // Observability: a lost audit row must not block the call it describes.
    logWriteError(result, "ai_budget_decisions.insert", {
      businessId: input.businessId,
      taskType: input.taskType,
      decision: decision.decision,
    });
  } catch (error) {
    console.error("[budget] ai_budget_decisions insert threw", error);
  }
}
