import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  USAGE_METRICS,
  USAGE_FEATURES,
  isUsageMetric,
  unitFor,
  type UsageMetric,
} from "../src/lib/billing/usage-metrics.ts";

/**
 * The defect these tests exist to prevent.
 *
 * `usage_events.metric` was widened in the database twice (0018, 0038) and the
 * TypeScript union in `audit.ts` was not widened with it. Callers that needed
 * one of the newer metrics could not use the typed writer, so three of them
 * hand-rolled their own insert instead — and the ledger quietly acquired four
 * writers, only one of which validated anything.
 *
 * The list and the constraint are now checked against each other. Adding a
 * metric to one and not the other fails here rather than in production.
 */

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/0062_usage_ledger.sql", import.meta.url),
  "utf8",
);

/** The metrics named inside the `usage_events` CHECK constraint. */
function constraintMetrics(table: "usage_events" | "usage_counters"): Set<string> {
  const marker = `alter table public.${table} add constraint ${table}_metric_check`;
  const start = MIGRATION.indexOf(marker);
  assert.notEqual(start, -1, `no metric constraint found for ${table}`);

  const body = MIGRATION.slice(start, MIGRATION.indexOf("));", start));
  return new Set([...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
}

describe("the usage ledger vocabulary", () => {
  test("every metric the code can write is permitted by the database", () => {
    const allowed = constraintMetrics("usage_events");
    const missing = USAGE_METRICS.filter((metric) => !allowed.has(metric));
    assert.deepEqual(
      missing,
      [],
      `these metrics would be rejected by usage_events_metric_check: ${missing.join(", ")}`,
    );
  });

  test("the roll-up table accepts everything the ledger accepts", () => {
    // usage_counters is derived from usage_events, so a metric the ledger can
    // hold but the counter cannot is a row that silently stops aggregating.
    const events = constraintMetrics("usage_events");
    const counters = constraintMetrics("usage_counters");
    const missing = [...events].filter((metric) => !counters.has(metric));
    assert.deepEqual(missing, []);
  });

  test("the constraint names nothing the code cannot produce", () => {
    // The reverse drift: a metric in the database that no longer exists in the
    // code is a column in a usage report that will always read zero.
    const allowed = constraintMetrics("usage_events");
    const orphaned = [...allowed].filter((metric) => !isUsageMetric(metric));
    assert.deepEqual(orphaned, []);
  });

  test("every metric declares what one unit of it means", () => {
    for (const metric of USAGE_METRICS) {
      assert.ok(
        unitFor(metric),
        `${metric} has no unit, so a quantity of it cannot be read on an invoice`,
      );
    }
  });

  test("the metric list has no duplicates", () => {
    assert.equal(new Set(USAGE_METRICS).size, USAGE_METRICS.length);
  });

  test("token metrics are the ones the AI meter writes", () => {
    // The meter names these explicitly rather than by interpolation; if either
    // side is renamed, this is where it surfaces.
    for (const deployment of ["nano", "mini"] as const) {
      for (const kind of ["input", "cached", "output"] as const) {
        const metric = `ai_${deployment}_${kind}_token` as UsageMetric;
        assert.ok(isUsageMetric(metric), `${metric} is not a known metric`);
        assert.equal(unitFor(metric), "token");
      }
    }
  });
});

describe("usage attribution", () => {
  test("features are distinct and non-empty", () => {
    assert.equal(new Set(USAGE_FEATURES).size, USAGE_FEATURES.length);
    for (const feature of USAGE_FEATURES) assert.ok(feature.length > 0);
  });

  test("an unknown string is not mistaken for a metric", () => {
    assert.equal(isUsageMetric("definitely_not_a_metric"), false);
    assert.equal(isUsageMetric(""), false);
  });
});

describe("the ledger is append-only", () => {
  test("the migration refuses updates and deliberately permits deletes", () => {
    assert.match(MIGRATION, /create trigger usage_events_no_update\s+before update/);
    assert.doesNotMatch(MIGRATION, /create trigger \w+\s+before delete on public\.usage_events/);
  });

  test("an operation can only be charged once", () => {
    assert.match(
      MIGRATION,
      /create unique index if not exists usage_events_operation_idx[\s\S]*?on public\.usage_events \(business_id, operation_id\)/,
    );
  });
});
