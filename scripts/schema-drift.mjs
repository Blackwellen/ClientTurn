#!/usr/bin/env node
/**
 * Does the live database actually match the migrations in this repository?
 *
 * Until now the only way to answer that was to read a migration, pick an object
 * out of it, and query for that object by hand — which is what every migration
 * in this branch was verified with, one at a time. That works and it does not
 * scale, and it cannot be run by someone who was not there.
 *
 * This does the same thing mechanically for every migration at once. It parses
 * each file for the objects it creates, asks the database which of them exist,
 * and reports the difference. It also compares `supabase_migrations.schema_migrations`
 * — the ledger the Supabase CLI reads to decide what `db push` should apply —
 * against the files on disk.
 *
 * That second check matters more than it looks. The ledger and the schema can
 * disagree in both directions, and both are dangerous:
 *
 *   - A migration **applied but unrecorded** will be re-applied by the next
 *     `db push`. `create table` without a guard fails, and the push stops
 *     part-way through a batch, which is the worst possible outcome: a
 *     half-applied deploy nobody planned for.
 *   - A migration **recorded but not applied** is invisible. The tooling
 *     believes the schema is current, the code assumes a column that is not
 *     there, and the failure surfaces at runtime in whichever request touches
 *     it first.
 *
 * Read-only. It issues `select` statements and nothing else.
 *
 *   node scripts/schema-drift.mjs           # report
 *   node scripts/schema-drift.mjs --json    # machine-readable
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

/* --------------------------------------------------------------- credentials */

function loadEnv() {
  const out = {};
  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const env = loadEnv();
const PAT = process.env.SUPABASE_PAT ?? env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF ?? "losieaikadkadtmezini";

if (!PAT) {
  console.error(
    "No SUPABASE_PAT. This reads the live schema through the Management API and\n" +
      "cannot run without a personal access token.",
  );
  process.exit(2);
}

async function query(sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${PAT}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

/* ------------------------------------------------------------------ parsing */

/**
 * Strip comments and string literals before looking for DDL.
 *
 * Without this, the word "create table" inside one of this schema's long
 * explanatory comments is indistinguishable from the statement it describes,
 * and the report fills with objects that were only ever discussed.
 */
function stripNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " $BODY$ ");
}

/**
 * The objects a migration creates.
 *
 * Deliberately only `create`, never `alter`. A migration that adds a column is
 * checked by whichever migration created the table, and trying to track every
 * column here would turn a drift check into a second, worse copy of the schema.
 */
function objectsIn(sql) {
  const text = stripNoise(sql);
  const tables = new Set();
  const functions = new Set();
  const indexes = new Set();

  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
  const idxRe =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;

  for (const m of text.matchAll(tableRe)) tables.add(m[1]);
  for (const m of text.matchAll(fnRe)) functions.add(m[1]);
  for (const m of text.matchAll(idxRe)) indexes.add(m[1]);

  // A dropped object is not drift. A migration that creates something and then
  // drops it later in the same file, or a later migration that drops it, would
  // otherwise be reported as missing forever.
  const dropped = new Set();
  for (const m of text.matchAll(
    /drop\s+(?:table|function|index)\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi,
  )) {
    dropped.add(m[1]);
  }

  return { tables, functions, indexes, dropped };
}

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("9999"))
    .sort();
}

/* -------------------------------------------------------------------- main */

const files = migrationFiles();
const wanted = { tables: new Map(), functions: new Map(), indexes: new Map() };
const droppedEverywhere = new Set();

for (const file of files) {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  const found = objectsIn(sql);
  for (const name of found.dropped) droppedEverywhere.add(name);
  for (const kind of ["tables", "functions", "indexes"]) {
    for (const name of found[kind]) {
      // First migration to create it owns it in the report — that is the file
      // somebody would open to find out what the object is for.
      if (!wanted[kind].has(name)) wanted[kind].set(name, file);
    }
  }
}

// Anything dropped by a later migration is not expected to exist. This is
// applied after the whole set is read, so order within the set does not matter.
for (const kind of ["tables", "functions", "indexes"]) {
  for (const name of [...wanted[kind].keys()]) {
    if (droppedEverywhere.has(name)) wanted[kind].delete(name);
  }
}

const live = await query(`
  select 'table' as kind, c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'function', p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'index', c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'i'
`);

const liveByKind = { table: new Set(), function: new Set(), index: new Set() };
for (const row of live) liveByKind[row.kind]?.add(row.name);

