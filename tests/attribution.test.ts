import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  attributeRevenue,
  buildLeadJourney,
  creditRevenue,
  modelWeights,
  revenueEventsFrom,
  splitMinor,
  type JourneyTouch,
  type RevenueEvent,
} from "../src/lib/analytics/attribution.ts";

const touch = (id: string, at: string, channel: JourneyTouch["channel"], leadId = "L1"): JourneyTouch => ({
  id,
  leadId,
  opportunityId: null,
  at,
  channel,
  kind: channel === "VOICE" ? "CALL" : channel === "AD_FORM" ? "SOURCE" : "OUTBOUND_MESSAGE",
  label: id,
});

const pay = (id: string, at: string, amountMinor: number, leadId = "L1"): RevenueEvent => ({
  id,
  leadId,
  opportunityId: null,
  at,
  amountMinor,
  currency: "GBP",
  kind: "CHECKOUT_PAYMENT",
});

// Ad -> SMS -> Email -> Voice -> paid £1,000.
const JOURNEY = [
  touch("t1", "2026-09-01T09:00:00Z", "AD_FORM"),
  touch("t2", "2026-09-01T09:01:00Z", "SMS"),
  touch("t3", "2026-09-03T10:00:00Z", "EMAIL"),
  touch("t4", "2026-09-05T11:00:00Z", "VOICE"),
];
const PAID = pay("p1", "2026-09-06T12:00:00Z", 100_000);

describe("model weights (golden)", () => {
  test("first touch", () => assert.deepEqual(modelWeights("first", 4), [1, 0, 0, 0]));
  test("last touch", () => assert.deepEqual(modelWeights("last", 4), [0, 0, 0, 1]));
  test("linear", () => assert.deepEqual(modelWeights("linear", 4), [0.25, 0.25, 0.25, 0.25]));
  test("position 40/20/40 with four touches", () => assert.deepEqual(modelWeights("position", 4), [0.4, 0.1, 0.1, 0.4]));
  test("position with three touches gives the middle 20%", () => {
    const w = modelWeights("position", 3);
    assert.equal(w[0], 0.4);
    assert.ok(Math.abs(w[1] - 0.2) < 1e-12);
    assert.equal(w[2], 0.4);
  });
  test("position with two touches splits 50/50, one touch takes all", () => {
    assert.deepEqual(modelWeights("position", 2), [0.5, 0.5]);
    for (const m of ["first", "last", "linear", "position"] as const) assert.deepEqual(modelWeights(m, 1), [1]);
  });
  test("weights always sum to 1", () => {
    for (const m of ["first", "last", "linear", "position"] as const) {
      for (let n = 1; n <= 9; n++) {
        const sum = modelWeights(m, n).reduce((s, v) => s + v, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, `${m} n=${n} sums to ${sum}`);
      }
    }
  });
});

describe("credited money (golden)", () => {
  test("£1,000 under each model", () => {
    const amounts = (model: "first" | "last" | "linear" | "position") => creditRevenue(JOURNEY, PAID, model).map((c) => c.amountMinor);
    assert.deepEqual(amounts("first"), [100_000, 0, 0, 0]);
    assert.deepEqual(amounts("last"), [0, 0, 0, 100_000]);
    assert.deepEqual(amounts("linear"), [25_000, 25_000, 25_000, 25_000]);
    assert.deepEqual(amounts("position"), [40_000, 10_000, 10_000, 40_000]);
  });

  test("an indivisible amount still adds up exactly (largest remainder)", () => {
    const parts = splitMinor(100, [1 / 3, 1 / 3, 1 / 3]);
    assert.deepEqual(parts, [34, 33, 33]);
    assert.equal(parts.reduce((s, v) => s + v, 0), 100);
    const odd = splitMinor(1001, modelWeights("position", 5));
    assert.equal(odd.reduce((s, v) => s + v, 0), 1001);
  });

  test("a touch after the payment earns nothing", () => {
    const late = [...JOURNEY, touch("t5", "2026-09-10T00:00:00Z", "WHATSAPP")];
    const credits = creditRevenue(late, PAID, "last");
    assert.equal(credits.find((c) => c.touch.id === "t5"), undefined);
    assert.equal(credits.at(-1)?.touch.id, "t4");
  });

  test("another lead's touches never earn credit", () => {
    const mixed = [...JOURNEY, touch("x1", "2026-09-02T00:00:00Z", "WHATSAPP", "L2")];
    assert.equal(creditRevenue(mixed, PAID, "linear").length, 4);
  });
});

describe("aggregate attribution and channel influence", () => {
  test("position-based summary by channel", () => {
    const summary = attributeRevenue(JOURNEY, [PAID], "position");
    assert.equal(summary.hasRevenue, true);
    assert.deepEqual(summary.totalRevenueMinor, { GBP: 100_000 });
    const byChannel = Object.fromEntries(summary.rows.map((r) => [r.channel, r.revenueMinor.GBP]));
    assert.deepEqual(byChannel, { AD_FORM: 40_000, VOICE: 40_000, SMS: 10_000, EMAIL: 10_000 });
    for (const row of summary.rows) assert.equal(row.influence, 1);
  });

  test("influence is the share of converting journeys a channel appeared in", () => {
    const touches = [...JOURNEY, touch("b1", "2026-09-01T00:00:00Z", "AD_FORM", "L2"), touch("b2", "2026-09-02T00:00:00Z", "SMS", "L2")];
    const summary = attributeRevenue(touches, [PAID, pay("p2", "2026-09-04T00:00:00Z", 5000, "L2")], "first");
    const voice = summary.rows.find((r) => r.channel === "VOICE");
    const ad = summary.rows.find((r) => r.channel === "AD_FORM");
    assert.equal(summary.convertingJourneys, 2);
    assert.equal(ad?.influence, 1);
    assert.equal(voice?.influence, 0.5);
    // First touch: all revenue to the ad.
    assert.equal(ad?.revenueMinor.GBP, 105_000);
  });

  test("revenue with no earlier touch is reported as unattributed, not credited", () => {
    const summary = attributeRevenue([], [PAID], "position");
    assert.deepEqual(summary.unattributedRevenueMinor, { GBP: 100_000 });
    assert.equal(summary.rows.length, 0);
  });
});

