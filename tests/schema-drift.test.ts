import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/**
 * Every column the code names in a `.from(...)` chain exists in the schema
 * (backend QA 2026-09-28). Untyped clients hide a wrong column from tsc, and
 * PostgREST's error was being ignored: Copilot's intent insight and its
 * intent-signals tool always said "0" (`observed_at` is `matched_at`), and
 * connector.get never showed a recent event (`error_message` is
 * `last_error`). Offline: reads src/lib/supabase/database.types.ts, which
 * `node scripts/refresh-db-types.mjs` regenerates from the live project.
 */
test("no query chain names a column, table or RPC the schema lacks", () => {
  const run = spawnSync(process.execPath, ["scripts/schema-drift-check.mjs", "--offline"], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /Findings: 0/);
});
