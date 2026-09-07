import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_STATE_LABEL,
  AFFILIATE_ACCOUNT_STATES,
  attributionRemaining,
  DEFAULT_NOTIFICATION_PREFS,
  describeAttribution,
  describeCommission,
  describePayout,
  describeRate,
  FALLBACK_POLICY,
  formatPercent,
  formatPointDelta,
  isEarningState,
  maskIdentifier,
  MAX_CUSTOM_RANGE_DAYS,
  parseCustomRange,
  parseRange,
  rangeComparisonLabel,
  programmeConversionRate,
  resolveNotificationPrefs,
  resolvePreferences,
  resolveRange,
  stepRate,
  type ProgrammePolicy,
} from "../src/lib/affiliates/programme.ts";

import {
  assessReadiness,
  nextPayoutDate,
} from "../src/lib/affiliates/payout-rules.ts";

import {
  buildFunnel,
  comparisonLabel,
  countDelta,
  rateDelta,
  type AffiliateMetrics,
} from "../src/lib/affiliates/metrics.ts";

import { interpretAccount } from "../src/lib/affiliates/connect-rules.ts";

/**
 * The affiliate programme's decision logic (V4 §29-36).
 *
 * Everything asserted here decides money or exposure: what a commission is
 * worth, whether a payout may be raised, what a partner is told about their
 * earnings, and what is masked. The pure functions are tested directly so
 * these rules are pinned without needing a database.
 */

/* ------------------------------------------------------- programme policy -- */

describe("programme policy", () => {
  const recurring: ProgrammePolicy = { ...FALLBACK_POLICY };

  test("states the rate the same way everywhere", () => {
    assert.equal(describeRate(recurring), "20%");
    assert.equal(
      describeRate({ ...recurring, commissionType: "FLAT_AMOUNT", commissionFlatMinor: 5000 }),
      "£50",
    );
  });

  test("a bounded recurring plan states its duration", () => {
    assert.match(describeCommission(recurring), /first 12 months/);
  });

  test("an unbounded recurring plan says so rather than implying a limit", () => {
    const lifetime = { ...recurring, recurringMonths: null };
    assert.match(describeCommission(lifetime), /as long as the customer stays/);
    assert.doesNotMatch(describeCommission(lifetime), /months/);
  });

  test("a first-payment plan does not claim recurring earnings", () => {
    const first = { ...recurring, commissionType: "FIRST_PAYMENT_PERCENT" as const };
    assert.match(describeCommission(first), /first payment/);
    assert.doesNotMatch(describeCommission(first), /every payment/);
  });

  test("attribution and payout copy carry the configured numbers", () => {
    const custom = { ...recurring, attributionWindowDays: 45, holdDays: 14, minimumPayoutMinor: 2500 };
    assert.match(describeAttribution(custom), /45 days/);
    assert.match(describePayout(custom), /14 days/);
    assert.match(describePayout(custom), /£25/);
  });
});

/* ---------------------------------------------------------- account state -- */

describe("account state", () => {
  test("only ACTIVE earns", () => {
    for (const state of AFFILIATE_ACCOUNT_STATES) {
      assert.equal(isEarningState(state), state === "ACTIVE");
    }
  });

  test("every state has a label", () => {
    for (const state of AFFILIATE_ACCOUNT_STATES) {
      assert.ok(ACCOUNT_STATE_LABEL[state]);
    }
  });
});

/* ---------------------------------------------------------------- metrics -- */

describe("conversion rate", () => {
  test("is paid customers over unique clicks", () => {
    // The figure the reference design shows: 64 paid from 2,847 clicks.
    const rate = programmeConversionRate(64, 2847);
    assert.ok(rate !== null);
    assert.equal(formatPercent(rate), "2.2%");
  });

  test("is null rather than zero when nothing was clicked", () => {
    // "0%" claims a measurement that was never taken.
    assert.equal(programmeConversionRate(0, 0), null);
    assert.equal(formatPercent(null), "—");
  });

  test("step rates match the funnel captions", () => {
    assert.equal(formatPercent(stepRate(342, 2847)), "12.0%");
    assert.equal(formatPercent(stepRate(198, 342)), "57.9%");
    assert.equal(formatPercent(stepRate(64, 198)), "32.3%");
  });
});