const missing = { tables: [], functions: [], indexes: [] };
const kindOf = { tables: "table", functions: "function", indexes: "index" };
for (const kind of ["tables", "functions", "indexes"]) {
  for (const [name, file] of wanted[kind]) {
    if (!liveByKind[kindOf[kind]].has(name)) missing[kind].push({ name, file });
  }
}

/* ------------------------------------------------------------------ ledger */

const ledger = await query(
  "select version from supabase_migrations.schema_migrations order by version",
);
const recorded = new Set(ledger.map((row) => row.version));

/**
 * The version is the prefix before the first underscore, which is how the
 * Supabase CLI derives it — not the first four characters. The distinction is
 * not academic here: this set contains `0024_platform_admin_ops.sql` alongside
 * `00241_agent_runtime.sql`, `00242_…` and `00243_…`, and a four-character
 * slice collapses all four onto `0024`.
 */
const onDisk = files.map((f) => ({ version: f.slice(0, f.indexOf("_")), file: f }));

/**
 * Two files claiming one version.
 *
 * The ledger is keyed on version, so a duplicate means only one of them can
 * ever be recorded — and the next `db push` skips whichever is not, silently,
 * with no error and no missing-migration warning. It is the one drift in this
 * report that gets worse rather than better with time: the longer both files
 * sit there, the more likely one has been applied by hand and the other has
 * not, with nothing anywhere recording which.
 */
const byVersion = new Map();
for (const m of onDisk) {
  byVersion.set(m.version, [...(byVersion.get(m.version) ?? []), m.file]);
}
const duplicateVersions = [...byVersion.entries()].filter(
  ([, list]) => list.length > 1,
);

const unrecorded = onDisk.filter((m) => !recorded.has(m.version));
const orphanLedger = [...recorded].filter(
  (v) => !onDisk.some((m) => m.version === v),
);

/* ------------------------------------------------- silently-empty reads */

/**
 * A table read through the *user's* session that has RLS enabled and no policy.
 *
 * This is the quietest failure in the system. The read does not error and does
 * not warn — it returns zero rows, forever. The panel renders its empty state,
 * and a workspace that has done plenty of work looks like one that has done
 * none.
 *
 * RLS-on-with-no-policy is the right configuration for most of this schema:
 * `jobs`, `webhook_events`, `integration_secrets`, `mcp_tokens` and the cost
 * ledgers are server-only, and denying every browser role outright is stronger
 * than trusting a policy to be written correctly. It is only wrong where the
 * application actually reads the table with the caller's own session.
 *
 * Which client a call site uses is decided per *file*, and only where the file
 * is unambiguous: it imports `@/lib/supabase/server` or `client` and never
 * touches the admin client. A file that imports both is skipped rather than
 * guessed at — a false positive here would train someone to ignore the report,
 * which is worse than the gap it would have found.
 */
function silentlyEmptyReads(policylessTables) {
  const suspects = [];
  const srcRoot = path.join(ROOT, "src");

  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  })(srcRoot);

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const usesAdmin =
      text.includes("supabase/admin") ||
      text.includes("createAdminClient") ||
      text.includes("adminRead");
    const usesSession = /from "@\/lib\/supabase\/(server|client)"/.test(text);
    if (usesAdmin || !usesSession) continue;

    for (const table of policylessTables) {
      if (text.includes(`.from("${table}")`)) {
        suspects.push({
          table,
          file: path.relative(ROOT, file).split(path.sep).join("/"),
        });
      }
    }
  }
  return suspects;
}

/**
 * Privileges that row-level security does not cover.
 *
 * Supabase ships a default-privileges rule granting ALL on new objects in
 * `public` to `anon` and `authenticated`, so `grant select ... to authenticated`
 * reads like least privilege while being additive to a grant of everything.
 * That is how this schema came to hold 49 grants to the unauthenticated role
 * and TRUNCATE on 121 tables (0086).
 *
 * RLS makes almost all of it harmless -- and not TRUNCATE, which RLS does not
 * govern at all. A role holding TRUNCATE can empty a table with RLS on, no
 * policy, and no rows it may see.
 *
 * So this checks the two things RLS cannot: any grant at all to `anon`, and
 * TRUNCATE to either browser role.
 */
const strayGrants = await query(`
  select grantee, privilege_type, count(*)::int as tables
    from information_schema.role_table_grants
   where table_schema = 'public'
     and (
       grantee = 'anon'
       or (grantee = 'authenticated' and privilege_type = 'TRUNCATE')
     )
   group by grantee, privilege_type
   order by grantee, privilege_type
`);

