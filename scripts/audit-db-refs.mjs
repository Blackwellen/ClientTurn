/**
 * Checks that every table and function the application queries actually exists
 * in the linked database.
 *
 * This catches the class of bug where `database.types.ts` has been regenerated
 * against a schema that was never applied — the typecheck passes, the build
 * passes, and the page 500s the first time a customer opens it. Types describe
 * intent; only the database is authoritative.
 *
 *   node scripts/audit-db-refs.mjs
 *
 * Exits non-zero when something is referenced but missing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file, key) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* missing file is fine */
  }
  return null;
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? readEnv(".env", "SUPABASE_PAT");
const REF = process.env.SUPABASE_PROJECT_REF ?? readEnv(".env.local", "SUPABASE_PROJECT_REF");
if (!TOKEN || !REF) throw new Error("SUPABASE_PAT / SUPABASE_PROJECT_REF not found");

/* ------------------------------------------------------------ scan source */

const tables = new Map(); // name -> Set(file)
const functions = new Map();

function record(map, name, file) {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(file);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(path);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;

    const text = readFileSync(path, "utf8");
    const rel = path.slice(root.length + 1).replace(/\\/g, "/");

    for (const m of text.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)) {
      record(tables, m[1], rel);
    }
    for (const m of text.matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)) {
      record(functions, m[1], rel);
    }
  }
}

walk(join(root, "src"));

/* ------------------------------------------------------------- ask the db */

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Query failed: ${await response.text()}`);
  return response.json();
}

const [dbTables, dbFunctions] = await Promise.all([
  query(
    "select table_name as name from information_schema.tables where table_schema='public' " +
      "union select table_name from information_schema.views where table_schema='public'",
  ),
  query(
    "select p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
  ),
]);

const haveTables = new Set(dbTables.map((r) => r.name));
const haveFunctions = new Set(dbFunctions.map((r) => r.name));

/* --------------------------------------------------------------- compare */

// Supabase Storage and auth schema helpers are reached through their own
// clients, not PostgREST, so a bare name that is not in `public` is only a
// finding when the code really did mean a public table.
const IGNORE = new Set(["objects", "buckets"]);

let failed = false;

function report(kind, refs, have) {
  const missing = [...refs.entries()]
    .filter(([name]) => !have.has(name) && !IGNORE.has(name))
    .sort();

  if (missing.length === 0) {
    console.log(`OK  every referenced ${kind} exists (${refs.size} distinct).`);
    return;
  }

  failed = true;
  console.error(`\nMISSING ${kind.toUpperCase()}S — referenced in code, absent from the database:`);
  for (const [name, files] of missing) {
    console.error(`  ${name}`);
    for (const file of [...files].sort().slice(0, 6)) console.error(`      ${file}`);
  }
}

report("table", tables, haveTables);
report("function", functions, haveFunctions);

if (failed) {
  console.error("\nApply the migration that creates these, or the pages that use them will fail at runtime.");
  process.exit(1);
}