describe("metric deltas", () => {
  test("counts report a percentage change", () => {
    const delta = countDelta(128, 100, "vs. previous 30 days");
    assert.equal(delta?.value, "+28%");
    assert.equal(delta?.direction, "up");
  });

  test("a zero baseline yields no delta rather than +100%", () => {
    // Growth from nothing is not a percentage, and printing one makes an empty
    // prior month look like a triumph.
    assert.equal(countDelta(50, 0, "vs. previous 30 days"), undefined);
    assert.equal(countDelta(50, undefined, "vs. previous 30 days"), undefined);
  });

  test("rates report percentage points, never a percentage change", () => {
    const delta = rateDelta(0.03, 0.022, "vs. previous 30 days");
    assert.equal(delta?.value, "+0.8pp");
    // The wrong answer here would be "+36%", which is the classic dashboard lie.
    assert.notEqual(delta?.value, "+36%");
  });

  test("a missing comparison window yields no rate delta", () => {
    assert.equal(rateDelta(0.03, null, "x"), undefined);
    assert.equal(rateDelta(null, 0.02, "x"), undefined);
  });

  test("point deltas format consistently", () => {
    assert.equal(formatPointDelta(0.03, 0.022), "+0.8pp");
    assert.equal(formatPointDelta(0.01, 0.02), "-1.0pp");
    assert.equal(formatPointDelta(null, 0.02), null);
  });

  test("comparison labels follow the selected range", () => {
    assert.equal(comparisonLabel("7d"), "vs. previous 7 days");
    assert.equal(comparisonLabel("30d"), "vs. previous 30 days");
    assert.equal(comparisonLabel("90d"), "vs. previous 90 days");
  });
});

describe("funnel", () => {
  const metrics: AffiliateMetrics = {
    clicks: 2847,
    uniqueClicks: 2847,
    signups: 342,
    trials: 198,
    paidCustomers: 64,
    renewals: 38,
    conversionRate: 64 / 2847,
    pendingMinor: 124000,
    approvedMinor: 287500,
    paidMinor: 198000,
    reversedMinor: 0,
    revenueAttributedMinor: 0,
  };

  test("each step carries both denominators", () => {
    const funnel = buildFunnel(metrics);
    assert.equal(funnel.length, 4);

    const [clicks, signups, trials, paid] = funnel;
    assert.equal(clicks.shareOfPrevious, null);
    assert.equal(formatPercent(clicks.shareOfTop), "100.0%");
    assert.equal(formatPercent(signups.shareOfTop), "12.0%");
    assert.equal(formatPercent(trials.shareOfTop), "7.0%");
    assert.equal(formatPercent(paid.shareOfTop), "2.2%");
    // Step-to-step is a different question from share-of-top.
    assert.equal(formatPercent(trials.shareOfPrevious), "57.9%");
  });

  test("an empty funnel does not divide by zero", () => {
    const empty = buildFunnel({ ...metrics, clicks: 0, signups: 0, trials: 0, paidCustomers: 0 });
    for (const step of empty) {
      assert.equal(step.shareOfTop, null);
    }
  });
});

/* ----------------------------------------------------------------- ranges -- */

describe("date ranges", () => {
  test("unknown values fall back to the default", () => {
    assert.equal(parseRange("nonsense"), "30d");
    assert.equal(parseRange(null), "30d");
    assert.equal(parseRange("90d"), "90d");
  });

  test("the window is half-open and the comparison is the same length", () => {
    const now = new Date("2026-04-15T09:30:00.000Z");
    const { from, to, days, previousFrom } = resolveRange("30d", now);

    assert.equal(days, 30);
    // `to` is the start of tomorrow, so today is fully included exactly once.
    assert.equal(to.toISOString(), "2026-04-16T00:00:00.000Z");
    assert.equal(from.toISOString(), "2026-03-17T00:00:00.000Z");
    assert.equal(previousFrom.toISOString(), "2026-02-15T00:00:00.000Z");

    const currentSpan = to.getTime() - from.getTime();
    const previousSpan = from.getTime() - previousFrom.getTime();
    assert.equal(currentSpan, previousSpan);
  });
});

