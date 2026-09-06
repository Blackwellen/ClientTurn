import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_DESTINATIONS,
  codeCandidate,
  commissionFor,
  conversionRate,
  formatMinor,
  formatRate,
  holdClearsAt,
  isAllowedDestination,
  isValidSlug,
  payoutBlocker,
  randomSuffix,
  referralLabel,
  referralUrl,
  type CommissionPlan,
} from "../src/lib/affiliates/types.ts";

import {
  clampCookieDays,
  looksAutomated,
  MAX_COOKIE_DAYS,
  parseCookie as parseCookieWith,
  serialiseCookie as serialiseCookieWith,
  visitorHash as visitorHashWith,
} from "../src/lib/affiliates/attribution-core.ts";

// The real secret comes from the environment at runtime; the codec only needs
// one to be stable, so the tests supply their own.
const SECRET = "test-signing-secret";
const serialiseCookie = (value: Parameters<typeof serialiseCookieWith>[1]) =>
  serialiseCookieWith(SECRET, value);
const parseCookie = (raw: string | undefined, now?: number) =>
  parseCookieWith(SECRET, raw, now);
const visitorHash = (ip: string, ua: string) => visitorHashWith(SECRET, ip, ua);

import { applicationGaps } from "../src/lib/admin/affiliates-types.ts";

import {
  EMPTY_DRAFT,
  ONBOARDING_STEPS,
  STEP_META,
  firstIncompleteStep,
  hasPayoutDetails,
  isPlausibleUrl,
  isStepComplete,
  nextStep,
  parseStep,
  previousStep,
  progressPercent,
  validateDraft,
  type OnboardingDraft,
} from "../src/lib/affiliates/onboarding.ts";

/**
 * The affiliate programme decides who gets paid what, so these tests are
 * written from the direction that matters: proving the arithmetic cannot pay
 * out more than was taken, and that a partner-supplied value cannot become a
 * redirect, a forged cookie or someone else's money.
 */

const RECURRING: CommissionPlan = {
  id: "plan-1",
  name: "Standard",
  commissionType: "RECURRING_PERCENT",
  percent: 20,
  flatAmountMinor: null,
  currency: "GBP",
  recurringMonths: null,
  attributionWindowDays: 60,
  cookieWindowDays: 60,
  holdDays: 30,
  minimumPayoutMinor: 5000,
};

describe("commission arithmetic", () => {
  test("recurring percent pays on every payment when there is no month limit", () => {
    assert.equal(commissionFor(RECURRING, 10000, 0), 2000);
    assert.equal(commissionFor(RECURRING, 10000, 11), 2000);
    assert.equal(commissionFor(RECURRING, 10000, 99), 2000);
  });

  test("recurring percent stops after the configured number of months", () => {
    const capped = { ...RECURRING, recurringMonths: 12 };
    assert.equal(commissionFor(capped, 10000, 11), 2000);
    assert.equal(commissionFor(capped, 10000, 12), 0, "month 13 must earn nothing");
  });

  test("first-payment percent pays once and never again", () => {
    const plan = { ...RECURRING, commissionType: "FIRST_PAYMENT_PERCENT" as const };
    assert.equal(commissionFor(plan, 10000, 0), 2000);
    assert.equal(commissionFor(plan, 10000, 1), 0);
  });

  test("a flat amount never exceeds what the customer actually paid", () => {
    const plan = {
      ...RECURRING,
      commissionType: "FLAT_AMOUNT" as const,
      flatAmountMinor: 5000,
    };
    assert.equal(commissionFor(plan, 10000, 0), 5000);
    // The customer paid less than the flat fee: paying 5000 would cost us money.
    assert.equal(commissionFor(plan, 3000, 0), 3000);
  });

  test("a misconfigured percent over 100 cannot pay out more than the base", () => {
    const broken = { ...RECURRING, percent: 150 };
    assert.equal(commissionFor(broken, 10000, 0), 10000);
  });

  test("a zero, negative or missing rate earns nothing", () => {
    assert.equal(commissionFor({ ...RECURRING, percent: 0 }, 10000, 0), 0);
    assert.equal(commissionFor({ ...RECURRING, percent: -20 }, 10000, 0), 0);
    assert.equal(commissionFor({ ...RECURRING, percent: null }, 10000, 0), 0);
  });

  test("a zero or refunded base earns nothing", () => {
    assert.equal(commissionFor(RECURRING, 0, 0), 0);
    assert.equal(commissionFor(RECURRING, -10000, 0), 0);
  });

  test("rounding is to the nearest penny, not always down", () => {
    // 3333 * 20% = 666.6
    assert.equal(commissionFor(RECURRING, 3333, 0), 667);
  });

  test("the hold period is measured in whole days from the payment", () => {
    const earned = new Date("2026-01-01T12:00:00.000Z");
    assert.equal(
      holdClearsAt(RECURRING, earned).toISOString(),
      "2026-01-31T12:00:00.000Z",
    );
  });
});

