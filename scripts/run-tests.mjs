#!/usr/bin/env node
/**
 * `npm test`: runs the three unit-test groups and ALWAYS runs all three.
 *
 * The groups live in package.json as `test:g1`, `test:g2` and `test:g3`, each
 * a `node [flags] --test "tests/a.test.ts" "tests/b.test.ts" ...` command with
 * every file its own quoted argument (add new files there, the same way):
 *
 *   test:g1  plain `node --test` (pure modules)
 *   test:g2  `--conditions=react-server`
 *   test:g3  `--import ./scripts/e2e-resolver.mjs` (resolves `@/` and
 *            `server-only`, for tests of server code)
 *
 * Why a runner: the old `test` script joined the groups with `&&`, so one
 * failure in group 1 (often another session's half-finished work) silently
 * skipped groups 2 and 3, and `npm test` looked like it had run them.
 *
 * It also refuses the other silent failure: a registered path that does not
 * exist (for instance two files spliced into one quoted string) fails its
 * group instead of quietly running nothing. And it warns about any
 * `tests/*.test.ts` on disk that no script registers.
 *
 * Node is spawned directly with an argument array, not through a shell, so
 * the Windows 8,191-character command-line limit of cmd.exe does not apply
 * to group 1's 200+ files.
 *
 * Usage:
 *   node scripts/run-tests.mjs            all groups
 *   node scripts/run-tests.mjs g1 g3      only those groups
 *
 * Exit code: 0 only if every group that ran passed.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const GROUPS = ["g1", "g2", "g3"];

/** Splits a command line on spaces, honouring double quotes. */
export function tokenize(command) {
  const tokens = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(command)) !== null) tokens.push(match[1] ?? match[2]);
  return tokens;
}

/**
 * `node --flag --test "tests/a.test.ts"` -> { nodeArgs, files }.
 * Throws on anything that is not a single `node ... --test <files>` command,
 * so a group can never be half-parsed.
 */
export function parseGroupCommand(command) {
  if (/&&|\|\||;/.test(command)) throw new Error(`A test group must be one command: ${command.slice(0, 80)}`);
  const tokens = tokenize(command);
  if (tokens[0] !== "node") throw new Error(`A test group must start with "node": ${command.slice(0, 80)}`);
  const testAt = tokens.indexOf("--test");
  if (testAt === -1) throw new Error(`A test group must use --test: ${command.slice(0, 80)}`);
  const files = tokens.slice(testAt + 1);
  const bad = files.filter((file) => !/^tests\/[^\s]+\.test\.ts$/.test(file));
  if (bad.length > 0) throw new Error(`Not a single test file path: ${bad.join(" | ")}`);
  return { nodeArgs: tokens.slice(1, testAt + 1), files };
}

/** Reads the spec reporter's closing totals ("ℹ pass 12"); TAP ("# pass 12") too. */
export function parseTotals(output) {
  const totals = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...output.matchAll(new RegExp(`^(?:ℹ|#) ${key} (\\d+)`, "gm"))];
    if (matches.length > 0) totals[key] = Number(matches.at(-1)[1]);
  }
  return totals;
}

function loadScripts() {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts ?? {};
}

function runGroup(name, command) {
  let parsed;
  try {
    parsed = parseGroupCommand(command);
  } catch (error) {
    return Promise.resolve({ name, code: 1, files: 0, totals: {}, note: error.message });
  }
  const missing = parsed.files.filter((file) => !existsSync(path.join(repoRoot, file)));
  if (missing.length > 0) {
    return Promise.resolve({
      name,
      code: 1,
      files: parsed.files.length,
      totals: {},
      note: `registered but missing on disk: ${missing.join(", ")}`,
    });
  }

  return new Promise((resolve) => {
    let tail = "";
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-400_000);
    };
    const child = spawn(process.execPath, [...parsed.nodeArgs, ...parsed.files], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      keep(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      keep(chunk);
    });
    child.on("close", (code, signal) =>
      resolve({
        name,
        code: code ?? 1,
        files: parsed.files.length,
        totals: parseTotals(tail),
        note: signal ? `killed by ${signal}` : "",
      }),
    );
    child.on("error", (error) => resolve({ name, code: 1, files: parsed.files.length, totals: {}, note: error.message }));
  });
}

function unregisteredTests(scripts) {
  const everything = Object.values(scripts).join(" ");
  const dir = path.join(repoRoot, "tests");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => `tests/${file}`)
    .filter((file) => !everything.includes(file));
}

async function main() {
  const scripts = loadScripts();
  const wanted = process.argv.slice(2).length > 0 ? process.argv.slice(2) : GROUPS;
  const results = [];

  for (const group of wanted) {
    const command = scripts[`test:${group}`];
    if (!command) {
      results.push({ name: group, code: 1, files: 0, totals: {}, note: `no "test:${group}" script in package.json` });
      continue;
    }
    console.log(`\n=== test:${group} ===\n`);
    results.push(await runGroup(group, command));
  }

  console.log("\n=== Test summary ===");
  let failed = false;
  for (const result of results) {
    const ok = result.code === 0;
    if (!ok) failed = true;
    const t = result.totals;
    const counts =
      t.tests !== undefined
        ? `${t.tests} tests, ${t.pass ?? 0} passed, ${t.fail ?? 0} failed${t.cancelled ? `, ${t.cancelled} cancelled` : ""}${t.skipped ? `, ${t.skipped} skipped` : ""}`
        : "no totals reported";
    console.log(`${ok ? "PASS" : "FAIL"}  test:${result.name}  ${result.files} files  ${counts}${result.note ? `  (${result.note})` : ""}`);
  }

  const orphans = unregisteredTests(scripts);
  if (orphans.length > 0) {
    console.log(`\nWARNING: ${orphans.length} test file(s) on disk are in no package.json script: ${orphans.join(", ")}`);
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