/* ------------------------------------------------------- payout readiness -- */

describe("payout readiness", () => {
  const ready = {
    status: "ACTIVE",
    connectState: "READY",
    payoutsEnabled: true,
    detailsSubmitted: true,
    identityStatus: "VERIFIED",
    taxStatus: "VERIFIED",
    availableMinor: 52000,
    minimumPayoutMinor: 10000,
  };

  test("a fully set-up partner is READY", () => {
    assert.equal(assessReadiness(ready).readiness, "READY");
    assert.equal(assessReadiness(ready).blocker, null);
  });

  test("a connected account alone is NOT ready", () => {
    // The critical case: treating OAuth completion as readiness is how a
    // payout gets scheduled that can never settle.
    const connectedOnly = assessReadiness({
      ...ready,
      payoutsEnabled: false,
      identityStatus: "REQUIRED",
      taxStatus: "NOT_PROVIDED",
    });
    assert.equal(connectedOnly.readiness, "ACTION_REQUIRED");
    assert.ok(connectedOnly.blocker);
  });

  test("payouts_enabled false alone blocks readiness", () => {
    assert.equal(
      assessReadiness({ ...ready, payoutsEnabled: false }).readiness,
      "ACTION_REQUIRED",
    );
  });

  test("missing tax information blocks readiness", () => {
    assert.equal(
      assessReadiness({ ...ready, taxStatus: "NOT_PROVIDED" }).readiness,
      "ACTION_REQUIRED",
    );
  });

  test("verification in progress is PENDING, not ACTION_REQUIRED", () => {
    const pending = assessReadiness({
      ...ready,
      identityStatus: "PENDING",
      taxStatus: "SUBMITTED",
    });
    assert.equal(pending.readiness, "PENDING");
  });

  test("a suspended account is BLOCKED whatever else is true", () => {
    assert.equal(assessReadiness({ ...ready, status: "SUSPENDED" }).readiness, "BLOCKED");
  });

  test("an empty balance does not make a set-up partner ACTION_REQUIRED", () => {
    // Having earned nothing yet is not something the partner can act on, and
    // showing "action required" to someone with nothing left to do is wrong.
    const broke = assessReadiness({ ...ready, availableMinor: 0 });
    assert.equal(broke.readiness, "READY");
    // ...but the threshold check itself still reports as outstanding.
    const threshold = broke.checks.find((check) => check.key === "threshold");
    assert.equal(threshold?.state, "incomplete");
  });
});

describe("next payout date", () => {
  test("is the last day of the current month", () => {
    const date = nextPayoutDate(new Date("2026-04-10T00:00:00.000Z"));
    assert.equal(date.toISOString().slice(0, 10), "2026-04-30");
  });

  test("rolls to next month once this month's run has passed", () => {
    const date = nextPayoutDate(new Date("2026-04-30T23:00:00.000Z"));
    assert.equal(date.toISOString().slice(0, 10), "2026-05-31");
  });
});

/* ------------------------------------------------------- Stripe interpret -- */

