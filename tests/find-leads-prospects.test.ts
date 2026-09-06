import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  PROSPECT_SORTS,
  activeFilterCount,
  parseProspectFilters,
  prospectFiltersToParams,
} from "../src/lib/prospects/filters.ts";
import {
  applyProspectFilters,
  needsCompanyJoin,
} from "../src/lib/prospects/filter-sql.ts";
import {
  prospectActivityLabel,
  shortAgo,
} from "../src/lib/prospects/activity.ts";
import {
  GRADE_BANDS,
  confidenceBand,
  evidenceSources,
  factorCeiling,
  gradeHeadline,
  positiveFactors,
  scoreConcerns,
} from "../src/lib/prospects/scoring-explain.ts";
import {
  DEFAULT_WEIGHTS,
  gradeForScore,
  scoreProspect,
} from "../src/lib/prospects/scoring.ts";
import type { ProspectScore } from "../src/lib/prospects/types.ts";
import {
  complianceSummary,
  formatMoneyMinor,
  isSpendingStatus,
  priorityFor,
  priorityLabel,
  type CampaignRow,
} from "../src/lib/outreach/types.ts";
import {
  DAILY_CADENCE_MIN_MONITOR_ALLOWANCE,
  MAX_SCORE_IMPACT,
  SCORE_IMPACT_OPTIONS,
  cadenceAvailable,
  cadenceUnavailableReason,
  clampScoreImpact,
} from "../src/lib/intent/types.ts";

/**
 * The Prospects inbox, its explainable score and the campaign list.
 *
 * The through-line of these tests: a customer must be able to reproduce every
 * number the surface shows. Filters must reach the database rather than being
 * quietly dropped, the score breakdown must add up to the headline, and nothing
 * may present a trend, a confidence or a budget figure it cannot support.
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

/* ------------------------------------------------------------------ filters */

test("the default page size matches the ten rows the table is designed for", () => {
  const filters = parseProspectFilters({});
  assert.equal(filters.pageSize, 10);
  assert.equal(DEFAULT_PAGE_SIZE, 10);
  assert.ok(PAGE_SIZES.includes(DEFAULT_PAGE_SIZE));
});

test("relevance is the default sort, and every sort round-trips through the URL", () => {
  assert.equal(parseProspectFilters({}).sort, "relevance");

  for (const sort of PROSPECT_SORTS) {
    const parsed = parseProspectFilters({ sort });
    assert.equal(parsed.sort, sort, `${sort} should parse`);

    const params = prospectFiltersToParams(parsed);
    // The default is dropped so shared links stay short; everything else is kept.
    assert.equal(params.get("sort"), sort === "relevance" ? null : sort);
  }
});

test("an unknown sort falls back rather than reaching the query builder", () => {
  assert.equal(parseProspectFilters({ sort: "score); drop table" }).sort, "relevance");
});

test("the new company filters round-trip and are counted as active", () => {
  const filters = parseProspectFilters({
    view: "prospects",
    industry: "Property Management,Facilities",
    size_band: "50-200",
    location: "Bournemouth,Poole",
  });

  assert.deepEqual(filters.industries, ["Property Management", "Facilities"]);
  assert.deepEqual(filters.companySizes, ["50-200"]);
  assert.deepEqual(filters.locations, ["Bournemouth", "Poole"]);

  // Five values across three dimensions — each one is a filter the customer
  // can see is on.
  assert.equal(activeFilterCount(filters), 5);

  const params = prospectFiltersToParams(filters);
  assert.equal(params.get("size_band"), "50-200");
  assert.equal(params.get("industry"), "Property Management,Facilities");
});

test("company-scoped filters demand an inner join, or they would silently do nothing", () => {
  // With a plain embed PostgREST filters the embedded rows and leaves every
  // parent in place. This flag is what stops a filter looking applied while
  // returning the unfiltered set.
  assert.equal(needsCompanyJoin(parseProspectFilters({ industry: "Roofing" })), true);
  assert.equal(needsCompanyJoin(parseProspectFilters({ size_band: "1-10" })), true);
  assert.equal(needsCompanyJoin(parseProspectFilters({ location: "Poole" })), true);
  assert.equal(needsCompanyJoin(parseProspectFilters({ grade: "A" })), false);
});

test("company filters are applied against the embedded company, not the prospect", () => {
  const { q, calls } = recorder();
  applyProspectFilters(
    q,
    parseProspectFilters({ industry: "Roofing", size_band: "50-200", location: "Poole" }),
  );

  const columns = calls.filter((call) => call.op === "in").map((call) => call.args[0]);
  assert.ok(columns.includes("prospect_companies.industry"));
  assert.ok(columns.includes("prospect_companies.company_size"));
  assert.ok(columns.includes("prospect_companies.location_json->>city"));
});

