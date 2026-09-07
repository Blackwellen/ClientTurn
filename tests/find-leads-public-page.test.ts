import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ACQUISITION_PROFILE,
  ANALYTICS_METRICS,
  CAMPAIGN_SEQUENCE,
  CAMPAIGN_STEPS,
  DEMO_FACTORS,
  DEMO_PROSPECTS,
  DEMO_SCORE,
  DEMO_STAGES,
  FUNNEL_STEPS,
  HERO_PLAN,
  INTEGRATION_ROWS,
  PROSPECT_FILTERS,
  RUN_COUNTERS,
} from "../src/components/marketing/find-leads/data.ts";
import { STAGES, STAGE_KEYS } from "../src/lib/find-leads/stages.ts";
import {
  DEFAULT_WEIGHTS,
  gradeForScore,
} from "../src/lib/prospects/scoring.ts";
import { scoreFactorLabel } from "../src/lib/prospects/types.ts";
import { COUNTER_DEFINITIONS } from "../src/lib/find-leads/types.ts";
import { WIZARD_STEPS } from "../src/lib/outreach/campaign-draft.ts";

/**
 * The public Find Leads page as a claim about the product.
 *
 * A marketing page is a promise, and the expensive failure mode is not a
 * broken layout — it is a page that keeps advertising a stage, a weight or a
 * wizard step after the software stopped having one. These tests exist so that
 * drift becomes a failing build rather than a slow lie.
 *
 * They deliberately do not assert particular copy. Wording is allowed to
 * change; the *correspondence* to the product is not.
 */

describe("sourcing stages shown publicly", () => {
  test("are exactly the twelve canonical stages, in order", () => {
    assert.equal(DEMO_STAGES.length, STAGE_KEYS.length);
    assert.deepEqual(
      DEMO_STAGES.map((stage) => stage.number),
      STAGES.map((stage) => stage.number),
    );
    assert.deepEqual(
      DEMO_STAGES.map((stage) => stage.title),
      STAGES.map((stage) => stage.title),
    );
  });

  test("carry the product's own descriptions rather than marketing rewrites", () => {
    for (const stage of DEMO_STAGES) {
      const canonical = STAGES.find((s) => s.number === stage.number);
      assert.ok(canonical, `stage ${stage.number} exists`);
      assert.equal(stage.description, canonical.description);
    }
  });

  test("show a run part-way through, never a finished or empty one", () => {
    const running = DEMO_STAGES.filter((s) => s.status === "RUNNING");
    const done = DEMO_STAGES.filter((s) => s.status === "COMPLETED");
    assert.equal(running.length, 1, "exactly one stage is live");
    assert.ok(done.length > 0 && done.length < DEMO_STAGES.length);
  });
});

describe("run counters", () => {
  test("cover every counter the product defines, and no invented ones", () => {
    assert.deepEqual(
      Object.keys(RUN_COUNTERS).sort(),
      COUNTER_DEFINITIONS.map((c) => c.key).sort(),
    );
  });

  test("are internally consistent — nothing survives a stage it never entered", () => {
    assert.ok(RUN_COUNTERS.contactsFound <= RUN_COUNTERS.companiesFound);
    assert.ok(RUN_COUNTERS.emailsDiscovered <= RUN_COUNTERS.contactsFound);
    assert.ok(RUN_COUNTERS.verified <= RUN_COUNTERS.emailsDiscovered);
    assert.ok(RUN_COUNTERS.ready <= RUN_COUNTERS.verified);
  });
});

describe("explainable scoring", () => {
  test("shows all six factors with the product's labels", () => {
    const keys = Object.keys(DEFAULT_WEIGHTS);
    assert.equal(DEMO_FACTORS.length, keys.length);
    for (const factor of DEMO_FACTORS) {
      assert.equal(factor.label, scoreFactorLabel(factor.factor));
    }
  });

  test("each factor's maximum is its configured weight", () => {
    for (const factor of DEMO_FACTORS) {
      assert.equal(
        factor.max,
        Math.round(DEFAULT_WEIGHTS[factor.factor] * 100),
        `${factor.factor} maximum matches its weight`,
      );
      assert.equal(factor.weightPercent, factor.max);
    }
  });

  test("the weights add up to a whole score", () => {
    const total = DEMO_FACTORS.reduce((sum, f) => sum + f.max, 0);
    assert.equal(total, 100);
  });

  /**
   * The point of §14: the headline number is arithmetic over the rows shown
   * beneath it. A decorative total would make the page argue against its own
   * "deterministic code computes the score" trust line.
   */
  test("the headline score is the sum of the factor contributions", () => {
    const summed = DEMO_FACTORS.reduce((sum, f) => sum + f.earned, 0);
    assert.equal(DEMO_SCORE, summed);
  });

  test("no factor earns more than its weight allows", () => {
    for (const factor of DEMO_FACTORS) {
      assert.ok(factor.earned >= 0 && factor.earned <= factor.max);
    }
  });

  test("the grade shown is the grade the product's banding produces", () => {
    assert.equal(gradeForScore(DEMO_SCORE), "A");
  });

  test("every factor carries evidence, a source, freshness and confidence", () => {
    for (const factor of DEMO_FACTORS) {
      assert.ok(factor.evidence.length > 0, `${factor.factor} has evidence`);
      assert.ok(factor.source.length > 0, `${factor.factor} names a source`);
      assert.ok(factor.freshness.length > 0, `${factor.factor} has freshness`);
      assert.ok(["High", "Medium", "Low"].includes(factor.confidence));
    }
  });
});