describe("Stripe account interpretation", () => {
  function account(overrides: Record<string, unknown>) {
    return {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: [], past_due: [], pending_verification: [] },
      ...overrides,
    } as never;
  }

  test("no details submitted is ONBOARDING", () => {
    assert.equal(interpretAccount(account({})).state, "ONBOARDING");
  });

  test("details in but requirements outstanding is RESTRICTED, not READY", () => {
    const snapshot = interpretAccount(
      account({
        details_submitted: true,
        payouts_enabled: false,
        requirements: {
          currently_due: ["individual.verification.document"],
          past_due: [],
          pending_verification: [],
        },
      }),
    );
    assert.equal(snapshot.state, "RESTRICTED");
    assert.equal(snapshot.payoutsEnabled, false);
  });

  test("details in, payouts enabled and nothing due is READY", () => {
    const snapshot = interpretAccount(
      account({ details_submitted: true, payouts_enabled: true, charges_enabled: true }),
    );
    assert.equal(snapshot.state, "READY");
    assert.equal(snapshot.identityStatus, "VERIFIED");
  });

  test("a disabled account reports FAILED identity", () => {
    const snapshot = interpretAccount(
      account({
        details_submitted: true,
        payouts_enabled: false,
        requirements: {
          currently_due: [],
          past_due: [],
          pending_verification: [],
          disabled_reason: "rejected.fraud",
        },
      }),
    );
    assert.equal(snapshot.state, "DISABLED");
    assert.equal(snapshot.identityStatus, "FAILED");
  });

  test("documents under review report PENDING", () => {
    const snapshot = interpretAccount(
      account({
        details_submitted: true,
        payouts_enabled: false,
        requirements: {
          currently_due: [],
          past_due: [],
          pending_verification: ["individual.verification.document"],
        },
      }),
    );
    assert.equal(snapshot.identityStatus, "PENDING");
  });
});

/* -------------------------------------------------------------- masking --- */

describe("masking", () => {
  test("a tax reference is never shown in full", () => {
    const masked = maskIdentifier("8291");
    assert.match(masked, /8291$/);
    assert.match(masked, /^•+/);
  });

  test("a longer value is still truncated to its last four", () => {
    const masked = maskIdentifier("1234567890");
    assert.ok(!masked.includes("123456"));
    assert.match(masked, /7890$/);
  });

  test("an absent value renders as an em dash, not as bullets", () => {
    assert.equal(maskIdentifier(null), "—");
  });
});

/* ---------------------------------------------------- attribution expiry -- */

describe("attribution expiry", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");

  test("reports days remaining", () => {
    const result = attributionRemaining("2026-06-30T12:00:00.000Z", now);
    assert.equal(result.expired, false);
    assert.equal(result.days, 76);
    assert.equal(result.label, "76 days");
  });

  test("flags the last fortnight as urgent", () => {
    const result = attributionRemaining("2026-04-27T12:00:00.000Z", now);
    assert.equal(result.urgent, true);
    assert.equal(result.label, "12 days");
  });

  test("a past date is expired, not negative", () => {
    const result = attributionRemaining("2026-04-01T12:00:00.000Z", now);
    assert.equal(result.expired, true);
    assert.equal(result.days, 0);
    assert.equal(result.label, "Expired");
  });

  test("one day is singular", () => {
    assert.equal(attributionRemaining("2026-04-16T12:00:00.000Z", now).label, "1 day");
  });

  test("a missing or malformed date does not throw", () => {
    assert.equal(attributionRemaining(null, now).label, "—");
    assert.equal(attributionRemaining("not-a-date", now).label, "—");
  });
});

/* ------------------------------------------------------------ preferences -- */

describe("preferences", () => {
  test("notification defaults leave marketing off", () => {
    // The one genuinely promotional item is the one that starts off.
    assert.equal(DEFAULT_NOTIFICATION_PREFS.marketing_tips, false);
    assert.equal(DEFAULT_NOTIFICATION_PREFS.payout_updates, true);
  });

  test("stored preferences merge over the defaults", () => {
    const resolved = resolveNotificationPrefs({ marketing_tips: true, payout_updates: false });
    assert.equal(resolved.marketing_tips, true);
    assert.equal(resolved.payout_updates, false);
    assert.equal(resolved.new_referral, true);
  });

  test("unknown keys and wrong types are ignored", () => {
    const resolved = resolveNotificationPrefs({
      not_a_pref: true,
      payout_updates: "yes",
    });
    assert.equal("not_a_pref" in resolved, false);
    assert.equal(resolved.payout_updates, true);
  });

  test("currency display cannot be changed by stored preferences", () => {
    // A converted figure is not what the partner will be paid, so this is not
    // a preference the affiliate gets to set.
    const resolved = resolvePreferences({ currencyDisplay: "USD", defaultRange: "7d" });
    assert.equal(resolved.currencyDisplay, "GBP");
    assert.equal(resolved.defaultRange, "7d");
  });

  test("an invalid stored range falls back rather than breaking the page", () => {
    assert.equal(resolvePreferences({ defaultRange: "eternity" }).defaultRange, "30d");
  });
});