describe("payout eligibility", () => {
  const base = {
    status: "ACTIVE" as const,
    taxStatus: "VERIFIED",
    hasPaymentDetails: true,
    payableMinor: 10000,
    minimumPayoutMinor: 5000,
  };

  test("an eligible partner has no blocker", () => {
    assert.equal(payoutBlocker(base), null);
  });

  test("a suspended partner cannot be paid", () => {
    assert.match(payoutBlocker({ ...base, status: "SUSPENDED" })!, /not active/i);
  });

  test("missing payment details block before anything else", () => {
    const blocker = payoutBlocker({
      ...base,
      hasPaymentDetails: false,
      payableMinor: 0,
    });
    // Both conditions fail; the actionable one must be reported first.
    assert.match(blocker!, /payment details/i);
  });

  test("a balance under the minimum names both numbers", () => {
    const blocker = payoutBlocker({ ...base, payableMinor: 1000 });
    assert.match(blocker!, /£50\.00/);
    assert.match(blocker!, /£10\.00/);
  });

  test("invalid tax details block payment", () => {
    assert.match(payoutBlocker({ ...base, taxStatus: "INVALID" })!, /tax details/i);
  });
});

describe("referral links", () => {
  test("only the fixed destination list is accepted", () => {
    for (const entry of ALLOWED_DESTINATIONS) {
      assert.equal(isAllowedDestination(entry.path), true, entry.path);
    }
  });

  test("an arbitrary or external destination is refused", () => {
    // The whole point: a partner-chosen destination would make a link that
    // carries our brand into an open redirect.
    assert.equal(isAllowedDestination("https://evil.example.com"), false);
    assert.equal(isAllowedDestination("//evil.example.com"), false);
    assert.equal(isAllowedDestination("/app/settings"), false);
    assert.equal(isAllowedDestination("/pricing?next=//evil"), false);
    assert.equal(isAllowedDestination(""), false);
  });

  test("slugs accept only lowercase URL-safe shapes", () => {
    assert.equal(isValidSlug("autumn-newsletter"), true);
    assert.equal(isValidSlug("abc"), true);

    assert.equal(isValidSlug("ab"), false, "too short");
    assert.equal(isValidSlug("-leading"), false);
    assert.equal(isValidSlug("trailing-"), false);
    assert.equal(isValidSlug("Has-Capitals"), false);
    assert.equal(isValidSlug("has spaces"), false);
    assert.equal(isValidSlug("has/slash"), false);
    assert.equal(isValidSlug("a".repeat(41)), false, "too long");
  });

  test("the referral URL does not double up on slashes", () => {
    assert.equal(referralUrl("https://x.com", "abc"), "https://x.com/r/abc");
    assert.equal(referralUrl("https://x.com/", "abc"), "https://x.com/r/abc");
    assert.equal(referralUrl("https://x.com///", "abc"), "https://x.com/r/abc");
  });

  test("code candidates are URL-safe and never empty", () => {
    assert.equal(codeCandidate("Acme Marketing Ltd"), "acme-marketing-ltd");
    assert.equal(codeCandidate("  Café Déjà Vu  "), "cafe-deja-vu");
    assert.equal(codeCandidate("!!!"), "partner", "a name with no usable characters");
    assert.equal(codeCandidate("ab"), "partner", "too short to be distinctive");
    assert.equal(codeCandidate("Acme", "x9k2"), "acme-x9k2");

    const long = codeCandidate("a".repeat(80));
    assert.ok(long.length <= 24);
  });

  test("random suffixes avoid characters that are misread aloud", () => {
    const suffix = randomSuffix(200, () => 0.999999);
    assert.equal(/^[a-z0-9]+$/.test(suffix), true);
    for (const banned of ["i", "l", "o", "0", "1"]) {
      assert.equal(suffix.includes(banned), false, `${banned} is ambiguous`);
    }
  });
});