describe("campaign wizard", () => {
  test("shows the six real steps, in the wizard's own order", () => {
    assert.equal(CAMPAIGN_STEPS.length, WIZARD_STEPS.length);
    assert.deepEqual(
      CAMPAIGN_STEPS.map((s) => s.label),
      WIZARD_STEPS.map((s) => s.label),
    );
    assert.deepEqual(
      CAMPAIGN_STEPS.map((s) => s.number),
      WIZARD_STEPS.map((_, i) => i + 1),
    );
  });

  /**
   * The channel policy is email-first for cold outreach. A sequence step on
   * any other channel would advertise behaviour the send guard refuses.
   */
  test("the cold sequence is email only", () => {
    for (const step of CAMPAIGN_SEQUENCE) {
      assert.equal(step.channel, "Email");
    }
  });

  test("the sequence moves forward in time", () => {
    const days = CAMPAIGN_SEQUENCE.map((s) => Number(s.day.replace("Day ", "")));
    for (let i = 1; i < days.length; i += 1) {
      assert.ok(days[i] > days[i - 1], "each step is later than the last");
    }
  });
});

describe("prospects shown publicly", () => {
  test("the quick filters each match at least one example row", () => {
    for (const filter of PROSPECT_FILTERS) {
      if (filter.label === "All") continue;
      const found = DEMO_PROSPECTS.some((p) => {
        switch (filter.label) {
          case "A Grade":
            return p.grade === "A" || p.grade === "A+";
          case "Intent":
            return p.intent !== "None";
          case "Ready":
            return p.outreach === "Ready";
          case "Contacted":
            return p.outreach === "In outreach" || p.outreach === "Replied";
          case "Replied":
            return p.outreach === "Replied";
          case "Review":
            return p.eligibility === "Review";
          default:
            return false;
        }
      });
      assert.ok(found, `${filter.label} has at least one example`);
    }
  });

  /**
   * Prospects are not leads. A row that is held for review must never also
   * claim to be ready for outreach, because that is the exact distinction the
   * section exists to explain.
   */
  test("a row held for review is never also ready for outreach", () => {
    for (const prospect of DEMO_PROSPECTS) {
      if (prospect.eligibility === "Review") {
        assert.notEqual(prospect.outreach, "Ready");
      }
    }
  });

  test("an unverified prospect is never eligible", () => {
    for (const prospect of DEMO_PROSPECTS) {
      if (prospect.verification !== "Verified") {
        assert.equal(prospect.eligibility, "Review");
      }
    }
  });

  test("a prospect in outreach belongs to a campaign", () => {
    for (const prospect of DEMO_PROSPECTS) {
      if (prospect.outreach === "In outreach" || prospect.outreach === "Replied") {
        assert.ok(prospect.campaign, `${prospect.company} has a campaign`);
      }
    }
  });

  test("the fit score and the grade agree", () => {
    for (const prospect of DEMO_PROSPECTS) {
      assert.equal(
        gradeForScore(prospect.fit),
        prospect.grade,
        `${prospect.company} grade matches its score`,
      );
    }
  });
});

describe("analytics shown publicly", () => {
  test("the funnel only ever narrows", () => {
    for (let i = 1; i < FUNNEL_STEPS.length; i += 1) {
      assert.ok(
        FUNNEL_STEPS[i].value <= FUNNEL_STEPS[i - 1].value,
        `${FUNNEL_STEPS[i].label} cannot exceed ${FUNNEL_STEPS[i - 1].label}`,
      );
    }
  });

  test("no metric is phrased as a customer outcome", () => {
    const forbidden = /customers?|clients? (get|see|achieve)|average|guarantee/i;
    for (const metric of ANALYTICS_METRICS) {
      assert.ok(
        !forbidden.test(metric.label),
        `"${metric.label}" must not read as a customer result`,
      );
    }
  });
});

describe("truthfulness guardrails", () => {
  /**
   * The plan summary is the page's central promise: that the interpretation is
   * reviewable before money is spent. Losing the exclusions or the review mode
   * from it would quietly drop the part that makes the promise meaningful.
   */
  test("the hero plan states exclusions, target and review mode", () => {
    const labels = HERO_PLAN.map((row) => row.label);
    for (const required of ["Exclusions", "Target", "Review mode"]) {
      assert.ok(labels.includes(required), `plan shows ${required}`);
    }
  });

  test("the acquisition profile is a fact list, not a metric list", () => {
    for (const row of ACQUISITION_PROFILE) {
      for (const value of row.value) {
        assert.ok(
          !/\d+%|\bx\d|\d+ leads?\b/i.test(value),
          `"${value}" must not be a performance claim`,
        );
      }
    }
  });

  /** Everything listed is connector-reachable only; see the copy beside it. */
  test("the integration strip names vendors without claiming native sync", () => {
    assert.ok(INTEGRATION_ROWS.length > 0);
    for (const name of INTEGRATION_ROWS) {
      assert.ok(!/oauth|two-?way|native|sync/i.test(name));
    }
  });
});