describe("no fabrication: revenue is only recorded money", () => {
  test("no revenue means hasRevenue false and no rows, never zeroes presented as data", () => {
    const summary = attributeRevenue(JOURNEY, [], "position");
    assert.equal(summary.hasRevenue, false);
    assert.deepEqual(summary.totalRevenueMinor, {});
    assert.equal(summary.rows.length, 0);
    const journey = buildLeadJourney(JOURNEY, []);
    assert.equal(journey.hasRevenue, false);
    assert.deepEqual(journey.credited.position, []);
  });

  test("unmatched or review payments are not revenue for a lead", () => {
    const events = revenueEventsFrom({
      checkoutPayments: [
        { id: "a", lead_id: "L1", opportunity_id: null, amount_minor: 500, currency: "GBP", status: "UNMATCHED", paid_at: "2026-09-01T00:00:00Z" },
        { id: "b", lead_id: "L1", opportunity_id: null, amount_minor: 500, currency: "GBP", status: "REVIEW", paid_at: "2026-09-01T00:00:00Z" },
        { id: "c", lead_id: null, opportunity_id: null, amount_minor: 500, currency: "GBP", status: "MATCHED", paid_at: "2026-09-01T00:00:00Z" },
        { id: "d", lead_id: "L1", opportunity_id: null, amount_minor: 700, currency: "GBP", status: "MATCHED", paid_at: "2026-09-01T00:00:00Z" },
      ],
      invoicePayments: [],
      wonOpportunities: [],
    });
    assert.deepEqual(events.map((e) => e.id), ["pay:d"]);
  });

  test("an invoice payment that is also a checkout payment counts once", () => {
    const events = revenueEventsFrom({
      checkoutPayments: [{ id: "cp1", lead_id: "L1", opportunity_id: "O1", amount_minor: 1000, currency: "GBP", status: "LINKED", paid_at: "2026-09-02T00:00:00Z" }],
      invoicePayments: [{ id: "ip1", lead_id: "L1", opportunity_id: "O1", amount_minor: 1000, currency: "GBP", received_at: "2026-09-02T00:00:00Z", checkout_payment_id: "cp1" }],
      wonOpportunities: [],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "INVOICE_PAYMENT");
  });

  test("a won value counts only when no payment exists for that opportunity, and is labelled as won value", () => {
    const won = { id: "O1", lead_id: "L1", value: "2500.00", currency: "GBP", outcome: "WON", closed_at: "2026-09-03T00:00:00Z" };
    const withPayment = revenueEventsFrom({
      checkoutPayments: [{ id: "cp1", lead_id: "L1", opportunity_id: "O1", amount_minor: 1000, currency: "GBP", status: "MATCHED", paid_at: "2026-09-02T00:00:00Z" }],
      invoicePayments: [],
      wonOpportunities: [won],
    });
    assert.deepEqual(withPayment.map((e) => e.kind), ["CHECKOUT_PAYMENT"]);

    const paidEarlier = revenueEventsFrom({ checkoutPayments: [], invoicePayments: [], wonOpportunities: [won], paidOpportunityIds: new Set(["O1"]) });
    assert.equal(paidEarlier.length, 0);

    const unpaid = revenueEventsFrom({ checkoutPayments: [], invoicePayments: [], wonOpportunities: [won] });
    assert.equal(unpaid.length, 1);
    assert.equal(unpaid[0].kind, "WON_OPPORTUNITY");
    assert.equal(unpaid[0].amountMinor, 250_000);
  });

  test("a won deal with no value, or a lost/open deal, is never revenue", () => {
    const events = revenueEventsFrom({
      checkoutPayments: [],
      invoicePayments: [],
      wonOpportunities: [
        { id: "O1", lead_id: "L1", value: null, currency: "GBP", outcome: "WON", closed_at: "2026-09-03T00:00:00Z" },
        { id: "O2", lead_id: "L1", value: 900, currency: "GBP", outcome: "LOST", closed_at: "2026-09-03T00:00:00Z" },
        { id: "O3", lead_id: "L1", value: 0, currency: "GBP", outcome: "WON", closed_at: "2026-09-03T00:00:00Z" },
      ],
    });
    assert.equal(events.length, 0);
  });
});

describe("one lead's journey", () => {
  test("timeline is ordered and revenue splits under every model", () => {
    const journey = buildLeadJourney(JOURNEY, [PAID]);
    assert.deepEqual(journey.entries.map((e) => (e.type === "touch" ? e.touch.id : e.revenue.id)), ["t1", "t2", "t3", "t4", "p1"]);
    const total = (m: keyof typeof journey.credited) => journey.credited[m].reduce((s, c) => s + c.amountMinor, 0);
    for (const m of ["first", "last", "linear", "position"] as const) assert.equal(total(m), 100_000);
  });
});
