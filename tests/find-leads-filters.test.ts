import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseProspectFilters,
  prospectFiltersToParams,
} from "../src/lib/prospects/filters.ts";
import { applyProspectFilters } from "../src/lib/prospects/filter-sql.ts";

/**
 * The run scope on the Prospects list.
 *
 * "Open prospects" on a sourcing run has to mean *that run's* prospects. It
 * previously passed `runId` in the URL that nothing read, so the link silently
 * showed every prospect in the workspace — a dead parameter that looked like a
 * working filter. These tests pin the whole path: parsed, serialised, applied.
 */

/** Records what the query builder was asked to do, without a database. */
function recorder() {
  const calls: { op: string; args: unknown[] }[] = [];
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  for (const op of ["eq", "in", "or", "gte", "lte", "ilike", "not", "is", "contains"]) {
    q[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return q;
    };
  }
  return { q, calls };
}

test("a run id in the URL is parsed", () => {
  const runId = "8f14e45f-ceea-467a-9d9a-1b0e1b5f3c21";
  const filters = parseProspectFilters({ view: "prospects", runId });
  assert.equal(filters.sourceRunId, runId);
});

test("a run id that is not a UUID is dropped, never passed through", () => {
  // The value reaches the query builder, so a junk string must not survive.
  for (const junk of ["../../etc", "1 OR 1=1", "not-a-uuid", ""]) {
    const filters = parseProspectFilters({ runId: junk });
    assert.equal(filters.sourceRunId, null, `expected ${junk} to be rejected`);
  }
});

test("the run scope is actually applied to the query", () => {
  const runId = "8f14e45f-ceea-467a-9d9a-1b0e1b5f3c21";
  const filters = parseProspectFilters({ view: "prospects", runId });
  const { q, calls } = recorder();

  applyProspectFilters(q, filters);

  const applied = calls.find(
    (call) => call.op === "eq" && call.args[0] === "source_run_id",
  );
  assert.ok(applied, "source_run_id was never constrained");
  assert.equal(applied.args[1], runId);
});

test("no run id means no run predicate at all", () => {
  const filters = parseProspectFilters({ view: "prospects" });
  const { q, calls } = recorder();

  applyProspectFilters(q, filters);

  assert.ok(
    !calls.some((call) => call.args[0] === "source_run_id"),
    "an absent run id must not narrow the list",
  );
});

test("the run scope survives a round trip, so paging keeps it", () => {
  const runId = "8f14e45f-ceea-467a-9d9a-1b0e1b5f3c21";
  const filters = parseProspectFilters({ view: "prospects", runId, quick: "review" });
  const params = prospectFiltersToParams(filters);

  assert.equal(params.get("runId"), runId);

  // Re-parsing the serialised form must produce the same scope: this is what a
  // sort or page link does.
  const round = parseProspectFilters(Object.fromEntries(params));
  assert.equal(round.sourceRunId, runId);
  assert.equal(round.quick, "review");
});