describe("referral identity", () => {
  test("a business with no opted-in label is shown by date, never by name", () => {
    const label = referralLabel(null, "2026-03-04T00:00:00.000Z");
    assert.match(label, /^Referral · /);
    assert.match(label, /2026/);
  });

  test("an opted-in label is used as given", () => {
    assert.equal(referralLabel("  Wilson Plumbing  ", "2026-03-04T00:00:00.000Z"), "Wilson Plumbing");
  });

  test("a blank label falls back rather than rendering nothing", () => {
    assert.match(referralLabel("   ", "2026-03-04T00:00:00.000Z"), /^Referral · /);
  });
});

describe("rates and money", () => {
  test("a rate with no clicks is null, not zero", () => {
    // "0% conversion" on a link nobody clicked reads as failure, not no data.
    assert.equal(conversionRate(0, 0), null);
    assert.equal(formatRate(conversionRate(0, 0)), "—");
    assert.equal(conversionRate(3, 100), 0.03);
  });

  test("small rates keep a decimal place", () => {
    assert.equal(formatRate(0.034), "3.4%");
    assert.equal(formatRate(0.25), "25%");
  });

  test("money is formatted in pounds from minor units", () => {
    assert.equal(formatMinor(5000), "£50.00");
    assert.equal(formatMinor(1), "£0.01");
    assert.equal(formatMinor(0), "£0.00");
  });
});

