import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  decidePlanChange,
  downgradeSchedulePhases,
  pendingChangeFromSchedule,
  planChangeDirection,
  planRank,
  previousSelfServePlan,
  resolvePlanInterval,
} from "../src/lib/billing/plan-change.ts";
import {
  NOT_INCLUDED_IN_TRIAL,
  SOURCING_ALLOWANCES,
  allowanceLabel,
} from "../src/lib/billing/sourcing-allowances.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/* ------------------------------------------------ 29: keep the interval */

describe("plan changes keep the customer's billing interval", () => {
  test("a live annual subscription stays annual whatever was requested", () => {
    assert.equal(resolvePlanInterval({ liveInterval: "year", requested: "month" }), "year");
    assert.equal(resolvePlanInterval({ liveInterval: "year" }), "year");
    assert.equal(resolvePlanInterval({ liveInterval: "month", requested: "year" }), "month");
  });

  test("without a live subscription: requested, then stored, then month", () => {
    assert.equal(resolvePlanInterval({ requested: "year", storedInterval: "month" }), "year");
    assert.equal(resolvePlanInterval({ storedInterval: "year" }), "year");
    assert.equal(resolvePlanInterval({}), "month");
    assert.equal(resolvePlanInterval({ liveInterval: "week", requested: null }), "month");
  });

  test("the in-app upgrade buttons no longer hard-code a monthly interval", () => {
    for (const file of [
      "src/components/settings/billing/billing-settings.tsx",
      "src/components/settings/billing/limits-panel.tsx",
    ]) {
      assert.doesNotMatch(read(file), /interval:\s*"month"/, file);
    }
  });

  test("the plan change reads the interval from the live Stripe price", () => {
    const checkout = read("src/lib/billing/checkout.ts");
    assert.match(checkout, /resolvePlanInterval\(\{\s*liveInterval:\s*item\.price\.recurring\?\.interval/);
  });
});

/* ------------------------------------- 30: upgrade now, downgrade later */

describe("upgrade vs downgrade is decided by plan rank", () => {
  test("rank follows the ladder", () => {
    assert.ok(planRank("starter") < planRank("growth"));
    assert.ok(planRank("growth") < planRank("pro"));
    assert.ok(planRank("pro") < planRank("enterprise"));
    assert.equal(planRank("nonsense"), -1);
  });

  test("direction", () => {
    assert.equal(planChangeDirection("starter", "growth"), "upgrade");
    assert.equal(planChangeDirection("pro", "starter"), "downgrade");
    assert.equal(planChangeDirection("growth", "growth"), "same");
  });

  test("the tier below, for the in-app downgrade", () => {
    assert.equal(previousSelfServePlan("pro"), "growth");
    assert.equal(previousSelfServePlan("growth"), "starter");
    assert.equal(previousSelfServePlan("starter"), null);
    assert.equal(previousSelfServePlan("trial"), null);
    assert.equal(previousSelfServePlan("enterprise"), null);
  });
});

describe("decidePlanChange matches terms 6.3", () => {
  const periodEnd = 1_790_000_000;

  test("an upgrade is immediate and prorated", () => {
    assert.deepEqual(
      decidePlanChange({ currentPlan: "starter", targetPlan: "pro", trialing: false, currentPeriodEnd: periodEnd }),
      { kind: "immediate", reason: "upgrade", prorationBehavior: "create_prorations" },
    );
  });

  test("a downgrade is scheduled for the period end, never immediate", () => {
    assert.deepEqual(
      decidePlanChange({ currentPlan: "pro", targetPlan: "growth", trialing: false, currentPeriodEnd: periodEnd }),
      { kind: "scheduled", effectiveAt: periodEnd },
    );
  });

  test("a downgrade with no known period end is refused, not applied now", () => {
    assert.equal(
      decidePlanChange({ currentPlan: "pro", targetPlan: "growth", trialing: false, currentPeriodEnd: null }),
      null,
    );
  });

  test("in a trial either direction is immediate with no prorations", () => {
    for (const [from, to] of [["starter", "pro"], ["pro", "starter"]] as const) {
      assert.deepEqual(
        decidePlanChange({ currentPlan: from, targetPlan: to, trialing: true, currentPeriodEnd: periodEnd }),
        { kind: "immediate", reason: "trial", prorationBehavior: "none" },
      );
    }
  });

  test("the same tier is a no-op", () => {
    assert.deepEqual(
      decidePlanChange({ currentPlan: "growth", targetPlan: "growth", trialing: false, currentPeriodEnd: periodEnd }),
      { kind: "noop" },
    );
  });
});

describe("the downgrade schedule", () => {
  const params = downgradeSchedulePhases({
    currentPriceId: "price_pro_year",
    targetPriceId: "price_growth_year",
    quantity: 1,
    currentPhaseStart: 1_760_000_000,
    currentPeriodEnd: 1_790_000_000,
    interval: "year",
    businessId: "biz_1",
  });

  test("releases afterwards and never prorates", () => {
    assert.equal(params.end_behavior, "release");
    assert.equal(params.proration_behavior, "none");
    for (const phase of params.phases) assert.equal(phase.proration_behavior, "none");
  });

  test("keeps the current price until the period end, then the lower one", () => {
    const [current, next] = params.phases;
    assert.deepEqual(current.items, [{ price: "price_pro_year", quantity: 1 }]);
    assert.equal(current.start_date, 1_760_000_000);
    assert.equal(current.end_date, 1_790_000_000);
    assert.deepEqual(next.items, [{ price: "price_growth_year", quantity: 1 }]);
    assert.equal(next.start_date, 1_790_000_000);
    assert.deepEqual(next.duration, { interval: "year", interval_count: 1 });
  });

  test("carries business_id so the webhook can still find the workspace", () => {
    for (const phase of params.phases) assert.deepEqual(phase.metadata, { business_id: "biz_1" });
  });

  test("the server path uses a Subscription Schedule for downgrades", () => {
    const checkout = read("src/lib/billing/checkout.ts");
    assert.match(checkout, /subscriptionSchedules\.create\(\{\s*from_subscription/);
    assert.match(checkout, /downgradeSchedulePhases\(/);
    assert.match(checkout, /decidePlanChange\(/);
    // The old unconditional swap-with-prorations is gone.
    assert.doesNotMatch(checkout, /proration_behavior:\s*"create_prorations"/);
  });
});

describe("the pending change shown on the billing page", () => {
  const now = 1_780_000_000;
  const planFor = (price: string | null) =>
    price === "price_growth" ? "growth" : price === "price_pro" ? "pro" : "trial";

  test("reads the next phase of a live schedule", () => {
    const pending = pendingChangeFromSchedule(
      {
        status: "active",
        phases: [
          { start_date: now - 100, items: [{ price: "price_pro" }] },
          { start_date: 1_790_000_000, items: [{ price: { id: "price_growth" } }] },
        ],
      },
      "pro",
      now,
      planFor,
    );
    assert.deepEqual(pending, {
      plan: "growth",
      effectiveAt: new Date(1_790_000_000 * 1000).toISOString(),
    });
  });

  test("nothing when released, finished, or the same plan", () => {
    const phases = [{ start_date: 1_790_000_000, items: [{ price: "price_growth" }] }];
    assert.equal(pendingChangeFromSchedule({ status: "released", phases }, "pro", now, planFor), null);
    assert.equal(pendingChangeFromSchedule({ status: "completed", phases }, "pro", now, planFor), null);
    assert.equal(pendingChangeFromSchedule({ status: "active", phases }, "growth", now, planFor), null);
    assert.equal(pendingChangeFromSchedule(null, "pro", now, planFor), null);
  });

  test("the billing page shows the date and a way to keep the current plan", () => {
    const ui = read("src/components/settings/billing/billing-settings.tsx");
    assert.match(ui, /Changes to \{planLabel\(pending\.plan\)\} on \{formatDate\(pending\.effectiveAt\)\}/);
    assert.match(ui, /cancelScheduledPlanChange/);
  });

  test("the public promise the code now keeps is unchanged", () => {
    assert.match(read("src/app/(marketing)/terms/page.tsx"), /downgrade with\s+effect from your next renewal date/);
    assert.match(read("src/app/(marketing)/pricing/page.tsx"), /downgrades take effect at the end of the current billing period/);
  });
});

/* -------------------------------------- 31: SMS segments vs messages */

describe("the usage card counts SMS segments against the SMS allowance", () => {
  const queries = read("src/lib/settings/queries.ts");
  const ui = read("src/components/settings/billing/billing-settings.tsx");

  test("segments come from the sms_outbound_segment meter", () => {
    assert.match(queries, /p_metric:\s*"sms_outbound_segment"/);
    assert.match(queries, /smsSegmentsUsed:/);
    assert.match(queries, /smsSegmentAllowance:\s*allowancesFor\(entitlements\.plan\)\.smsSegmentAllowance/);
    assert.doesNotMatch(queries, /messageAllowance:/);
  });

  test("messages sent are shown separately with no allowance", () => {
    assert.match(ui, /label="SMS segments"[\s\S]*?used=\{billing\.smsSegmentsUsed\}[\s\S]*?limit=\{billing\.smsSegmentAllowance\}/);
    assert.match(ui, /Messages sent/);
    assert.doesNotMatch(ui, /limit=\{billing\.messageAllowance\}/);
    assert.doesNotMatch(ui, /used=\{billing\.messagesSent\}/);
  });

  test("a failed segment read is said, not shown as zero", () => {
    assert.match(queries, /segmentsResult\.error \? null/);
    assert.match(ui, /SMS usage could not be loaded/);
  });
});

/* ---------------------------------- 32: trial sourcing is not included */

describe("the trial does not advertise sourcing or cold email", () => {
  test("every trial sourcing allowance is 0 and flagged not included", () => {
    const trial = SOURCING_ALLOWANCES.trial;
    assert.equal(trial.sourcingIncluded, false);
    assert.equal(trial.coldEmailIncluded, false);
    for (const key of [
      "verifiedProspects",
      "searchRuns",
      "savedSearches",
      "intentMonitors",
      "senderIdentities",
      "emailSends",
    ] as const) {
      assert.equal(trial[key], 0, key);
    }
  });

  test("paid plans include both", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.equal(SOURCING_ALLOWANCES[plan].sourcingIncluded, true);
      assert.equal(SOURCING_ALLOWANCES[plan].coldEmailIncluded, true);
    }
  });

  test("a zero trial allowance reads 'Not included in trial'", () => {
    assert.equal(NOT_INCLUDED_IN_TRIAL, "Not included in trial");
    assert.equal(allowanceLabel("trial", 0), "Not included in trial");
    assert.equal(allowanceLabel("starter", 90), "90");
    assert.equal(allowanceLabel("enterprise", 9000), "Custom");
  });
});
