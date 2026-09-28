import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createFakeDb, installFakeFetch, table, type FakeDb } from "./fixtures/fake-postgrest.ts";
import {
  DEFAULT_TIERS,
  MAX_TIER_PERCENT,
  effectivePlan,
  tierRateRangeLabel,
  tierSummary,
  validateTierEdit,
  countsTowardTier,
} from "../src/lib/affiliates/tier-rules.ts";
import { commissionForPayment, writeOffAmountMinor } from "../src/lib/affiliates/ledger-rules.ts";
import { selfBillingLines, SELF_BILLING_AT_LAUNCH } from "../src/lib/affiliates/payout-rules.ts";
import {
  latestReferral,
  parseCookie,
  serialiseCookie,
} from "../src/lib/affiliates/attribution-core.ts";
import { looksLikeReferralToken, withReferralParam } from "../src/lib/affiliates/referral-param.ts";

/**
 * The affiliate owner decisions of 2026-09-28, end to end where money moves:
 *
 * 1. `ct_ref` is set only after cookie consent; without it the referral is
 *    carried in the URL to signup (no storage). In the Cookie Policy.
 * 2. A negative balance at the end of a partnership is written off, never
 *    invoiced, with a WRITE_OFF ledger entry.
 * 3. No self-billing at launch; statements are remittance advice.
 * 4. Promo codes are removed from the UI (Stripe promotion codes judged
 *    disproportionate; see link-actions.ts).
 * 5. Commission is ONE-OFF on the first payment, on the FULL amount (annual
 *    not divided by 12); renewals earn nothing; refunds in the hold reverse.
 * 6. Tiers: Partner 6%, Pro Partner 8% (5 paid customers in 12 months),
 *    Elite Partner 10% (15). Nothing anywhere claims more than 10%.
 *
 * Supabase is the in-memory fake (fixtures/fake-postgrest); Stripe is never
 * called; no money moves.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake_never_used";
process.env.AFFILIATE_COOKIE_SECRET = "test-cookie-secret";

const db: FakeDb = createFakeDb();
const restore = installFakeFetch(db);
after(() => restore());

const commissions = await import("../src/lib/affiliates/commissions.ts");

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const AFF = "bbbbbbbb-0000-4000-8000-000000000001";
const REF = "bbbbbbbb-0000-4000-8000-000000000002";
const BIZ = "bbbbbbbb-0000-4000-8000-000000000003";
const PLAN = "bbbbbbbb-0000-4000-8000-000000000004";

function ledger() {
  return table(db, "affiliate_commissions");
}

beforeEach(() => {
  db.tables.clear();
  db.rpcs.clear();
  db.unique.set("affiliate_commissions", [["idempotency_key"]]);
  db.rpcs.set("affiliate_balances", (fake, args) => {
    const mine = table(fake, "affiliate_commissions").filter((row) => row.affiliate_id === args.p_affiliate_id);
    const available = mine
      .filter((row) => (row.status === "APPROVED" || row.status === "PAYABLE") && !row.payout_id)
      .reduce((acc, row) => acc + Number(row.commission_amount_minor), 0);
    return [{ available_minor: available }];
  });
  table(db, "affiliate_commission_plans").push({
    id: PLAN, name: "Partner 6% one-off", commission_type: "FIRST_PAYMENT_PERCENT", percent: 6, flat_amount_minor: null,
    currency: "GBP", recurring_months: 1, attribution_window_days: 90, cookie_window_days: 90, hold_days: 30,
    minimum_payout_minor: 5000, is_default: true, active: true,
  });
  for (const tier of DEFAULT_TIERS) {
    table(db, "affiliate_tiers").push({
      key: tier.key, name: tier.name, rank: tier.rank, min_active_customers: tier.minActiveCustomers,
      commission_percent: tier.commissionPercent, description: tier.description,
    });
  }
  table(db, "affiliates").push({
    id: AFF, user_id: "user-aff", status: "ACTIVE", commission_plan_id: PLAN, tier: "STANDARD", notification_prefs: {},
  });
  table(db, "affiliate_referrals").push({
    id: REF, affiliate_id: AFF, business_id: BIZ, status: "SIGNED_UP", paid_state: "NOT_PAID", paid_at: null,
    flagged_reason: null, renewal_count: 0, lifetime_revenue_minor: 0,
  });
});

function accrue(invoiceId: string, base: number, gross = Math.round(base * 1.2), paidAt?: string) {
  return commissions.accrueCommission({
    businessId: BIZ, amountPaidMinor: base, grossPaidMinor: gross, currency: "GBP", invoiceId, periodMonth: "2026-09-01", paidAt,
  });
}

/* ----------------------------------------------------- 5. one-off rule -- */

