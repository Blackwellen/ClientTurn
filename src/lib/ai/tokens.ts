/**
 * AI token arithmetic. Pure: no I/O, no `server-only`, so it is testable under
 * `node --test` and is the ONE place billing maths lives.
 *
 * ## What Azure reports (and why it matters)
 *
 * `usage.prompt_tokens` INCLUDES any cached prefix. `usage.prompt_tokens_details
 * .cached_tokens` is a SUBSET of prompt_tokens, not an addition to it. So:
 *
 *   uncached input = prompt_tokens - cached_tokens   (billed at the input rate)
 *   cached input   = cached_tokens                   (billed at the cached rate)
 *   output         = completion_tokens               (billed at the output rate)
 *
 * The customer allowance is debited `prompt_tokens + completion_tokens` -- what
 * the provider counts. Cached tokens are not discounted on the allowance: the
 * allowance is a simple countable thing, and weighting it by our unit cost
 * would leak the price book into the product. They are discounted in our cost.
 *
 * Field names: `inputTokens` is prompt_tokens (cached INCLUDED);
 * `cachedInputTokens` is the cached subset. Never add them together.
 */

export type TokenUsage = {
  /** prompt_tokens, INCLUDING the cached prefix. */
  inputTokens: number;
  /** The cached subset of inputTokens. Never added to it. */
  cachedInputTokens: number;
  /** completion_tokens. */
  outputTokens: number;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Reads an Azure/OpenAI `usage` object. Cached is clamped to [0, prompt]. */
export function usageFromProvider(raw: unknown): TokenUsage {
  const usage = (raw ?? {}) as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
  };
  const inputTokens = count(usage.prompt_tokens);
  const cachedInputTokens = Math.min(
    count(usage.prompt_tokens_details?.cached_tokens),
    inputTokens,
  );
  return { inputTokens, cachedInputTokens, outputTokens: count(usage.completion_tokens) };
}

export type BillableTokens = {
  uncachedInput: number;
  cachedInput: number;
  output: number;
  /** What the customer allowance is debited: prompt + completion. */
  allowanceDebit: number;
};

export function billableTokens(usage: TokenUsage): BillableTokens {
  const input = count(usage.inputTokens);
  const cachedInput = Math.min(count(usage.cachedInputTokens), input);
  const output = count(usage.outputTokens);
  return {
    uncachedInput: input - cachedInput,
    cachedInput,
    output,
    allowanceDebit: input + output,
  };
}

export type PriceRow = { unit_cost: number; unit: string };
export type PriceBook = { input: PriceRow; cachedInput: PriceRow; output: PriceRow };

export function priceRowCost(tokens: number, price: PriceRow): number {
  if (price.unit === "per_million_tokens") return (tokens / 1_000_000) * price.unit_cost;
  return tokens * price.unit_cost;
}

export function costFor(usage: TokenUsage, priceBook: PriceBook) {
  const tokens = billableTokens(usage);
  const inputCost = priceRowCost(tokens.uncachedInput, priceBook.input);
  const cachedCost = priceRowCost(tokens.cachedInput, priceBook.cachedInput);
  const outputCost = priceRowCost(tokens.output, priceBook.output);
  return { inputCost, cachedCost, outputCost, totalCost: inputCost + cachedCost + outputCost };
}

// ------------------------------------------------------------ price cache

/** A TTL cache keyed per entry, so two models never share one slot. */
export class KeyedTtlCache<T> {
  private readonly entries = new Map<string, { value: T; at: number }>();
  private readonly ttlMs: number;
  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.entries.set(key, { value, at: now });
  }
}

/** The provider_price_book product prefix for a deployment. */
export function priceBookKey(deployment: "nano" | "mini"): string {
  return deployment === "nano" ? "gpt_5_4_nano" : "gpt_5_4_mini";
}

// ------------------------------------------------------------ idempotency

/**
 * The token-debit key. An explicit key wins; otherwise a correlation id the
 * caller already has (job id, message id, prospect id) gives a key that is the
 * same on every retry. Only when neither exists is the key random -- `stable:
 * false` tells the caller to log it, because a retry of that call will be
 * charged again.
 */
export function resolveIdempotencyKey(input: {
  businessId: string;
  taskType: string;
  idempotencyKey?: string | null;
  correlationId?: string | null;
}): { key: string; stable: boolean } {
  if (input.idempotencyKey) return { key: input.idempotencyKey, stable: true };
  if (input.correlationId) {
    return {
      key: `ai:${input.businessId}:${input.taskType}:${input.correlationId}`,
      stable: true,
    };
  }
  return { key: `ai:${globalThis.crypto.randomUUID()}`, stable: false };
}

// ------------------------------------------------------------ overdraw

/**
 * Emergency hard ceiling on overdraw, as a fraction of the period's plan
 * allocation (`included_tokens`). No plan_entitlements field carries an
 * overdraw limit, so this is a conservative constant. Mirrored in SQL by
 * `consume_ai_tokens_bounded(overdraw_ceiling_ratio)` (migration 0116).
 */
export const OVERDRAW_CEILING_RATIO = 0.1;

export function overdrawCeiling(includedTokens: number): number {
  if (!Number.isFinite(includedTokens) || includedTokens <= 0) return 0;
  return Math.floor(includedTokens * OVERDRAW_CEILING_RATIO);
}

/**
 * Admission rule, mirrored by `reserve_ai_tokens`: a call starts only if the
 * allowance still covers its estimate after every call already in flight has
 * been counted. The SQL version holds a row lock so concurrent workers are
 * serialised; this one exists so the rule is testable.
 */
export function admitsCall(
  balance: { granted: number; used: number; held: number },
  estimate: number,
): boolean {
  return balance.granted - balance.used - balance.held >= estimate;
}
