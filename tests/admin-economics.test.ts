import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PLANS } from "../src/lib/billing/plans.ts";
import {
  AI_TOKEN_RATE_GBP_PER_MILLION,
  MODEL_ASSUMPTIONS,
  UNIT_COST_GBP,
  UNIT_COST_SOURCES,
  VERIFIED_PROSPECT_HARD_LIMIT,
  planCost,
  type Interval,
  type Usage,
} from "../src/lib/billing/unit-costs.ts";
import {
  MIN_GROSS_MARGIN,
  annualPriceFor,
  belowFloorOnly,
  economicsPeriods,
  economicsTotals,
  elapsedShare,
  emptyUsage,
  marginAlertFor,
  periodEconomics,
  periodKey,
  planInputFor,
  simulatePlan,
  sortWorkspaces,
  subscriptionRevenue,
  usageFromRpc,
  workspaceEconomics,
  type EconomicsPeriod,
  type SubscriptionFacts,
  type UsageCounts,
  type WorkspaceEconomics,
} from "../src/lib/admin/economics-model.ts";

/**
 * Admin → Economics. The per-workspace margin is computed from fixture usage
 * rows (the shape the 0145 RPC returns), "not measured" is never zero, the
 * simulator is the plan-margins model and nothing else, and a margin alert is
 * raised once per workspace per month.
 */

