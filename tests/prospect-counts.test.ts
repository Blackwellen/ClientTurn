import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  inLiveCampaign,
  LIVE_CAMPAIGN_STATUSES,
  matchesProspectCount,
  PROSPECT_COUNT_DEFINITIONS,
  PROSPECT_COUNT_KEYS,
  PROSPECT_KPI_KEYS,
  prospectKpisFrom,
  QUICK_FILTER_COUNT_KEY,
  quickCountsFrom,
  tallyProspectCounts,
  type ProspectCountFacts,
} from "../src/lib/prospects/prospect-counts.ts";

/**
 * One definition per prospect count (owner decision, 2026-09-30).
 *
 * The chips once said "Ready 3" above a KPI saying "Ready for outreach 0", and
 * "Contacted" counted APPROVED prospects nobody had written to. These tests pin
 * that the chips and the KPIs are two views of one tally, and that each
 * definition means what its tooltip says.
 */

function prospect(overrides: Partial<ProspectCountFacts> = {}): ProspectCountFacts {
  return {
    status: "READY",
    grade: "B",
    verification_status: "VALID",
    outreach_eligibility: "ELIGIBLE",
    email: "jo@acme.example",
    campaign_id: null,
    last_contacted_at: null,
    replied_at: null,
    promoted_to_lead_id: null,
    is_test: false,
    hasLiveIntent: false,
    ...overrides,
  };
}

/** A workspace in which the old chip and KPI definitions disagreed. */
const FIXTURE: ProspectCountFacts[] = [
  // Genuinely ready.
  prospect({ grade: "A" }),
  prospect({ status: "APPROVED", verification_status: "UNKNOWN" }),
  // Approved, never sent to: the old "Contacted" chip counted this one.
  prospect({ status: "APPROVED", campaign_id: "c1", campaign_status: "ACTIVE" }),
  // READY but no email / failed verification / not eligible: the old chip
  // counted these as ready; nothing could be sent to them.
  prospect({ email: null }),
  prospect({ verification_status: "INVALID" }),
  prospect({ outreach_eligibility: "REVIEW", hasLiveIntent: true }),
  prospect({ outreach_eligibility: "SUPPRESSED" }),
  // Sent to, then replied.
  prospect({
    status: "OUTREACH_ACTIVE",
    campaign_id: "c1",
    campaign_status: "ACTIVE",
    last_contacted_at: "2026-09-20T09:00:00Z",
    grade: "A+",
  }),
  prospect({
    status: "REPLIED",
    campaign_id: "c1",
    campaign_status: "ACTIVE",
    last_contacted_at: "2026-09-18T09:00:00Z",
    replied_at: "2026-09-19T09:00:00Z",
    hasLiveIntent: true,
  }),
  prospect({ status: "BOUNCED", outreach_eligibility: "SUPPRESSED", last_contacted_at: "2026-09-10T09:00:00Z" }),
  prospect({ status: "REVIEW", outreach_eligibility: "REVIEW" }),
  // Out of the inbox scope.
  prospect({ promoted_to_lead_id: "lead-1", last_contacted_at: "2026-09-01T09:00:00Z" }),
  prospect({ is_test: true }),
];