test("a search term cannot inject additional PostgREST predicates", () => {
  const { q, calls } = recorder();
  applyProspectFilters(q, parseProspectFilters({ q: "acme,status.eq.APPROVED" }));

  const or = calls.find((call) => call.op === "or");
  assert.ok(or, "search should reach the builder");

  // The separator is what matters. PostgREST splits an `or` on commas, so the
  // term must contribute none: the injected text may survive as *content*
  // inside an ilike pattern, but it cannot become a predicate of its own.
  const clauses = String(or.args[0]).split(",");
  assert.equal(clauses.length, 4, "exactly the four search columns, and no more");
  for (const clause of clauses) {
    assert.match(
      clause,
      /^(first_name|last_name|email|role_title)\.ilike\./,
      `${clause} is not one of the intended search predicates`,
    );
  }
});

/* ----------------------------------------------------------------- activity */

test("last activity reads as an event, not a bare timestamp", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const yesterday = new Date(now.getTime() - 26 * 3600_000).toISOString();

  assert.equal(shortAgo(twoHoursAgo, now), "2h ago");
  assert.equal(shortAgo(yesterday, now), "yesterday");

  assert.equal(
    prospectActivityLabel({ kind: "EMAIL_SENT", at: yesterday }, null).startsWith("Email sent"),
    true,
  );
  assert.equal(
    prospectActivityLabel({ kind: "REPLY_RECEIVED", at: twoHoursAgo }, null).startsWith("Replied"),
    true,
  );
});

test("a prospect with no recorded activity falls back to when it was sourced", () => {
  const created = new Date(Date.now() - 3 * 3600_000).toISOString();
  assert.ok(prospectActivityLabel(null, created).startsWith("Sourced"));
  assert.equal(prospectActivityLabel(null, null), "—");
});

/* ------------------------------------------------------- explainable score */

/** A stored score, shaped exactly as the drawer and scoring page receive it. */
function storedScore(overrides: Partial<ProspectScore> = {}): ProspectScore {
  const result = scoreProspect([
    {
      factor: "ICP_FIT",
      value: 0.92,
      confidence: 1,
      evidenceSummary: "Property management is a core target industry.",
      evidenceSource: "Company website",
      evidenceUrl: "https://example.co.uk",
      observedAt: "2026-09-01T00:00:00Z",
    },
    {
      factor: "ROLE_AUTHORITY",
      value: 0.85,
      confidence: 1,
      evidenceSummary: "Property Manager with maintenance authority.",
      evidenceSource: "LinkedIn profile",
    },
    { factor: "GEOGRAPHY", value: 1, confidence: 1, evidenceSource: "Company website" },
    { factor: "NEED", value: 0.78, confidence: 1 },
    { factor: "INTENT", value: 0.7, confidence: 0.6, evidenceSource: "Company news" },
    { factor: "DATA_QUALITY", value: 0.8, confidence: 0.4, evidenceSource: "Company website" },
  ]);

  return {
    id: "score-1",
    scoreVersion: result.scoreVersion,
    totalScore: result.totalScore,
    grade: result.grade,
    explanation: result.explanation,
    createdAt: "2026-09-05T00:00:00Z",
    factors: result.factors.map((factor) => ({
      factor: factor.factor,
      weight: factor.weight,
      rawValue: factor.rawValue,
      contribution: factor.contribution,
      direction: factor.direction,
      evidenceSummary: factor.evidenceSummary,
      evidenceSource: factor.evidenceSource,
      evidenceUrl: factor.evidenceUrl,
      observedAt: factor.observedAt,
      confidence: factor.confidence,
    })),
    ...overrides,
  };
}

test("the breakdown adds up to the headline score", () => {
  // This is the whole promise of §14.3: a customer can add the panel up and
  // get the number back. If this drifts, the page is lying.
  const score = storedScore();
  const summed = score.factors.reduce((total, factor) => total + factor.contribution, 0);
  assert.ok(
    Math.abs(summed - score.totalScore) < 0.05,
    `factors summed to ${summed}, headline is ${score.totalScore}`,
  );
});

test("each factor's ceiling is its weight in points, and the six weights make 100", () => {
  const score = storedScore();
  const ceilings = score.factors.reduce((total, factor) => total + factorCeiling(factor), 0);
  assert.ok(Math.abs(ceilings - 100) < 0.001);

  const declared = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(declared - 1) < 0.001);
});

