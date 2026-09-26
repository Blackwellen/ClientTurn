import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  LEAD_INTENTS,
  MESSAGE_REPLY_CLASSIFICATIONS,
  POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS,
  REPLY_CLASSIFICATIONS,
  replyClassificationFor,
  toMessageReplyClassification,
} from "../src/lib/agent/types.ts";
import { AUTOMATION_EVENT_TYPES } from "../src/lib/automation/event-types.ts";

/**
 * Writes the database would reject.
 *
 * A CHECK constraint and a TypeScript union describing the same column drift
 * apart silently: the Supabase client returns the violation as `{ error }`
 * instead of throwing, so an unread error turns every write of the missing
 * value into a no-op nobody sees (B14, B15). These tests parse the constraint
 * out of the migrations — the latest definition wins — and hold the TS
 * vocabulary to it.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: readFileSync(path.join(MIGRATIONS, file), "utf8") }));

/** The quoted values of the first `in (...)` list at or after `from`. */
function inListAfter(sql: string, from: number): string[] {
  const open = sql.toLowerCase().indexOf("in (", from);
  assert.ok(open >= 0, "no IN list after anchor");
  const close = sql.indexOf(")", open);
  return [...sql.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * The allowed values of a CHECK constraint, from the most recent migration
 * that (re)adds it by name, or from the inline column check that created it.
 */
function checkValues(constraint: string, inlineAnchor?: RegExp): string[] {
  for (const migration of [...migrations].reverse()) {
    const named = migration.sql.toLowerCase().lastIndexOf(`add constraint ${constraint}`);
    if (named >= 0) return inListAfter(migration.sql, named);
  }
  if (inlineAnchor) {
    for (const migration of migrations) {
      const match = inlineAnchor.exec(migration.sql);
      if (match) return inListAfter(migration.sql, match.index);
    }
  }
  assert.fail(`constraint ${constraint} not found in any migration`);
}

describe("messages.reply_classification (B14)", () => {
  const allowed = new Set(checkValues("messages_reply_classification_check"));

  test("every agent classification maps to a value the CHECK allows", () => {
    for (const value of REPLY_CLASSIFICATIONS) {
      const mapped = toMessageReplyClassification(value);
      assert.ok(allowed.has(mapped), `${value} -> ${mapped} is rejected by the CHECK`);
    }
  });

  test("every lead intent ends in a storable classification", () => {
    for (const intent of LEAD_INTENTS) {
      const mapped = toMessageReplyClassification(replyClassificationFor(intent));
      assert.ok(allowed.has(mapped), `${intent} -> ${mapped} is rejected by the CHECK`);
    }
  });

  test("the TS canonical vocabulary is exactly the CHECK vocabulary", () => {
    assert.deepEqual([...MESSAGE_REPLY_CLASSIFICATIONS].sort(), [...allowed].sort());
  });

  test("agent values map to their canonical meaning, not a neighbour", () => {
    assert.equal(toMessageReplyClassification("POSITIVE"), "POSITIVE_INTEREST");
    assert.equal(toMessageReplyClassification("QUESTION"), "NEUTRAL_QUESTION");
    assert.equal(toMessageReplyClassification("WRONG_NUMBER"), "WRONG_PERSON");
    assert.equal(toMessageReplyClassification("BOOKING_INTENT"), "BOOKING_INTENT");
    // "Not interested" is a refusal; "not now" invites a later follow-up.
    assert.equal(toMessageReplyClassification("NOT_INTERESTED"), "NOT_INTERESTED");
  });

  test("booking intent counts as a positive reply", () => {
    assert.ok(POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS.includes("BOOKING_INTENT"));
    for (const value of POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS) {
      assert.ok(allowed.has(value), `${value} is not an allowed classification`);
    }
  });

  test("outreach_campaign_results counts the canonical positive set", () => {
    const latest = [...migrations]
      .reverse()
      .find((m) => /create or replace function public\.outreach_campaign_results/i.test(m.sql));
    assert.ok(latest, "outreach_campaign_results not found");
    const anchor = latest.sql.search(/m\.reply_classification in/i);
    assert.ok(anchor >= 0, `${latest.file} has no reply_classification filter`);
    assert.deepEqual(
      inListAfter(latest.sql, anchor).sort(),
      [...POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS].sort(),
    );
  });
});

describe("automation_events.event_type (B15)", () => {
  const allowed = new Set(
    checkValues(
      "automation_events_event_type_check",
      /event_type text not null\s+check \(event_type in/i,
    ),
  );

  test("every emitted event type is allowed by the CHECK", () => {
    const missing = AUTOMATION_EVENT_TYPES.filter((type) => !allowed.has(type));
    assert.deepEqual(missing, []);
  });

  test("automation.step_blocked is storable", () => {
    assert.ok(allowed.has("automation.step_blocked"));
  });
});
