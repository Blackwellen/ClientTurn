import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AiDeployment } from "./azure-client";
import type { TaskType } from "./schemas";

type PriceRow = { unit_cost: number; unit: string };
type PriceBook = {
  input: PriceRow;
  cachedInput: PriceRow;
  output: PriceRow;
};

let cachedPriceBook: PriceBook | null = null;
let cachedAt = 0;
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadPriceBook(deployment: AiDeployment): Promise<PriceBook> {
  const now = Date.now();
  if (cachedPriceBook && now - cachedAt < PRICE_CACHE_TTL_MS) return cachedPriceBook;

  const model = deployment === "nano" ? "gpt_5_4_nano" : "gpt_5_4_mini";
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("provider_price_book")
    .select("product, unit_cost, unit")
    .eq("provider", "azure")
    .in("product", [`${model}_input`, `${model}_cached_input`, `${model}_output`])
    .is("effective_to", null);

  const byProduct = new Map((data ?? []).map((row) => [row.product, row]));
  const priceBook: PriceBook = {
    input: byProduct.get(`${model}_input`) ?? { unit_cost: 0, unit: "per_million_tokens" },
    cachedInput: byProduct.get(`${model}_cached_input`) ?? {
      unit_cost: 0,
      unit: "per_million_tokens",
    },
    output: byProduct.get(`${model}_output`) ?? { unit_cost: 0, unit: "per_million_tokens" },
  };

  cachedPriceBook = priceBook;
  cachedAt = now;
  return priceBook;
}

function costFor(tokens: number, price: PriceRow): number {
  if (price.unit === "per_million_tokens") return (tokens / 1_000_000) * price.unit_cost;
  return tokens * price.unit_cost;
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
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  confidence: number | null;
  resultJson: unknown;
  status: "ok" | "error" | "fallback" | "low_confidence";
  errorCode?: string | null;
};

/**
 * Every Azure call — success or failure — is metered here. Writes ai_runs
 * (audit + cost detail), usage_events (the per-metric ledger other reports
 * read) and cost_events (priced from provider_price_book, never hardcoded).
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  const supabase = createAdminClient();
  const priceBook = await loadPriceBook(input.deployment);

  const inputCost = costFor(input.inputTokens, priceBook.input);
  const cachedCost = costFor(input.cachedInputTokens, priceBook.cachedInput);
  const outputCost = costFor(input.outputTokens, priceBook.output);
  const estimatedCostUsd = inputCost + cachedCost + outputCost;

  await supabase.from("ai_runs").insert({
    business_id: input.businessId,
    lead_id: input.leadId ?? null,
    conversation_id: input.conversationId ?? null,
    automation_run_id: input.automationRunId ?? null,
    task_type: input.taskType,
    deployment: input.deployment,
    prompt_key: input.promptKey,
    prompt_version: input.promptVersion,
    input_tokens: input.inputTokens,
    cached_input_tokens: input.cachedInputTokens,
    output_tokens: input.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    latency_ms: input.latencyMs,
    confidence: input.confidence,
    result_json: input.resultJson as never,
    status: input.status,
    error_code: input.errorCode ?? null,
  });

  const prefix = input.deployment === "nano" ? "ai_nano" : "ai_mini";
  const occurredAt = new Date().toISOString();
  const usageRows = [
    { metric: `${prefix}_input_token`, quantity: input.inputTokens },
    { metric: `${prefix}_cached_token`, quantity: input.cachedInputTokens },
    { metric: `${prefix}_output_token`, quantity: input.outputTokens },
  ].filter((row) => row.quantity > 0);

  if (usageRows.length > 0) {
    await supabase.from("usage_events").insert(
      usageRows.map((row) => ({
        business_id: input.businessId,
        metric: row.metric as never,
        quantity: row.quantity,
        source: "ai_run",
        occurred_at: occurredAt,
      })),
    );
  }

  if (estimatedCostUsd > 0) {
    await supabase.from("cost_events").insert({
      business_id: input.businessId,
      provider: "azure",
      metric: input.taskType,
      quantity: input.inputTokens + input.cachedInputTokens + input.outputTokens,
      currency: "USD",
      unit_cost: priceBook.input.unit_cost,
      total_cost: estimatedCostUsd,
      occurred_at: occurredAt,
      estimated: true,
      reconciled: false,
    });
  }
}
