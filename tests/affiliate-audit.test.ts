import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assessPayment,
  assessSignup,
  CLICK_RATE_LIMIT,
  decideFlag,
  deviceHash,
  emailHash,
  FRAUD_CODES,
  FRAUD_LABEL,
  FRAUD_SEVERITY,
  ipHash,
  isFreeMailDomain,
  isPrefetch,
  normaliseEmail,
  proxySuspected,
  type SignupEvidence,
} from "../src/lib/affiliates/fraud-rules.ts";
import {
  commissionBaseMinor,
  commissionForPayment,
  disputeReversalMinor,
  isCommissionableInvoice,
  monthsBetween,
  negativeBalanceNotice,
  planReaccrual,
  planReversalWrite,
  refundReversalMinor,
} from "../src/lib/affiliates/ledger-rules.ts";
import {
  DEFAULT_TIERS,
  earnedTier,
  effectivePlan,
  evaluateTier,
  isTierReviewDay,
  salesTierBreakdown,
  tierProgress,
  validateTierEdit,
  type TierDefinition,
} from "../src/lib/affiliates/tier-rules.ts";
import {
  autoDispatchAllowed,
  canTransitionPayout,
  payoutRunDecision,
  selfBillingLines,
} from "../src/lib/affiliates/payout-rules.ts";
import { billingEventJobKey, disputeEvent, refundEvent } from "../src/lib/affiliates/billing-event-rules.ts";
import { looksAutomated, parseCookie, serialiseCookie } from "../src/lib/affiliates/attribution-core.ts";
import { describeAttribution, FALLBACK_POLICY } from "../src/lib/affiliates/programme.ts";
import { referralLabel } from "../src/lib/affiliates/types.ts";

/**
 * Affiliate audit 17 (docs/revenue-engine/17-affiliate-audit.md): the pure
 * rules behind every fix, plus source checks that the wiring holds. The
 * end-to-end ledger chain runs in tests/affiliate-ledger-chain.test.ts.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

/* ------------------------------------------------------------ §1 clicks -- */

