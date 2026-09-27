/**
 * Model tiers, task routes and per-task token envelopes (Phase 4, brief
 * §§67-74). Pure: no I/O, no `server-only`, relative `.ts` imports only, so the
 * routing rules and the fallback are testable under `node --test`.
 *
 * The database (`ai_model_tiers`, `ai_task_routes`, migration 0122) is the
 * source of truth when it has rows. Everything in this file is what applies
 * when it does not: the env-configured nano/mini split the router always used,
 * so an empty table changes nothing.
 */

import type { TaskType } from "./schemas.ts";

/** 0 = deterministic, no model. 1-4 = cheap -> highest. */
export type TierNumber = 0 | 1 | 2 | 3 | 4;
export const MODEL_TIERS: readonly TierNumber[] = [1, 2, 3, 4];

/** The metering class. ai_runs.deployment and the usage metrics only know these. */
export type DeploymentAlias = "nano" | "mini";

export type ModelTier = {
  tier: TierNumber;
  provider: "none" | "azure_openai";
  /** Metering class and, without `deploymentName`, the env var it resolves through. */
  deploymentAlias: DeploymentAlias | null;
  /** Explicit provider deployment; overrides the alias's env var. */
  deploymentName: string | null;
  priceCurrency: "USD" | "GBP";
  inputPricePer1m: number;
  cachedInputPricePer1m: number;
  outputPricePer1m: number;
  enabled: boolean;
};

export type TaskRoute = {
  defaultTier: TierNumber;
  allowedTiers: TierNumber[];
};

export type TierConfig = {
  tiers: Record<TierNumber, ModelTier>;
  routes: Record<TaskType, TaskRoute>;
  /** "database" when loaded from 0122's tables, "fallback" when not. */
  source: "database" | "fallback";
};

/**
 * Tasks whose output decides whether a message is an opt-out, a complaint or a
 * request for a person. They never drop below tier 1: skipping them to save a
 * fraction of a penny would route an ambiguous "stop" to the wrong path. Only
 * the EMERGENCY ceiling stops them, and the deterministic opt-out check runs
 * before any of them regardless.
 */
export const SAFETY_CLASSIFICATION_TASKS: ReadonlySet<TaskType> = new Set<TaskType>([
  "intent_classification",
  "social_reply_classification",
]);

/**
 * Per-task token envelopes: the expected input (system prompt + context) and
 * output of one call. Used to estimate a call's cost BEFORE it is made.
 *
 * Output figures are the `maxOutputTokens` each caller passes today; input
 * figures are the measured system prompt (tests/fixtures/prompt-token-snapshot
 * .json) plus a typical context block, rounded up. The brief's §69 envelope
 * table was not in the repository when this was written, so these were derived
 * from the code; tests/token-budget.test.ts asserts every task has one and
 * that each input envelope covers its system prompt.
 */
export const TASK_TOKEN_ENVELOPES: Record<TaskType, { input: number; output: number }> = {
  intent_classification: { input: 900, output: 80 },
  // Multi-dimension extraction (design 08 §B.16): still nano, a wider envelope.
  answer_extraction: { input: 900, output: 200 },
  reply_generation: { input: 900, output: 150 },
  conversation_summary: { input: 2_500, output: 250 },
  handover_reasoning: { input: 1_500, output: 200 },
  reactivation_copy: { input: 800, output: 200 },
  agent_decision: { input: 4_000, output: 400 },
  search_planning: { input: 2_500, output: 900 },
  research_summary: { input: 3_500, output: 700 },
  social_reply_classification: { input: 700, output: 200 },
  social_message: { input: 1_500, output: 500 },
  website_contacts: { input: 6_000, output: 900 },
  variant_generation: { input: 2_000, output: 1_200 },
  copilot_turn: { input: 6_000, output: 800 },
  // Structured brief in (bounded by renderBriefForModel), ~150 tokens out.
  handoff_brief: { input: 1_500, output: 200 },
};

/** Structured, high-volume tasks: tier 1 (nano) by default. Mirrors schemas.ts. */
const FALLBACK_TIER_1_TASKS = new Set<TaskType>([
  "intent_classification",
  "answer_extraction",
  "social_reply_classification",
  "website_contacts",
]);

