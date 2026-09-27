import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWANCE_ALERT_THRESHOLDS,
  CHOOSE_PLAN_HREF,
  allowanceAlertFor,
  allowancePercentUsed,
  allowanceRemaining,
  creditBundleHref,
  crossedThreshold,
  mostUrgentAlert,
  nextAllowanceAlert,
  parseBundleParam,
  periodResetDate,
  projectedShortfall,
  recommendBundle,
  watermarkForPeriod,
  type AllowanceAlertInput,
  type AllowanceAlertThreshold,
} from "../src/lib/billing/allowance-alerts.ts";
import { upsellFor } from "../src/lib/billing/limits.ts";
import { MESSAGE_CREDIT_BUNDLES, creditBundlesFor } from "../src/lib/billing/plans.ts";

/**
 * The running-low rule for SMS / WhatsApp (owner request 2026-09-27: "When
 * SMS runs out, prompt them when coming up to it to buy a pack"). One pure
 * module decides it for the notification, the banner and the Usage & limits
 * row, so these tests are the contract all three share.
 */

const SMS_BUNDLES = MESSAGE_CREDIT_BUNDLES.filter((bundle) => bundle.channel === "sms");
const PERIOD_START = "2026-09-01T00:00:00.000Z";
const PERIOD_END = "2026-10-01T00:00:00.000Z";

function input(overrides: Partial<AllowanceAlertInput> = {}): AllowanceAlertInput {
  return {
    channel: "sms",
    trial: false,
    allowance: 1000,
    usedThisPeriod: 0,
    creditBalance: 0,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    now: new Date("2026-09-16T00:00:00.000Z"),
    bundles: creditBundlesFor({ whatsappEnabled: true }),
    ...overrides,
  };
}

describe("thresholds: 75%, 90% and run out", () => {
  test("the thresholds are exactly 75, 90 and 100", () => {
    assert.deepEqual([...ALLOWANCE_ALERT_THRESHOLDS], [75, 90, 100]);
  });

  test("below 75% there is nothing to say", () => {
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 749, creditBalance: 0 }), null);
    assert.equal(allowanceAlertFor(input({ usedThisPeriod: 749 })), null);
  });

  test("75%, 90% and 100% of the allowance", () => {
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 750, creditBalance: 0 }), 75);
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 899, creditBalance: 0 }), 75);
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 900, creditBalance: 0 }), 90);
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 999, creditBalance: 0 }), 90);
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 1000, creditBalance: 0 }), 100);
  });

  test("run out is exact: 99.9% with one unit left is still 90", () => {
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 999, creditBalance: 0 }), 90);
    assert.ok(allowancePercentUsed({ allowance: 1000, usedThisPeriod: 999, creditBalance: 0 }) < 100);
  });

  test("top-up credit counts as remaining", () => {
    // Allowance used up, but 1,000 credits bought: 1,000 of 2,000 used.
    const position = { allowance: 1000, usedThisPeriod: 1000, creditBalance: 1000 };
    assert.equal(allowanceRemaining(position), 1000);
    assert.equal(allowancePercentUsed(position), 50);
    assert.equal(crossedThreshold(position), null);
    // 800 of the credit spent: 1,800 used, 200 left = 90%.
    assert.equal(crossedThreshold({ allowance: 1000, usedThisPeriod: 1800, creditBalance: 200 }), 90);
  });

  test("nothing available and nothing used (WhatsApp before any credit) is not an alert", () => {
    assert.equal(crossedThreshold({ allowance: 0, usedThisPeriod: 0, creditBalance: 0 }), null);
  });

  test("WhatsApp with no allowance runs on credit alone", () => {
    assert.equal(crossedThreshold({ allowance: 0, usedThisPeriod: 225, creditBalance: 25 }), 90);
    assert.equal(crossedThreshold({ allowance: 0, usedThisPeriod: 250, creditBalance: 0 }), 100);
  });
});

