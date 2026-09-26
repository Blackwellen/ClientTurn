// Applies ONE migration file to the Supabase project through the Management
// API, in a single transaction, and records it in
// supabase_migrations.schema_migrations exactly as the Supabase CLI does.
//
// Usage (from the repo root):
//   node scripts/apply-migration.mjs supabase/migrations/0104_oauth_pkce.sql
//
// Reads SUPABASE_PAT from .env and SUPABASE_PROJECT_REF from .env.local.
// Idempotent: a version already recorded is skipped. A failure rolls the whole
// migration back and exits non-zero, so a batch can stop at the first error.

import fs from "node:fs";
import path from "node:path";

function readEnv(file) {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

const env = { ...readEnv(".env"), ...readEnv(".env.local") };
const pat = env.SUPABASE_PAT;
const ref = env.SUPABASE_PROJECT_REF;
if (!pat || !ref) {
  console.error("SUPABASE_PAT (.env) and SUPABASE_PROJECT_REF (.env.local) are required.");
  process.exit(2);
}

const file = process.argv[2];
if (!file || !/^supabase[\\/]migrations[\\/]\d{4}_[a-z0-9_]+\.sql$/.test(file)) {
  console.error("Pass one file under supabase/migrations/, e.g. supabase/migrations/0104_oauth_pkce.sql");
  process.exit(2);
}

const base = path.basename(file, ".sql");
const version = base.slice(0, base.indexOf("_"));
const name = base.slice(base.indexOf("_") + 1);
const sql = fs.readFileSync(file, "utf8");
if (sql.includes("$ctmig$")) throw new Error("The migration text contains the quoting tag $ctmig$.");

async function query(text) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: text }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

const already = await query(
  `select count(*)::int as n from supabase_migrations.schema_migrations where version = '${version}'`,
);
if (!already.ok) {
  console.error(`Could not read schema_migrations: HTTP ${already.status} ${already.body.slice(0, 500)}`);
  process.exit(1);
}
if (/"n":\s*[1-9]/.test(already.body)) {
  console.log(`${version} ${name}: already applied, skipped`);
  process.exit(0);
}

const started = Date.now();
const result = await query(
  `begin;\n${sql}\n;\n` +
    `insert into supabase_migrations.schema_migrations (version, name, statements) ` +
    `values ('${version}', '${name}', array[$ctmig$${sql}$ctmig$]);\n` +
    `commit;`,
);
console.log(`${version} ${name}: HTTP ${result.status} in ${Date.now() - started}ms`);
if (!result.ok) {
  console.log(result.body.slice(0, 3000));
  process.exit(1);
}
