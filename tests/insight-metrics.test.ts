import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildRoiCard,
  computeQuoteAnalytics,
  computeVoiceAnalytics,
  formatRate,
  gatedRate,
  MIN_SAMPLE,
  type QuoteFact,
  type VoiceCallFact,
} from "../src/lib/analytics/insight-metrics.ts";

function quote(i: number, over: Partial<QuoteFact> = {}): QuoteFact {
  return {
    id: `q${i}`,
    createdAt: "2026-09-01T09:00:00Z",
    createdByKind: "HUMAN",
    currency: "GBP",
    source: "Ad / lead form",
    sentVia: "EMAIL",
    requestedAt: null,
    sentAt: "2026-09-01T10:00:00Z",
    firstViewedAt: null,
    acceptedAt: null,
    signedAt: null,
    paidAt: null,
    declinedAt: null,
    expiredAt: null,
    revisions: 1,
    grossMinor: 120_000,
    listMinor: 100_000,
    discountMinor: 0,
    netMinor: 100_000,
    marginMinor: 40_000,
    discountRequested: false,
    ...over,
  };
}

function call(i: number, over: Partial<VoiceCallFact> = {}): VoiceCallFact {
  return {
    id: `c${i}`,
    leadId: `L${i}`,
    route: "QUALIFICATION",
    direction: "OUTBOUND",
    outcome: "COMPLETED",
    answeredAt: "2026-09-01T10:00:05Z",
    endedAt: "2026-09-01T10:03:05Z",
    durationSec: 180,
    disposition: "CONVERSATION",
    costGbp: 0.3,
    bookedAfter: false,
    quotedAfter: false,
    soldAfter: false,
    ...over,
  };
}

describe("sample gates", () => {
  test("below MIN_SAMPLE a rate is withheld as not enough data", () => {
    const small = gatedRate(3, MIN_SAMPLE - 1);
    assert.equal(small.enough, false);
    assert.match(formatRate(small), /^Not enough data \(n=9\)$/);
    const big = gatedRate(3, MIN_SAMPLE);
    assert.equal(big.enough, true);
    assert.equal(formatRate(big), "30%");
  });
  test("an empty denominator is a dash, never 0%", () => {
    assert.equal(gatedRate(0, 0).value, null);
    assert.equal(formatRate(gatedRate(0, 0)), "—");
  });
});

describe("quote analytics", () => {
  test("no quotes: hasData false and no invented rates", () => {
    const a = computeQuoteAnalytics([]);
    assert.equal(a.hasData, false);
    assert.equal(a.rates.accepted.value, null);
    assert.deepEqual(a.averageValueMinor, {});
    assert.equal(a.margin.averageMarginPercent, null);
  });

  test("rates, timings and segments on a real sample", () => {
    const quotes = Array.from({ length: 10 }, (_, i) =>
      quote(i, {
        firstViewedAt: i < 8 ? "2026-09-01T11:00:00Z" : null,
        acceptedAt: i < 4 ? "2026-09-02T10:00:00Z" : null,
        signedAt: i < 3 ? "2026-09-02T11:00:00Z" : null,
        paidAt: i < 2 ? "2026-09-03T10:00:00Z" : null,
        declinedAt: i === 9 ? "2026-09-04T10:00:00Z" : null,
        createdByKind: i % 2 === 0 ? "AI" : "HUMAN",
        revisions: i === 0 ? 3 : 1,
      }),
    );
    const a = computeQuoteAnalytics(quotes);
    assert.equal(a.counts.sent, 10);
    assert.equal(a.rates.viewed.value, 0.8);
    assert.equal(a.rates.accepted.value, 0.4);
    assert.equal(a.rates.signed.value, 0.3);
    assert.equal(a.rates.paid.value, 0.2);
    assert.equal(a.rates.declined.value, 0.1);
    assert.equal(a.medianHours.toAccept, 24);
    assert.equal(a.medianHours.toPay, 24);
    assert.deepEqual(a.averageValueMinor, { GBP: 120_000 });
    assert.equal(a.revisions.averagePerQuote, 1.2);
    const ai = a.byAuthor.find((r) => r.key === "AI");
    assert.equal(ai?.created, 5);
    // 5 per segment: below the gate, so withheld.
    assert.equal(ai?.acceptRate.enough, false);
  });

  test("discounts and margin impact use only quotes with every cost known", () => {
    const quotes = [
      quote(1, { listMinor: 100_000, discountMinor: 10_000, netMinor: 90_000, marginMinor: 30_000, discountRequested: true }),
      quote(2, { marginMinor: null }),
    ];
    const a = computeQuoteAnalytics(quotes);
    assert.equal(a.discount.requested, 1);
    assert.equal(a.discount.averagePercent, 0.1);
    // quote 2 has an unknown cost: left out of margin, not guessed.
    assert.equal(a.margin.quotesWithCost, 1);
    // 30k/90k = 33.33% after; (30k+10k)/(90k+10k) = 40% before; impact -6.67 pts.
    assert.equal(a.margin.impactPoints, -6.67);
  });
});

