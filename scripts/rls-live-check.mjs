#!/usr/bin/env node
/**
 * READ-ONLY live check of the public schema's access control.
 *
 *   node scripts/rls-live-check.mjs            human-readable report
 *   node scripts/rls-live-check.mjs --json     machine-readable
 *
 * Reports, against the live project (SUPABASE_PROJECT_REF + SUPABASE_PAT from
 * .env / .env.local, through the Management API):
 *
 *   1. public tables with row level security OFF;
 *   2. public tables with RLS on but NOT forced (informational: the owner
 *      bypasses unforced RLS; the app never connects as the owner);
 *   3. TRUNCATE granted to `authenticated` (TRUNCATE is not subject to RLS),
 *      and INSERT/UPDATE/DELETE grants with no policy for that command
 *      (denied by RLS today, live the moment an unrelated policy is added);
 *   4. any privilege at all granted to `anon` on a table;
 *   7. privileged columns the browser role can UPDATE (platform_role,
 *      businesses.status / deleted_at / job_claims_paused, ...). A column
 *      grant does not narrow a table-level grant: 0178 found platform_role
 *      writable by every signed-in user this way.
 *   5. RLS-on tables with no policy (fine for service-role-only tables; listed
 *      so a table meant for members is noticed);
 *   6. views in public (a view runs as its owner unless security_invoker).
 *
 * Every query runs inside `begin transaction read only`, and the script
 * refuses any statement containing a write keyword. Exit code 1 when 1, 3, 4
 * or 7 has findings (the ones that are always a bug), else 0. REFERENCES and
 * TRIGGER grants (Supabase defaults, unreachable through PostgREST) are
 * counted as information only.
 */
import fs from "node:fs";

const read = (file) => {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => {
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
  console.error("SUPABASE_PROJECT_REF and SUPABASE_PAT are required (.env / .env.local).");
  process.exit(2);
}

const WRITE = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|vacuum|copy|lock|refresh|reindex|cluster)\b/i;

async function sql(query) {
  // String literals are blanked before the keyword check (privilege names are compared as text).
  if (WRITE.test(query.replace(/'[^']*'/g, "''"))) throw new Error("refused: not a read-only query");
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `begin transaction read only; ${query};` }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}

/** Columns a browser session must never write, whatever the policy says. */
const PRIVILEGED = [
  ["profiles", "platform_role"],
  ["businesses", "status"],
  ["businesses", "deleted_at"],
  ["businesses", "job_claims_paused"],
  ["businesses", "activated_at"],
  ["businesses", "created_by"],
  ["business_members", "role"],
  ["subscriptions", "plan"],
  ["subscriptions", "status"],
];
const privilegedList = PRIVILEGED.map(([t, c]) => `('${t}','${c}')`).join(",");

const [noRls, notForced, writeGrants, anonGrants, noPolicy, views, privileged, defaultNoise] = await Promise.all([
  sql(`select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`),
  sql(`select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and not c.relforcerowsecurity order by 1`),
  sql(`select g.table_name as table, g.grantee, string_agg(g.privilege_type, ',' order by g.privilege_type) as privileges
       from information_schema.role_table_grants g
       join pg_class c on c.relname = g.table_name and c.relnamespace = 'public'::regnamespace
       where g.table_schema = 'public' and g.grantee in ('anon','authenticated')
         and (g.privilege_type = 'TRUNCATE'
              or (g.privilege_type in ('INSERT','UPDATE','DELETE')
                  and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                                  and p.polcmd in (case g.privilege_type when 'INSERT' then 'a' when 'UPDATE' then 'w' else 'd' end, '*'))))
       group by 1, 2 order by 1, 2`),
  sql(`select table_name as table, string_agg(privilege_type, ',' order by privilege_type) as privileges
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
       group by 1 order by 1`),
  sql(`select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
       order by 1`),
  sql(`select c.relname as view, coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') as security_invoker
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v','m') order by 1`),
  sql(`select table_name as table, column_name as column, grantee
       from information_schema.column_privileges
       where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type = 'UPDATE'
         and (table_name, column_name) in (${privilegedList})
       order by 1, 2`),
  sql(`select count(*)::int as n from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('REFERENCES','TRIGGER')`),
]);

const report = { noRls, notForced, writeGrants, anonGrants, noPolicy, views, privileged, referencesTriggerGrants: defaultNoise[0]?.n ?? 0 };
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const list = (title, rows, fmt) => {
    console.log(`\n${title}: ${rows.length}`);
    for (const r of rows) console.log(`  - ${fmt(r)}`);
  };
  list("1. RLS OFF (bug)", noRls, (r) => r.table);
  list("3. TRUNCATE, or a write grant with no policy (bug)", writeGrants, (r) => `${r.table} -> ${r.grantee}: ${r.privileges}`);
  list("4. Any grant to anon (bug)", anonGrants, (r) => `${r.table}: ${r.privileges}`);
  list("6. Views in public", views, (r) => `${r.view} (security_invoker=${r.security_invoker})`);
  list("7. Privileged columns the browser can UPDATE (bug)", privileged, (r) => `${r.table}.${r.column} -> ${r.grantee}`);
  console.log(`\nREFERENCES/TRIGGER grants (Supabase defaults, info): ${report.referencesTriggerGrants}`);
  console.log(`\n2. RLS on but not forced (info): ${notForced.length}`);
  console.log(`5. RLS on, no policy = service-role only (info): ${noPolicy.length}`);
  if (process.argv.includes("--verbose")) {
    list("2. not forced", notForced, (r) => r.table);
    list("5. no policy", noPolicy, (r) => r.table);
  }
}
process.exit(noRls.length + writeGrants.length + anonGrants.length + privileged.length > 0 ? 1 : 0);
