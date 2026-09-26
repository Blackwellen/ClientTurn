import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PROMPT_REGISTRY } from "../src/lib/ai/prompt-registry.ts";
import { TASK_TYPES, FAST_STRUCTURED_TASKS, type TaskType } from "../src/lib/ai/schemas.ts";
import { estimateTokensForCall } from "../src/lib/billing/tokens.ts";
import { FALLBACK_ROUTES, TASK_TOKEN_ENVELOPES } from "../src/lib/ai/tiers.ts";

/**
 * Token regression (brief §95).
 *
 * Every registered prompt's system-prompt size is compared with a committed
 * snapshot. Growing any prompt by more than 20% fails until the snapshot is
 * updated deliberately -- a prompt that quietly doubles doubles the cost of
 * every call of that task, and nobody sees it in review.
 *
 * Update the snapshot after an intended change:
 *
 *   UPDATE_TOKEN_SNAPSHOT=1 node --import ./scripts/e2e-resolver.mjs --test tests/token-budget.test.ts
 *
 * Needs the resolver: the prompt registry imports without file extensions.
 */

const SNAPSHOT = path.join(process.cwd(), "tests", "fixtures", "prompt-token-snapshot.json");
const MAX_GROWTH = 0.2;

function currentSizes(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const [task, entry] of Object.entries(PROMPT_REGISTRY)) {
    sizes[task] = estimateTokensForCall(0, entry.systemPrompt.length);
  }
  return Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
}

describe("prompt token snapshot", () => {
  const current = currentSizes();

  if (process.env.UPDATE_TOKEN_SNAPSHOT === "1") {
    mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, `${JSON.stringify({ tokens: current }, null, 2)}\n`);
  }

  test("the snapshot exists", () => {
    assert.ok(
      existsSync(SNAPSHOT),
      "tests/fixtures/prompt-token-snapshot.json is missing; generate it with UPDATE_TOKEN_SNAPSHOT=1",
    );
  });

  const snapshot: Record<string, number> = existsSync(SNAPSHOT)
    ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { tokens: Record<string, number> }).tokens
    : {};

  test("every registered prompt is in the snapshot", () => {
    const missing = Object.keys(current).filter((task) => !(task in snapshot));
    assert.deepEqual(missing, [], `not in the snapshot: ${missing.join(", ")}`);
  });

  test(`no system prompt grew more than ${MAX_GROWTH * 100}% without a snapshot update`, () => {
    const grown = Object.entries(current)
      .filter(([task, size]) => task in snapshot && size > snapshot[task] * (1 + MAX_GROWTH))
      .map(([task, size]) => `${task}: ${snapshot[task]} -> ${size} tokens`);
    assert.deepEqual(grown, [], `prompts grew past the threshold:\n${grown.join("\n")}`);
  });
});

describe("every task is budgeted and routed", () => {
  test("every task has a token envelope that covers its system prompt", () => {
    const current = currentSizes();
    for (const task of TASK_TYPES) {
      const envelope = TASK_TOKEN_ENVELOPES[task];
      assert.ok(envelope, `${task} has no envelope`);
      assert.ok(envelope.output > 0, `${task} has no output envelope`);
      assert.ok(
        envelope.input >= current[task],
        `${task}: input envelope ${envelope.input} < system prompt ${current[task]}`,
      );
    }
  });

  test("every task has a code fallback route, matching the nano/mini rule", () => {
    for (const task of TASK_TYPES) {
      const route = FALLBACK_ROUTES[task];
      assert.ok(route, `${task} has no fallback route`);
      assert.equal(route.defaultTier, FAST_STRUCTURED_TASKS.has(task) ? 1 : 2, task);
    }
  });

  test("every task has a seeded route (0122, or a later migration that adds the task)", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith(".sql") && file >= "0122")
      .map((file) => readFileSync(path.join(dir, file), "utf8"))
      .join("\n");
    const seeded = new Set(
      [...sql.matchAll(/\('([a-z_]+)',\s*\d,\s*array\[/g)].map((match) => match[1] as TaskType),
    );
    const missing = TASK_TYPES.filter((task) => !seeded.has(task));
    assert.deepEqual(missing, []);
  });
});
