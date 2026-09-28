import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  actionRequiredNotice,
  asCompletedCheckoutEvent,
  asyncPaymentFailedNotice,
  checkoutEventMeaning,
  disputeClawbackAmount,
  disputeNotice,
  disputeOutcome,
  disputeRestoreKey,
  disputeReversalKey,
  invoiceAmounts,
  invoiceFailureDecision,
  isSchemaMissing,
  isSubscriptionInvoice,
  mrrMinorFromInvoice,
  oneOffKindOf,
} from "../src/lib/billing/stripe-events.ts";
import {
  addOnSubscriptionStatus,
  deriveEntitlements,
  type DunningLike,
  type SubscriptionRowLike,
} from "../src/lib/billing/lifecycle.ts";
import {
  NUMBER_RELEASE_AFTER_CANCEL_DAYS,
  READ_ONLY_RETENTION_DAYS,
  RETENTION_POLICY_TEXT,
  numberReleaseAt,
  retentionSchedule,
  subscriptionHasEnded,
} from "../src/lib/billing/cancellation.ts";
import { attemptInvoiceCharge, type StripeInvoicesLike } from "../src/lib/billing/dunning-core.ts";
import { attributeUnusedCredit, refundReversalAmount } from "../src/lib/billing/refundability.ts";
import { voicePackRefund } from "../src/lib/voice/pack-refund.ts";
import { assertVoiceAllowed } from "../src/lib/voice/entitlement.ts";
import { buildEntitlementSnapshot, type EntitlementFacts } from "../src/lib/voice/snapshot.ts";