/** gpt-5.4 prices in USD per 1M tokens, mirroring provider_price_book (0018). */
export const FALLBACK_TIERS: Record<TierNumber, ModelTier> = {
  0: tier(0, "none", null, 0, 0, 0, true),
  1: tier(1, "azure_openai", "nano", 0.2, 0.02, 1.25, true),
  2: tier(2, "azure_openai", "mini", 0.75, 0.075, 4.5, true),
  3: tier(3, "azure_openai", "mini", 0, 0, 0, false),
  4: tier(4, "azure_openai", "mini", 0, 0, 0, false),
};

function tier(
  n: TierNumber,
  provider: ModelTier["provider"],
  alias: DeploymentAlias | null,
  input: number,
  cached: number,
  output: number,
  enabled: boolean,
): ModelTier {
  return {
    tier: n,
    provider,
    deploymentAlias: alias,
    deploymentName: null,
    priceCurrency: "USD",
    inputPricePer1m: input,
    cachedInputPricePer1m: cached,
    outputPricePer1m: output,
    enabled,
  };
}

/** The route each task gets without a database row: today's nano/mini rule. */
export function fallbackRoute(taskType: TaskType): TaskRoute {
  const defaultTier: TierNumber = FALLBACK_TIER_1_TASKS.has(taskType) ? 1 : 2;
  return { defaultTier, allowedTiers: [defaultTier] };
}

export const FALLBACK_ROUTES: Record<TaskType, TaskRoute> = Object.fromEntries(
  (Object.keys(TASK_TOKEN_ENVELOPES) as TaskType[]).map((task) => [task, fallbackRoute(task)]),
) as Record<TaskType, TaskRoute>;

export const FALLBACK_TIER_CONFIG: TierConfig = {
  tiers: FALLBACK_TIERS,
  routes: FALLBACK_ROUTES,
  source: "fallback",
};

export function isTierNumber(value: unknown): value is TierNumber {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Merges database rows over the fallback. A tier or route missing from the
 * database keeps its fallback; a malformed row is ignored rather than trusted.
 * A route whose default tier is disabled falls back to its code route, so a
 * half-configured tier can never strand a task with nowhere to run.
 */
export function buildTierConfig(
  tierRows: ReadonlyArray<Omit<Partial<ModelTier>, "tier"> & { tier: unknown }>,
  routeRows: ReadonlyArray<{ taskType: string; defaultTier: unknown; allowedTiers: unknown }>,
): TierConfig {
  const tiers: Record<TierNumber, ModelTier> = { ...FALLBACK_TIERS };
  let fromDb = false;
  for (const row of tierRows) {
    if (!isTierNumber(row.tier)) continue;
    const base = FALLBACK_TIERS[row.tier];
    const alias = row.deploymentAlias === "nano" || row.deploymentAlias === "mini" ? row.deploymentAlias : null;
    if (row.tier > 0 && !alias) continue;
    tiers[row.tier] = {
      ...base,
      provider: row.provider === "azure_openai" ? "azure_openai" : row.tier === 0 ? "none" : base.provider,
      deploymentAlias: row.tier === 0 ? null : alias,
      deploymentName: row.deploymentName ?? null,
      priceCurrency: row.priceCurrency === "GBP" ? "GBP" : "USD",
      inputPricePer1m: finiteOr(row.inputPricePer1m, base.inputPricePer1m),
      cachedInputPricePer1m: finiteOr(row.cachedInputPricePer1m, base.cachedInputPricePer1m),
      outputPricePer1m: finiteOr(row.outputPricePer1m, base.outputPricePer1m),
      // Tiers 3/4 have no env var: without an explicit deployment they cannot run.
      enabled: Boolean(row.enabled) && (row.tier < 3 || Boolean(row.deploymentName)),
    };
    fromDb = true;
  }

  const routes: Record<TaskType, TaskRoute> = { ...FALLBACK_ROUTES };
  for (const row of routeRows) {
    if (!(row.taskType in FALLBACK_ROUTES)) continue;
    const task = row.taskType as TaskType;
    if (!isTierNumber(row.defaultTier) || !Array.isArray(row.allowedTiers)) continue;
    const allowed = [...new Set(row.allowedTiers.filter(isTierNumber))].sort((a, b) => a - b);
    if (!allowed.includes(row.defaultTier)) continue;
    if (!tiers[row.defaultTier].enabled) continue;
    routes[task] = { defaultTier: row.defaultTier, allowedTiers: allowed };
    fromDb = true;
  }

  return { tiers, routes, source: fromDb ? "database" : "fallback" };
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
}