const policyless = await query(`
  select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and (select count(*) from pg_policy p where p.polrelid = c.oid) = 0
`);
const policylessNames = policyless.map((row) => row.name);
const silent = silentlyEmptyReads(policylessNames);

/* ------------------------------------------------------------------ report */

const summary = {
  migrations: files.length,
  expectedTables: wanted.tables.size,
  expectedFunctions: wanted.functions.size,
  missing,
  strayGrants,
  rlsEnabledWithoutPolicy: policylessNames.length,
  silentlyEmptyReads: silent,
  ledger: {
    recorded: recorded.size,
    unrecorded: unrecorded.map((m) => m.file),
    orphan: orphanLedger,
    duplicateVersions: Object.fromEntries(duplicateVersions),
  },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const tick = (ok) => (ok ? "ok" : "DRIFT");
  console.log(`\nSchema drift — ${files.length} migrations, project ${REF}\n`);
  for (const kind of ["tables", "functions", "indexes"]) {
    const gone = missing[kind];
    console.log(
      `  ${kind.padEnd(10)} ${String(wanted[kind].size).padStart(4)} expected  ` +
        `${String(gone.length).padStart(3)} missing  [${tick(gone.length === 0)}]`,
    );
    for (const row of gone) console.log(`      - ${row.name}  (${row.file})`);
  }

  const strayTotal = strayGrants.reduce((sum, row) => sum + row.tables, 0);
  console.log(
    `\n  grants     ${String(strayTotal).padStart(4)} privileges RLS cannot gate  ` +
      `[${tick(strayTotal === 0)}]`,
  );
  if (strayTotal > 0) {
    console.log(
      `      Supabase grants ALL on new objects in public to anon and\n` +
        `      authenticated by default, and a later grant is additive rather\n` +
        `      than a replacement. RLS covers most of it — but not TRUNCATE,\n` +
        `      which it does not govern at all.`,
    );
    for (const row of strayGrants) {
      console.log(`      - ${row.grantee}: ${row.privilege_type} on ${row.tables} table(s)`);
    }
  }

  console.log(
    `\n  rls        ${String(policylessNames.length).padStart(4)} tables have RLS on and no policy  ` +
      `${String(silent.length).padStart(3)} of them read with a user session  ` +
      `[${tick(silent.length === 0)}]`,
  );
  if (silent.length > 0) {
    console.log(
      `      These reads return zero rows, silently, forever — no error and no\n` +
        `      warning reaches anything. The panel renders its empty state and\n` +
        `      looks like a workspace that has not done anything yet.`,
    );
    for (const row of silent) console.log(`      - ${row.table}  read by ${row.file}`);
  }

  console.log(
    `\n  ledger     ${String(recorded.size).padStart(4)} recorded  ` +
      `${String(unrecorded.length).padStart(3)} applied but unrecorded  ` +
      `[${tick(unrecorded.length === 0 && orphanLedger.length === 0)}]`,
  );
  if (unrecorded.length > 0) {
    console.log(
      `      The next \`supabase db push\` would try to re-apply these.\n` +
        `      Bare \`create table\` fails on the second run, and the push stops\n` +
        `      part-way through the batch.`,
    );
    for (const m of unrecorded.slice(0, 8)) console.log(`      - ${m.file}`);
    if (unrecorded.length > 8) {
      console.log(`      … and ${unrecorded.length - 8} more`);
    }
  }
  for (const v of orphanLedger) {
    console.log(`      ! ${v} is recorded as applied but has no file on disk`);
  }

  if (duplicateVersions.length > 0) {
    console.log(`
  versions   ${String(duplicateVersions.length).padStart(4)} duplicated  [DRIFT]`);
    console.log(
      `      The ledger is keyed on version, so only one of each pair can ever
` +
        `      be recorded — and the next push skips the other silently.`,
    );
    for (const [version, list] of duplicateVersions) {
      console.log(`      ! ${version}: ${list.join("  +  ")}`);
    }
  }
  console.log();
}

const drifted =
  strayGrants.length > 0 ||
  silent.length > 0 ||
  duplicateVersions.length > 0 ||
  missing.tables.length > 0 ||
  missing.functions.length > 0 ||
  missing.indexes.length > 0 ||
  unrecorded.length > 0 ||
  orphanLedger.length > 0;

process.exit(drifted ? 1 : 0);