/**
 * Billing batch 2 (gap audit 15 top-10 #7): dunning, failed one-off payments,
 * SCA and delayed payment methods, disputes and the post-cancellation
 * timeline. Pure rules plus source checks of the webhook wiring. No Stripe
 * call is made: where a Stripe client is needed it is a hand-written fake.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("1. a failed ONE-OFF payment never touches subscription status", () => {
  test("a top-up or pack invoice (no subscription) is ignored", () => {
    assert.deepEqual(invoiceFailureDecision({ id: "in_1", billing_reason: "manual", subscriptionId: null }), {
      action: "ignore",
      reason: "one_off",
    });
    assert.equal(isSubscriptionInvoice({ billing_reason: null, subscriptionId: null }), false);
  });

  test("a manual invoice linked to the subscription is still one-off", () => {
    assert.equal(isSubscriptionInvoice({ billing_reason: "manual", subscriptionId: "sub_1" }), false);
    assert.equal(invoiceFailureDecision({ id: "in_1", billing_reason: "manual", subscriptionId: "sub_1" }).action, "ignore");
  });

  test("renewals, first invoices and prorations are dunned", () => {
    for (const reason of ["subscription_cycle", "subscription_create", "subscription_update", "subscription_threshold"]) {
      assert.deepEqual(invoiceFailureDecision({ id: "in_1", billing_reason: reason, subscriptionId: "sub_1" }), {
        action: "dun",
        subscriptionId: "sub_1",
      });
    }
  });

  test("dunning.ts decides BEFORE it writes PAST_DUE (the old order locked workspaces out)", () => {
    const source = read("src/lib/billing/dunning.ts");
    const fn = source.slice(source.indexOf("export async function recordInvoiceFailure"));
    const decideAt = fn.indexOf("invoiceFailureDecision(");
    const pastDueAt = fn.indexOf('status: "PAST_DUE"');
    assert.ok(decideAt > 0 && pastDueAt > 0, "both the decision and the PAST_DUE write exist");
    assert.ok(decideAt < pastDueAt, "the one-off check runs before PAST_DUE is written");
    assert.match(fn.slice(decideAt, pastDueAt), /if \(decision\.action !== "dun"\) return;/);
  });
});

describe("2. add-on items (Pro voice item, number) follow the subscription's dunning", () => {
  const row = (status: string): SubscriptionRowLike => ({
    plan: "pro",
    status,
    trial_ends_at: null,
    stripe_subscription_id: "sub_1",
    current_period_start: null,
    current_period_end: null,
    lead_limit: 1000,
    user_limit: 10,
    whatsapp_enabled: true,
    campaigns_enabled: true,
    ai_assist_allowed: true,
  });
  const dunning = (firstFailedAt: string): DunningLike => ({ status: "OPEN", first_failed_at: firstFailedAt, attempts: 1, last_attempt_on: null });
  const now = new Date("2026-09-28T12:00:00Z");

  const facts = (subscriptionStatus: string): EntitlementFacts => ({
    plan: "pro",
    subscriptionStatus,
    businessStatus: "ACTIVE",
    voiceCapability: true,
    grants: { proVoiceItem: true, numberItem: false },
    packsHeld: false,
    balance: { includedRemainingSec: 6000, packRemainingSec: 0 },
    platformKill: false,
    settings: {
      voice_enabled: true,
      admin_kill_switch: false,
      calling_as_name: "Acme",
      legal_entity_name: "Acme Ltd",
      identification_contact: "1 High Street, London EC1A 1BB",
      assistant_persona_name: "Sam",
    },
    number: { provisioning_state: "ACTIVE", e164: "+441234567890" },
  });

  test("grace days: voice keeps working, as sending and AI do", () => {
    const ent = deriveEntitlements(row("PAST_DUE"), dunning("2026-09-27T12:00:00Z"), now);
    assert.equal(ent.access, "full");
    const status = addOnSubscriptionStatus(ent);
    assert.equal(status, "ACTIVE");
    const decision = assertVoiceAllowed(buildEntitlementSnapshot(facts(status)));
    assert.equal(decision.allowed, true);
  });

  test("from day 3: voice pauses with the rest", () => {
    const ent = deriveEntitlements(row("PAST_DUE"), dunning("2026-09-24T12:00:00Z"), now);
    assert.equal(ent.access, "restricted");
    const status = addOnSubscriptionStatus(ent);
    assert.equal(status, "PAST_DUE");
    const decision = assertVoiceAllowed(buildEntitlementSnapshot(facts(status)));
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.ok(decision.reasons.includes("SUBSCRIPTION_INACTIVE"));
  });

  test("cancelled: off", () => {
    const ent = deriveEntitlements(row("CANCELLED"), null, now);
    assert.equal(addOnSubscriptionStatus(ent), "CANCELLED");
  });

  test("the voice gate reads the dunning-aware status", () => {
    assert.match(read("src/lib/voice/server-deps.ts"), /subscriptionStatus: addOnSubscriptionStatus\(entitlements\)/);
  });
});

describe("3. SCA (3-D Secure) and delayed payment methods", () => {
  test("Checkout event meanings", () => {
    assert.equal(checkoutEventMeaning("checkout.session.completed"), "grant");
    assert.equal(checkoutEventMeaning("checkout.session.async_payment_succeeded"), "grant");
    assert.equal(checkoutEventMeaning("checkout.session.expired"), "expire");
    assert.equal(checkoutEventMeaning("checkout.session.async_payment_failed"), "async_failed");
    assert.equal(checkoutEventMeaning("invoice.paid"), null);
  });

  test("async success is applied as a paid completion; everything else is untouched", () => {
    const event = { id: "evt_1", type: "checkout.session.async_payment_succeeded", data: { object: { payment_status: "paid" } } };
    const relabelled = asCompletedCheckoutEvent(event);
    assert.equal(relabelled.type, "checkout.session.completed");
    assert.equal(relabelled.id, "evt_1");
    assert.equal(event.type, "checkout.session.async_payment_succeeded", "the original is not mutated");
    const expired = { type: "checkout.session.expired" };
    assert.equal(asCompletedCheckoutEvent(expired), expired);
  });

  test("only one-off kinds get the async-failure path", () => {
    assert.equal(oneOffKindOf("ai_tokens"), "ai_tokens");
    assert.equal(oneOffKindOf("voice_pack"), "voice_pack");
    assert.equal(oneOffKindOf("subscription"), null);
    assert.equal(oneOffKindOf(undefined), null);
    assert.match(asyncPaymentFailedNotice("voice_pack").body, /subscription and everything else are unaffected/);
  });

  test("the SCA notice links to the hosted invoice and changes no access", () => {
    const notice = actionRequiredNotice({ hostedInvoiceUrl: "https://invoice.stripe.com/i/x", amountDueMinor: 39900, currency: "gbp" });
    assert.equal(notice.linkUrl, "https://invoice.stripe.com/i/x");
    assert.match(notice.body, /£399\.00/);
    assert.match(notice.body, /Nothing is paused yet/);
    assert.equal(actionRequiredNotice({ hostedInvoiceUrl: null, amountDueMinor: null, currency: null }).linkUrl, "/api/billing/portal");
  });

  test("a daily retry that hits requires_action is a failed attempt, never a crash (fake Stripe)", async () => {
    const calls: string[] = [];
    const fake: StripeInvoicesLike = {
      invoices: {
        async retrieve(id) {
          calls.push(`retrieve:${id}`);
          return { id, status: "open", amount_remaining: 39900 };
        },
        async pay(id) {
          calls.push(`pay:${id}`);
          throw Object.assign(new Error("This payment requires additional user action before it can be completed."), {
            code: "invoice_payment_intent_requires_action",
          });
        },
      },
    };
    const outcome = await attemptInvoiceCharge(fake, "in_sca", "2026-09-28");
    assert.equal(outcome.outcome, "failed");
    assert.deepEqual(calls, ["retrieve:in_sca", "pay:in_sca"]);
  });

  test("the webhook handles every new event and routes each one", () => {
    const route = read("src/app/api/webhooks/stripe/route.ts");
    for (const type of [
      "invoice.payment_action_required",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "charge.dispute.closed",
    ]) {
      assert.ok(route.includes(`"${type}"`), `${type} is in HANDLED`);
    }
    assert.match(route, /recordInvoiceActionRequired\(/);
    assert.match(route, /applyAsyncPaymentFailed\(event\)/);
    assert.match(route, /asCompletedCheckoutEvent\(event\)/);
    assert.match(route, /recordDisputeOpened\(/);
    assert.match(route, /recordDisputeClosed\(/);
    assert.match(route, /recordPaidInvoice\(/);
  });
});

describe("4. disputes claw back only unused units, FIFO, and restore on a win", () => {
  test("outcomes", () => {
    assert.equal(disputeOutcome("needs_response"), "open");
    assert.equal(disputeOutcome("under_review"), "open");
    assert.equal(disputeOutcome("won"), "won");
    assert.equal(disputeOutcome("warning_closed"), "won");
    assert.equal(disputeOutcome("lost"), "lost");
  });

  test("the clawback amount never exceeds the charge", () => {
    assert.equal(disputeClawbackAmount({ disputedMinor: 5000, chargeAmountMinor: 4900 }), 4900);
    assert.equal(disputeClawbackAmount({ disputedMinor: 2000, chargeAmountMinor: 4900 }), 2000);
    assert.equal(disputeClawbackAmount({ disputedMinor: 2000, chargeAmountMinor: null }), 2000);
  });

  test("keys are one per dispute, distinct for clawback and restore", () => {
    assert.equal(disputeReversalKey("dp_1"), "dispute:dp_1");
    assert.equal(disputeRestoreKey("dp_1"), "dispute_won:dp_1");
    assert.notEqual(disputeReversalKey("dp_1"), disputeRestoreKey("dp_1"));
  });

  test("a disputed pack whose credit is partly used gives back only the unused part (FIFO)", () => {
    // Two packs of 100; 150 used in all, so the older pack is empty and the
    // newer one has 50 left. A dispute of the newer pack takes 50, not 100.
    const purchases = [
      { id: "old", credits: 100, status: "PAID", createdAt: "2026-09-01T00:00:00Z", creditedAt: "2026-09-01T00:00:00Z" },
      { id: "new", credits: 100, status: "PAID", createdAt: "2026-09-10T00:00:00Z", creditedAt: "2026-09-10T00:00:00Z" },
    ] as const;
    const unused = attributeUnusedCredit([...purchases], 50).get("new")?.unused ?? 0;
    const amount = disputeClawbackAmount({ disputedMinor: 2400, chargeAmountMinor: 2400 });
    const reversed = refundReversalAmount({ credits: 100, amountMinor: 2400, amountRefundedMinor: amount, unused, alreadyReversed: 0, pool: 50 });
    assert.equal(reversed, 50);
    // The older, fully used pack yields nothing.
    const oldUnused = attributeUnusedCredit([...purchases], 50).get("old")?.unused ?? 0;
    assert.equal(refundReversalAmount({ credits: 100, amountMinor: 2400, amountRefundedMinor: 2400, unused: oldUnused, alreadyReversed: 0, pool: 50 }), 0);
  });

  test("voice packs: a whole-payment dispute takes every unused second of that pack, never a used one", () => {
    const ledger = [
      { kind: "PACK_PURCHASE" as const, stripeRef: "pi_a", packDeltaSec: 6000, createdAt: "2026-09-01T00:00:00Z" },
      { kind: "PACK_PURCHASE" as const, stripeRef: "pi_b", packDeltaSec: 6000, createdAt: "2026-09-10T00:00:00Z" },
    ];
    const plan = voicePackRefund({ ledger, refundedRef: "pi_b", amountMinor: 1, amountRefundedMinor: 1, packRemainingSec: 4000 });
    assert.equal(plan?.reverseSec, 4000);
    const none = voicePackRefund({ ledger, refundedRef: "pi_a", amountMinor: 1, amountRefundedMinor: 1, packRemainingSec: 4000 });
    assert.equal(none?.reverseSec, 0);
  });

  test("owner notices say what was held back and what came back", () => {
    assert.match(disputeNotice({ outcome: "open", kindLabel: "AI token pack", reversedUnits: 1200, unitLabel: "AI tokens" }).body, /1,200 unused AI tokens have been held back/);
    assert.match(disputeNotice({ outcome: "won", kindLabel: "top-up", reversedUnits: 40, unitLabel: "credits" }).body, /returned to your balance/);
    assert.equal(disputeNotice({ outcome: "lost", kindLabel: "top-up", reversedUnits: 40, unitLabel: "credits" }).severity, "error");
  });

  test("the clawback is queued (never done on the request) and idempotent on the dispute id", () => {
    const disputes = read("src/lib/billing/disputes.ts");
    assert.match(disputes, /onConflict: "stripe_dispute_id", ignoreDuplicates: true/);
    assert.match(disputes, /billing\.refund_reverse:dispute:\$\{dispute\.id\}:reverse/);
    assert.match(disputes, /billing\.refund_reverse:dispute:\$\{dispute\.id\}:restore/);
    // A dispute already won before the job ran takes nothing.
    assert.match(disputes, /if \(row\.status === "WON"\) return 0;/);
    const job = read("src/lib/jobs/handlers/billing-refund.ts");
    assert.match(job, /kind: z\.literal\("dispute"\)/);
    const migration = read("supabase/migrations/0165_billing_disputes_invoices_mrr.sql");
    assert.match(migration, /stripe_dispute_id text not null unique/);
    assert.match(migration, /restored_units <= reversed_units/);
    assert.match(migration, /function public\.restore_disputed_message_credits/);
    assert.match(migration, /function public\.restore_disputed_ai_tokens/);
  });
});

describe("5. invoice amounts and real MRR", () => {
  const invoice = {
    currency: "GBP",
    subtotal: 39900,
    total: 40680,
    total_excluding_tax: 33900,
    amount_paid: 40680,
    total_discount_amounts: [{ amount: 6000 }],
    total_taxes: [{ amount: 6780 }],
  };

  test("reads amount paid, discounts and tax", () => {
    const amounts = invoiceAmounts(invoice);
    assert.deepEqual(amounts, {
      currency: "gbp",
      subtotalMinor: 39900,
      discountMinor: 6000,
      taxMinor: 6780,
      totalExcludingTaxMinor: 33900,
      amountPaidMinor: 40680,
    });
  });

  test("older payloads: `tax` and no total_excluding_tax", () => {
    const amounts = invoiceAmounts({ currency: "gbp", subtotal: 9900, total: 11880, amount_paid: 11880, tax: 1980 });
    assert.equal(amounts.taxMinor, 1980);
    assert.equal(amounts.totalExcludingTaxMinor, 9900);
  });

  test("MRR: net of discount, before VAT; annual / 12; prorations and £0 trials do not move it", () => {
    const amounts = invoiceAmounts(invoice);
    assert.equal(mrrMinorFromInvoice({ billingReason: "subscription_cycle", amounts, interval: "month" }), 33900);
    assert.equal(mrrMinorFromInvoice({ billingReason: "subscription_create", amounts: { ...amounts, totalExcludingTaxMinor: 406980 }, interval: "year" }), 33915);
    assert.equal(mrrMinorFromInvoice({ billingReason: "subscription_update", amounts, interval: "month" }), null);
    assert.equal(mrrMinorFromInvoice({ billingReason: "subscription_create", amounts: { ...amounts, totalExcludingTaxMinor: 0 }, interval: "month" }), null);
  });

  test("an unapplied 0165 never fails a Stripe event", () => {
    assert.equal(isSchemaMissing({ code: "42P01", message: "relation does not exist" }), true);
    assert.equal(isSchemaMissing({ code: "PGRST205", message: "Could not find the table" }), true);
    assert.equal(isSchemaMissing({ code: "23505", message: "duplicate key" }), false);
    assert.equal(isSchemaMissing(null), false);
  });
});

describe("6. after cancellation: read-only 90 days, number released after 14", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  test("active: nothing scheduled", () => {
    assert.deepEqual(retentionSchedule({ status: "ACTIVE", cancelledAt: null, cancelAtPeriodEnd: false, periodEnd: null, now }), {
      phase: "active",
      endsAt: null,
      readOnlyUntil: null,
      numberReleaseAt: null,
    });
  });

  test("ending at period end: the dates are known in advance", () => {
    const s = retentionSchedule({ status: "ACTIVE", cancelledAt: null, cancelAtPeriodEnd: true, periodEnd: "2026-10-15T00:00:00.000Z", now });
    assert.equal(s.phase, "ending");
    assert.equal(s.readOnlyUntil, "2027-01-13T00:00:00.000Z");
    assert.equal(s.numberReleaseAt, "2026-10-29T00:00:00.000Z");
  });

  test("ended: read-only, then deletion due after 90 days", () => {
    const ended = "2026-09-01T00:00:00.000Z";
    assert.equal(retentionSchedule({ status: "CANCELLED", cancelledAt: ended, cancelAtPeriodEnd: false, periodEnd: null, now }).phase, "read_only");
    const later = new Date(new Date(ended).getTime() + READ_ONLY_RETENTION_DAYS * 86_400_000 + 1);
    assert.equal(retentionSchedule({ status: "CANCELLED", cancelledAt: ended, cancelAtPeriodEnd: false, periodEnd: null, now: later }).phase, "deletion_due");
  });

  test("number release date and the end signal", () => {
    assert.equal(NUMBER_RELEASE_AFTER_CANCEL_DAYS, 14);
    assert.equal(numberReleaseAt("2026-09-01T00:00:00.000Z"), "2026-09-15T00:00:00.000Z");
    assert.equal(subscriptionHasEnded({ deleted: true, stripeStatus: "active" }), true);
    assert.equal(subscriptionHasEnded({ deleted: false, stripeStatus: "canceled" }), true);
    assert.equal(subscriptionHasEnded({ deleted: false, stripeStatus: "past_due" }), false);
  });

  test("the policy text matches the privacy policy's 90 days", () => {
    assert.match(RETENTION_POLICY_TEXT, /read-only for 90 days/);
    assert.match(read("src/app/(marketing)/privacy/page.tsx"), /90 days after account closure/);
  });

  test("subscription end queues the existing voice.number_release path, keyed on the subscription", () => {
    const release = read("src/lib/billing/number-release.ts");
    assert.match(release, /enqueue\(\s*"voice\.number_release"/);
    assert.match(release, /voice\.number_release:subscription_end:\$\{input\.subscriptionId\}/);
    assert.match(release, /CANCEL_RELEASE/);
    const sync = read("src/lib/billing/subscription-sync.ts");
    assert.match(sync, /scheduleNumberReleaseAfterEnd\(/);
    assert.match(sync, /cancelNumberReleaseOnResubscribe\(/);
  });
});