describe("prospect count definitions", () => {
  const counts = tallyProspectCounts(FIXTURE);

  test("the fixture tallies to the documented definitions", () => {
    assert.deepEqual(counts, {
      found: 11,
      aGrade: 2,
      intent: 2,
      verified: 9,
      ready: 2,
      inCampaign: 3,
      contacted: 3,
      replied: 1,
      review: 2,
      suppressed: 2,
      converted: 1,
    });
  });

  test("the chips and the KPI strip agree on every count they share", () => {
    const chips = quickCountsFrom(counts);
    const kpis = prospectKpisFrom(counts);

    const chipByCountKey = new Map<string, number>();
    for (const [chip, countKey] of Object.entries(QUICK_FILTER_COUNT_KEY)) {
      const value =
        chip === "all"
          ? chips.all
          : chip === "a-grade"
            ? chips.aGrade
            : chips[chip as "intent" | "ready" | "contacted" | "replied" | "review"];
      chipByCountKey.set(countKey, value);
    }

    let shared = 0;
    for (const { key, countKey } of PROSPECT_KPI_KEYS) {
      const kpi = kpis.find((item) => item.key === key);
      assert.ok(kpi, `KPI ${key} is missing`);
      assert.equal(kpi.value, counts[countKey]);
      if (chipByCountKey.has(countKey)) {
        shared += 1;
        assert.equal(
          chipByCountKey.get(countKey),
          kpi.value,
          `chip and KPI disagree on ${countKey}`,
        );
      }
    }
    // "All" = "Prospects found" and "Ready" = "Ready for outreach" at least.
    assert.ok(shared >= 2);
    assert.equal(chips.ready, kpis.find((item) => item.key === "ready")?.value);
    assert.equal(chips.all, kpis.find((item) => item.key === "found")?.value);
  });

  test("each KPI carries its definition for the tooltip", () => {
    for (const kpi of prospectKpisFrom(counts)) {
      assert.ok(kpi.definition.length > 10, `${kpi.key} has no definition`);
    }
  });

  test("approval alone is not contact", () => {
    const approved = prospect({ status: "APPROVED" });
    assert.equal(matchesProspectCount("contacted", approved), false);
    assert.equal(
      matchesProspectCount("contacted", { ...approved, status: "OUTREACH_ACTIVE", last_contacted_at: "2026-09-01T00:00:00Z" }),
      true,
    );
  });

  test("ready means sendable: email, not failed, eligible, not suppressed, not in a sequence", () => {
    assert.equal(matchesProspectCount("ready", prospect()), true);
    assert.equal(matchesProspectCount("ready", prospect({ email: null })), false);
    assert.equal(matchesProspectCount("ready", prospect({ verification_status: "INVALID" })), false);
    // SQL `<>` is never true for NULL, and the JS twin must not pretend otherwise.
    assert.equal(matchesProspectCount("ready", prospect({ verification_status: null })), false);
    assert.equal(matchesProspectCount("ready", prospect({ outreach_eligibility: "SUPPRESSED" })), false);
    assert.equal(matchesProspectCount("ready", prospect({ outreach_eligibility: "CONSENT_REQUIRED" })), false);
    assert.equal(matchesProspectCount("ready", prospect({ campaign_id: "c1", campaign_status: "ACTIVE" })), false);
    assert.equal(matchesProspectCount("ready", prospect({ last_contacted_at: "2026-09-01T00:00:00Z" })), false);
    assert.equal(matchesProspectCount("ready", prospect({ status: "DISCOVERED" })), false);
  });

  test("ready means not in a LIVE campaign: a finished, stopped or draft campaign frees the prospect", () => {
    for (const status of ["ACTIVE", "OPTIMIZING", "PAUSED"]) {
      const row = prospect({ campaign_id: "c9", campaign_status: status });
      assert.equal(matchesProspectCount("ready", row), false, status);
      assert.equal(matchesProspectCount("inCampaign", row), true, status);
    }
    for (const status of ["COMPLETED", "STOPPED", "DRAFT", "READY"]) {
      const row = prospect({ campaign_id: "c9", campaign_status: status });
      assert.equal(matchesProspectCount("ready", row), true, status);
      assert.equal(matchesProspectCount("inCampaign", row), false, status);
    }
    // Contacted during the finished campaign: still not ready.
    assert.equal(
      matchesProspectCount("ready", prospect({ campaign_id: "c9", campaign_status: "COMPLETED", last_contacted_at: "2026-09-01T00:00:00Z" })),
      false,
    );
    // A campaign whose status is unknown is not treated as live.
    assert.equal(inLiveCampaign({ campaign_id: "c9", campaign_status: null }), false);
    assert.deepEqual([...LIVE_CAMPAIGN_STATUSES], ["ACTIVE", "OPTIMIZING", "PAUSED"]);
  });

  test("ready is disjoint from in-campaign and contacted", () => {
    for (const row of FIXTURE) {
      if (matchesProspectCount("ready", row)) {
        assert.equal(matchesProspectCount("inCampaign", row), false);
        assert.equal(matchesProspectCount("contacted", row), false);
      }
    }
  });

  test("replied counts a reply timestamp even after the status moved on", () => {
    assert.equal(
      matchesProspectCount("replied", prospect({ status: "OUTREACH_ACTIVE", replied_at: "2026-09-01T00:00:00Z" })),
      true,
    );
  });

  test("promoted and test prospects are outside every inbox count", () => {
    const promoted = prospect({ promoted_to_lead_id: "l1" });
    for (const key of PROSPECT_COUNT_KEYS) {
      const expected = key === "converted";
      assert.equal(matchesProspectCount(key, promoted), expected, key);
      assert.equal(matchesProspectCount(key, prospect({ is_test: true, promoted_to_lead_id: "l1" })), false, key);
    }
  });

  test("every definition has a label and a tooltip sentence", () => {
    for (const key of PROSPECT_COUNT_KEYS) {
      const definition = PROSPECT_COUNT_DEFINITIONS[key];
      assert.ok(definition.label.length > 0);
      assert.match(definition.definition, /\.$/);
    }
  });
});