describe("one-off commission on the first payment", () => {
  test("only the first invoice earns: 6% of a £199 first monthly payment", async () => {
    const first = await accrue("in_first", 19900);
    assert.equal(first.status, "created");
    assert.equal(ledger()[0].commission_amount_minor, 1194);
    assert.equal(ledger()[0].entry_type, "NEW_CUSTOMER");
  });

  test("an annual plan pays the rate on the FULL first annual invoice, not a twelfth", async () => {
    const annualBase = 214900; // £2,149 ex VAT, one annual invoice
    await accrue("in_annual", annualBase);
    assert.equal(ledger()[0].commission_amount_minor, Math.round(annualBase * 0.06));
    assert.notEqual(ledger()[0].commission_amount_minor, Math.round((annualBase / 12) * 0.06));
  });

  test("a renewal, a second annual invoice and a later monthly invoice earn nothing", async () => {
    await accrue("in_1", 19900, 23880, "2026-01-10T00:00:00.000Z");
    assert.deepEqual(await accrue("in_2", 19900, 23880, "2026-02-10T00:00:00.000Z"), { status: "skipped", reason: "not_first_payment" });
    assert.deepEqual(await accrue("in_3", 214900, 257880, "2027-01-10T00:00:00.000Z"), { status: "skipped", reason: "not_first_payment" });
    assert.equal(ledger().length, 1);
  });

  test("the tier sets the one-off rate: Elite Partner earns 10%", async () => {
    table(db, "affiliates")[0].tier = "PREMIUM";
    await accrue("in_elite", 19900);
    assert.equal(ledger()[0].commission_amount_minor, 1990);
  });

  test("a full refund of the first payment inside the hold reverses the commission", async () => {
    await accrue("in_refund", 19900, 23880);
    const result = await commissions.reverseInvoiceCommission({
      invoiceId: "in_refund", reason: "REFUND", sourceRef: "refund:ch_1", cumulativeMinor: 23880, grossPaidMinor: 23880,
    });
    assert.equal(result.status, "reversed");
    assert.equal(ledger()[0].status, "REVERSED");
  });

  test("the pure rule agrees", () => {
    const plan = { commissionType: "FIRST_PAYMENT_PERCENT" as const, percent: 8, flatAmountMinor: null };
    assert.equal(commissionForPayment(plan, 10000, { paymentIndex: 0 }), 800);
    assert.equal(commissionForPayment(plan, 10000, { paymentIndex: 1 }), 0);
  });
});

/* ----------------------------------------------------------- 6. tiers -- */