test("no factor can contribute more than its own weight allows", () => {
  const score = storedScore();
  for (const factor of score.factors) {
    assert.ok(
      factor.contribution <= factorCeiling(factor) + 0.001,
      `${factor.factor} contributed ${factor.contribution} against a ceiling of ${factorCeiling(factor)}`,
    );
  }
});

test("positive factors are ranked by points earned, not by raw value", () => {
  const score = storedScore();
  const positives = positiveFactors(score);

  assert.ok(positives.length > 0);
  for (let i = 1; i < positives.length; i++) {
    assert.ok(positives[i - 1].points >= positives[i].points);
  }
  // Geography scored a perfect 100 but is only worth 15 points, so it must not
  // outrank ICP fit, which scored 92 of a 30-point factor.
  assert.equal(positives[0].factor, "ICP_FIT");
});

test("concerns are shortfalls against a factor's own weight, never invented penalties", () => {
  const score = storedScore();
  const concerns = scoreConcerns(score);

  for (const concern of concerns) {
    assert.ok(concern.points < 0, "a concern is expressed as points not earned");
    const factor = score.factors.find((f) => f.factor === concern.factor)!;
    assert.ok(
      Math.abs(concern.points) <= factorCeiling(factor) + 1,
      "a shortfall can never exceed what the factor was worth",
    );
  }
});

test("a factor at full marks with full confidence raises no concern", () => {
  const score = storedScore();
  const geography = score.factors.find((f) => f.factor === "GEOGRAPHY")!;
  assert.equal(geography.rawValue, 1);
  assert.ok(!scoreConcerns(score, 6).some((c) => c.factor === "GEOGRAPHY"));
});

test("confidence is banded from the stored value, never asserted", () => {
  assert.equal(confidenceBand(0.95), "HIGH");
  assert.equal(confidenceBand(0.6), "MEDIUM");
  assert.equal(confidenceBand(0.2), "LOW");

  // A source's band is the *lowest* of the facts it supplied: one shaky fact is
  // a reason to trust the source less, not something to average away.
  const score = storedScore();
  const website = evidenceSources(score).find((s) => s.source === "Company website");
  assert.ok(website);
  assert.equal(website.band, "LOW", "data quality came from the website at 0.4 confidence");
});

test("evidence is grouped by source and every source came from a stored factor", () => {
  const score = storedScore();
  const sources = evidenceSources(score);
  const names = sources.map((s) => s.source);

  assert.ok(names.includes("LinkedIn profile"));
  assert.ok(names.includes("Company news"));
  for (const source of sources) {
    assert.ok(
      score.factors.some((factor) => factor.evidenceSource === source.source),
      `${source.source} must trace back to a factor`,
    );
  }
});

test("a score with no evidence sources produces no evidence panel rows", () => {
  const score = storedScore();
  const stripped: ProspectScore = {
    ...score,
    factors: score.factors.map((factor) => ({ ...factor, evidenceSource: null })),
  };
  assert.deepEqual(evidenceSources(stripped), []);
});

test("the grade bands are contiguous, cover 0-100, and agree with the engine", () => {
  const sorted = [...GRADE_BANDS].sort((a, b) => a.min - b.min);
  assert.equal(sorted[0].min, 0);
  assert.equal(sorted[sorted.length - 1].max, 100);

  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i].min, sorted[i - 1].max + 1, "no gap or overlap between bands");
  }

  // The page and the engine must never disagree about what a score is graded.
  for (const band of GRADE_BANDS) {
    assert.equal(gradeForScore(band.min), band.grade);
    assert.equal(gradeForScore(band.max), band.grade);
  }
});

test("the headline sentence can never describe a prospect above its band", () => {
  assert.equal(gradeHeadline("A").title, "Strong match");
  assert.equal(gradeHeadline("D").title, "Weak match");
  assert.ok(gradeHeadline("C").description.includes("review"));
  assert.ok(gradeHeadline("D").description.includes("budget"));
});

/* -------------------------------------------------------------- intent bounds */

test("a category's score impact is bounded however it is supplied", () => {
  assert.equal(clampScoreImpact(100), MAX_SCORE_IMPACT);
  assert.equal(clampScoreImpact(-5), 0);
  assert.equal(clampScoreImpact(Number.NaN), 0);

  // The picker cannot offer a value the server would clamp — otherwise a
  // customer chooses 100 and silently gets 25.
  for (const option of SCORE_IMPACT_OPTIONS) {
    assert.equal(clampScoreImpact(option.value), option.value);
    assert.ok(option.value <= MAX_SCORE_IMPACT);
  }
});

