import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/audit";
import type { UsageFeature, UsageMetric } from "@/lib/billing/usage-metrics";
import type { AiDeployment } from "./azure-client";
import type { TaskType } from "./schemas";
import {
  billableTokens,
  costFor,
  KeyedTtlCache,
  priceBookKey,
  type PriceBook,
  type PriceRow,
} from "./tokens";

/**
 * Which product surface spent the tokens (V4 section 18).
 *
 * Task type says what the model was asked to do; this says who was asking, and
 * it is the difference between a workspace being told "you used 9.1M tokens"
 * and being told which part of the product used them. A workspace can act on
 * the second and not on the first.
 */
const TASK_FEATURE: Record<TaskType, UsageFeature> = {
  intent_classification: "inbox",
  conversation_summary: "inbox",
  answer_extraction: "qualification",
  handover_reasoning: "qualification",
  reply_generation: "follow_up",
  reactivation_copy: "reactivation",
  agent_decision: "agents",
  search_planning: "find_leads",
  research_summary: "find_leads",
  // Both belong to Find Leads rather than to the inbox or the agent: they are
  // spent working a Prospect through the connect-then-message sequence, before
  // anybody has become a Lead. Filing them under "agents" would tell a customer
  // their conversation agent had run up a bill it never touched.
  social_reply_classification: "find_leads",
  social_message: "find_leads",
  // Reading a company's own team page. Find Leads for the same reason as the
  // two above: it is prospecting spend, incurred before a Lead exists.
  website_contacts: "find_leads",
  // Cold campaign copy. `outreach`, matching the feature the cold email sends
  // themselves record, so a workspace reading its usage sees the writing and
  // the sending of a campaign in one place rather than as two unrelated lines.
  variant_generation: "outreach",
  copilot_turn: "copilot",
  // The handoff brief is read in the inbox by the person taking over.
  handoff_brief: "inbox",
};

/**
 * Cached per model. A single shared slot (the old behaviour) served whichever
 * deployment loaded first to every other deployment for five minutes, pricing
 * mini calls at nano rates or the reverse.
 */
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const priceBookCache = new KeyedTtlCache<PriceBook>(PRICE_CACHE_TTL_MS);

async function loadPriceBook(deployment: AiDeployment): Promise<PriceBook> {
  const model = priceBookKey(deployment);
  const cached = priceBookCache.get(model);
  if (cached) return cached;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_price_book")
    .select("product, unit_cost, unit")
    .eq("provider", "azure")
    .in("product", [`${model}_input`, `${model}_cached_input`, `${model}_output`])
    .is("effective_to", null);

  const zero: PriceRow = { unit_cost: 0, unit: "per_million_tokens" };
  const byProduct = new Map((data ?? []).map((row) => [row.product, row]));
  const priceBook: PriceBook = {
    input: byProduct.get(`${model}_input`) ?? zero,
    cachedInput: byProduct.get(`${model}_cached_input`) ?? zero,
    output: byProduct.get(`${model}_output`) ?? zero,
  };

  // A failed read is not cached: the next call retries rather than pricing
  // five minutes of usage at zero.
  if (!error) priceBookCache.set(model, priceBook);
  return priceBook;
}

export type RecordAiUsageInput = {
  businessId: string;
  leadId?: string | null;
  conversationId?: string | null;
  automationRunId?: string | null;
  taskType: TaskType;
  deployment: AiDeployment;
  promptKey: string;
  promptVersion: number;
  /** prompt_tokens, cached prefix INCLUDED (as Azure reports it). */
  inputTokens: number;
  /** The cached subset of inputTokens. Not additional to it. */
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  confidence: number | null;
  resultJson: unknown;
  status: "ok" | "error" | "fallback" | "low_confidence";
  errorCode?: string | null;
  /**
   * Stable key for this model call (the token-debit idempotency key when it is
   * stable). Keys the usage_events rows, so a retried job re-recording the
   * same call does not count it twice. Falls back to the ai_runs id.
   */
  operationKey?: string | null;
};