describe("tiers are 6% / 8% / 10% by paid customers in the last 12 months", () => {
  test("the rates and thresholds", () => {
    assert.deepEqual(
      DEFAULT_TIERS.map((t) => [t.key, t.name, t.commissionPercent, t.minActiveCustomers]),
      [
        ["STANDARD", "Partner", 6, 0],
        ["PARTNER", "Pro Partner", 8, 5],
        ["PREMIUM", "Elite Partner", 10, 15],
      ],
    );
    assert.equal(MAX_TIER_PERCENT, 10);
    assert.equal(tierRateRangeLabel(DEFAULT_TIERS, 6), "6% to 10%");
    assert.match(tierSummary(DEFAULT_TIERS, 6), /Partner 6%; Pro Partner 8% from 5 paid referred customers in the last 12 months; Elite Partner 10% from 15/);
  });

  test("no tier or plan can pay more than 10%", () => {
    assert.ok(validateTierEdit([{ ...DEFAULT_TIERS[0], commissionPercent: 20 }]).length > 0);
    assert.equal(effectivePlan({ commissionType: "FIRST_PAYMENT_PERCENT" as const, percent: 6 }, { ...DEFAULT_TIERS[2], commissionPercent: 25 }).percent, 10);
  });

  test("the window is the last 12 months of first payments", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    assert.equal(countsTowardTier("2026-01-01T00:00:00Z", now), true);
    assert.equal(countsTowardTier("2025-09-01T00:00:00Z", now), false);
    assert.equal(countsTowardTier(null, now), false);
  });

  test("migration 0169 seeds exactly the code's tiers and caps rates at 10%", () => {
    const sql = read("supabase/migrations/0169_affiliate_one_off_commission_and_tiers.sql");
    for (const tier of DEFAULT_TIERS) {
      assert.match(sql, new RegExp(`\\('${tier.key}',\\s*'${tier.name}',\\s*${tier.rank},\\s*${tier.minActiveCustomers},\\s*0,\\s*${tier.commissionPercent},\\s*1,`));
    }
    assert.match(sql, /commission_percent <= 10/);
    assert.match(sql, /percent <= 10/);
    assert.match(sql, /'WRITE_OFF'/);
    assert.match(sql, /entry_type = 'RENEWAL'\s+and status in \('PENDING', 'APPROVED'\)/);
  });

  test("the public pages read the rates from the tier config", () => {
    const page = read("src/app/(marketing)/affiliates/page.tsx");
    assert.match(page, /loadTiers\(\)/);
    assert.match(page, /tierRateRangeLabel\(tiers/);
    assert.match(read("src/app/(marketing)/affiliates/terms/page.tsx"), /loadTiers\(\)/);
  });
});

/* ------------------------------------------- marketing copy (5 and 6) -- */

describe("no recurring claims and nothing above 10% on any affiliate surface", () => {
  const files = [
    "src/components/affiliates/public/affiliate-landing.tsx",
    "src/components/affiliates/public/affiliate-hero.tsx",
    "src/app/(marketing)/affiliates/page.tsx",
    "src/app/(marketing)/affiliates/terms/page.tsx",
    "src/app/affiliates/signup/page.tsx",
    "src/app/affiliates/app/help/page.tsx",
    "src/components/affiliates/tier/tier-progress-panel.tsx",
    "src/components/affiliates/onboarding-wizard.tsx",
    "src/components/admin/affiliates/programme-panels.tsx",
    "src/components/marketing/public/home/partner-frame.tsx",
    "src/components/auth/auth-brand-panel.tsx",
    "src/lib/affiliates/programme.ts",
  ];

  test("no recurring wording", () => {
    const recurring = /recurring commission|of every payment|for as long as the customer|ongoing earnings|lifetime commission|monthly commission|commission for 12 months|for the first \d+ months/i;
    for (const file of files) assert.doesNotMatch(read(file), recurring, file);
  });

  test("no percentage above 10% in affiliate copy", () => {
    for (const file of files) {
      for (const match of read(file).matchAll(/(\d+(?:\.\d+)?)%\s*(?:commission|one-off|of )/gi)) {
        assert.ok(Number(match[1]) <= 10, `${file}: ${match[0]}`);
      }
    }
  });

  test("the policy sentence is one-off, annual in full", async () => {
    const { describeCommission, FALLBACK_POLICY } = await import("../src/lib/affiliates/programme.ts");
    const text = describeCommission(FALLBACK_POLICY);
    assert.match(text, /one-off 6%/);
    assert.match(text, /full amount of an annual plan/);
    assert.match(text, /Renewals and later payments do not earn/);
  });
});

/* ------------------------------------------------ 1. consent cookie -- */

