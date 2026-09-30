#!/usr/bin/env node
/**
 * READ-ONLY check that the live database's CHECK value lists match the
 * migrations.
 *
 *   node scripts/constraint-drift-check.mjs
 *
 * Why it exists: on 2026-09-30, migration 0038 was recorded as applied but its
 * widening of `integrations_provider_type_check` never reached the live
 * project, so nobody could save an email mailbox (fixed by 0181). The column
 * drift check (schema-drift-check.mjs) cannot see this; it only compares
 * columns.
 *
 * For every `constraint <name> check (<col> in ('a', 'b', ...))`, and every
 * inline `check (<col> in (...))` in a create table (Postgres names those
 * `<table>_<col>_check`), the LATEST migration that defines it is compared
 * with pg_get_constraintdef on the live project. A value the migrations allow
 * but live does not is drift, and the script exits 1. Values only live has are
 * reported but are not an error (they are usually widened by a later
 * migration in a form this parser doesn't read).
 */
import fs from "node:fs";
import path from "node:path";

const read = (file) => {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
      }),
    );
  } catch {
    return {};
  }
};
const env = { ...read(".env"), ...read(".env.local") };
if (!env.SUPABASE_PROJECT_REF || !env.SUPABASE_PAT) {
  console.error("SUPABASE_PROJECT_REF and SUPABASE_PAT are required.");
  process.exit(2);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `begin transaction read only; ${query};` }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}

const quoted = (list) => new Set([...list.matchAll(/'([^']*)'/g)].map((m) => m[1]));

/** Latest definition of each value-list constraint across the migrations, in order. */
function fromMigrations(dir) {
  const latest = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const text = fs.readFileSync(path.join(dir, file), "utf8").replace(/--.*$/gm, "");
    for (const m of text.matchAll(/constraint\s+([a-z0-9_]+)\s+check\s*\(\s*[a-z0-9_."]+\s+in\s*\(([^)]*)\)/gi)) {
      latest.set(m[1], { file, values: quoted(m[2]) });
    }
    for (const t of text.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      for (const c of t[2].matchAll(/check\s*\(\s*([a-z0-9_]+)\s+in\s*\(([^)]*)\)/gi)) {
        latest.set(`${t[1]}_${c[1]}_check`, { file, values: quoted(c[2]) });
      }
    }
  }
  return latest;
}

const live = new Map();
for (const row of await sql(
  "select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype = 'c'",
)) {
  if (!/ANY \(ARRAY/.test(row.def)) continue;
  live.set(row.conname, new Set([...row.def.matchAll(/'([^']*)'::text/g)].map((m) => m[1])));
}

const expected = fromMigrations(path.join("supabase", "migrations"));
let compared = 0;
let drifted = 0;
for (const [name, want] of expected) {
  const have = live.get(name);
  if (!have) continue;
  compared++;
  const missing = [...want.values].filter((v) => !have.has(v));
  const extra = [...have].filter((v) => !want.values.has(v));
  if (missing.length) {
    drifted++;
    console.log(`DRIFT ${name} (latest: ${want.file}): live is missing ${missing.join(", ")}`);
  } else if (extra.length) {
    console.log(`note  ${name}: live also allows ${extra.join(", ")}`);
  }
}
console.log(`${compared} value-list constraints compared; ${drifted} drifted.`);
process.exit(drifted ? 1 : 0);