describe("voice analytics", () => {
  test("durations are actual recorded ones only", () => {
    const a = computeVoiceAnalytics([call(1, { durationSec: 120 }), call(2, { durationSec: null }), call(3, { durationSec: 240 })], []);
    assert.equal(a.averageDurationSec, 180);
    assert.equal(a.durationSample, 2);
    const none = computeVoiceAnalytics([call(1, { durationSec: null })], []);
    assert.equal(none.averageDurationSec, null);
  });

  test("connect and voicemail rates, outcome by route, cancelled calls excluded", () => {
    const calls = [
      ...Array.from({ length: 6 }, (_, i) => call(i)),
      ...Array.from({ length: 3 }, (_, i) => call(10 + i, { outcome: "VOICEMAIL", answeredAt: null, durationSec: 20 })),
      call(20, { outcome: "FAILED", answeredAt: null, durationSec: null, route: "REACTIVATION" }),
      call(21, { outcome: "CANCELLED", answeredAt: null }),
      call(22, { outcome: null, answeredAt: null }),
    ];
    const a = computeVoiceAnalytics(calls, []);
    assert.equal(a.calls, 12);
    assert.equal(a.attempted, 10);
    assert.equal(a.connectRate.value, 0.6);
    assert.equal(a.voicemailRate.value, 0.3);
    const q = a.byRoute.find((r) => r.route === "QUALIFICATION");
    assert.equal(q?.attempted, 9);
    assert.equal(q?.voicemail, 3);
    assert.equal(a.byRoute.find((r) => r.route === "REACTIVATION")?.failed, 1);
  });

  test("conversion counts each lead once; cost per outcome is null without outcomes or costs", () => {
    const calls = [call(1, { bookedAfter: true }), call(2, { leadId: "L1", bookedAfter: false }), call(3, { costGbp: null })];
    const a = computeVoiceAnalytics(calls, []);
    assert.equal(a.conversion.connectedLeads, 2);
    assert.equal(a.conversion.booking.numerator, 1);
    assert.equal(a.costPerOutcome.perBooking, 0.6);
    assert.equal(a.costPerOutcome.perSale, null);
    const noCost = computeVoiceAnalytics([call(1, { costGbp: null, bookedAfter: true })], []);
    assert.equal(noCost.costPerOutcome.totalCostGbp, null);
    assert.equal(noCost.costPerOutcome.perBooking, null);
  });

  test("objections by type with a resolved share", () => {
    const a = computeVoiceAnalytics([call(1)], [
      { key: "price.too_high", handledOutcome: "RESOLVED", channel: "VOICE" },
      { key: "price.too_high", handledOutcome: "LOST", channel: "VOICE" },
      { key: "timing.not_now", handledOutcome: null, channel: "VOICE" },
    ]);
    assert.deepEqual(a.objections.map((o) => [o.key, o.count]), [["price.too_high", 2], ["timing.not_now", 1]]);
    assert.equal(a.objections[0].resolvedRate.value, 0.5);
  });
});

describe("ROI card: real data only", () => {
  const base = { voiceSpendGbp: 115, qualified: 4, booked: 2, quotes: 1, sales: 1, model: "position" };

  test("no minutes and no revenue: empty state with a reason", () => {
    const card = buildRoiCard({ ...base, voiceMinutes: 0, attributedRevenueMinor: {} });
    assert.equal(card.status, "empty");
  });

  test("minutes but no recorded revenue: still empty, never a zero revenue figure", () => {
    const card = buildRoiCard({ ...base, voiceMinutes: 42, attributedRevenueMinor: {} });
    assert.equal(card.status, "empty");
    if (card.status === "empty") assert.match(card.reason, /never estimated/);
  });

  test("revenue but no minutes: empty (nothing to measure a return on)", () => {
    assert.equal(buildRoiCard({ ...base, voiceMinutes: 0, attributedRevenueMinor: { GBP: 50_000 } }).status, "empty");
  });

  test("with both, the chain renders and the multiple is revenue over spend", () => {
    const card = buildRoiCard({ ...base, voiceMinutes: 42, attributedRevenueMinor: { GBP: 115_000 } });
    assert.equal(card.status, "ready");
    if (card.status === "ready") {
      assert.equal(card.returnMultiple, 10);
      assert.deepEqual(card.steps.map((s) => s.key), ["minutes", "spend", "qualified", "booked", "quotes", "sales", "revenue"]);
    }
  });

  test("unknown spend gives no multiple rather than an invented one", () => {
    const card = buildRoiCard({ ...base, voiceSpendGbp: null, voiceMinutes: 42, attributedRevenueMinor: { GBP: 115_000 } });
    assert.equal(card.status === "ready" && card.returnMultiple, null);
  });
});
