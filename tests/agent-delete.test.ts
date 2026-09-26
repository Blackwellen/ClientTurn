import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_OPERATIONS } from "../src/lib/services/registry.ts";

/**
 * Deleting an agent: a person's decision, confirmed, admin-only, and never a
 * Copilot or conversation-agent tool. The handler must keep the work the agent
 * produced and refuse while a run is in progress.
 */

const op = ALL_OPERATIONS.find((o) => o.name === "agent.delete");

test("agent.delete is a confirmed, admin-only, destructive operation", () => {
  assert.ok(op, "agent.delete is declared");
  assert.equal(op.risk, "DESTRUCTIVE");
  assert.equal(op.minimumRole, "admin");
  assert.ok(op.effect && op.effect.length > 40, "states its effect before it runs");
});

test("agent.delete is never offered to Copilot or the conversation agent", () => {
  assert.ok(op?.callers, "callers are restricted explicitly");
  assert.ok(!op.callers.includes("COPILOT"));
  assert.ok(!op.callers.includes("AGENT"));
  assert.ok(op.callers.includes("UI"));
});

test("the handler refuses a live run and keeps leads, prospects and runs", () => {
  const source = readFileSync("src/lib/services/operations/agents.ts", "utf8");
  const handler = source.slice(source.indexOf('defineOperation("agent.delete"'));
  assert.match(handler, /\.in\("status", \["QUEUED", "RUNNING"\]\)/);
  assert.match(handler, /"CONFLICT"/);
  assert.match(handler, /kept: \{ leads, prospects, sourcingRuns: runs \}/);
});
