import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  METRICS,
  formatMetric,
  metric,
  rate,
  delta,
  withRates,
} from "../src/lib/analytics/v4-metrics.ts";
import {
  replyRate,
  qualificationRate,
  bookingRate,
} from "../src/lib/campaigns/reactivation-types.ts";

/**
 * The metric contract.
 *
 * ClientTurn computed "reply rate" five different ways — three counting
 * messages, two counting people, three returning fractions, two returning
 * percentage points, three returning null on an empty denominator and two
 * returning zero — and none of them matched the definition published to the
 * customer in the metric tooltip.
 *
 * These tests fix the contract in place. They are unit tests of pure functions
 * on purpose: the arithmetic is where the divergence lived, and arithmetic is
 * the part that can be proved without a database.
 */

describe("the ratio rule", () => {
  test("a rate is a fraction in [0, 1]", () => {
    assert.equal(rate(1, 4), 0.25);
    assert.equal(rate(3, 3), 1);
    assert.equal(rate(0, 5), 0);
  });

  test("an empty denominator has no rate", () => {
    // Null, not zero. `rate()` carries the reason in its own comment: "0% reply
    // rate on a campaign that has sent nothing is a lie that reads as failure".
    assert.equal(rate(0, 0), null);
    assert.equal(rate(5, 0), null);
    assert.equal(rate(1, -1), null);
  });

  test("an absent rate renders as an em dash, not 0%", () => {
    assert.equal(formatMetric(null, "percent"), "—");
    assert.equal(formatMetric(Number.NaN, "percent"), "—");
    assert.equal(formatMetric(0.25, "percent"), "25%");
    // Below 10% a decimal place keeps a small rate honest — including a
    // measured zero, which is a real finding and reads differently from "—".
    assert.equal(formatMetric(0, "percent"), "0.0%");
    assert.equal(formatMetric(0.021, "percent"), "2.1%");
  });

  test("a delta against no baseline is absent, not infinite", () => {
    assert.equal(delta(5, 0), null);
    assert.equal(delta(0, 0), null);
    assert.equal(delta(6, 4), 0.5);
  });
});

describe("reactivation rates follow the same rule", () => {
  test("they are fractions, not percentage points", () => {
    assert.equal(replyRate(200, 50), 0.25);
    assert.equal(qualificationRate(50, 10), 0.2);
    assert.equal(bookingRate(50, 5), 0.1);
  });

  test("they are null, not zero, when nothing has been sent", () => {
    assert.equal(replyRate(0, 0), null);
    assert.equal(qualificationRate(0, 3), null);
    assert.equal(bookingRate(0, 3), null);
  });

  test("each is measured against the step before it, not against sends", () => {
    // 200 sent, 50 replied, 10 qualified, 5 booked. Qualification is 10/50, not
    // 10/200 — the funnel is a chain, and measuring every step against the
    // first would make later steps look like failures.
    assert.equal(qualificationRate(50, 10), 0.2);
    assert.notEqual(qualificationRate(50, 10), rate(10, 200));
  });
});

describe("engagement is counted in people", () => {
  test("reply rate is repliers over contacts", () => {
    const result = withRates({ contacted: 400, replied: 40, positive: 12, optedOut: 8 });
    assert.equal(result.replyRate, 0.1);
  });

  test("positive reply rate is measured against replies, not contacts", () => {
    // "Half our replies were positive" and "half the people we contacted
    // replied positively" are different claims. The second one flatters, and it
    // is the one a contacts-denominator would produce.
    const result = withRates({ contacted: 400, replied: 40, positive: 20, optedOut: 0 });
    assert.equal(result.positiveReplyRate, 0.5);
    assert.notEqual(result.positiveReplyRate, rate(20, 400));
  });

  test("opt-out rate is measured against contacts", () => {
    const result = withRates({ contacted: 400, replied: 40, positive: 0, optedOut: 8 });
    assert.equal(result.optOutRate, 0.02);
  });

  test("a workspace that has contacted nobody has no rates at all", () => {
    const result = withRates({ contacted: 0, replied: 0, positive: 0, optedOut: 0 });
    assert.equal(result.replyRate, null);
    assert.equal(result.positiveReplyRate, null);
    assert.equal(result.optOutRate, null);
  });
});

describe("the published definitions match the arithmetic", () => {
  /**
   * The registry is what the customer reads in the tooltip. When it says
   * "contacts", the query must count people; when it says "messages", it must
   * count messages. This is the assertion that keeps those two honest with each
   * other, because the divergence was never in the words — it was in the gap
   * between the words and the code.
   */
  test("contact-denominated metrics say so", () => {
    for (const key of ["reply_rate", "opt_out_rate"]) {
      assert.match(
        metric(key).definition.toLowerCase(),
        /contacts/,
        `${key} is computed over people, so its definition must say "contacts"`,
      );
    }
  });

  test("message-denominated metrics say so", () => {
    for (const key of ["delivery_rate", "bounce_rate"]) {
      assert.match(
        metric(key).definition.toLowerCase(),
        /messages/,
        `${key} is computed over messages, so its definition must say "messages"`,
      );
    }
  });

  test("every metric is rendered by the format it declares", () => {
    for (const [key, definition] of Object.entries(METRICS)) {
      assert.equal(definition.key, key, "registry key and definition key disagree");
      assert.ok(definition.definition.length > 20, `${key} has no usable definition`);
      // A rate must be a percent. A count rendered as a percent would be a
      // hundred-fold error nobody would question on screen.
      if (key.endsWith("_rate")) {
        assert.equal(definition.format, "percent", `${key} is a rate but is not a percent`);
      }
    }
  });
});
