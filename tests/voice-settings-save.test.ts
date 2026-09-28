/**
 * Switching voice on after the identity is saved (owner test call, 2026-09-28).
 *
 * `voice.settings_update` used to upsert a partial row. Postgres checks CHECK
 * constraints on the proposed insert row before it resolves the conflict, so
 * `{ voice_enabled: true }` alone failed voice_settings_identity_before_enable
 * ("Complete your calling identity...") even with the identity already saved.
 * The operation must update an existing row and insert only the first time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/services/operations/voice.ts", "utf8");
const update = source.slice(
  source.indexOf('defineOperation("voice.settings_update"'),
  source.indexOf("if (args.voiceProfile)"),
);

test("settings_update updates an existing row instead of upserting a partial one", () => {
  assert.ok(update.length > 0, "voice.settings_update not found");
  assert.doesNotMatch(update, /from\("voice_settings"\)\.upsert\(/);
  assert.match(update, /before\s*\?\s*await db\(\)\.from\("voice_settings"\)\.update\(changes\)\.eq\("business_id", context\.businessId\)/);
  assert.match(update, /: await db\(\)\.from\("voice_settings"\)\.insert\(patch\)/);
});

test("the identity-before-enable constraint still exists in the schema", () => {
  const migration = readFileSync("supabase/migrations/0150_voice_core.sql", "utf8");
  assert.match(migration, /voice_settings_identity_before_enable/);
});