describe("once per threshold per period", () => {
  function run(steps: (AllowanceAlertThreshold | null)[], start = 0) {
    let watermark = start;
    const notified: AllowanceAlertThreshold[] = [];
    for (const crossed of steps) {
      const next = nextAllowanceAlert({ crossed, watermark });
      if (next.notify !== null) notified.push(next.notify);
      watermark = next.watermark;
    }
    return { notified, watermark };
  }

  test("each threshold is announced once as usage climbs", () => {
    const { notified } = run([null, 75, 75, 75, 90, 90, 100, 100, 100]);
    assert.deepEqual(notified, [75, 90, 100]);
  });

  test("jumping two thresholds at once announces only the higher", () => {
    assert.deepEqual(run([null, 90, 100]).notified, [90, 100]);
  });

  test("a stored watermark stops a repeat (a second send in the same period)", () => {
    assert.deepEqual(run([75, 75], 75).notified, []);
    assert.deepEqual(run([90], 90).notified, []);
  });

  test("a top-up re-arms: running low again later is announced again", () => {
    // 90% -> bought a pack (back under 75%) -> 75% -> 90% again.
    const { notified } = run([90, null, 75, 90], 0);
    assert.deepEqual(notified, [90, 75, 90]);
  });

  test("a new period starts un-warned", () => {
    const stored = { periodStart: "2026-08-01T00:00:00.000Z", warnedAtPercent: 100 };
    assert.equal(watermarkForPeriod(stored, PERIOD_START), 0);
    assert.equal(watermarkForPeriod({ ...stored, periodStart: PERIOD_START }, PERIOD_START), 100);
    // Same instant written differently still counts as the same period.
    assert.equal(watermarkForPeriod({ periodStart: "2026-09-01T00:00:00+00:00", warnedAtPercent: 90 }, PERIOD_START), 90);
    assert.equal(watermarkForPeriod(null, PERIOD_START), 0);
    const next = nextAllowanceAlert({ crossed: 75, watermark: watermarkForPeriod(stored, PERIOD_START) });
    assert.equal(next.notify, 75);
  });
});

