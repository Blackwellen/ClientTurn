import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseProspectFilters,
  prospectFiltersToParams,
} from "../src/lib/prospects/filters.ts";
import { applyCountDefinition, applyProspectFilters } from "../src/lib/prospects/filter-sql.ts";
import {
  matchesProspectCount,
  PROSPECT_COUNT_KEYS,
  QUICK_FILTER_COUNT_KEY,
  type ProspectCountFacts,
} from "../src/lib/prospects/prospect-counts.ts";

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
  for (const op of ["eq", "neq", "in", "or", "gte", "lte", "ilike", "not", "is", "contains"]) {
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

  applyProspectFilters(q, filters, { liveCampaignIds: [] });

  const applied = calls.find(
    (call) => call.op === "eq" && call.args[0] === "source_run_id",
  );
  assert.ok(applied, "source_run_id was never constrained");
  assert.equal(applied.args[1], runId);
});

test("no run id means no run predicate at all", () => {
  const filters = parseProspectFilters({ view: "prospects" });
  const { q, calls } = recorder();

  applyProspectFilters(q, filters, { liveCampaignIds: [] });

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

/* ----------------------------------------------- one definition per count */

/**
 * Evaluates recorded PostgREST calls against one row, the way the database
 * would. Enough of PostgREST for the operators the count definitions use.
 */
function rowPasses(calls: { op: string; args: unknown[] }[], row: Record<string, unknown>): boolean {
  const atom = (text: string): boolean => {
    const [column, ...rest] = text.split(".");
    const op = rest.join(".");
    const value = row[column];
    if (op === "is.null") return value === null || value === undefined;
    if (op === "not.is.null") return value !== null && value !== undefined;
    if (op.startsWith("eq.")) return value === op.slice(3);
    if (op.startsWith("neq.")) return value !== null && value !== undefined && value !== op.slice(4);
    if (op.startsWith("not.in.(")) {
      const values = op.slice(8, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      return value !== null && value !== undefined && !values.includes(String(value));
    }
    if (op.startsWith("in.(")) {
      const values = op.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      return value !== null && value !== undefined && values.includes(String(value));
    }
    throw new Error(`unsupported atom ${text}`);
  };
  return calls.every(({ op, args }) => {
    const [column, a, b] = args as [string, unknown, unknown];
    const value = row[column];
    switch (op) {
      case "eq":
        return value === a;
      case "neq":
        return value !== null && value !== undefined && value !== a;
      case "in":
        return value !== null && value !== undefined && (a as unknown[]).includes(value);
      case "is":
        return value === null || value === undefined;
      case "not":
        assert.equal(a, "is");
        assert.equal(b, null);
        return value !== null && value !== undefined;
      case "or":
        // Split on top-level commas only: an `in.(...)` list has its own.
        return String(column).split(/,(?![^(]*\))/).some(atom);
      default:
        throw new Error(`unsupported op ${op}`);
    }
  });
}

const COUNT_ROWS: ProspectCountFacts[] = [
  { status: "READY", grade: "A", verification_status: "VALID", outreach_eligibility: "ELIGIBLE", email: "a@x.example", campaign_id: null, last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
  { status: "APPROVED", grade: "B", verification_status: "UNKNOWN", outreach_eligibility: "ELIGIBLE", email: "b@x.example", campaign_id: "c1", campaign_status: "ACTIVE", last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
  { status: "READY", grade: "C", verification_status: "INVALID", outreach_eligibility: "ELIGIBLE", email: "c@x.example", campaign_id: null, last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
  { status: "READY", grade: "B", verification_status: "VALID", outreach_eligibility: "REVIEW", email: null, campaign_id: null, last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
  { status: "OUTREACH_ACTIVE", grade: "A+", verification_status: "VALID", outreach_eligibility: "ELIGIBLE", email: "d@x.example", campaign_id: "c1", campaign_status: "ACTIVE", last_contacted_at: "2026-09-20T00:00:00Z", replied_at: "2026-09-21T00:00:00Z", promoted_to_lead_id: null },
  { status: "BOUNCED", grade: "B", verification_status: "VALID", outreach_eligibility: "SUPPRESSED", email: "e@x.example", campaign_id: "c1", campaign_status: "ACTIVE", last_contacted_at: "2026-09-10T00:00:00Z", replied_at: null, promoted_to_lead_id: null },
  { status: "REVIEW", grade: null, verification_status: "UNKNOWN", outreach_eligibility: "REVIEW", email: "f@x.example", campaign_id: null, last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
  // Enrolled in a campaign that finished, never sent to: ready again.
  { status: "APPROVED", grade: "B", verification_status: "VALID", outreach_eligibility: "ELIGIBLE", email: "g@x.example", campaign_id: "c2", campaign_status: "COMPLETED", last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
  // A paused campaign is still live: not ready.
  { status: "APPROVED", grade: "B", verification_status: "VALID", outreach_eligibility: "ELIGIBLE", email: "h@x.example", campaign_id: "c3", campaign_status: "PAUSED", last_contacted_at: null, replied_at: null, promoted_to_lead_id: null },
];

/** The live ids the server would resolve for COUNT_ROWS (c1 ACTIVE, c3 PAUSED). */
const COUNT_CONTEXT = { liveCampaignIds: ["c1", "c3"] };

test("each count's PostgREST predicates select exactly what its JS definition selects", () => {
  for (const key of PROSPECT_COUNT_KEYS) {
    if (key === "intent" || key === "converted" || key === "found") continue; // join / scope only
    const { q, calls } = recorder();
    applyCountDefinition(q, key, COUNT_CONTEXT);
    for (const row of COUNT_ROWS) {
      assert.equal(
        rowPasses(calls, row as unknown as Record<string, unknown>),
        matchesProspectCount(key, row),
        `${key} disagrees on ${row.status}/${row.outreach_eligibility}`,
      );
    }
  }
});

test("a quick-filter chip lists the same prospects its count counts", () => {
  for (const [quick, countKey] of Object.entries(QUICK_FILTER_COUNT_KEY)) {
    if (quick === "all" || quick === "intent") continue;
    const list = recorder();
    applyProspectFilters(list.q, parseProspectFilters({ view: "prospects", quick }), COUNT_CONTEXT);
    const count = recorder();
    applyCountDefinition(count.q, countKey, COUNT_CONTEXT);
    assert.deepEqual(list.calls, count.calls, `chip ${quick} filters differently from its count`);
  }
});

test("the Contacted chip no longer means approved", () => {
  const { q, calls } = recorder();
  applyProspectFilters(q, parseProspectFilters({ view: "prospects", quick: "contacted" }), COUNT_CONTEXT);
  assert.ok(!calls.some((call) => JSON.stringify(call.args).includes("APPROVED")));
  assert.ok(calls.some((call) => call.op === "not" && call.args[0] === "last_contacted_at"));
});

test("with no live campaign, ready applies no campaign predicate and in-campaign matches nothing", () => {
  const ready = recorder();
  applyCountDefinition(ready.q, "ready", { liveCampaignIds: [] });
  assert.ok(!ready.calls.some((call) => JSON.stringify(call.args).includes("campaign_id")));
  const enrolled = recorder();
  applyCountDefinition(enrolled.q, "inCampaign", { liveCampaignIds: [] });
  const finished = { status: "APPROVED", grade: "B", verification_status: "VALID", outreach_eligibility: "ELIGIBLE", email: "g@x.example", campaign_id: "c2", campaign_status: "COMPLETED", last_contacted_at: null, replied_at: null, promoted_to_lead_id: null };
  assert.equal(rowPasses(enrolled.calls, finished), false);
  assert.equal(matchesProspectCount("inCampaign", finished), false);
});
