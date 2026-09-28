/**
 * Deletes the help-centre DEMO workspace ("Blackwellen Ltd", slug
 * `blackwellen-demo`) created by scripts/seed-help-demo.mjs, and its demo
 * logins, then proves nothing is left.
 *
 *   node --env-file=.env --env-file=.env.local scripts/teardown-help-demo.mjs            # dry run: counts only
 *   node --env-file=.env --env-file=.env.local scripts/teardown-help-demo.mjs --confirm  # really delete
 *
 * Safety:
 *   - The workspace is found by slug and must also be named "Blackwellen Ltd"
 *     and have job_claims_paused = true (every demo workspace has; a real one
 *     does not). Anything else is refused. The owner's real workspace
 *     ("Blackwellen Roofing & Exteriors") has neither the slug nor the flag.
 *   - Auth users are deleted only if their email is one of the seed's demo
 *     addresses on the reserved `.example` domain AND they belong to no other
 *     workspace.
 *   - Dry run is the default.
 *
 * Order (as tests/stories/harness.ts): the workspace's jobs and domain events
 * in small batches (a self-referencing FK makes big job deletes time out),
 * then the business row, which cascades to every tenant table (issued invoices
 * and sent quotes can only go this way: their guards allow cascaded deletes),
 * then anything a cascade did not reach, then the auth users, then a count of
 * every public table with a business_id column (via the Management API, read
 * only) that must be all zeros.
 */
import { createClient } from "@supabase/supabase-js";

const SLUG = "blackwellen-demo";
const NAME = "Blackwellen Ltd";
const DEMO_EMAILS = [
  "alex.morgan@blackwellen-demo.example",
  "priya.nandra@blackwellen-demo.example",
  "tom.ashby@blackwellen-demo.example",
  "sam.okafor@blackwellen-demo.example",
];

const CONFIRM = process.argv.includes("--confirm");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Load .env and .env.local (--env-file) first.");
if (!/losieaikadkadtmezini/.test(url)) throw new Error(`Refusing: ${url} is not the ClientTurn project.`);
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const PAT = process.env.SUPABASE_PAT ?? process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF ?? "losieaikadkadtmezini";
async function readSql(sql) {
  if (!PAT) throw new Error("SUPABASE_PAT is needed for the row-count proof.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`sql: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Row counts for the workspace in every public table with a business_id column. */
async function remainingRows(businessId) {
  if (!/^[0-9a-f-]{36}$/.test(businessId)) throw new Error("bad id");
  const tables = await readSql(
    "select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name " +
      "where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE' order by 1",
  );
  const counts = {};
  const parts = tables.map((t) => `select '${t.table_name}' t, count(*)::int n from public."${t.table_name}" where business_id = '${businessId}'`);
  for (let i = 0; i < parts.length; i += 40) {
    for (const row of await readSql(parts.slice(i, i + 40).join(" union all "))) if (row.n > 0) counts[row.t] = row.n;
  }
  const [biz] = await readSql(`select count(*)::int n from public.businesses where id = '${businessId}'`);
  if (biz.n > 0) counts.businesses = biz.n;
  return { tablesChecked: tables.length + 1, nonZero: counts };
}

async function deleteInBatches(table, businessId, batch = 25) {
  let deleted = 0;
  for (;;) {
    const { data, error } = await admin.from(table).select("id").eq("business_id", businessId).limit(500);
    if (error) throw new Error(`${table} read: ${error.message}`);
    if (!data?.length) return deleted;
    for (let i = 0; i < data.length; i += batch) {
      const ids = data.slice(i, i + batch).map((r) => r.id);
      const { data: gone, error: e } = await admin.from(table).delete().in("id", ids).select("id");
      if (e) throw new Error(`${table} delete: ${e.message}`);
      deleted += gone?.length ?? 0;
    }
  }
}

async function demoUsers(businessId) {
  const found = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email && DEMO_EMAILS.includes(u.email.toLowerCase())) found.push(u);
    if (data.users.length < 200) break;
  }
  const out = [];
  for (const u of found) {
    const { data: memberships } = await admin.from("business_members").select("business_id").eq("user_id", u.id);
    const other = (memberships ?? []).filter((m) => m.business_id !== businessId);
    out.push({ id: u.id, email: u.email, otherWorkspaces: other.length });
  }
  return out;
}

async function main() {
  const { data: business, error } = await admin
    .from("businesses")
    .select("id, name, slug, job_claims_paused")
    .eq("slug", SLUG)
    .maybeSingle();
  if (error) throw new Error(`lookup: ${error.message}`);
  if (!business) {
    console.log(`No workspace with slug ${SLUG}: nothing to tear down.`);
    const users = await demoUsers("00000000-0000-0000-0000-000000000000");
    console.log(`Demo auth users still present: ${users.length}`);
    if (CONFIRM) for (const u of users.filter((x) => x.otherWorkspaces === 0)) await admin.auth.admin.deleteUser(u.id);
    return;
  }
  if (business.name !== NAME || business.job_claims_paused !== true) {
    throw new Error(`Refusing: ${SLUG} is "${business.name}" with job_claims_paused=${business.job_claims_paused}; not the demo workspace.`);
  }
  const before = await remainingRows(business.id);
  const users = await demoUsers(business.id);
  console.log(`Demo workspace ${business.id} "${business.name}"`);
  console.log("Rows now:", JSON.stringify(before.nonZero));
  console.log("Demo auth users:", users.map((u) => `${u.email}${u.otherWorkspaces ? " (KEPT: in another workspace)" : ""}`).join(", ") || "none");

  if (!CONFIRM) {
    console.log("\nDRY RUN: nothing deleted. Re-run with --confirm to delete all of the above.");
    return;
  }

  // 1. Jobs and domain events, batched.
  const jobs = await deleteInBatches("jobs", business.id);
  const events = await deleteInBatches("domain_events", business.id, 200);
  console.log(`Deleted ${jobs} jobs, ${events} domain events.`);

  // 2. The business (cascades), retried.
  for (let attempt = 1; ; attempt += 1) {
    const { error: e } = await admin.from("businesses").delete().eq("id", business.id);
    if (!e) break;
    if (attempt >= 3) throw new Error(`business delete: ${e.message}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }

  // 3. Anything the cascade did not reach, in passes.
  let left = await remainingRows(business.id);
  for (let pass = 1; pass <= 4 && Object.keys(left.nonZero).length; pass += 1) {
    for (const table of Object.keys(left.nonZero)) {
      await admin.from(table).delete().eq("business_id", business.id);
    }
    left = await remainingRows(business.id);
  }

  // 4. Demo logins that belong to no other workspace.
  for (const u of users.filter((x) => x.otherWorkspaces === 0)) {
    const { error: e } = await admin.auth.admin.deleteUser(u.id);
    if (e) console.warn(`auth user ${u.email}: ${e.message}`);
  }
  const usersLeft = (await demoUsers(business.id)).filter((u) => u.otherWorkspaces === 0).length;

  console.log(`\nAfter: ${left.tablesChecked} tables checked, rows left: ${JSON.stringify(left.nonZero)}; demo auth users left: ${usersLeft}`);
  if (Object.keys(left.nonZero).length || usersLeft) process.exitCode = 1;
  else console.log("Zero rows left. The demo workspace is gone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
