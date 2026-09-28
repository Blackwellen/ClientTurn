import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFakeDb, installFakeFetch, table, type FakeDb } from "./fixtures/fake-postgrest.ts";

/**
 * A platform admin's LinkedIn Assist hold (0175), through the real server
 * code (scripts/e2e-resolver.mjs) against the in-memory PostgREST: the hold
 * pauses the person's list whatever they chose, keeps their own switch apart,
 * and lifts cleanly. No AI, no provider, no network.
 */

function primeEnv() {
  const source = readFileSync(path.join(process.cwd(), "src/lib/env.ts"), "utf8");
  for (const [, name] of source.matchAll(/required\("([A-Z0-9_]+)"\)/g)) {
    if (!process.env[name]) process.env[name] = name.includes("STRIPE_SECRET") ? "sk_test_placeholder" : "placeholder";
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
}

const BIZ = "cccccccc-0000-4000-8000-000000000001";
const USER = "cccccccc-0000-4000-8000-000000000002";

const db: FakeDb = createFakeDb();
let restore: () => void;
let store: typeof import("../src/lib/linkedin-assist/store.ts");

before(async () => {
  primeEnv();
  restore = installFakeFetch(db);
  store = await import("../src/lib/linkedin-assist/store.ts");
});
after(() => restore?.());

beforeEach(() => {
  db.tables.clear();
  table(db, "linkedin_assist_settings").push({
    business_id: BIZ,
    user_id: USER,
    account_tier: "FREE",
    daily_connection_notes: 10,
    weekly_connection_requests: 60,
    daily_messages: 20,
    monthly_inmail_credits: 0,
    follow_up_after_days: 4,
    max_follow_ups: 2,
    paused: false,
  });
});

describe("LinkedIn Assist workspace hold", () => {
  test("no hold: the person's own settings", async () => {
    const result = await store.loadSettings(BIZ, USER);
    assert.equal(result.settings.paused, false);
    assert.equal(result.personPaused, false);
    assert.equal(result.workspaceHold, null);
    assert.equal(result.settings.dailyMessages, 20);
  });

  test("a hold pauses the list without touching the person's own switch", async () => {
    table(db, "linkedin_assist_workspace_holds").push({ business_id: BIZ, reason: "Complaint from a recipient", held_at: "2026-09-28T10:00:00Z" });
    const result = await store.loadSettings(BIZ, USER);
    assert.equal(result.settings.paused, true);
    assert.equal(result.personPaused, false);
    assert.deepEqual(result.workspaceHold, { reason: "Complaint from a recipient", heldAt: "2026-09-28T10:00:00Z" });
    // Nothing was written to the person's row.
    assert.equal(table(db, "linkedin_assist_settings")[0].paused, false);
  });

  test("a hold on another workspace does not leak", async () => {
    table(db, "linkedin_assist_workspace_holds").push({ business_id: "cccccccc-0000-4000-8000-000000000009", reason: "Other", held_at: "2026-09-28T10:00:00Z" });
    assert.equal(await store.loadWorkspaceHold(BIZ), null);
    assert.equal((await store.loadSettings(BIZ, USER)).settings.paused, false);
  });
});
