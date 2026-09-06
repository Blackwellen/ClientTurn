/**
 * Runs SQL against the linked Supabase project through the Management API.
 *
 *   node scripts/run-sql.mjs --check 0025 0026 ...   # BEGIN ... ROLLBACK (validate only)
 *   node scripts/run-sql.mjs --apply 0025 0026 ...   # BEGIN ... COMMIT   (for real)
 *   node scripts/run-sql.mjs --query "select 1"
 *
 * `--check` is the important mode: it executes the migrations against the real
 * schema inside a transaction and then rolls back, so syntax, constraint and
 * dependency errors surface without changing anything. Nothing should ever be
 * applied that has not passed a check first.
 *
 * Credentials come from .env / .env.local and are never printed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file, key) {
  try {
    const text = readFileSync(join(root, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* file may not exist */
  }
  return null;
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? readEnv(".env", "SUPABASE_PAT");
const REF = process.env.SUPABASE_PROJECT_REF ?? readEnv(".env.local", "SUPABASE_PROJECT_REF");

if (!TOKEN) throw new Error("SUPABASE_PAT not found in .env");
if (!REF) throw new Error("SUPABASE_PROJECT_REF not found in .env.local");

async function runQuery(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

const args = process.argv.slice(2);
const mode = args[0];

if (mode === "--query") {
  const result = await runQuery(args.slice(1).join(" "));
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (mode !== "--check" && mode !== "--apply") {
  console.error("Usage: run-sql.mjs --check|--apply <migration prefixes...>  |  --query <sql>");
  process.exit(2);
}

const prefixes = args.slice(1);
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => prefixes.length === 0 || prefixes.some((p) => f.startsWith(p)))
  .sort();

if (files.length === 0) {
  console.error("No migrations matched.");
  process.exit(2);
}

console.log(`${mode === "--check" ? "Validating" : "APPLYING"} ${files.length} migration(s):`);
for (const f of files) console.log(`  ${f}`);

// One transaction for the whole set, so a later migration that depends on an
// earlier one is exercised exactly as it would be on a real apply.
const body = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n\n");
const sql = `BEGIN;\n${body}\n${mode === "--check" ? "ROLLBACK;" : "COMMIT;"}\n`;

const result = await runQuery(sql);

if (result.ok) {
  console.log(mode === "--check" ? "\nOK — all statements executed, transaction rolled back." : "\nAPPLIED and committed.");
  process.exit(0);
}

console.error(`\nFAILED (HTTP ${result.status})`);
console.error(typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2));
process.exit(1);