describe("the recommended pack", () => {
  test("projected shortfall at the period's daily rate", () => {
    // 15 days in, 750 used = 50/day; 15 days left = 750 more; 250 left.
    assert.equal(
      projectedShortfall({
        usedThisPeriod: 750,
        remaining: 250,
        periodStart: PERIOD_START,
        resetsAt: new Date(PERIOD_END),
        now: new Date("2026-09-16T00:00:00.000Z"),
      }),
      500,
    );
  });

  test("no shortfall when what is left covers the rest of the period", () => {
    assert.equal(
      projectedShortfall({
        usedThisPeriod: 750,
        remaining: 250,
        periodStart: PERIOD_START,
        resetsAt: new Date(PERIOD_END),
        now: new Date("2026-09-29T00:00:00.000Z"),
      }),
      0,
    );
  });

  test("the rate is taken over at least a day", () => {
    // 100 used in the first hour does not project 2,400 a day.
    const shortfall = projectedShortfall({
      usedThisPeriod: 100,
      remaining: 0,
      periodStart: PERIOD_START,
      resetsAt: new Date("2026-09-03T01:00:00.000Z"),
      now: new Date("2026-09-01T01:00:00.000Z"),
    });
    assert.equal(shortfall, 200);
  });

  test("the smallest pack covering the shortfall", () => {
    assert.equal(recommendBundle({ channel: "sms", shortfall: 0, bundles: SMS_BUNDLES })?.key, "sms_100");
    assert.equal(recommendBundle({ channel: "sms", shortfall: 100, bundles: SMS_BUNDLES })?.key, "sms_100");
    assert.equal(recommendBundle({ channel: "sms", shortfall: 101, bundles: SMS_BUNDLES })?.key, "sms_500");
    assert.equal(recommendBundle({ channel: "sms", shortfall: 500, bundles: SMS_BUNDLES })?.key, "sms_500");
    assert.equal(recommendBundle({ channel: "sms", shortfall: 501, bundles: SMS_BUNDLES })?.key, "sms_1000");
  });

  test("capped at the largest pack", () => {
    assert.equal(recommendBundle({ channel: "sms", shortfall: 50_000, bundles: SMS_BUNDLES })?.key, "sms_1000");
  });

  test("only the channel's own packs, and none where the workspace cannot buy any", () => {
    const bundles = creditBundlesFor({ whatsappEnabled: true });
    assert.equal(recommendBundle({ channel: "whatsapp", shortfall: 1500, bundles })?.key, "whatsapp_tokens_2000");
    assert.equal(
      recommendBundle({ channel: "whatsapp", shortfall: 1, bundles: creditBundlesFor({ whatsappEnabled: false }) }),
      null,
    );
  });

  test("prices come from the catalogue", () => {
    const alert = allowanceAlertFor(input({ usedThisPeriod: 750 }));
    assert.ok(alert?.recommended);
    const catalogue = MESSAGE_CREDIT_BUNDLES.find((bundle) => bundle.key === alert.recommended!.key);
    assert.equal(alert.recommended.priceGbp, catalogue?.priceGbp);
    assert.match(alert.body, new RegExp(`£${catalogue!.priceGbp}`));
  });

  test("the one-click link opens Message credits with the pack selected", () => {
    const alert = allowanceAlertFor(input({ usedThisPeriod: 750 }));
    assert.equal(alert?.recommended?.key, "sms_500");
    assert.equal(alert?.action.href, "/app/settings?section=billing&bundle=sms_500#message-credits");
    assert.equal(alert?.action.href, creditBundleHref("sms_500"));
    assert.equal(alert?.action.label, "Buy SMS credits");
  });

  test("the link's bundle is accepted only when the workspace can buy it", () => {
    const smsOnly = creditBundlesFor({ whatsappEnabled: false });
    assert.equal(parseBundleParam("sms_500", smsOnly), "sms_500");
    assert.equal(parseBundleParam("whatsapp_tokens_1000", smsOnly), null);
    assert.equal(parseBundleParam("sms_9999", smsOnly), null);
    assert.equal(parseBundleParam(["sms_100", "sms_500"], smsOnly), "sms_100");
    assert.equal(parseBundleParam(undefined, smsOnly), null);
  });
});

