import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Backend QA 2026-09-28 (scripts/rls-live-check.mjs against live): a column
 * grant does not narrow a table-level grant. `authenticated` held table-level
 * UPDATE on `profiles` (so `platform_role` was self-writable: any user could
 * make themselves a platform admin) and on `businesses` (an owner could lift
 * a platform suspension). Migration 0178 narrows both and adds guard
 * triggers. These assertions keep a later migration from quietly undoing it;
 * `node scripts/rls-live-check.mjs` checks the live database itself.
 */

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
const m0178 = sql(files.find((f) => f.startsWith("0178_"))!);

describe("0178 privileged column grants", () => {
  test("profiles: table-level UPDATE revoked, only the four profile fields granted", () => {
    assert.match(m0178, /revoke update on public\.profiles from authenticated;/);
    assert.match(m0178, /grant update \(first_name, last_name, phone, avatar_url\) on public\.profiles to authenticated;/);
    assert.match(m0178, /before update on public\.profiles[\s\S]*guard_profile_privileged_columns/);
  });

  test("businesses: status, deletion and the job pause are not browser-writable", () => {
    assert.match(m0178, /revoke update on public\.businesses from authenticated;/);
    const grant = /grant update \(([^)]*)\) on public\.businesses to authenticated;/.exec(m0178)?.[1] ?? "";
    for (const col of ["status", "deleted_at", "job_claims_paused", "activated_at", "created_by"]) {
      assert.ok(!grant.split(/\s*,\s*/).includes(col), `${col} must not be granted`);
    }
    assert.match(m0178, /new\.status is distinct from old\.status/);
  });

  test("no later migration grants table-level UPDATE on profiles or businesses back", () => {
    for (const f of files.filter((x) => x > "0178")) {
      assert.doesNotMatch(sql(f), /grant\s+(all|update)\s+on\s+(table\s+)?public\.(profiles|businesses)\s+to\s+authenticated/i, f);
    }
  });

  test("the latest voice anonymise function also removes an inbound caller's number", () => {
    const latest = files.filter((f) => /function public\.voice_clear_on_anonymise/.test(sql(f))).at(-1)!;
    assert.match(sql(latest), /set from_e164 = null[\s\S]*direction = 'INBOUND'/);
  });
});
