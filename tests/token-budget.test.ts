import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PROMPT_REGISTRY } from "../src/lib/ai/prompt-registry.ts";
import { TASK_TYPES, FAST_STRUCTURED_TASKS, type TaskType } from "../src/lib/ai/schemas.ts";
import { estimateTokensForCall } from "../src/lib/billing/tokens.ts";
import { FALLBACK_ROUTES, TASK_TOKEN_ENVELOPES } from "../src/lib/ai/tiers.ts";
import { buildNbaStrategyBlock, buildStrategyBlock, estimateTokens } from "../src/lib/agent/strategy.ts";
import { NBA_STRATEGY_BLOCK_MAX_TOKENS } from "../src/lib/qualification-intelligence/types.ts";
import { TURN_FIXTURES } from "./fixtures/qi-turn-fixtures.ts";
import { OFFER_CARD_TOKEN_BUDGET } from "../src/lib/agent/offer-card.ts";
import { renderTranscriptBlocks, UNBOUNDED_TRANSCRIPT_LIMITS } from "../src/lib/agent/transcript.ts";
import { TRANSCRIPT_FIXTURES } from "./fixtures/transcript-fixtures.ts";

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

/**
 * Per-turn prompt tokens for the strategy block (design 08 §B.16): the same
 * five turns planned by the legacy strategy and by the NBA. Recorded in the
 * snapshot's `turn` section so a change in either is visible in review.
 */
function turnSizes() {
  const legacy = TURN_FIXTURES.map((f) => estimateTokens(buildStrategyBlock(f.legacy).text));
  const nba = TURN_FIXTURES.map((f) => estimateTokens(buildNbaStrategyBlock(f.legacy, f.nba, { booking: "SLOTS" }).text));
  const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const nbaMean = mean(nba);
  const systemPrompt = estimateTokensForCall(0, PROMPT_REGISTRY.agent_decision.systemPrompt.length);
  const transcript = transcriptSizes();
  // Modelled input of one agent_decision turn from the measured parts: system
  // prompt + offer card at its budget (the cacheable prefix) + NBA block +
  // the conversation blocks. The lead/qualification/booking blocks (~150-250
  // tokens, unchanged by this) are not included.
  const turnInput = Object.fromEntries(
    Object.entries(transcript).map(([id, t]) => [
      id,
      {
        before: systemPrompt + OFFER_CARD_TOKEN_BUDGET + nbaMean + t.before,
        after: systemPrompt + OFFER_CARD_TOKEN_BUDGET + nbaMean + t.after,
      },
    ]),
  );
  return {
    fixtures: TURN_FIXTURES.map((f) => f.id),
    legacy_strategy_block: { mean: mean(legacy), max: Math.max(...legacy) },
    nba_strategy_block: { mean: nbaMean, max: Math.max(...nba) },
    agent_decision_system_prompt: systemPrompt,
    offer_card_budget: OFFER_CARD_TOKEN_BUDGET,
    conversation_blocks: transcript,
    agent_turn_input: turnInput,
  };
}

/**
 * RECENT CONVERSATION + CURRENT MESSAGE tokens for the transcript fixtures:
 * `before` is the unbounded render with the untrusted notice on every lead
 * message (the pre-transcript.ts shape), `after` is what a turn sends now.
 */
function transcriptSizes(): Record<string, { before: number; after: number }> {
  const size = (blocks: string[]) => estimateTokens(blocks.join("\n\n"));
  return Object.fromEntries(
    TRANSCRIPT_FIXTURES.map((f) => [
      f.id,
      {
        before: size(renderTranscriptBlocks(f.recent, f.latestMessage, UNBOUNDED_TRANSCRIPT_LIMITS, true)),
        after: size(renderTranscriptBlocks(f.recent, f.latestMessage)),
      },
    ]),
  );
}

/** agent_decision before the qualification engine (v3). The NBA may grow it by at most 5%. */
const AGENT_DECISION_BEFORE_ENGINE = 1113;

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
    writeFileSync(SNAPSHOT, `${JSON.stringify({ tokens: current, turn: turnSizes() }, null, 2)}\n`);
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

describe("qualification engine token accounting (design 08 §B.16)", () => {
  const turn = turnSizes();
  const stored = existsSync(SNAPSHOT)
    ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { turn?: ReturnType<typeof turnSizes> }).turn
    : undefined;

  test(`every NBA strategy block is within ${NBA_STRATEGY_BLOCK_MAX_TOKENS} tokens`, () => {
    for (const f of TURN_FIXTURES) {
      const tokens = estimateTokens(buildNbaStrategyBlock(f.legacy, f.nba, { booking: "SLOTS" }).text);
      assert.ok(tokens <= NBA_STRATEGY_BLOCK_MAX_TOKENS, `${f.id}: ${tokens}`);
    }
  });

  test("the NBA block is smaller than the legacy plan for the same turns", () => {
    // Printed for the release report: prompt tokens per turn, before and after.
    console.log(
      `[token-budget] strategy block tokens per turn: legacy mean ${turn.legacy_strategy_block.mean} ` +
        `(max ${turn.legacy_strategy_block.max}) -> NBA mean ${turn.nba_strategy_block.mean} (max ${turn.nba_strategy_block.max})`,
    );
    assert.ok(turn.nba_strategy_block.mean < turn.legacy_strategy_block.mean);
  });

  test("agent_decision grew at most 5% for the engine", () => {
    const size = estimateTokensForCall(0, PROMPT_REGISTRY.agent_decision.systemPrompt.length);
    assert.ok(size <= AGENT_DECISION_BEFORE_ENGINE * 1.05, `${AGENT_DECISION_BEFORE_ENGINE} -> ${size}`);
  });

  test("the turn measurements are in the snapshot and have not grown past the threshold", () => {
    assert.ok(stored, "no turn section in the snapshot; regenerate it with UPDATE_TOKEN_SNAPSHOT=1");
    assert.ok(turn.nba_strategy_block.mean <= stored.nba_strategy_block.mean * (1 + MAX_GROWTH));
    assert.ok(turn.legacy_strategy_block.mean <= stored.legacy_strategy_block.mean * (1 + MAX_GROWTH));
  });

  test("the conversation blocks are bounded, smaller than before, and in the snapshot", () => {
    console.log(
      `[token-budget] conversation block tokens per turn: ${Object.entries(turn.conversation_blocks)
        .map(([id, t]) => `${id} ${t.before} -> ${t.after}`)
        .join("; ")}`,
    );
    for (const [id, t] of Object.entries(turn.conversation_blocks)) {
      assert.ok(t.after < t.before, `${id}: ${t.before} -> ${t.after}`);
      // 8 x 500-char messages capped at 2,800 chars + a 2,400-char current message + fences.
      assert.ok(t.after <= 1_500, `${id}: ${t.after} tokens`);
      const was = stored?.conversation_blocks?.[id];
      assert.ok(was, `${id} is not in the snapshot; regenerate it with UPDATE_TOKEN_SNAPSHOT=1`);
      assert.ok(t.after <= was.after * (1 + MAX_GROWTH), `${id}: ${was.after} -> ${t.after}`);
    }
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
