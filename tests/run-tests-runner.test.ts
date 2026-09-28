import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GROUPS, parseGroupCommand, parseTotals, tokenize } from "../scripts/run-tests.mjs";

/**
 * The `npm test` group runner (scripts/run-tests.mjs). Its job is to make the
 * two silent failures impossible: a failing group skipping the rest, and a
 * registered path that runs nothing.
 */

const scripts = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts as Record<string, string>;

test("npm test runs the runner, and every group is a parseable single command", () => {
  assert.equal(scripts.test, "node scripts/run-tests.mjs");
  for (const group of GROUPS as string[]) {
    const parsed = parseGroupCommand(scripts[`test:${group}`]);
    assert.ok(parsed.files.length > 0, group);
    assert.equal(parsed.nodeArgs.at(-1), "--test");
  }
});

test("every file is its own argument: two paths spliced into one quoted string are refused", () => {
  assert.throws(() => parseGroupCommand('node --test "tests/a.test.ts tests/b.test.ts"'), /single test file/);
  assert.throws(() => parseGroupCommand('node --test "tests/a.test.ts" && node --test "tests/b.test.ts"'), /one command/);
  const ok = parseGroupCommand('node --import ./scripts/e2e-resolver.mjs --test "tests/a.test.ts" "tests/b.test.ts"');
  assert.deepEqual(ok.nodeArgs, ["--import", "./scripts/e2e-resolver.mjs", "--test"]);
  assert.deepEqual(ok.files, ["tests/a.test.ts", "tests/b.test.ts"]);
});

test("tokenize honours double quotes", () => {
  assert.deepEqual(tokenize('node --test "a b" c'), ["node", "--test", "a b", "c"]);
});

test("totals are read from both the spec and the TAP reporters", () => {
  assert.deepEqual(parseTotals("ℹ tests 12\nℹ pass 11\nℹ fail 1\n"), { tests: 12, pass: 11, fail: 1 });
  assert.deepEqual(parseTotals("# tests 3\n# pass 3\n# fail 0\n"), { tests: 3, pass: 3, fail: 0 });
});

test("no test file is registered twice across the three groups", () => {
  const all = (GROUPS as string[]).flatMap((group) => parseGroupCommand(scripts[`test:${group}`]).files);
  assert.equal(new Set(all).size, all.length);
});