describe("copy: paid versus trial", () => {
  test("75%: segments left, the reset date, and what happens at zero", () => {
    const alert = allowanceAlertFor(input({ usedThisPeriod: 750 }))!;
    assert.equal(alert.threshold, 75);
    assert.equal(alert.tone, "warning");
    assert.equal(alert.title, "SMS is 75% used: 250 SMS segments left");
    assert.match(alert.body, /250 SMS segments left/);
    assert.match(alert.body, /resets on 1 October 2026/);
    assert.match(alert.body, /no new texts go out/);
    assert.match(alert.body, /AI replies to leads who text back go by email where the lead has an email address/);
    assert.match(alert.body, /otherwise the lead is handed to your team/);
    assert.match(alert.body, /Nothing is charged beyond the credit you buy/);
    assert.doesNotMatch(alert.body, /[Oo]verage/);
    assert.match(alert.body, /about 500 more/);
    assert.match(alert.body, /Non-refundable once any credit is used\./);
  });

  test("the credit balance is named alongside the allowance", () => {
    const alert = allowanceAlertFor(input({ usedThisPeriod: 950, creditBalance: 100 }))!;
    assert.equal(alert.remaining, 150);
    assert.match(alert.body, /50 of this period's allowance and 100 top-up credit/);
  });

  test("run out: says sending has stopped and what happens to replies, with no overage", () => {
    const alert = allowanceAlertFor(input({ usedThisPeriod: 1000 }))!;
    assert.equal(alert.threshold, 100);
    assert.equal(alert.tone, "danger");
    assert.equal(alert.title, "You've run out of SMS");
    assert.match(alert.body, /no SMS allowance or top-up credit left, so no new texts go out/);
    assert.doesNotMatch(alert.body, /[Oo]verage/);
    assert.equal(alert.action.label, "Buy SMS credits");
  });

  test("WhatsApp names tokens and the replies they cover, never £, and has no reset", () => {
    const alert = allowanceAlertFor(input({ channel: "whatsapp", allowance: 0, usedThisPeriod: 200, creditBalance: 50 }))!;
    assert.equal(alert.threshold, 75);
    assert.match(alert.title, /50 WhatsApp tokens left/);
    assert.match(alert.body, /50 WhatsApp tokens left \(about 25 conversation replies or 10 marketing messages\)/);
    assert.match(alert.body, /no included allowance; WhatsApp tokens never expire/);
    assert.match(alert.body, /Nothing is charged beyond the tokens you buy/);
    assert.doesNotMatch(alert.body, /credit left|[0-9]p\b/);
    assert.equal(alert.action.label, "Buy WhatsApp tokens");
  });

  test("a trial is pointed at its plan, never at a pack", () => {
    const alert = allowanceAlertFor(
      input({
        trial: true,
        allowance: 8,
        usedThisPeriod: 8,
        bundles: [],
        trialEndsAt: "2026-09-20T12:00:00.000Z",
      }),
    )!;
    assert.equal(alert.trial, true);
    assert.equal(alert.recommended, null);
    assert.equal(alert.title, "Start your plan to keep texting");
    assert.deepEqual(alert.action, { label: "Upgrade now", href: CHOOSE_PLAN_HREF });
    assert.match(alert.body, /Upgrade now to start your plan today/);
    assert.match(alert.body, /20 September 2026/);
    assert.doesNotMatch(alert.body, /£/);
    assert.doesNotMatch(alert.body, /Non-refundable/);
  });

  test("a trial at 75% also names the plan, not a pack", () => {
    const alert = allowanceAlertFor(input({ trial: true, allowance: 8, usedThisPeriod: 6, bundles: [] }))!;
    assert.equal(alert.threshold, 75);
    assert.match(alert.title, /start your plan to keep texting/);
    assert.match(alert.body, /2 of the trial's 8 SMS segments left/);
    assert.equal(alert.action.href, CHOOSE_PLAN_HREF);
  });
});

describe("one rule for every surface", () => {
  test("the Usage & limits upsell appears from 75% when handed the alert's level", () => {
    // Plain upsellFor is silent at 75%; with the alert's level it offers packs.
    assert.equal(upsellFor({ metric: "sms", plan: "starter", used: 750, limit: 1000 }), null);
    const offer = upsellFor({ metric: "sms", plan: "starter", used: 750, limit: 1000, level: "warning" });
    assert.equal(offer?.level, "warning");
    assert.ok(offer!.topUps.length > 0);
    // Credit covering it: no alert, so no upsell either.
    assert.equal(upsellFor({ metric: "sms", plan: "starter", used: 1000, limit: 1000, level: "ok" }), null);
  });

  test("the banner picks run out over running low", () => {
    const low = allowanceAlertFor(input({ usedThisPeriod: 760 }));
    const out = allowanceAlertFor(input({ channel: "whatsapp", allowance: 0, usedThisPeriod: 10 }));
    assert.equal(mostUrgentAlert([low, out])?.channel, "whatsapp");
    assert.equal(mostUrgentAlert([null, null]), null);
  });

  test("the reset date falls back to a month after the period start", () => {
    assert.equal(periodResetDate(PERIOD_START, null).toISOString(), PERIOD_END);
    assert.equal(periodResetDate(PERIOD_START, "2026-09-15T00:00:00.000Z").toISOString(), "2026-09-15T00:00:00.000Z");
  });
});