describe("ct_ref only after consent; URL-carried otherwise", () => {
  const secret = "test-cookie-secret";
  const value = (clickedAt: string, affiliateId = "aff-1") =>
    serialiseCookie(secret, { affiliateId, linkId: "link-1", clickedAt, expiresAt: "2099-01-01T00:00:00.000Z" });

  test("/r sets no cookie; it carries the signed referral in the landing URL", () => {
    const route = read("src/app/r/[slug]/route.ts");
    assert.doesNotMatch(route, /cookies\.set\(/);
    assert.match(route, /searchParams\.set\(\s*REFERRAL_PARAM/);
  });

  test("the cookie is set only by the consent endpoint, which the page calls only with consent", () => {
    const api = read("src/app/api/affiliates/referral/route.ts");
    assert.match(api, /cookies\.set\(REFERRAL_COOKIE_NAME/);
    assert.match(api, /isSameOriginRequest\(/);
    assert.match(api, /parseReferralToken\(/);
    const capture = read("src/components/marketing/referral-capture.tsx");
    assert.match(capture, /if \(carried && hasAnalyticsConsent\(\)\) void persist\(\)/);
    assert.match(capture, /choice === "accepted"\) void persist\(\)/);
    assert.match(capture, /method: "DELETE"/, "withdrawal deletes the cookie");
    assert.doesNotMatch(capture, /localStorage|sessionStorage|document\.cookie/, "nothing stored without consent");
  });

  test("the referral travels to signup in the URL and is verified there", () => {
    assert.match(read("src/app/(auth)/signup/signup-form.tsx"), /name="ct_ref"/);
    assert.match(read("src/lib/auth/actions.ts"), /referralToken: str\(formData, "ct_ref"\)/);
    assert.match(read("src/app/api/auth/google/callback/route.ts"), /referralToken: referralFromNext\(next\)/);
    assert.match(read("src/lib/affiliates/attribution.ts"), /latestReferral\(await readReferralCookie\(\), parseReferralToken\(input\.referralToken\)\)/);
  });

  test("the Cookie Policy lists ct_ref as optional, set only after acceptance", () => {
    const policy = read("src/app/(marketing)/cookies/page.tsx");
    const optional = policy.slice(policy.indexOf("const OPTIONAL"), policy.indexOf("const SECTIONS"));
    assert.match(optional, /name: "ct_ref"/);
    assert.match(optional, /Set only after you accept/);
    const essential = policy.slice(policy.indexOf("const ESSENTIAL"), policy.indexOf("const OPTIONAL"));
    assert.doesNotMatch(essential, /ct_ref/);
  });

  test("tokens: shape, forgery and last click", () => {
    const early = value("2026-09-01T00:00:00.000Z", "aff-early");
    const late = value("2026-09-20T00:00:00.000Z", "aff-late");
    assert.equal(looksLikeReferralToken(early), true);
    assert.equal(looksLikeReferralToken("not a token"), false);
    assert.equal(parseCookie(secret, early.replace(/.$/, "x")), null, "a forged signature is refused");
    const chosen = latestReferral(parseCookie(secret, early), parseCookie(secret, late));
    assert.equal(chosen?.affiliateId, "aff-late");
    assert.equal(latestReferral(null, parseCookie(secret, early))?.affiliateId, "aff-early");
  });

  test("the parameter is only ever added to same-site links", () => {
    assert.equal(withReferralParam("/pricing", "a.b", "https://clientturn.com"), "/pricing?ct_ref=a.b");
    assert.equal(withReferralParam("/signup?plan=pro#x", "a.b", "https://clientturn.com"), "/signup?plan=pro&ct_ref=a.b#x");
    assert.equal(withReferralParam("https://evil.example/", "a.b", "https://clientturn.com"), null);
  });
});

/* --------------------------------------------------- 2. write-off -- */

describe("a negative balance at the end is written off, not invoiced", () => {
  test("closing with -£15 writes one WRITE_OFF of £15 and closes the partner, once", async () => {
    ledger().push({
      id: "neg-1", affiliate_id: AFF, status: "APPROVED", entry_type: "REVERSAL", commission_amount_minor: -1500,
      payout_id: null, available_at: "2026-01-01T00:00:00.000Z", idempotency_key: "rev:1",
    });
    const result = await commissions.closePartnership({ affiliateId: AFF, actorUserId: "op-1", reason: "Partner left" });
    assert.deepEqual(result, { ok: true, writtenOffMinor: 1500 });
    const writeOff = ledger().find((row) => row.entry_type === "WRITE_OFF");
    assert.ok(writeOff);
    assert.equal(writeOff!.commission_amount_minor, 1500);
    assert.equal(writeOff!.idempotency_key, `writeoff:${AFF}`);
    assert.equal(table(db, "affiliates")[0].status, "CLOSED");
    const net = ledger().filter((r) => r.status === "APPROVED").reduce((a, r) => a + Number(r.commission_amount_minor), 0);
    assert.equal(net, 0, "the balance nets to zero");

    const again = await commissions.closePartnership({ affiliateId: AFF, actorUserId: "op-1", reason: "again" });
    assert.equal(again.writtenOffMinor, 0);
    assert.equal(ledger().filter((row) => row.entry_type === "WRITE_OFF").length, 1);
  });

  test("a positive balance is never written off", async () => {
    ledger().push({ id: "pos", affiliate_id: AFF, status: "APPROVED", entry_type: "NEW_CUSTOMER", commission_amount_minor: 900, payout_id: null, idempotency_key: "a:1" });
    const result = await commissions.closePartnership({ affiliateId: AFF, actorUserId: "op-1", reason: "done" });
    assert.equal(result.writtenOffMinor, 0);
    assert.equal(writeOffAmountMinor(900), 0);
    assert.equal(writeOffAmountMinor(-250), 250);
  });

  test("the terms and admin say so", () => {
    assert.match(read("src/app/(marketing)/affiliates/terms/page.tsx"), /deficit is written\s+off/);
    assert.match(read("src/components/admin/affiliates/programme-panels.tsx"), /never\s+invoiced/);
    assert.match(read("src/lib/admin/affiliate-actions.ts"), /export async function endPartnership/);
  });
});

/* -------------------------------------------- 3. no self-billing -- */

describe("no self-billing at launch", () => {
  test("statements are remittance advice even with an agreement flag", () => {
    assert.equal(SELF_BILLING_AT_LAUNCH, false);
    const lines = selfBillingLines({ taxCountry: "GB", vatRegistered: true, selfBillingAgreement: true });
    assert.match(lines[0], /Remittance advice, not a VAT invoice/);
    assert.match(lines[0], /send ClientTurn a VAT invoice/);
  });

  test("the terms and the payout UI state it", () => {
    assert.match(read("src/app/(marketing)/affiliates/terms/page.tsx"), /We do not operate self-billing/);
    assert.match(read("src/components/affiliates/payouts/payouts-view.tsx"), /We do not self-bill/);
  });
});

/* ------------------------------------------------ 4. promo codes -- */

describe("promo codes are removed from the programme", () => {
  test("no promo UI on the links page or in portal search", () => {
    const view = read("src/components/affiliates/links/links-view.tsx");
    assert.doesNotMatch(view, /<PromoCodes|requestPromoCode|label: "Promo code"|promoCodes/);
    assert.doesNotMatch(read("src/app/affiliates/app/links/page.tsx"), /listPromoCodes/);
    assert.doesNotMatch(read("src/app/affiliates/app/layout.tsx"), /listPromoCodes/);
  });

  test("the server actions refuse, with the decision recorded", () => {
    const actions = read("src/lib/affiliates/link-actions.ts");
    assert.match(actions, /const PROMO_CODES_ENABLED: boolean = false;/);
    assert.match(actions, /if \(!PROMO_CODES_ENABLED\) \{/);
    assert.match(actions, /disproportionate/);
  });

  test("the terms say there are no promo codes", () => {
    assert.match(read("src/app/(marketing)/affiliates/terms/page.tsx"), /There are no partner promo\s+codes/);
    assert.ok(existsSync(new URL("../src/app/api/affiliates/referral/route.ts", import.meta.url)));
  });
});