const close = (actual: number | null, expected: number, message?: string) => {
  assert.ok(actual !== null, message ?? "expected a number, got null");
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} != ${expected}`);
};

// Fixed clocks: mid-September 2026 (open month) and a closed August.
const NOW = new Date("2026-09-16T00:00:00.000Z");
const { mtd, last } = economicsPeriods(NOW);

function sub(overrides: Partial<SubscriptionFacts> = {}): SubscriptionFacts {
  return {
    plan: "growth",
    status: "ACTIVE",
    billingInterval: "month",
    createdAt: "2026-01-10T00:00:00.000Z",
    cancelledAt: null,
    trialEndsAt: null,
    ...overrides,
  };
}

function usage(overrides: Partial<UsageCounts> = {}): UsageCounts {
  return { ...emptyUsage("b-1"), ...overrides };
}

function only(rows: WorkspaceEconomics[], id: string) {
  const row = rows.find((r) => r.businessId === id);
  assert.ok(row, `no row for ${id}`);
  return row;
}

describe("periods", () => {
  test("month to date and the last full month, in UTC", () => {
    assert.equal(mtd.start.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(mtd.end.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(last.start.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(last.end.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(periodKey(mtd), "2026-09");
    assert.equal(periodKey(last), "2026-08");
    assert.equal(mtd.open, true);
    assert.equal(last.open, false);
  });

  test("elapsed share: 15 of 30 days is a half; a closed month is whole", () => {
    close(elapsedShare(mtd), 0.5);
    assert.equal(elapsedShare(last), 1);
  });

  test("January rolls back to December", () => {
    const jan = economicsPeriods(new Date("2027-01-03T10:00:00Z"));
    assert.equal(jan.last.start.toISOString(), "2026-12-01T00:00:00.000Z");
  });
});

describe("RPC rows", () => {
  test("numerics arrive as strings and are read as numbers; nulls read as 0", () => {
    const row = usageFromRpc({
      business_id: "b-9",
      sms_out_segments: "120.0000",
      sms_out_rows: "7",
      ai_mini_output: "2500",
      wa_marketing: 3,
      credit_revenue_gbp: "24.00",
      resend_rows: null,
    });
    assert.equal(row.businessId, "b-9");
    assert.equal(row.smsOutSegments, 120);
    assert.equal(row.smsOutRows, 7);
    assert.equal(row.aiMiniOutput, 2500);
    assert.equal(row.waMarketing, 3);
    assert.equal(row.creditRevenueGbp, 24);
    assert.equal(row.resendRows, 0);
    assert.equal(row.smsInSegments, 0);
  });
});

describe("per-workspace margin from fixture usage", () => {
  // A Growth workspace, monthly, in a closed month.
  const fixture = usage({
    businessId: "growth-1",
    smsOutSegments: 300,
    smsOutRows: 150,
    aiMiniInput: 1_000_000,
    aiMiniCached: 400_000,
    aiMiniOutput: 200_000,
    aiNanoInput: 500_000,
    aiNanoOutput: 50_000,
    aiRows: 40,
    waMarketing: 10,
    waUtility: 5,
    waServiceFree: 3,
    waInbound: 4,
    waOutLedger: 18,
    placesRecords: 45,
    placesRequests: 3,
    otherProviderCostGbp: 1.5,
    leads: 120,
    qualifiedLeads: 18,
    creditRevenueGbp: 24,
    creditCharges: 1,
  });

  const rows = periodEconomics(
    [
      { businessId: "growth-1", name: "Acme Studio", subscription: sub(), usage: fixture },
      // A second SMS sender, so the shared number is split two ways.
      { businessId: "starter-1", name: "Beta Ltd", subscription: sub({ plan: "starter" }), usage: usage({ businessId: "starter-1", smsOutSegments: 10, smsOutRows: 10 }) },
    ],
    last,
  );
  const row = only(rows, "growth-1");
  const line = (key: string) => row.lines.find((l) => l.key === key)?.value;

  test("each usage line is recorded quantity × its unit cost", () => {
    close(line("smsOut") ?? null, 300 * UNIT_COST_GBP.smsOutboundSegment, "smsOut");
    const r = AI_TOKEN_RATE_GBP_PER_MILLION;
    close(
      line("ai") ?? null,
      (1_000_000 * r.mini.input + 400_000 * r.mini.cached + 200_000 * r.mini.output + 500_000 * r.nano.input + 50_000 * r.nano.output) / 1e6,
      "ai",
    );
    const fee = UNIT_COST_GBP.whatsappTwilioFee;
    close(
      line("whatsapp") ?? null,
      10 * (UNIT_COST_GBP.whatsappMetaMarketing + fee) + 5 * (UNIT_COST_GBP.whatsappMetaUtility + fee) + 3 * fee + 4 * fee,
      "whatsapp",
    );
    close(line("places") ?? null, 3 * UNIT_COST_GBP.placesTextSearchRequest, "places");
    close(line("otherProviders") ?? null, 1.5, "other");
    close(line("numberShare") ?? null, UNIT_COST_GBP.numberRentalMonth / 2, "number share");
    close(line("infrastructure") ?? null, MODEL_ASSUMPTIONS.infrastructurePerCustomerMonth, "infra");
  });

  test("revenue is the list price plus paid top-ups; Stripe is planCost's fee plus the top-up fee", () => {
    close(row.revenue.subscription, 199);
    close(row.revenue.total, 199 + 24);
    const a = MODEL_ASSUMPTIONS;
    const subFee = planCost(planInputFor("growth"), "monthly", "max").stripe;
    close(line("stripe") ?? null, subFee + 24 * a.vatMultiplier * a.stripePercentMax + a.stripeFixedGbp, "stripe");
  });

  test("margin = (revenue − every known cost) ÷ revenue, and a healthy Growth month clears 75%", () => {
    const known = row.lines.reduce((sum, l) => sum + (l.value ?? 0), 0);
    close(row.totalCost, known);
    close(row.margin, (223 - known) / 223);
    assert.equal(row.belowFloor, false);
    assert.equal(row.projected, null, "a closed month has no projection");
  });

  test("a Starter workspace burning SMS falls below 75% and is flagged", () => {
    const [burning] = periodEconomics(
      [{ businessId: "s", name: "Heavy", subscription: sub({ plan: "starter" }), usage: usage({ businessId: "s", smsOutSegments: 800, smsOutRows: 800 }) }],
      last,
    );
    assert.ok(burning.margin !== null && burning.margin < MIN_GROSS_MARGIN, `margin ${burning.margin}`);
    assert.equal(burning.belowFloor, true);
  });

  test("an annual subscription earns yearly ÷ 12, with Stripe spread the same way", () => {
    const revenue = subscriptionRevenue(sub({ billingInterval: "year" }), last);
    close(revenue.monthly, (PLANS.growth.yearlyPrice as number) / 12);
    close(revenue.stripeFee, planCost(planInputFor("growth"), "annual", "max").stripe);
  });

  test("no revenue outside the subscription's life: created after, cancelled before, or a trial", () => {
    assert.equal(subscriptionRevenue(sub({ createdAt: "2026-09-05T00:00:00Z" }), last).monthly, 0);
    assert.equal(subscriptionRevenue(sub({ status: "CANCELLED", cancelledAt: "2026-07-20T00:00:00Z" }), last).monthly, 0);
    close(subscriptionRevenue(sub({ status: "CANCELLED", cancelledAt: "2026-08-20T00:00:00Z" }), last).monthly, 199);
    assert.equal(subscriptionRevenue(sub({ plan: "trial", status: "TRIALING" }), last).monthly, 0);
    assert.equal(subscriptionRevenue(null, last).monthly, 0);
  });

  test("a complimentary workspace (no Stripe subscription) earns £0 and pays no Stripe fee", () => {
    const comped = subscriptionRevenue(sub({ billed: false }), last);
    assert.equal(comped.monthly, 0);
    assert.equal(comped.stripeFee, 0);
    close(subscriptionRevenue(sub({ billed: true }), last).monthly as number, 199);
  });

  test("WhatsApp sends the ledger counted but the messages table did not categorise are priced at marketing", () => {
    const [w] = periodEconomics(
      [{ businessId: "w", name: "W", subscription: sub(), usage: usage({ businessId: "w", waOutLedger: 5, waUtility: 2 }) }],
      last,
    );
    const wa = w.lines.find((l) => l.key === "whatsapp");
    const fee = UNIT_COST_GBP.whatsappTwilioFee;
    close(wa?.value ?? null, 3 * (UNIT_COST_GBP.whatsappMetaMarketing + fee) + 2 * (UNIT_COST_GBP.whatsappMetaUtility + fee));
    assert.match(wa?.note ?? "", /3 sends without a category/);
  });

  test("month to date projects usage to month end and leaves fixed lines whole", () => {
    const [open] = periodEconomics(
      [{ businessId: "g", name: "G", subscription: sub(), usage: usage({ businessId: "g", smsOutSegments: 1000, smsOutRows: 1 }) }],
      mtd,
    );
    assert.ok(open.projected);
    // Half the month elapsed: usage doubles, fees and allocations do not.
    close(open.projected.totalCost, open.totalCost + open.variableCost);
    assert.ok((open.projected.margin ?? 1) < (open.margin ?? 0));
  });
});

describe("not measured is not zero", () => {
  const base = { businessId: "n", name: "N", subscription: sub() };

  test("inbound SMS and system email are null when nothing records them", () => {
    const [row] = periodEconomics([{ ...base, usage: usage({ businessId: "n", smsOutSegments: 10, smsOutRows: 10 }) }], last);
    const smsIn = row.lines.find((l) => l.key === "smsIn");
    const resend = row.lines.find((l) => l.key === "resend");
    assert.equal(smsIn?.value, null);
    assert.equal(resend?.value, null);
    assert.deepEqual(row.notMeasured.sort(), ["resend", "smsIn"]);
  });

  test("once rows exist the same line is measured, and a measured zero stays 0", () => {
    const [row] = periodEconomics(
      [{ ...base, usage: usage({ businessId: "n", smsInRows: 4, smsInSegments: 4, resendRows: 1, resendEmails: 0 }) }],
      last,
    );
    close(row.lines.find((l) => l.key === "smsIn")?.value ?? null, 4 * UNIT_COST_GBP.smsInbound);
    assert.equal(row.lines.find((l) => l.key === "resend")?.value, 0);
    assert.deepEqual(row.notMeasured, []);
  });

  test("a measured channel with no use is 0, not 'not measured'", () => {
    const [row] = periodEconomics([{ ...base, usage: usage({ businessId: "n" }) }], last);
    assert.equal(row.lines.find((l) => l.key === "smsOut")?.value, 0);
    assert.equal(row.lines.find((l) => l.key === "ai")?.value, 0);
    assert.ok(!row.notMeasured.includes("smsOut"));
  });

  test("an unrecorded contract price gives no margin, and totals leave it out of revenue", () => {
    const rows = periodEconomics(
      [
        { businessId: "e", name: "Enterprise Co", subscription: sub({ plan: "enterprise" }), usage: usage({ businessId: "e", smsOutSegments: 50, smsOutRows: 1 }) },
        { businessId: "g", name: "Growth Co", subscription: sub(), usage: usage({ businessId: "g" }) },
      ],
      last,
    );
    const enterprise = only(rows, "e");
    assert.equal(enterprise.revenue.total, null);
    assert.equal(enterprise.margin, null);
    assert.equal(enterprise.belowFloor, false);
    const totals = economicsTotals(rows);
    assert.equal(totals.revenueNotRecorded, 1);
    close(totals.revenue, 199);
    // Margin is over the workspace whose revenue is known, not Enterprise's cost against £0.
    close(totals.margin, (199 - only(rows, "g").totalCost) / 199);
  });

  test("the driver split reports how many workspaces a line is not measured in", () => {
    const rows = periodEconomics([{ ...base, usage: usage({ businessId: "n" }) }], last);
    const totals = economicsTotals(rows);
    assert.equal(totals.drivers.find((d) => d.key === "smsIn")?.notMeasuredIn, 1);
    assert.equal(totals.drivers.find((d) => d.key === "smsOut")?.notMeasuredIn, 0);
  });

  test("every unit cost shown on the page carries a source", () => {
    assert.ok(UNIT_COST_SOURCES.length >= 10);
    for (const item of UNIT_COST_SOURCES) {
      assert.ok(item.source.length > 0 && Number.isFinite(item.gbp), item.key);
    }
  });
});

describe("totals: cost per trial, per lead, per qualified lead", () => {
  const rows = periodEconomics(
    [
      {
        businessId: "t1",
        name: "Trial One",
        subscription: sub({ plan: "trial", status: "TRIALING", createdAt: "2026-08-10T00:00:00Z", trialEndsAt: "2026-08-24T00:00:00Z" }),
        usage: usage({ businessId: "t1", smsOutSegments: 8, smsOutRows: 8, leads: 5, qualifiedLeads: 1 }),
      },
      {
        businessId: "t2",
        name: "Trial Two",
        subscription: sub({ plan: "trial", status: "TRIALING", createdAt: "2026-08-12T00:00:00Z", trialEndsAt: "2026-08-26T00:00:00Z" }),
        usage: usage({ businessId: "t2", leads: 3 }),
      },
      { businessId: "p", name: "Paid", subscription: sub(), usage: usage({ businessId: "p", smsOutSegments: 100, smsOutRows: 50, leads: 40, qualifiedLeads: 5 }) },
    ],
    last,
  );
  const totals = economicsTotals(rows);

  test("a trial's cost is its usage only (no number share, no allocation)", () => {
    assert.equal(totals.trialsStarted, 2);
    close(totals.costPerTrial, (8 * UNIT_COST_GBP.smsOutboundSegment) / 2);
    assert.equal(only(rows, "t1").lines.find((l) => l.key === "infrastructure")?.value, 0);
  });

  test("per lead and per qualified lead divide actual usage cost", () => {
    const variable = 108 * UNIT_COST_GBP.smsOutboundSegment;
    close(totals.costPerLead, variable / 48);
    close(totals.costPerQualifiedLead, variable / 6);
  });

  test("no leads: the per-lead figures are unknown, not zero", () => {
    const none = economicsTotals(periodEconomics([{ businessId: "x", name: "X", subscription: sub(), usage: usage({ businessId: "x" }) }], last));
    assert.equal(none.costPerLead, null);
    assert.equal(none.costPerQualifiedLead, null);
    assert.equal(none.costPerTrial, null);
  });
});

describe("table helpers", () => {
  const rows = periodEconomics(
    [
      { businessId: "a", name: "Alpha", subscription: sub(), usage: usage({ businessId: "a" }) },
      { businessId: "b", name: "Bravo", subscription: sub({ plan: "starter" }), usage: usage({ businessId: "b", smsOutSegments: 900, smsOutRows: 1 }) },
      { businessId: "c", name: "Charlie", subscription: sub({ plan: "trial", status: "TRIALING" }), usage: usage({ businessId: "c", leads: 1 }) },
    ],
    last,
  );

  test("sort by margin ascending puts the worst first and unknown margins last", () => {
    const sorted = sortWorkspaces(rows, "margin", "asc").map((r) => r.businessId);
    assert.deepEqual(sorted, ["b", "a", "c"]);
    assert.equal(sortWorkspaces(rows, "margin", "desc").at(-1)?.businessId, "c");
  });

  test("the below-75% filter keeps only flagged workspaces", () => {
    assert.deepEqual(belowFloorOnly(rows).map((r) => r.businessId), ["b"]);
  });
});

describe("margin alert: once per workspace per month", () => {
  const [low] = periodEconomics(
    [{ businessId: "low", name: "Low Margin Ltd", subscription: sub({ plan: "starter" }), usage: usage({ businessId: "low", smsOutSegments: 800, smsOutRows: 1 }) }],
    mtd,
  );
  const [healthy] = periodEconomics(
    [{ businessId: "ok", name: "Healthy Ltd", subscription: sub(), usage: usage({ businessId: "ok" }) }],
    mtd,
  );

  test("raises for a workspace below 75% with nothing raised this month", () => {
    const alert = marginAlertFor(low, mtd, new Set());
    assert.ok(alert);
    assert.equal(alert.businessId, "low");
    assert.equal(alert.period, "2026-09");
    assert.equal(alert.metrics.period, "2026-09");
    assert.match(alert.title, /below 75%/);
  });

  test("does not raise again in the same month", () => {
    assert.equal(marginAlertFor(low, mtd, new Set(["low:2026-09"])), null);
  });

  test("a previous month's alert does not suppress this month's", () => {
    assert.ok(marginAlertFor(low, mtd, new Set(["low:2026-08"])));
  });

  test("a daily loop raises it once even when the check sees it on many days", () => {
    const raised = new Set<string>();
    let count = 0;
    for (let day = 0; day < 10; day += 1) {
      const alert = marginAlertFor(low, mtd, raised);
      if (alert) {
        count += 1;
        raised.add(`${alert.businessId}:${alert.period}`);
      }
    }
    assert.equal(count, 1);
  });

  test("healthy and revenue-less workspaces raise nothing", () => {
    assert.equal(marginAlertFor(healthy, mtd, new Set()), null);
    const [trial] = periodEconomics(
      [{ businessId: "t", name: "Trial", subscription: sub({ plan: "trial", status: "TRIALING" }), usage: usage({ businessId: "t", smsOutSegments: 8, smsOutRows: 8 }) }],
      mtd,
    );
    assert.equal(marginAlertFor(trial, mtd, new Set()), null);
  });

  test("the projection alone can raise it: healthy to date, below 75% by month end", () => {
    // Find an SMS volume whose month-to-date margin clears 75% but whose
    // doubled (projected) usage does not.
    const period: EconomicsPeriod = mtd;
    let found: WorkspaceEconomics | null = null;
    for (let segments = 100; segments <= 2000; segments += 25) {
      const [row] = periodEconomics(
        [{ businessId: "p", name: "Projected", subscription: sub({ plan: "starter" }), usage: usage({ businessId: "p", smsOutSegments: segments, smsOutRows: 1 }) }],
        period,
      );
      if (!row.belowFloor && row.projected?.belowFloor) {
        found = row;
        break;
      }
    }
    assert.ok(found, "a projected-only breach exists");
    const alert = marginAlertFor(found, period, new Set());
    assert.ok(alert);
    assert.match(alert.title, /^Projected month-end margin/);
    assert.deepEqual(belowFloorOnly([found]).length, 1);
  });

  test("below 55% (to date or projected, whichever is worse) is critical, otherwise a warning", () => {
    const alert = marginAlertFor(low, mtd, new Set());
    assert.ok(alert);
    const worst = Math.min(low.margin ?? 1, low.projected?.margin ?? 1);
    assert.equal(alert.severity, worst < 0.55 ? "CRITICAL" : "WARNING");
    const [mild] = periodEconomics(
      [{ businessId: "m", name: "Mild", subscription: sub({ plan: "starter" }), usage: usage({ businessId: "m", smsOutSegments: 600, smsOutRows: 1 }) }],
      last,
    );
    // A closed month has no projection; 600 segments on Starter sits between 55% and 75%.
    assert.ok(mild.margin !== null && mild.margin < 0.75 && mild.margin >= 0.55, `margin ${mild.margin}`);
    assert.equal(marginAlertFor(mild, last, new Set())?.severity, "WARNING");
  });
});

describe("pricing simulator = the plan-margins model", () => {
  const SELF_SERVE = ["starter", "growth", "pro"] as const;

  // Built exactly as tests/plan-margins.test.ts builds it.
  function testPlanInput(plan: (typeof SELF_SERVE)[number]) {
    const definition = PLANS[plan];
    return {
      monthlyPrice: definition.monthlyPrice as number,
      yearlyPrice: definition.yearlyPrice,
      leadLimit: definition.leadLimit,
      smsSegmentAllowance: definition.smsSegmentAllowance,
      whatsappMessageAllowance: definition.whatsappMessageAllowance,
      aiTokenAllowance: definition.aiTokenAllowance,
      verifiedProspects: VERIFIED_PROSPECT_HARD_LIMIT[plan],
    };
  }

  for (const plan of SELF_SERVE) {
    test(`${plan}: unedited, the simulator returns planCost() for every interval and usage`, () => {
      assert.deepEqual(planInputFor(plan), testPlanInput(plan));
      const result = simulatePlan(planInputFor(plan));
      assert.equal(result.cells.length, 4);
      for (const interval of ["monthly", "annual"] as Interval[]) {
        for (const usageLevel of ["max", "typical"] as Usage[]) {
          const cell = result.cells.find((c) => c.interval === interval && c.usage === usageLevel);
          assert.ok(cell);
          assert.deepEqual(cell.line, planCost(testPlanInput(plan), interval, usageLevel));
          assert.equal(cell.pass, cell.line.margin >= MIN_GROSS_MARGIN);
        }
      }
      assert.equal(result.pass, result.cells.every((c) => c.pass));
      assert.equal(result.binding.line.margin, Math.min(...result.cells.map((c) => c.line.margin)));
    });
  }

  test("the annual price for an edited monthly price follows plans.ts (−15%, rounded)", () => {
    for (const plan of SELF_SERVE) {
      assert.equal(annualPriceFor(PLANS[plan].monthlyPrice as number), PLANS[plan].yearlyPrice);
    }
  });

  test("editing can fail the rule: Pro at £399 with the old 12M tokens and 2,000 prospects (economics.md §10.5 B)", () => {
    const result = simulatePlan({ ...planInputFor("pro"), aiTokenAllowance: 12_000_000, verifiedProspects: 2000 });
    assert.equal(result.pass, false);
    assert.equal(result.binding.interval, "annual");
    assert.equal(result.binding.usage, "max");
  });

  test("no annual price: monthly cells only", () => {
    const result = simulatePlan({ ...planInputFor("starter"), yearlyPrice: null });
    assert.deepEqual(
      result.cells.map((c) => c.interval),
      ["monthly", "monthly"],
    );
  });

  test("the simulator is read-only: it returns a new result and leaves its input untouched", () => {
    const input = planInputFor("growth");
    const snapshot = JSON.stringify(input);
    simulatePlan(input);
    assert.equal(JSON.stringify(input), snapshot);
    assert.deepEqual(planInputFor("growth"), testPlanInput("growth"));
  });
});

describe("workspaceEconomics is deterministic for one input", () => {
  test("same input, same output", () => {
    const input = { businessId: "d", name: "D", subscription: sub(), usage: usage({ businessId: "d", smsOutSegments: 12, smsOutRows: 3 }) };
    assert.deepEqual(workspaceEconomics(input, { period: last, smsWorkspaces: 1 }), workspaceEconomics(input, { period: last, smsWorkspaces: 1 }));
  });
});
