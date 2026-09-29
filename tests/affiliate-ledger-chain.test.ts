import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createFakeDb, installFakeFetch, table, type FakeDb } from "./fixtures/fake-postgrest.ts";

/**
 * The affiliate attribution chain end to end through the REAL ledger code
 * (affiliate audit 17 §2, §4): paid invoice -> accrual (net of VAT) ->
 * partial and full refunds (cumulative, never double-counted) -> dispute ->
 * dispute won (re-accrual, the BILLING.md gap) -> fraud hold and clear ->
 * payout pending approval -> approve / cancel / retry.
 *
 * Supabase is an in-memory PostgREST behind `fetch` (fixtures/fake-postgrest),
 * and Stripe is never called: the invoice resolver is injected. No network,
 * no database, no money.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake_never_used";
process.env.AFFILIATE_COOKIE_SECRET = "test-cookie-secret";

const db: FakeDb = createFakeDb();
const restore = installFakeFetch(db);
after(() => restore());

const commissions = await import("../src/lib/affiliates/commissions.ts");
const payouts = await import("../src/lib/affiliates/payouts.ts");
const dispatch = await import("../src/lib/affiliates/dispatch.ts");
const events = await import("../src/lib/affiliates/billing-events.ts");

const AFF = "aaaaaaaa-0000-4000-8000-000000000001";
const REF = "aaaaaaaa-0000-4000-8000-000000000002";
const BIZ = "aaaaaaaa-0000-4000-8000-000000000003";
const PLAN = "aaaaaaaa-0000-4000-8000-000000000004";

const DAY = 24 * 60 * 60 * 1000;

function rows(name: string) {
  return table(db, name);
}

function ledger() {
  return rows("affiliate_commissions");
}

function registerRpcs() {
  db.rpcs.set("approve_due_commissions", (fake) => {
    let n = 0;
    for (const row of table(fake, "affiliate_commissions")) {
      if (row.status !== "PENDING") continue;
      const due = new Date(String(row.available_at ?? row.created_at)).getTime() <= Date.now();
      const referral = table(fake, "affiliate_referrals").find((r) => r.id === row.referral_id);
      if (due && (!referral || !referral.flagged_reason)) {
        row.status = "APPROVED";
        n += 1;
      }
    }
    return n;
  });
  db.rpcs.set("claim_commissions_for_payout", (fake, args) => {
    let total = 0;
    let count = 0;
    for (const row of table(fake, "affiliate_commissions")) {
      if (row.affiliate_id !== args.p_affiliate_id) continue;
      if (row.status !== "APPROVED" && row.status !== "PAYABLE") continue;
      if (row.payout_id) continue;
      if (new Date(String(row.available_at ?? row.created_at)).getTime() > Date.now()) continue;
      const referral = table(fake, "affiliate_referrals").find((r) => r.id === row.referral_id);
      if (Number(row.commission_amount_minor) >= 0 && referral?.flagged_reason) continue;
      row.payout_id = args.p_payout_id;
      row.status = "PAYABLE";
      total += Number(row.commission_amount_minor);
      count += 1;
    }
    return [{ claimed_minor: total, claimed_count: count }];
  });
  db.rpcs.set("affiliate_balances", (fake, args) => {
    const mine = table(fake, "affiliate_commissions").filter((row) => row.affiliate_id === args.p_affiliate_id);
    const sum = (predicate: (row: Record<string, unknown>) => boolean) =>
      mine.filter(predicate).reduce((acc, row) => acc + Number(row.commission_amount_minor), 0);
    const availablePred = (row: Record<string, unknown>) =>
      (row.status === "APPROVED" || row.status === "PAYABLE") &&
      !row.payout_id &&
      new Date(String(row.available_at ?? row.created_at)).getTime() <= Date.now();
    return [{
      pending_minor: sum((row) => row.status === "PENDING"),
      approved_minor: sum((row) => row.status === "APPROVED" || row.status === "PAYABLE"),
      available_minor: sum(availablePred),
      paid_minor: sum((row) => row.status === "PAID"),
      reversed_minor: sum((row) => row.status === "REVERSED"),
      lifetime_minor: sum((row) => row.status !== "REVERSED"),
      available_count: mine.filter(availablePred).length,
    }];
  });
}

beforeEach(() => {
  db.tables.clear();
  db.rpcs.clear();
  db.unique.set("affiliate_commissions", [["idempotency_key"]]);
  db.unique.set("affiliate_payouts", [["idempotency_key"]]);
  registerRpcs();
  rows("affiliate_commission_plans").push({
    id: PLAN, name: "Default", commission_type: "RECURRING_PERCENT", percent: 20, flat_amount_minor: null,
    currency: "GBP", recurring_months: 12, attribution_window_days: 90, cookie_window_days: 90, hold_days: 30,
    minimum_payout_minor: 1000, is_default: true, active: true,
  });
  rows("affiliates").push({
    id: AFF, user_id: "user-aff", status: "ACTIVE", commission_plan_id: PLAN, tier: "STANDARD", notification_prefs: {},
  });
  rows("affiliate_referrals").push({
    id: REF, affiliate_id: AFF, business_id: BIZ, status: "SIGNED_UP", paid_state: "NOT_PAID", paid_at: null,
    flagged_reason: null, renewal_count: 0, lifetime_revenue_minor: 0,
  });
});

async function accrue(invoiceId: string, opts: { base?: number; gross?: number; paidAt?: string } = {}) {
  return commissions.accrueCommission({
    businessId: BIZ,
    amountPaidMinor: opts.base ?? 10000,
    grossPaidMinor: opts.gross ?? 12000,
    currency: "GBP",
    invoiceId,
    periodMonth: "2026-09-01",
    paidAt: opts.paidAt,
  });
}

describe("accrual", () => {
  test("accrues 20% of the VAT-exclusive base, once per invoice", async () => {
    const first = await accrue("in_1");
    assert.equal(first.status, "created");
    assert.equal(ledger()[0].commission_amount_minor, 2000);
    assert.equal((ledger()[0].metadata as Record<string, unknown>).gross_paid_minor, 12000);
    assert.equal(ledger()[0].entry_type, "NEW_CUSTOMER");
    assert.deepEqual(await accrue("in_1"), { status: "duplicate" });
    assert.equal(ledger().length, 1);
    const referral = rows("affiliate_referrals")[0];
    assert.equal(referral.status, "PAID");
    assert.equal(referral.paid_state, "PAID");
  });

  test("one-off (owner decision 2026-09-28): the first invoice earns on its full amount, every later one earns nothing", async () => {
    const first = await accrue("in_y1", { base: 120000, gross: 144000, paidAt: "2026-01-10T00:00:00.000Z" });
    assert.equal(first.status, "created");
    // The fixture plan is a legacy RECURRING_PERCENT 20% row: read as one-off.
    assert.equal(ledger().find((row) => row.stripe_invoice_id === "in_y1")?.commission_amount_minor, 24000);
    const second = await accrue("in_y2", { base: 120000, gross: 144000, paidAt: "2027-01-10T00:00:00.000Z" });
    assert.deepEqual(second, { status: "skipped", reason: "not_first_payment" });
    const monthly = await accrue("in_m2", { paidAt: "2026-02-10T00:00:00.000Z" });
    assert.deepEqual(monthly, { status: "skipped", reason: "not_first_payment" });
    assert.equal(ledger().filter((row) => row.entry_type === "RENEWAL").length, 0);
  });

  test("a held referral accrues nothing; clearing replays its paid invoices from billing_invoices once", async () => {
    rows("affiliate_referrals")[0].flagged_reason = "SAME_DEVICE";
    assert.deepEqual(await accrue("in_h1"), { status: "skipped", reason: "flagged_for_review" });
    rows("billing_invoices").push({
      business_id: BIZ, stripe_invoice_id: "in_h1", billing_reason: "subscription_cycle", currency: "gbp",
      total_excluding_tax_minor: 10000, tax_minor: 2000, amount_paid_minor: 12000, period_start: "2026-09-01T00:00:00.000Z",
      paid_at: "2026-09-02T00:00:00.000Z",
    });
    rows("billing_invoices").push({
      business_id: BIZ, stripe_invoice_id: "in_topup", billing_reason: "manual", currency: "gbp",
      total_excluding_tax_minor: 5000, tax_minor: 1000, amount_paid_minor: 6000, period_start: null, paid_at: "2026-09-03T00:00:00.000Z",
    });
    rows("affiliate_referrals")[0].flagged_reason = null;
    assert.equal(await commissions.reaccrueReferral(BIZ), 1);
    assert.equal(await commissions.reaccrueReferral(BIZ), 0);
    assert.equal(ledger().length, 1);
    assert.equal(ledger()[0].commission_amount_minor, 2000);
  });

  test("a payment in another currency is left for an operator, not converted", async () => {
    const result = await commissions.accrueCommission({
      businessId: BIZ, amountPaidMinor: 10000, currency: "EUR", invoiceId: "in_eur", periodMonth: "2026-09-01",
    });
    assert.deepEqual(result, { status: "skipped", reason: "currency_mismatch" });
  });
});

describe("refunds", () => {
  test("partial refunds reverse proportionally from Stripe's cumulative amount, with no double count", async () => {
    await accrue("in_r");
    const half = await commissions.reverseInvoiceCommission({
      invoiceId: "in_r", reason: "REFUND", sourceRef: "refund:ch_r", cumulativeMinor: 6000, grossPaidMinor: 12000,
    });
    assert.deepEqual(half, { status: "reversed", reversedMinor: 1000, entries: 1 });
    // The same cumulative amount again (a replay) moves nothing.
    const replay = await commissions.reverseInvoiceCommission({
      invoiceId: "in_r", reason: "REFUND", sourceRef: "refund:ch_r", cumulativeMinor: 6000, grossPaidMinor: 12000,
    });
    assert.equal(replay.status, "duplicate");
    const negative = ledger().filter((row) => row.entry_type === "REVERSAL");
    assert.equal(negative.length, 1);
    assert.equal(negative[0].commission_amount_minor, -1000);
    // Still in its hold, so the clawback nets inside PENDING.
    assert.equal(negative[0].status, "PENDING");
    assert.equal(rows("affiliate_referrals")[0].paid_state, "PAID");

    const full = await commissions.reverseInvoiceCommission({
      invoiceId: "in_r", reason: "REFUND", sourceRef: "refund:ch_r", cumulativeMinor: 12000, grossPaidMinor: 12000,
    });
    assert.deepEqual(full, { status: "reversed", reversedMinor: 1000, entries: 1 });
    const net = ledger().reduce((sum, row) => sum + (row.status === "REVERSED" ? 0 : Number(row.commission_amount_minor)), 0);
    assert.equal(net, 0);
    assert.equal(rows("affiliate_referrals")[0].paid_state, "REFUNDED");
  });

  test("a full refund of unpaid commission flips it to REVERSED rather than adding rows", async () => {
    await accrue("in_f");
    await commissions.reverseInvoiceCommission({
      invoiceId: "in_f", reason: "REFUND", sourceRef: "refund:ch_f", cumulativeMinor: 12000, grossPaidMinor: 12000,
    });
    assert.equal(ledger().length, 1);
    assert.equal(ledger()[0].status, "REVERSED");
  });

  test("a refund of commission already paid is clawed back as an APPROVED negative row", async () => {
    await accrue("in_p");
    Object.assign(ledger()[0], { status: "PAID", payout_id: "po_done" });
    await commissions.reverseInvoiceCommission({
      invoiceId: "in_p", reason: "REFUND", sourceRef: "refund:ch_p", cumulativeMinor: 12000, grossPaidMinor: 12000,
    });
    const clawback = ledger().find((row) => row.entry_type === "REVERSAL");
    assert.equal(clawback?.status, "APPROVED");
    assert.equal(clawback?.commission_amount_minor, -2000);
    assert.equal(ledger()[0].status, "PAID", "a paid entry is never edited");
  });
});

describe("disputes", () => {
  test("a dispute reverses; a WON dispute re-accrues exactly that amount, once", async () => {
    await accrue("in_d");
    await commissions.reverseInvoiceCommission({
      invoiceId: "in_d", reason: "CHARGEBACK", sourceRef: "dispute:dp_1", cumulativeMinor: 12000,
    });
    assert.equal(ledger()[0].status, "REVERSED");
    assert.equal(rows("affiliate_referrals")[0].paid_state, "CHARGEBACK");

    assert.equal(await commissions.reaccrueDisputedCommission({ disputeId: "dp_1" }), 1);
    assert.equal(await commissions.reaccrueDisputedCommission({ disputeId: "dp_1" }), 0, "replay re-accrues nothing");
    const back = ledger().filter((row) => row.entry_type === "REACCRUAL");
    assert.equal(back.length, 1);
    assert.equal(back[0].commission_amount_minor, 2000);
    // Still inside the original hold: it waits with the original date.
    assert.equal(back[0].status, "PENDING");
    assert.equal(back[0].available_at, ledger()[0].available_at);
    assert.equal(rows("affiliate_referrals")[0].paid_state, "PAID");
  });

  test("a won dispute on paid commission re-accrues the clawback as APPROVED", async () => {
    await accrue("in_dp");
    Object.assign(ledger()[0], { status: "PAID", payout_id: "po_x" });
    await commissions.reverseInvoiceCommission({ invoiceId: "in_dp", reason: "CHARGEBACK", sourceRef: "dispute:dp_2", cumulativeMinor: 12000 });
    assert.equal(await commissions.reaccrueDisputedCommission({ disputeId: "dp_2" }), 1);
    const back = ledger().find((row) => row.entry_type === "REACCRUAL");
    assert.equal(back?.status, "APPROVED");
    const net = ledger()
      .filter((row) => row.entry_type !== "NEW_CUSTOMER")
      .reduce((sum, row) => sum + Number(row.commission_amount_minor), 0);
    assert.equal(net, 0, "clawback and re-accrual cancel out");
  });

  test("the job applies refund and dispute events with an injected resolver (no Stripe)", async () => {
    await accrue("in_job");
    const resolver = async () => "in_job";
    const refund = await events.applyAffiliateBillingEvent(
      { kind: "refund", eventId: "evt_1", chargeId: "ch_job", paymentIntentId: "pi_job", invoiceId: null, amountRefundedMinor: 12000, chargeAmountMinor: 12000 },
      resolver,
    );
    assert.equal(refund.status, "reversed");
    const lost = await events.applyAffiliateBillingEvent(
      { kind: "dispute_closed", eventId: "evt_2", disputeId: "dp_9", chargeId: null, paymentIntentId: null, invoiceId: null, disputedMinor: 12000, status: "lost" },
      resolver,
    );
    assert.equal(lost.status, "nothing");
    const missing = await events.applyAffiliateBillingEvent(
      { kind: "dispute_opened", eventId: "evt_3", disputeId: "dp_8", chargeId: "ch_x", paymentIntentId: null, invoiceId: null, disputedMinor: 100, status: "needs_response" },
      async () => null,
    );
    assert.equal(missing.status, "no_invoice");
  });
});

describe("payouts", () => {
  function approvedCommission(amount: number) {
    rows("affiliate_commissions").push({
      id: `c-${amount}-${ledger().length}`, affiliate_id: AFF, referral_id: REF, status: "APPROVED", entry_type: "RENEWAL",
      commission_amount_minor: amount, base_amount_minor: amount * 5, currency: "GBP", payout_id: null,
      available_at: new Date(Date.now() - DAY).toISOString(), created_at: new Date(Date.now() - 40 * DAY).toISOString(),
    });
  }

  test("the monthly run raises a payout PENDING APPROVAL; approval, then cancel releases the commission", async () => {
    approvedCommission(8000);
    const raised = await payouts.createPayout({
      affiliateId: AFF, periodStart: "2026-08-01", periodEnd: "2026-08-31", minimumPayoutMinor: 1000,
      method: "Stripe Connect", idempotencyKey: "payout:a:2026-08",
    });
    assert.equal(raised.status, "created");
    const payout = rows("affiliate_payouts")[0];
    assert.equal(payout.status, "DRAFT");
    assert.equal(payout.amount_minor, 8000);
    assert.equal(ledger()[0].status, "PAYABLE");

    assert.equal(await payouts.approveDraftPayout({ payoutId: String(payout.id), actorUserId: "admin" }), true);
    assert.equal(payout.status, "APPROVED");
    assert.equal(await payouts.approveDraftPayout({ payoutId: String(payout.id), actorUserId: "admin" }), false, "approving twice is a no-op");

    assert.equal(await payouts.cancelPayout(String(payout.id)), true);
    assert.equal(payout.status, "CANCELLED");
    assert.equal(ledger()[0].status, "APPROVED");
    assert.equal(ledger()[0].payout_id, null);
  });

  test("a clawback that nets the claim below the minimum releases everything and raises nothing", async () => {
    approvedCommission(1500);
    rows("affiliate_commissions").push({
      id: "neg", affiliate_id: AFF, referral_id: REF, status: "APPROVED", entry_type: "REVERSAL", commission_amount_minor: -800,
      currency: "GBP", payout_id: null, available_at: new Date(Date.now() - DAY).toISOString(), created_at: new Date().toISOString(),
    });
    const result = await payouts.createPayout({
      affiliateId: AFF, periodStart: "2026-08-01", periodEnd: "2026-08-31", minimumPayoutMinor: 1000,
      method: "Stripe Connect", idempotencyKey: "payout:b:2026-08",
    });
    assert.deepEqual(result, { status: "skipped", reason: "below_threshold" });
    assert.equal(rows("affiliate_payouts").length, 0);
    assert.ok(ledger().every((row) => row.payout_id === null && row.status === "APPROVED"));
  });

  test("retrying a failed payout re-claims the released commission instead of paying it twice", async () => {
    approvedCommission(9000);
    await payouts.createPayout({
      affiliateId: AFF, periodStart: "2026-08-01", periodEnd: "2026-08-31", minimumPayoutMinor: 1000,
      method: "Stripe Connect", idempotencyKey: "payout:c:2026-08", initialStatus: "APPROVED",
    });
    const payout = rows("affiliate_payouts")[0];
    assert.equal(await payouts.markPayoutFailed({ payoutId: String(payout.id), failureCode: "x", reason: "bank rejected" }), true);
    assert.equal(ledger()[0].payout_id, null, "failure releases the commission");

    assert.equal(await dispatch.retryFailedPayout(String(payout.id)), true);
    assert.equal(payout.status, "DRAFT", "a retried payout needs approval again");
    assert.equal(ledger()[0].payout_id, payout.id, "the commission is re-claimed into it");
    assert.equal(payout.amount_minor, 9000);
  });
});