describe("attribution cookie", () => {
  const value = {
    affiliateId: "aff-1",
    linkId: "link-1",
    clickedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  test("a cookie round-trips", () => {
    assert.deepEqual(parseCookie(serialiseCookie(value)), value);
  });

  test("a cookie with no link id round-trips as null", () => {
    const anonymous = { ...value, linkId: null };
    assert.deepEqual(parseCookie(serialiseCookie(anonymous)), anonymous);
  });

  test("a tampered payload is rejected", () => {
    const raw = serialiseCookie(value);
    const [payload, signature] = raw.split(".");
    const forged = Buffer.from("someone-else|link-1|x|y").toString("base64url");
    assert.equal(parseCookie(`${forged}.${signature}`), null);
    assert.equal(parseCookie(`${payload}.notasignature`), null);
  });

  test("an expired cookie is rejected even though it is validly signed", () => {
    const expired = serialiseCookie({
      ...value,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(parseCookie(expired), null);
  });

  test("nonsense is rejected rather than throwing", () => {
    assert.equal(parseCookie(undefined), null);
    assert.equal(parseCookie(""), null);
    assert.equal(parseCookie("no-dot-here"), null);
    assert.equal(parseCookie("!!!.!!!"), null);
  });

  test("a cookie signed with a different secret is rejected", () => {
    assert.equal(parseCookie(serialiseCookieWith("another-secret", value)), null);
  });

  test("a malformed expiry is rejected rather than treated as never expiring", () => {
    assert.equal(parseCookie(serialiseCookie({ ...value, expiresAt: "soon" })), null);
  });
});

describe("cookie window", () => {
  test("a window is clamped to the maximum we are willing to honour", () => {
    assert.equal(clampCookieDays(60), 60);
    assert.equal(clampCookieDays(9999), MAX_COOKIE_DAYS);
    assert.equal(clampCookieDays(0), 1);
    assert.equal(clampCookieDays(-30), 1);
    assert.equal(clampCookieDays(Number.NaN), 1);
  });
});

describe("visitor identity", () => {
  test("the same visitor hashes stably, a different one does not collide", () => {
    const a = visitorHash("1.2.3.4", "Mozilla/5.0");
    assert.equal(a, visitorHash("1.2.3.4", "Mozilla/5.0"));
    assert.notEqual(a, visitorHash("1.2.3.5", "Mozilla/5.0"));
    assert.notEqual(a, visitorHash("1.2.3.4", "Safari"));
  });

  test("the raw address never survives into the hash", () => {
    assert.equal(visitorHash("1.2.3.4", "Mozilla/5.0").includes("1.2.3.4"), false);
  });
});

describe("bot filtering", () => {
  test("obvious automation is flagged", () => {
    for (const agent of [
      "Googlebot/2.1",
      "curl/8.4.0",
      "python-requests/2.31",
      "HeadlessChrome/120",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "WhatsApp Preview",
    ]) {
      assert.equal(looksAutomated(agent), true, agent);
    }
  });

  test("an empty user agent is treated as automation", () => {
    assert.equal(looksAutomated(""), true);
    assert.equal(looksAutomated("   "), true);
  });

  test("real browsers are not flagged", () => {
    // A person misclassified as a bot costs their referrer a commission, so
    // this direction matters more than catching every crawler.
    for (const agent of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Firefox/121.0",
    ]) {
      assert.equal(looksAutomated(agent), false, agent);
    }
  });
});

describe("application review", () => {
  const complete = {
    id: "a",
    code: "acme",
    displayName: "Acme",
    companyName: "Acme Ltd",
    contactEmail: "a@example.com",
    websiteUrl: "https://acme.example.com",
    country: "United Kingdom",
    audienceDescription:
      "A newsletter of about four thousand UK tradespeople, mostly plumbers and electricians.",
    promotionMethods: ["Newsletter"],
    status: "APPLIED",
    statusReason: null,
    taxStatus: "NOT_PROVIDED",
    hasPaymentDetails: false,
    planName: null,
    clicks: 0,
    referrals: 0,
    paying: 0,
    pendingMinor: 0,
    payableMinor: 0,
    paidMinor: 0,
    lifetimeMinor: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    approvedAt: null,
  };

  test("a complete application has nothing flagged", () => {
    assert.deepEqual(applicationGaps(complete), []);
  });

  test("each missing piece is named separately", () => {
    const gaps = applicationGaps({
      ...complete,
      websiteUrl: null,
      audienceDescription: "Some people",
      promotionMethods: [],
    });
    assert.equal(gaps.length, 3);
  });

  test("gaps are advisory only and never block, so they carry no verdict", () => {
    const gaps = applicationGaps({ ...complete, websiteUrl: null });
    assert.equal(gaps.length, 1);
    assert.equal(/reject|refuse|denied/i.test(gaps[0]), false);
  });
});

/* ------------------------------------------------------- partner onboarding */

describe("onboarding steps", () => {
  const complete: OnboardingDraft = {
    displayName: "Acme Marketing",
    companyName: "Acme Ltd",
    contactEmail: "partner@example.com",
    websiteUrl: "https://acme.example.com",
    country: "United Kingdom",
    audienceDescription:
      "A newsletter of about four thousand UK tradespeople, mostly plumbers and electricians.",
    audienceSize: "4,000 subscribers",
    promotionMethods: ["Newsletter"],
    payoutMethod: "BANK_TRANSFER",
    payoutAccountName: "Acme Ltd",
    payoutReference: "ACME-2026",
    acceptedTerms: true,
  };

  test("a complete draft passes every step", () => {
    assert.deepEqual(validateDraft(complete), []);
    assert.equal(firstIncompleteStep(complete), null);
    for (const step of ONBOARDING_STEPS) {
      assert.equal(isStepComplete(step, complete), true, step);
    }
  });

  test("the empty draft stops at the first step, not the last", () => {
    assert.equal(firstIncompleteStep(EMPTY_DRAFT), "profile");
  });

  /* ------------------------------------------------------------- profile */

  test("a name and a valid contact email are required", () => {
    assert.equal(isStepComplete("profile", { ...complete, displayName: "A" }), false);
    assert.equal(isStepComplete("profile", { ...complete, contactEmail: "nope" }), false);
    assert.equal(isStepComplete("profile", { ...complete, contactEmail: "" }), false);
  });

  test("a website is optional, but a malformed one is refused", () => {
    // No website at all is fine — plenty of partners promote off-web.
    assert.equal(isStepComplete("profile", { ...complete, websiteUrl: "" }), true);
    assert.equal(
      isStepComplete("profile", { ...complete, websiteUrl: "acme.example.com" }),
      false,
      "a bare domain has no scheme",
    );
    assert.equal(
      isStepComplete("profile", { ...complete, websiteUrl: "https://acme" }),
      false,
      "no dot means it is not a hostname",
    );
    assert.equal(isPlausibleUrl("http://acme.co.uk"), true);
  });

  /* ------------------------------------------------------------ audience */

  test("the audience description is the field a reviewer reads, so it has a floor", () => {
    assert.equal(
      isStepComplete("audience", { ...complete, audienceDescription: "Some people" }),
      false,
    );
    assert.equal(
      isStepComplete("audience", { ...complete, audienceDescription: "   ".repeat(30) }),
      false,
      "whitespace is not a description",
    );
  });

  test("audience size is optional", () => {
    assert.equal(isStepComplete("audience", { ...complete, audienceSize: "" }), true);
  });

  /* ----------------------------------------------------------- promotion */

  test("at least one promotion method is required", () => {
    assert.equal(
      isStepComplete("promotion", { ...complete, promotionMethods: [] }),
      false,
    );
  });

  /* -------------------------------------------------------------- payout */

  test("payout details are optional entirely", () => {
    const none = {
      ...complete,
      payoutMethod: "" as const,
      payoutAccountName: "",
      payoutReference: "",
    };
    assert.equal(isStepComplete("payout", none), true);
    assert.equal(hasPayoutDetails(none), false);
    // And an application without them is still submittable.
    assert.deepEqual(validateDraft(none), []);
  });

  test("half-filled payout details are refused", () => {
    // The dangerous state: it looks saved but silently fails at payout time.
    assert.equal(
      isStepComplete("payout", { ...complete, payoutReference: "" }),
      false,
    );
    assert.equal(
      isStepComplete("payout", { ...complete, payoutAccountName: "" }),
      false,
    );
    assert.equal(
      isStepComplete("payout", { ...complete, payoutMethod: "" }),
      false,
      "a name and reference with no method cannot be paid",
    );
  });

  test("hasPayoutDetails needs all three parts", () => {
    assert.equal(hasPayoutDetails(complete), true);
    assert.equal(hasPayoutDetails({ ...complete, payoutReference: "ab" }), false);
  });

  /* -------------------------------------------------------------- review */

  test("the terms must be accepted to submit", () => {
    assert.equal(isStepComplete("review", { ...complete, acceptedTerms: false }), false);
    assert.equal(validateDraft({ ...complete, acceptedTerms: false }).length, 1);
  });

  test("validateDraft reports problems from every step, not just the last", () => {
    const problems = validateDraft({
      ...EMPTY_DRAFT,
      acceptedTerms: false,
    });
    // profile (name + email), audience, promotion, review — payout is optional.
    assert.ok(problems.length >= 4, `expected several problems, got ${problems.length}`);
  });

  /* ---------------------------------------------------------- navigation */

  test("steps run in order and stop at both ends", () => {
    assert.equal(previousStep("profile"), null);
    assert.equal(nextStep("profile"), "audience");
    assert.equal(nextStep("review"), null);
    assert.equal(previousStep("review"), "payout");
  });

  test("progress runs from zero to a hundred across the steps", () => {
    assert.equal(progressPercent("profile"), 0);
    assert.equal(progressPercent("review"), 100);
    assert.ok(progressPercent("promotion") > progressPercent("audience"));
  });

  test("an unknown step falls back to the first rather than throwing", () => {
    assert.equal(parseStep("audience"), "audience");
    assert.equal(parseStep("nonsense"), "profile");
    assert.equal(parseStep(undefined), "profile");
    assert.equal(parseStep(7), "profile");
  });

  test("every step has copy a person can read", () => {
    for (const step of ONBOARDING_STEPS) {
      assert.ok(STEP_META[step].title.length > 2, step);
      assert.ok(STEP_META[step].description.length > 10, step);
    }
  });
});