/* ---------------------------------------------------------- custom ranges -- */

describe("custom date ranges", () => {
  const now = new Date("2026-04-15T09:30:00.000Z");

  test("a valid pair is accepted as given", () => {
    const range = parseCustomRange("2026-03-01", "2026-03-31", now);
    assert.deepEqual(range, { fromDate: "2026-03-01", toDate: "2026-03-31" });
  });

  test("a reversed pair is corrected rather than rejected", () => {
    // Picking the end date first is an ordering mistake, not a request for
    // nothing.
    const range = parseCustomRange("2026-03-31", "2026-03-01", now);
    assert.deepEqual(range, { fromDate: "2026-03-01", toDate: "2026-03-31" });
  });

  test("a window reaching into the future is clamped to today", () => {
    // Future days render as empty buckets, which reads as a collapse in
    // performance rather than as "not yet".
    const range = parseCustomRange("2026-04-01", "2026-12-31", now);
    assert.equal(range?.toDate, "2026-04-15");
  });

  test("a multi-year span is shortened to the maximum", () => {
    const range = parseCustomRange("2020-01-01", "2026-04-15", now);
    assert.ok(range);
    const span =
      (new Date(`${range.toDate}T00:00:00Z`).getTime() -
        new Date(`${range.fromDate}T00:00:00Z`).getTime()) /
      86400000;
    assert.equal(span, MAX_CUSTOM_RANGE_DAYS);
  });

  test("unparseable or missing dates yield null, not a broken window", () => {
    assert.equal(parseCustomRange("not-a-date", "2026-03-01", now), null);
    assert.equal(parseCustomRange("2026-03-01", null, now), null);
    assert.equal(parseCustomRange(null, null, now), null);
  });

  test("the resolved window includes the chosen end date exactly once", () => {
    const custom = parseCustomRange("2026-03-01", "2026-03-31", now);
    const { from, to, days } = resolveRange("custom", now, custom);

    assert.equal(from.toISOString(), "2026-03-01T00:00:00.000Z");
    // Half-open: `to` is the start of the day after the chosen end.
    assert.equal(to.toISOString(), "2026-04-01T00:00:00.000Z");
    assert.equal(days, 31);
  });

  test("the comparison window is the same length, immediately before", () => {
    const custom = parseCustomRange("2026-03-01", "2026-03-31", now);
    const { from, previousFrom, days } = resolveRange("custom", now, custom);

    const gap = (from.getTime() - previousFrom.getTime()) / 86400000;
    assert.equal(gap, days);
    assert.equal(previousFrom.toISOString(), "2026-01-29T00:00:00.000Z");
  });

  test("custom without a window falls back to the preset behaviour", () => {
    // A `range=custom` query string with no dates must not produce an empty
    // or infinite window.
    const { days } = resolveRange("custom", now, null);
    assert.equal(days, 30);
  });

  test("a custom window captions its own comparison length", () => {
    assert.equal(rangeComparisonLabel("custom", 31), "vs. previous 31 days");
    assert.equal(rangeComparisonLabel("30d", 30), "vs. previous 30 days");
    // A preset ignores the passed length and uses its own definition.
    assert.equal(rangeComparisonLabel("7d", 99), "vs. previous 7 days");
  });
});