export type RecordAiUsageResult = {
  /** The ai_runs row id, or null if the insert failed. */
  runId: string | null;
  estimatedCostUsd: number;
};

/**
 * Every Azure call — success or failure — is metered here. Writes ai_runs
 * (audit + cost detail), usage_events (the per-metric ledger other reports
 * read) and cost_events (priced from provider_price_book, never hardcoded).
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<RecordAiUsageResult> {
  const supabase = createAdminClient();
  const priceBook = await loadPriceBook(input.deployment);

  // Azure's prompt_tokens already includes the cached prefix: uncached input is
  // billed at the input rate, the cached subset at the cached rate, once each.
  const tokens = billableTokens(input);
  const { totalCost: estimatedCostUsd } = costFor(input, priceBook);

  const { data: run, error: runError } = await supabase
    .from("ai_runs")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      conversation_id: input.conversationId ?? null,
      automation_run_id: input.automationRunId ?? null,
      task_type: input.taskType,
      deployment: input.deployment,
      prompt_key: input.promptKey,
      prompt_version: input.promptVersion,
      // Stored split, so input + cached + output is exactly what the provider
      // counted and any report summing the three columns is correct.
      input_tokens: tokens.uncachedInput,
      cached_input_tokens: tokens.cachedInput,
      output_tokens: tokens.output,
      estimated_cost_usd: estimatedCostUsd,
      latency_ms: input.latencyMs,
      confidence: input.confidence,
      result_json: input.resultJson as never,
      status: input.status,
      error_code: input.errorCode ?? null,
    })
    .select("id")
    .single();

  if (runError) {
    console.error("[usage-meter] ai_runs insert failed", runError.message);
  }

  const runId = run?.id ?? null;
  const operationKey = input.operationKey ?? runId;
  const occurredAt = new Date().toISOString();

  // Named explicitly rather than built by interpolation, so a renamed metric is
  // caught here by the compiler instead of at the database constraint.
  const tokenMetrics: Record<AiDeployment, [UsageMetric, UsageMetric, UsageMetric]> = {
    nano: ["ai_nano_input_token", "ai_nano_cached_token", "ai_nano_output_token"],
    mini: ["ai_mini_input_token", "ai_mini_cached_token", "ai_mini_output_token"],
  };
  const [inputMetric, cachedMetric, outputMetric] = tokenMetrics[input.deployment];

  const usageRows: { metric: UsageMetric; quantity: number }[] = [
    { metric: inputMetric, quantity: tokens.uncachedInput },
    { metric: cachedMetric, quantity: tokens.cachedInput },
    { metric: outputMetric, quantity: tokens.output },
  ].filter((row) => row.quantity > 0);

  for (const row of usageRows) {
    await recordUsage({
      businessId: input.businessId,
      metric: row.metric,
      quantity: row.quantity,
      source: "ai_run",
      feature: TASK_FEATURE[input.taskType],
      provider: "azure_openai",
      ...(runId ? { entity: { type: "ai_run", id: runId } } : {}),
      // Keyed on the call's stable key where there is one (a retried job makes
      // a new ai_runs row, so the run id alone would count it twice), else on
      // the run.
      ...(operationKey ? { operationId: `${row.metric}:${operationKey}` } : {}),
      metadata: { task_type: input.taskType, deployment: input.deployment },
    });
  }

  if (estimatedCostUsd > 0) {
    const { error: costError } = await supabase.from("cost_events").insert({
      business_id: input.businessId,
      provider: "azure",
      metric: input.taskType,
      quantity: tokens.allowanceDebit,
      currency: "USD",
      unit_cost: priceBook.input.unit_cost,
      total_cost: estimatedCostUsd,
      occurred_at: occurredAt,
      estimated: true,
      reconciled: false,
    });
    if (costError) {
      console.error("[usage-meter] cost_events insert failed", costError.message);
    }
  }

  return { runId, estimatedCostUsd };
}