test("daily monitoring is gated on the plan, and the reason is stated", () => {
  const small = DAILY_CADENCE_MIN_MONITOR_ALLOWANCE - 1;

  assert.equal(cadenceAvailable("DAILY", small), false);
  assert.equal(cadenceAvailable("DAILY", DAILY_CADENCE_MIN_MONITOR_ALLOWANCE), true);

  // Everything slower than daily is always available — the gate is on cost.
  for (const cadence of ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const) {
    assert.equal(cadenceAvailable(cadence, 0), true);
    assert.equal(cadenceUnavailableReason(cadence, 0), null);
  }

  assert.ok(cadenceUnavailableReason("DAILY", small)?.includes("Weekly"));
});

/* ----------------------------------------------------------------- campaigns */

function campaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "c1",
    name: "Property managers",
    description: null,
    status: "ACTIVE",
    minimumGrade: "B",
    priority: 100,
    audience: { segment: null, locations: [], radiusMiles: null },
    budgetCapMinor: 50_000,
    budgetSpentMinor: 21_000,
    budgetPercent: 42,
    hasBudgetCap: true,
    ownerId: "u1",
    ownerName: "JT",
    createdAt: "2026-08-01T00:00:00Z",
    autoOptimize: false,
    reviewBeforeOutreach: false,
    dailyContactCap: 50,
    monthlyContactCap: 1000,
    senderIdentityId: "s1",
    conversionGoalName: "Site visits",
    icpProfileName: "Property managers",
    sequenceStepCount: 3,
    launchedAt: null,
    updatedAt: "2026-09-05T00:00:00Z",
    funnel: {
      audience: 900,
      contacted: 842,
      delivered: 820,
      bounced: 4,
      replies: 156,
      positiveReplies: 28,
      optOuts: 2,
      promoted: 9,
      converted: 6,
      stopped: 0,
      pending: 58,
    },
    ...overrides,
  };
}

test("only a campaign that can actually send counts as spending", () => {
  assert.equal(isSpendingStatus("ACTIVE"), true);
  assert.equal(isSpendingStatus("OPTIMIZING"), true);
  for (const status of ["DRAFT", "READY", "PAUSED", "COMPLETED", "STOPPED"] as const) {
    assert.equal(isSpendingStatus(status), false, `${status} must not count as spending`);
  }
});

test("priority bands map from the stored integer, lowest first", () => {
  assert.equal(priorityFor(10), "URGENT");
  assert.equal(priorityFor(50), "HIGH");
  assert.equal(priorityFor(100), "NORMAL");
  assert.equal(priorityFor(500), "LOW");
  assert.equal(priorityLabel(100), "Normal");
});

test("compliance reports the real blocker, and good standing only when there is none", () => {
  assert.equal(
    complianceSummary({ campaigns: [campaign()], hasSender: true }).ok,
    true,
  );

  const noSender = complianceSummary({ campaigns: [campaign()], hasSender: false });
  assert.equal(noSender.ok, false);
  assert.ok(noSender.title.includes("sending identity"));

  const overspent = complianceSummary({
    campaigns: [campaign({ budgetPercent: 100 })],
    hasSender: true,
  });
  assert.equal(overspent.ok, false);
  assert.ok(overspent.title.includes("budget cap"));

  const awaiting = complianceSummary({
    campaigns: [campaign({ status: "DRAFT", reviewBeforeOutreach: true })],
    hasSender: true,
  });
  assert.equal(awaiting.ok, false);
  assert.ok(awaiting.title.includes("review"));
});

test("a campaign at its budget cap is only flagged while it can still send", () => {
  // A stopped campaign at 100% is finished, not a compliance problem.
  const stopped = complianceSummary({
    campaigns: [campaign({ status: "STOPPED", budgetPercent: 100 })],
    hasSender: true,
  });
  assert.equal(stopped.ok, true);
});

test("budget amounts render as pounds, dropping pence on a round figure", () => {
  assert.equal(formatMoneyMinor(21_000), "£210");
  assert.equal(formatMoneyMinor(50_000), "£500");
  // A part-pound figure keeps its pence rather than being rounded away.
  assert.equal(formatMoneyMinor(21_050), "£210.50");
  assert.equal(formatMoneyMinor(0), "£0");
});

test("an uncapped campaign has no budget percentage rather than zero", () => {
  // Rendering 0% for a campaign with no cap would read as "nothing spent",
  // which is a different and false claim.
  const uncapped = campaign({
    hasBudgetCap: false,
    budgetPercent: null,
    budgetCapMinor: null,
  });
  assert.equal(uncapped.budgetPercent, null);
  assert.equal(uncapped.budgetCapMinor, null);
  assert.equal(
    complianceSummary({ campaigns: [uncapped], hasSender: true }).ok,
    true,
  );
});
