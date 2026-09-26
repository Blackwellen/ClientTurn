import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  billableTokens,
  costFor,
  usageFromProvider,
  KeyedTtlCache,
  priceBookKey,
  resolveIdempotencyKey,
  overdrawCeiling,
  OVERDRAW_CEILING_RATIO,
  admitsCall,
  type PriceBook,
} from "../src/lib/ai/tokens.ts";

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/0116_ai_billing_integrity.sql", import.meta.url),
  "utf8",
);

// Azure reports prompt_tokens INCLUDING the cached prefix; cached_tokens is a
// subset of it, not an addition to it.
const AZURE_USAGE = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  prompt_tokens_details: { cached_tokens: 600 },
};

const PER_MILLION = "per_million_tokens";
const BOOK: PriceBook = {
  input: { unit_cost: 1, unit: PER_MILLION },
  cachedInput: { unit_cost: 0.1, unit: PER_MILLION },
  output: { unit_cost: 4, unit: PER_MILLION },
};

describe("B17 - cached input tokens are billed once", () => {
  test("provider usage keeps cached as a subset of prompt tokens", () => {
    const usage = usageFromProvider(AZURE_USAGE);
    assert.deepEqual(usage, { inputTokens: 1000, cachedInputTokens: 600, outputTokens: 200 });
  });

  test("a cached count larger than the prompt is clamped, never negative uncached", () => {
    const usage = usageFromProvider({
      prompt_tokens: 100,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 900 },
    });
    assert.equal(usage.cachedInputTokens, 100);
    assert.equal(billableTokens(usage).uncachedInput, 0);
  });

  test("missing usage is zero, not NaN", () => {
    assert.deepEqual(usageFromProvider(undefined), {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  });

  test("the allowance debit is prompt + completion, with no cached double count", () => {
    const tokens = billableTokens(usageFromProvider(AZURE_USAGE));
    assert.equal(tokens.uncachedInput, 400);
    assert.equal(tokens.cachedInput, 600);
    assert.equal(tokens.output, 200);
    assert.equal(tokens.allowanceDebit, 1200);
    // The three metered parts sum to exactly what the provider counted.
    assert.equal(tokens.uncachedInput + tokens.cachedInput + tokens.output, 1200);
  });

  test("cost prices uncached at the input rate and cached at the cached rate", () => {
    const cost = costFor(usageFromProvider(AZURE_USAGE), BOOK);
    assert.equal(cost.inputCost, 400 / 1e6 * 1);
    assert.equal(cost.cachedCost, 600 / 1e6 * 0.1);
    assert.equal(cost.outputCost, 200 / 1e6 * 4);
    assert.equal(cost.totalCost, cost.inputCost + cost.cachedCost + cost.outputCost);
    // The old arithmetic charged 1000 input + 600 cached.
    assert.notEqual(cost.inputCost, 1000 / 1e6);
  });

  test("per-token units are priced per token", () => {
    const cost = costFor(
      { inputTokens: 10, cachedInputTokens: 0, outputTokens: 0 },
      { ...BOOK, input: { unit_cost: 2, unit: "per_token" } },
    );
    assert.equal(cost.inputCost, 20);
  });
});

describe("B18 - price books are cached per model", () => {
  test("nano and mini do not share one cache slot", () => {
    const cache = new KeyedTtlCache<string>(60_000);
    cache.set(priceBookKey("nano"), "nano-book", 0);
    assert.equal(cache.get(priceBookKey("mini"), 10), undefined);
    cache.set(priceBookKey("mini"), "mini-book", 10);
    assert.equal(cache.get(priceBookKey("nano"), 20), "nano-book");
    assert.equal(cache.get(priceBookKey("mini"), 20), "mini-book");
  });

  test("entries expire after the TTL", () => {
    const cache = new KeyedTtlCache<string>(1000);
    cache.set("k", "v", 0);
    assert.equal(cache.get("k", 999), "v");
    assert.equal(cache.get("k", 1000), undefined);
  });
});

describe("B19 - a retried call debits once", () => {
  const base = { businessId: "biz-1", taskType: "answer_extraction" };

  test("an explicit key wins", () => {
    const resolved = resolveIdempotencyKey({ ...base, idempotencyKey: "given", correlationId: "job-1" });
    assert.deepEqual(resolved, { key: "given", stable: true });
  });

  test("a correlation id yields the same key on every attempt", () => {
    const first = resolveIdempotencyKey({ ...base, correlationId: "job-1" });
    const retry = resolveIdempotencyKey({ ...base, correlationId: "job-1" });
    assert.equal(first.key, retry.key);
    assert.equal(first.stable, true);
  });

  test("the key is scoped by business and task", () => {
    const a = resolveIdempotencyKey({ ...base, correlationId: "job-1" }).key;
    const b = resolveIdempotencyKey({ ...base, businessId: "biz-2", correlationId: "job-1" }).key;
    const c = resolveIdempotencyKey({ ...base, taskType: "reply_generation", correlationId: "job-1" }).key;
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  test("no key and no correlation id is random and reported unstable", () => {
    const first = resolveIdempotencyKey(base);
    const second = resolveIdempotencyKey(base);
    assert.notEqual(first.key, second.key);
    assert.equal(first.stable, false);
  });
});

describe("B21 - overdraw has a hard ceiling", () => {
  test("the ceiling is a bounded fraction of the plan allocation", () => {
    assert.equal(OVERDRAW_CEILING_RATIO, 0.1);
    assert.equal(overdrawCeiling(1_000_000), 100_000);
    assert.equal(overdrawCeiling(0), 0);
    assert.equal(overdrawCeiling(-5), 0);
  });

  test("admission counts calls already in flight", () => {
    const balance = { granted: 1000, used: 0, held: 0 };
    assert.equal(admitsCall(balance, 600), true);
    // A second concurrent call sees the first one's hold.
    assert.equal(admitsCall({ ...balance, held: 600 }, 600), false);
    assert.equal(admitsCall({ ...balance, held: 600 }, 400), true);
  });

  test("an overdrawn balance admits nothing", () => {
    assert.equal(admitsCall({ granted: 1000, used: 1050, held: 0 }, 1), false);
  });

  test("the SQL enforces admission atomically and bounds the overdraw", () => {
    assert.match(MIGRATION, /create or replace function public\.reserve_ai_tokens/);
    assert.match(MIGRATION, /for update/);
    assert.match(MIGRATION, /create or replace function public\.consume_ai_tokens_bounded/);
    assert.match(MIGRATION, /overdraw_ceiling_ratio/);
  });
});

describe("B20 - agent run usage accumulates atomically", () => {
  test("the migration adds an increment function for conversation_agent_runs", () => {
    assert.match(MIGRATION, /create or replace function public\.add_agent_run_usage/);
    assert.match(MIGRATION, /input_tokens = r\.input_tokens \+/);
  });
});