describe("click tracking", () => {
  test("attribution is last click everywhere it is stated", () => {
    assert.equal(FALLBACK_POLICY.attributionModel, "LAST_TOUCH");
    assert.match(describeAttribution(FALLBACK_POLICY), /last affiliate link/i);
    const route = read("src/app/r/[slug]/route.ts");
    assert.match(route, /Attribution is \*\*last click\*\*/);
    // Every counted click carries a fresh signed referral in the URL (the
    // cookie is only set after consent, owner decision 2026-09-28).
    assert.match(route, /referred\.searchParams\.set\(\s*REFERRAL_PARAM/);
    assert.match(read("src/app/(marketing)/affiliates/terms/page.tsx"), /describeAttribution\(policy\)/);
  });

  test("the cookie window is the crediting partner's plan, not always the default", () => {
    const route = read("src/app/r/[slug]/route.ts");
    assert.match(route, /affiliate\.commission_plan_id\s*\?\s*await planQuery\.eq\("id"/);
  });

  test("a later click from another partner replaces the earlier cookie; a forged one is refused", () => {
    const secret = "s";
    const future = new Date(Date.now() + 86400000).toISOString();
    const a = serialiseCookie(secret, { affiliateId: "a", linkId: "l1", clickedAt: new Date().toISOString(), expiresAt: future });
    const b = serialiseCookie(secret, { affiliateId: "b", linkId: "l2", clickedAt: new Date().toISOString(), expiresAt: future });
    assert.equal(parseCookie(secret, b)?.affiliateId, "b");
    assert.equal(parseCookie("other", a), null);
  });

  test("link previews, prefetches and headless tools are not counted", () => {
    for (const ua of [
      "facebookexternalhit/1.1",
      "WhatsApp/2.23.20.0",
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0",
      "axios/1.6.0",
      "node-fetch/1.0",
      "PostmanRuntime/7.36",
      "Go-http-client/2.0",
    ]) {
      assert.equal(looksAutomated(ua), true, ua);
    }
    assert.equal(looksAutomated("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), false);
    assert.equal(isPrefetch(headers({ "sec-purpose": "prefetch;prerender" })), true);
    assert.equal(isPrefetch(headers({})), false);
  });

  test("IP and device are keyed hashes, never the address, and differ by secret", () => {
    const hash = ipHash("secret", "203.0.113.9");
    assert.doesNotMatch(hash, /203|113/);
    assert.notEqual(hash, ipHash("other", "203.0.113.9"));
    assert.notEqual(deviceHash("secret", "203.0.113.9", "UA-1"), deviceHash("secret", "203.0.113.9", "UA-2"));
    assert.equal(emailHash("k", "J.Doe+x@GMAIL.com"), emailHash("k", "jdoe@gmail.com"));
  });

  test("the click limit is per network hash and much tighter than before", () => {
    assert.ok(CLICK_RATE_LIMIT.limit <= 30);
    const limits = read("src/lib/security/rate-limit.ts");
    assert.match(limits, /"affiliate:click": \{ limit: 20, windowSeconds: 600 \}/);
    const route = read("src/app/r/[slug]/route.ts");
    assert.match(route, /checkRateLimit\("affiliate:click", hashes\?\.ipHash/);
    assert.doesNotMatch(route, /checkRateLimit\("affiliate:click",\s*clientIdentifier/);
  });

  test("the proxy heuristic reads only headers already received, and is a soft signal", () => {
    assert.equal(proxySuspected(headers({ via: "1.1 proxy" })), true);
    assert.equal(proxySuspected(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })), true);
    assert.equal(proxySuspected(headers({ "x-forwarded-for": "1.1.1.1" })), false);
    assert.equal(FRAUD_SEVERITY.PROXY_SUSPECTED, "INFO");
  });

  test("the migration purges hashes after 120 days and click rows after 400", () => {
    const sql = read("supabase/migrations/0166_affiliate_programme_hardening.sql");
    assert.match(sql, /fingerprint_retention_days integer not null default 120/);
    assert.match(sql, /click_retention_days integer not null default 400/);
    assert.match(sql, /create or replace function public\.purge_affiliate_identifiers\(\)/);
    assert.match(read("src/lib/jobs/handlers/affiliate-ledger.ts"), /purge_affiliate_identifiers/);
  });
});

/* ------------------------------------------------------- §1 self-referral -- */

const baseEvidence = (): SignupEvidence => ({
  affiliate: { userId: "aff", email: "sam@studio-one.co.uk", ipHashes: ["ip-home"], deviceHashes: ["dev-laptop"] },
  signup: { userId: "cust", email: "ops@other.co.uk", ipHash: "ip-x", deviceHash: "dev-x", priorWorkspaceCount: 0, msSinceClick: 60_000, proxySuspected: false },
});

describe("self-referral and duplicate screening", () => {
  test("a clean signup raises nothing", () => {
    assert.deepEqual(assessSignup(baseEvidence()), []);
    assert.deepEqual(decideFlag([]), { action: "none" });
  });

  test("the affiliate's own user or email is rejected outright", () => {
    const own = baseEvidence();
    own.signup.userId = "aff";
    assert.equal(decideFlag(assessSignup(own)).action, "reject");
    const email = baseEvidence();
    email.signup.email = "Sam+test@studio-one.co.uk";
    assert.deepEqual(decideFlag(assessSignup(email)), { action: "reject", reason: "SAME_EMAIL" });
  });

  test("same company domain, device, network or a prior workspace holds for review", () => {
    const domain = baseEvidence();
    domain.signup.email = "finance@studio-one.co.uk";
    assert.deepEqual(decideFlag(assessSignup(domain)), { action: "hold", reason: "SAME_EMAIL_DOMAIN" });
    const device = baseEvidence();
    device.signup.deviceHash = "dev-laptop";
    assert.deepEqual(decideFlag(assessSignup(device)), { action: "hold", reason: "SAME_DEVICE" });
    const network = baseEvidence();
    network.signup.ipHash = "ip-home";
    assert.deepEqual(decideFlag(assessSignup(network)), { action: "hold", reason: "SAME_NETWORK" });
    const duplicate = baseEvidence();
    duplicate.signup.priorWorkspaceCount = 1;
    assert.deepEqual(decideFlag(assessSignup(duplicate)), { action: "hold", reason: "DUPLICATE_ACCOUNT" });
  });

  test("a shared consumer mailbox domain is not a signal", () => {
    const gmail = baseEvidence();
    gmail.affiliate.email = "sam@gmail.com";
    gmail.signup.email = "someone@gmail.com";
    assert.deepEqual(assessSignup(gmail), []);
    assert.equal(isFreeMailDomain("outlook.com"), true);
    assert.equal(normaliseEmail("J.Doe+aff@googlemail.com"), "jdoe@gmail.com");
  });

  test("instant signups and proxies are recorded as context only", () => {
    const quick = baseEvidence();
    quick.signup.msSinceClick = 1200;
    quick.signup.proxySuspected = true;
    const signals = assessSignup(quick);
    assert.deepEqual(signals.map((s) => s.code).sort(), ["INSTANT_SIGNUP", "PROXY_SUSPECTED"]);
    assert.deepEqual(decideFlag(signals), { action: "none" });
  });

  test("the same Stripe customer or card, or membership of the workspace, is rejected", () => {
    assert.deepEqual(
      decideFlag(assessPayment({ referredCustomerId: "cus_1", affiliateCustomerIds: ["cus_1"], referredCardFingerprints: [], affiliateCardFingerprints: [], affiliateIsMember: false })),
      { action: "reject", reason: "SAME_STRIPE_CUSTOMER" },
    );
    assert.deepEqual(
      decideFlag(assessPayment({ referredCustomerId: "cus_2", affiliateCustomerIds: ["cus_1"], referredCardFingerprints: ["fp_a"], affiliateCardFingerprints: ["fp_a"], affiliateIsMember: false })),
      { action: "reject", reason: "SAME_PAYMENT_CARD" },
    );
    assert.equal(assessPayment({ referredCustomerId: "cus_2", affiliateCustomerIds: ["cus_1"], referredCardFingerprints: ["fp_b"], affiliateCardFingerprints: ["fp_a"], affiliateIsMember: false }).length, 0);
  });

  test("every code has a severity and an admin label", () => {
    for (const code of FRAUD_CODES) {
      assert.ok(FRAUD_SEVERITY[code]);
      assert.ok(FRAUD_LABEL[code]);
    }
  });

  test("signup screening is wired and never blocks account creation", () => {
    const attribution = read("src/lib/affiliates/attribution.ts");
    assert.match(attribution, /await screenSignup\(/);
    assert.match(attribution, /Screening is a safety net, never a gate on account creation/);
    // The referral now carries the link it came from (link metrics join on it).
    assert.match(attribution, /source_link_id: cookie\.linkId/);
    assert.match(read("src/app/affiliates/app/layout.tsx"), /after\(\(\) => recordAffiliatePresence/);
  });

  test("fraud flags and fingerprints are service-role only; a partner never sees which signal fired", () => {
    const sql = read("supabase/migrations/0166_affiliate_programme_hardening.sql");
    for (const name of ["affiliate_fraud_flags", "affiliate_fingerprints", "affiliate_programme_settings"]) {
      assert.match(sql, new RegExp(`alter table public\\.${name} force row level security;\\s*revoke all on public\\.${name} from anon, authenticated;`));
    }
    assert.match(sql, /create policy affiliate_tier_history_select[\s\S]*affiliate_id = public\.current_affiliate_id\(\)/);
  });
});

/* ---------------------------------------------------------- §2 the ledger -- */

describe("commission base and window", () => {
  test("VAT is excluded and credit-balance payments scale the base down", () => {
    assert.equal(commissionBaseMinor({ amountPaidMinor: 12000, totalMinor: 12000, totalExcludingTaxMinor: 10000 }), 10000);
    // A 20% coupon is already inside total_excluding_tax.
    assert.equal(commissionBaseMinor({ amountPaidMinor: 9600, totalMinor: 9600, totalExcludingTaxMinor: 8000 }), 8000);
    // Half paid from customer credit: only the cash half earns.
    assert.equal(commissionBaseMinor({ amountPaidMinor: 6000, totalMinor: 12000, totalExcludingTaxMinor: 10000 }), 5000);
    assert.equal(commissionBaseMinor({ amountPaidMinor: 0, totalMinor: 12000, totalExcludingTaxMinor: 10000 }), 0);
  });

  test("only subscription invoices earn", () => {
    assert.equal(isCommissionableInvoice("subscription_cycle"), true);
    assert.equal(isCommissionableInvoice("subscription_create"), true);
    assert.equal(isCommissionableInvoice("manual"), false);
    assert.equal(isCommissionableInvoice(null), false);
  });

  test("commission is one-off: only the first payment earns (owner decision 2026-09-28)", () => {
    const plan = { commissionType: "FIRST_PAYMENT_PERCENT" as const, percent: 6, flatAmountMinor: null };
    assert.equal(commissionForPayment(plan, 120000, { paymentIndex: 0 }), 7200, "the full first annual payment");
    assert.equal(commissionForPayment(plan, 10000, { paymentIndex: 1 }), 0, "a renewal earns nothing");
    const legacy = { commissionType: "RECURRING_PERCENT" as const, percent: 6, flatAmountMinor: null };
    assert.equal(commissionForPayment(legacy, 10000, { paymentIndex: 3 }), 0, "a legacy recurring row is read as one-off");
    assert.equal(monthsBetween(new Date("2026-01-31T00:00:00Z"), new Date("2026-02-28T00:00:00Z")), 0);
    const flat = { commissionType: "FLAT_AMOUNT" as const, percent: null, flatAmountMinor: 5000 };
    assert.equal(commissionForPayment(flat, 10000, { paymentIndex: 1, monthsSinceFirstPayment: 1 }), 0, "a flat bounty is paid once");
  });

  test("the webhook accrues on the net base and never calls Stripe for affiliates", () => {
    const route = read("src/app/api/webhooks/stripe/route.ts");
    assert.match(route, /commissionBaseMinor\(/);
    assert.match(route, /isCommissionableInvoice\(invoice\.billing_reason/);
    assert.match(route, /enqueueAffiliateBillingEvent\(refundEvent\(/);
    assert.match(route, /enqueueAffiliateBillingEvent\(disputeEvent\(event\.id, event\.type/);
    assert.doesNotMatch(route, /stripe\.charges\.retrieve/);
    assert.doesNotMatch(route, /reverseCommission\(/);
  });
});

describe("refunds, disputes and re-accrual", () => {
  test("cumulative refunds reverse only the new share", () => {
    const base = { commissionMinor: 2000, grossPaidMinor: 12000 };
    assert.equal(refundReversalMinor({ ...base, cumulativeRefundedMinor: 3000, alreadyReversedMinor: 0 }), 500);
    assert.equal(refundReversalMinor({ ...base, cumulativeRefundedMinor: 6000, alreadyReversedMinor: 500 }), 500);
    assert.equal(refundReversalMinor({ ...base, cumulativeRefundedMinor: 6000, alreadyReversedMinor: 1000 }), 0);
    assert.equal(refundReversalMinor({ ...base, cumulativeRefundedMinor: 99999, alreadyReversedMinor: 0 }), 2000);
    assert.equal(disputeReversalMinor({ ...base, disputedMinor: 12000, alreadyReversedMinor: 0 }), 2000);
  });

  test("an unpaid full reversal flips; partial or paid ones add a negative row", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    const pending = { status: "PENDING" as const, commissionMinor: 2000, availableAt: "2026-10-28T00:00:00Z", payoutId: null };
    assert.deepEqual(planReversalWrite({ accrual: pending, amountMinor: 2000, alreadyReversedMinor: 0, now }), { kind: "flip" });
    assert.deepEqual(planReversalWrite({ accrual: pending, amountMinor: 500, alreadyReversedMinor: 0, now }), {
      kind: "negative", amountMinor: 500, status: "PENDING", availableAt: "2026-10-28T00:00:00Z",
    });
    const paid = { status: "PAID" as const, commissionMinor: 2000, availableAt: null, payoutId: "po" };
    assert.deepEqual(planReversalWrite({ accrual: paid, amountMinor: 2000, alreadyReversedMinor: 0, now }), {
      kind: "negative", amountMinor: 2000, status: "APPROVED", availableAt: now.toISOString(),
    });
    assert.equal(planReversalWrite({ accrual: pending, amountMinor: 0, alreadyReversedMinor: 0, now }), null);
  });

  test("a won dispute re-accrues each reversal, keeping a future hold date", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    const rows = planReaccrual(
      [
        { id: "a", kind: "flipped", amountMinor: 2000, status: "REVERSED", availableAt: "2026-10-10T00:00:00Z" },
        { id: "b", kind: "negative", amountMinor: 700, status: "APPROVED", availableAt: "2026-09-01T00:00:00Z" },
        { id: "c", kind: "negative", amountMinor: 0, status: "APPROVED", availableAt: null },
      ],
      now,
    );
    assert.deepEqual(rows, [
      { sourceId: "a", amountMinor: 2000, status: "PENDING", availableAt: "2026-10-10T00:00:00.000Z" },
      { sourceId: "b", amountMinor: 700, status: "APPROVED", availableAt: now.toISOString() },
    ]);
  });

  test("webhook payloads skip top-ups and carry what the job needs", () => {
    assert.equal(refundEvent("evt", { id: "ch", amount: 100, amount_refunded: 100, metadata: { kind: "ai_tokens" } }), null);
    assert.equal(refundEvent("evt", { id: "ch", amount: 100, amount_refunded: 0 }), null);
    const refund = refundEvent("evt_1", { id: "ch_1", amount: 12000, amount_refunded: 6000, payment_intent: "pi_1" });
    assert.deepEqual(refund, {
      kind: "refund", eventId: "evt_1", chargeId: "ch_1", paymentIntentId: "pi_1", invoiceId: null,
      amountRefundedMinor: 6000, chargeAmountMinor: 12000,
    });
    const closed = disputeEvent("evt_2", "charge.dispute.closed", { id: "dp_1", amount: 12000, status: "won", charge: { id: "ch_1", invoice: "in_1" } });
    assert.equal(closed?.kind, "dispute_closed");
    assert.equal(closed?.invoiceId, "in_1");
    assert.equal(billingEventJobKey(refund!), "affiliate.billing_event:evt_1");
  });

  test("the job is registered with a lane", () => {
    assert.match(read("src/lib/jobs/queue.ts"), /\| "affiliate\.billing_event"/);
    assert.match(read("src/lib/jobs/lanes.ts"), /"affiliate\.billing_event": c\(/);
    assert.match(read("src/lib/jobs/register.ts"), /registerHandler\("affiliate\.billing_event", handleAffiliateBillingEvent\)/);
  });

  test("approval honours available_at and skips held referrals; claims never dodge a clawback", () => {
    const sql = read("supabase/migrations/0166_affiliate_programme_hardening.sql");
    assert.match(sql, /coalesce\(ac\.available_at, ac\.created_at \+ make_interval/);
    assert.match(sql, /\(r\.id is null or r\.flagged_reason is null\)/);
    assert.match(sql, /c\.commission_amount_minor < 0 or r\.id is null or r\.flagged_reason is null/);
    assert.match(sql, /'NEW_CUSTOMER','RENEWAL','ADJUSTMENT','REVERSAL','REACCRUAL'/);
  });

  test("a negative balance is recovered, and written off (never invoiced) at the end", () => {
    assert.equal(negativeBalanceNotice(100, String), null);
    const text = negativeBalanceNotice(-1500, (m) => `£${m / 100}`) ?? "";
    assert.match(text, /recovered from future commission/);
    assert.match(text, /written off/);
    assert.match(text, /never invoice/);
  });
});

/* ------------------------------------------------------------ §3 tiers -- */

describe("tiers", () => {
  const tiers: TierDefinition[] = DEFAULT_TIERS.map((tier) => ({ ...tier }));

  test("paid customers earn a tier; MRR does not", () => {
    assert.equal(earnedTier(tiers, { activeCustomers: 0, referredMrrMinor: 0 }), "STANDARD");
    assert.equal(earnedTier(tiers, { activeCustomers: 5, referredMrrMinor: 0 }), "PARTNER");
    assert.equal(earnedTier(tiers, { activeCustomers: 1, referredMrrMinor: 5_000_000 }), "STANDARD", "revenue is not a threshold");
    assert.equal(earnedTier(tiers, { activeCustomers: 15, referredMrrMinor: 0 }), "PREMIUM");
  });

  test("promotion is immediate, demotion waits for the monthly review, a lock holds", () => {
    const low = { activeCustomers: 0, referredMrrMinor: 0 };
    assert.deepEqual(evaluateTier({ tiers, metrics: { activeCustomers: 6, referredMrrMinor: 0 }, current: "STANDARD", locked: false, allowDowngrade: false }), {
      tier: "PARTNER", changed: true, direction: "up", heldBecause: null,
    });
    assert.equal(evaluateTier({ tiers, metrics: low, current: "PARTNER", locked: false, allowDowngrade: false }).heldBecause, "not_review_day");
    assert.equal(evaluateTier({ tiers, metrics: low, current: "PARTNER", locked: false, allowDowngrade: true }).tier, "STANDARD");
    assert.equal(evaluateTier({ tiers, metrics: { activeCustomers: 20, referredMrrMinor: 0 }, current: "STANDARD", locked: true, allowDowngrade: true }).heldBecause, "locked");
    assert.equal(isTierReviewDay(new Date("2026-10-01T09:00:00Z")), true);
    assert.equal(isTierReviewDay(new Date("2026-10-02T09:00:00Z")), false);
  });

  test("a tier sets the rate, never below the plan and never above 10%", () => {
    const plan = { commissionType: "FIRST_PAYMENT_PERCENT" as const, percent: 6 };
    assert.deepEqual(effectivePlan(plan, tiers[2]), { ...plan, percent: 10 });
    assert.deepEqual(effectivePlan(plan, tiers[1]), { ...plan, percent: 8 });
    assert.deepEqual(effectivePlan({ ...plan, percent: 9 }, tiers[1]), { ...plan, percent: 9 }, "never below the plan");
    assert.equal(effectivePlan(plan, { ...tiers[2], commissionPercent: 30 }).percent, 10, "capped at 10%");
    assert.equal(effectivePlan({ commissionType: "FLAT_AMOUNT" as const, percent: null }, tiers[2]).percent, null);
  });

  test("progress counts paid customers and what is left", () => {
    const progress = tierProgress(tiers, { activeCustomers: 4, referredMrrMinor: 10_000 }, "STANDARD");
    assert.equal(progress.next?.key, "PARTNER");
    assert.equal(progress.percent, 80);
    assert.equal(progress.customersToGo, 1);
    assert.equal(tierProgress(tiers, { activeCustomers: 99, referredMrrMinor: 0 }, "PREMIUM").next, null);
  });

  test("admin edits are validated as a ladder, 1-10%", () => {
    assert.deepEqual(validateTierEdit(tiers), []);
    assert.ok(validateTierEdit([tiers[0], { ...tiers[1], commissionPercent: 10.5 }, tiers[2]]).length > 0);
    assert.ok(validateTierEdit([tiers[0], { ...tiers[1], commissionPercent: 9 }, { ...tiers[2], commissionPercent: 7 }]).some((p) => /lower rate/.test(p)));
    assert.ok(validateTierEdit([tiers[0], { ...tiers[1], minActiveCustomers: 50 }, tiers[2]]).some((p) => /at least as many/.test(p)));
    assert.ok(validateTierEdit([{ ...tiers[0], commissionPercent: 20 }]).length > 0, "20% is refused");
  });

  test("sales tiers group active customers by plan, anonymised", () => {
    const rows = salesTierBreakdown([
      { planKey: "growth", mrrMinor: 9900 },
      { planKey: "pro", mrrMinor: 19900 },
      { planKey: "growth", mrrMinor: 9900 },
    ]);
    assert.deepEqual(rows, [
      { planKey: "pro", label: "Pro", customers: 1, mrrMinor: 19900 },
      { planKey: "growth", label: "Growth", customers: 2, mrrMinor: 19800 },
    ]);
  });

  test("tiers are recalculated by the daily job and changes are recorded and notified", () => {
    assert.match(read("src/lib/jobs/handlers/affiliate-ledger.ts"), /await recalculateTiers\(\)/);
    const tiersSrc = read("src/lib/affiliates/tiers.ts");
    assert.match(tiersSrc, /affiliate_tier_history/);
    assert.match(tiersSrc, /kind: "tier\.changed"/);
  });
});

/* ----------------------------------------------------------- §4 payouts -- */

describe("payouts", () => {
  test("the monthly run raises pending-approval payouts unless an admin enabled auto-approval", () => {
    assert.deepEqual(payoutRunDecision({ readiness: "READY", availableMinor: 20000, minimumPayoutMinor: 1000, autoApprove: false }), { action: "raise", initialStatus: "DRAFT" });
    assert.deepEqual(payoutRunDecision({ readiness: "READY", availableMinor: 20000, minimumPayoutMinor: 1000, autoApprove: true }), { action: "raise", initialStatus: "APPROVED" });
    assert.deepEqual(payoutRunDecision({ readiness: "READY", availableMinor: -100, minimumPayoutMinor: 1000, autoApprove: true }), { action: "skip", reason: "negative_balance" });
    assert.deepEqual(payoutRunDecision({ readiness: "ACTION_REQUIRED", availableMinor: 20000, minimumPayoutMinor: 1000, autoApprove: true }), { action: "skip", reason: "not_ready" });
  });

  test("sending needs the admin setting AND the deployment switch", () => {
    assert.equal(autoDispatchAllowed({ settingEnabled: true, envEnabled: false }), false);
    assert.equal(autoDispatchAllowed({ settingEnabled: false, envEnabled: true }), false);
    assert.equal(autoDispatchAllowed({ settingEnabled: true, envEnabled: true }), true);
    assert.match(read("src/lib/jobs/handlers/affiliate-ledger.ts"), /autoDispatchAllowed\(\{\s*settingEnabled: settings\.autoDispatchPayouts/);
  });

  test("payout states only move forward", () => {
    assert.equal(canTransitionPayout("DRAFT", "APPROVED"), true);
    assert.equal(canTransitionPayout("PAID", "APPROVED"), false);
    assert.equal(canTransitionPayout("CANCELLED", "APPROVED"), false);
    assert.equal(canTransitionPayout("FAILED", "APPROVED"), true);
  });

  test("statements are always remittance advice: no self-billing at launch", () => {
    assert.match(selfBillingLines({ taxCountry: "GB", vatRegistered: true, selfBillingAgreement: false })[0], /not a VAT invoice/);
    assert.match(selfBillingLines({ taxCountry: "GB", vatRegistered: true, selfBillingAgreement: true })[0], /not a VAT invoice/);
    assert.match(selfBillingLines({ taxCountry: "GB", vatRegistered: true, selfBillingAgreement: true })[0], /send ClientTurn a VAT invoice/);
    assert.match(selfBillingLines({ taxCountry: "IE", vatRegistered: false, selfBillingAgreement: false })[0], /Remittance advice/);
    assert.match(read("src/app/affiliates/app/payouts/[id]/statement/route.ts"), /selfBillingLines\(/);
  });

  test("Connect objects are tagged app=clientturn", () => {
    const connect = read("src/lib/affiliates/stripe-connect.ts");
    assert.equal((connect.match(/app: "clientturn"/g) ?? []).length, 2);
  });
});

/* ------------------------------------------------- §5-§8 surfaces, terms -- */

describe("surfaces, terms and privacy", () => {
  test("referral labels stay anonymous and tell same-day referrals apart", () => {
    const label = referralLabel(null, "2026-03-04T00:00:00.000Z", "abcd1234-0000-4000-8000-000000000000");
    assert.match(label, /^Referral · .* · #ABCD$/);
    for (const file of ["src/lib/affiliates/portal.ts", "src/lib/affiliates/queries.ts"]) {
      assert.doesNotMatch(read(file), /businesses \(/, `${file} must never join a customer's business`);
    }
  });

  test("the partner portal has loading and error states and shows tier progress", () => {
    assert.match(read("src/app/affiliates/app/loading.tsx"), /PageSkeleton/);
    assert.match(read("src/app/affiliates/app/error.tsx"), /RouteError/);
    assert.match(read("src/app/affiliates/app/page.tsx"), /<TierProgressPanel/);
  });

  test("admin has the review queue, tiers, payout approval and export", () => {
    const types = read("src/lib/admin/affiliates-types.ts");
    assert.match(types, /"flags",\s*"tiers",/);
    const actions = read("src/lib/admin/affiliate-actions.ts");
    for (const name of ["approvePayout", "approvePayoutRun", "cancelPayoutAction", "reviewReferralFlag", "updateTiers", "setAffiliateTier", "updateProgrammeSettings"]) {
      assert.match(actions, new RegExp(`export async function ${name}\\(`));
    }
    assert.match(actions, /guarded\("affiliate\.flag_reviewed"/);
    const exportRoute = read("src/app/admin/(ops)/affiliates/export/route.ts");
    assert.match(exportRoute, /getPlatformOperator\(\)/);
    assert.match(exportRoute, /action: "affiliate\.exported"/);
    assert.doesNotMatch(exportRoute, /stripe_connect_account_id|tax_identifier|payment_profile_json/);
  });

  test("the public terms state the behaviour and the PECR promotion rules, owner-approved", () => {
    const terms = read("src/app/(marketing)/affiliates/terms/page.tsx");
    assert.match(terms, /APPROVED BY THE OWNER 2026-09-28/);
    assert.doesNotMatch(terms, /index: false/);
    for (const phrase of [
      /excluding VAT/,
      /reversed in proportion to the amount/,
      /decided in our favour, it is restored/,
      /deducted from your future/,
      /reviewed and\s+approved by our team/,
      /sole traders or unincorporated\s+partnerships/,
      /TPS or CTPS/,
      /brand terms/,
      /cookie stuffing/,
      /anonymised referral labels/,
    ]) {
      assert.match(terms, phrase);
    }
    assert.match(read("src/components/affiliates/onboarding-wizard.tsx"), /href="\/affiliates\/terms"/);
  });
});
