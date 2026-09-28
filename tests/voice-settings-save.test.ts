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

/**
 * A person pressing "Call with AI" on a lead they are handling themselves
 * (human_takeover = true, e.g. a lead they added by hand) was deferred 30
 * minutes, and re-deferred at every dial: the call never rang (owner test
 * call, 2026-09-28). The takeover hold now applies only to calls a person
 * did not ask for.
 */
const runtime = readFileSync("src/lib/voice/runtime-core.ts", "utf8");
const handler = readFileSync("src/lib/jobs/handlers/voice.ts", "utf8");

test("a person's own Call with AI is not held by their own takeover", () => {
  assert.match(runtime, /humanTakeover: Boolean\(ctx\.lead\?\.human_takeover\) && !personRequested/);
  assert.match(runtime, /const personRequested = input\.entryPoint === "OUTBOUND_DIAL" && Boolean\(input\.requestedBy\) && !input\.attemptNumber/);
});

test("the flag rides the dial job and survives every deferral", () => {
  assert.match(runtime, /enqueue\("voice\.dial", \{ callId: row\.id, \.\.\.\(personRequested \? \{ personRequested: true \} : \{\}\) \}/);
  const deferrals = runtime.match(/return deferCall\(deps, call,[^\n]*\);/g) ?? [];
  assert.ok(deferrals.length >= 4, `${deferrals.length} deferrals`);
  for (const d of deferrals) assert.match(d, /personRequested\);$/, d);
  assert.match(handler, /dialCall\(serverVoiceDeps\(\), callId, \{ personRequested \}\)/);
});

test("the identity-before-enable constraint still exists in the schema", () => {
  const migration = readFileSync("supabase/migrations/0150_voice_core.sql", "utf8");
  assert.match(migration, /voice_settings_identity_before_enable/);
});
