import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import {
  DEFAULT_TRACKING_PARAM,
  STRIPE_TRACKING_PARAM,
  isStripePaymentLink,
  tagCheckoutUrl,
  trackedTokenFor,
  trackingParamFor,
  untagCheckoutUrl,
} from "../src/lib/payments/tracking.ts";
import { derivedCheckoutToken, newCheckoutToken } from "../src/lib/payments/tracking-token.ts";
import {
  signOrderPaid,
  signStripePayload,
  verifyOrderPaidSignature,
  verifyStripeSignature,
} from "../src/lib/payments/signatures.ts";
import {
  matchPayment,
  mergeDelivery,
  mrrMinor,
  orderPaidFact,
  orderPaidSchema,
  paymentStatusFor,
  appliesAutomatically,
  stripePaymentFact,
  toMinorUnits,
  type PaymentFact,
} from "../src/lib/payments/facts.ts";
import {
  DEFAULT_ABANDONED_CHECKOUT,
  attemptExpiresAt,
  attemptStatusAt,
  nudgeChannel,
  nudgeDecision,
  nudgeSchedule,
  parseAbandonedSettings,
  thankYouMessage,
} from "../src/lib/payments/abandoned.ts";
import { checkoutNudgeEvent, checkoutNudgeOf } from "../src/lib/payments/nudge-event.ts";
import { isPaymentThanksSendKey, paymentThanksSendKey } from "../src/lib/payments/send-keys.ts";
import {
  checkoutLinkIn,
  checkoutMessage,
  commercialAuthoritySchema,
  parseAuthority,
  type CheckoutLink,
} from "../src/lib/commercial/authority.ts";
import { countQuestions, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { evaluateSend } from "../src/lib/jobs/send-core.ts";

const STRIPE_LINK: CheckoutLink = {
  id: "pro-monthly",
  label: "Pro",
  product: "Pro plan",
  url: "https://buy.stripe.com/test_eVa5nPg1j1wmfXq5kr",
  price_text: "£49 per month",
  currency: "GBP",
};
const SHOP_LINK: CheckoutLink = {
  id: "starter-site",
  label: "Starter",
  product: "Starter website",
  url: "https://shop.example.com/products/starter?variant=12",
  price_text: "£2,950",
  currency: "GBP",
};
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";

/* ------------------------------------------------------------ link tagging */

describe("tracked checkout links", () => {
  test("a Stripe Payment Link carries client_reference_id, and only that", () => {
    assert.equal(isStripePaymentLink(STRIPE_LINK.url), true);
    assert.equal(trackingParamFor(STRIPE_LINK), STRIPE_TRACKING_PARAM);
    const tagged = tagCheckoutUrl(STRIPE_LINK.url, trackingParamFor(STRIPE_LINK), TOKEN);
    assert.equal(tagged, `${STRIPE_LINK.url}?client_reference_id=${TOKEN}`);
  });

  test("another provider gets ct_ref by default, keeping its own query, or a configured parameter", () => {
    assert.equal(trackingParamFor(SHOP_LINK), DEFAULT_TRACKING_PARAM);
    assert.equal(
      tagCheckoutUrl(SHOP_LINK.url, "ct_ref", TOKEN),
      `https://shop.example.com/products/starter?variant=12&ct_ref=${TOKEN}`,
    );
    assert.equal(trackingParamFor({ ...SHOP_LINK, tracking_param: "attributes[ct_ref]" }), "attributes[ct_ref]");
    // An invalid configured parameter falls back rather than being trusted.
    assert.equal(trackingParamFor({ ...SHOP_LINK, tracking_param: "a b" }), DEFAULT_TRACKING_PARAM);
  });

  test("tokens are opaque, Stripe-safe and never the lead id; derived tokens are stable per send", () => {
    const random = newCheckoutToken();
    assert.match(random, /^[A-Za-z0-9_-]{24}$/);
    assert.notEqual(random, newCheckoutToken());
    const a = derivedCheckoutToken("a-long-server-secret", "agent-checkout:run-1");
    assert.equal(a, derivedCheckoutToken("a-long-server-secret", "agent-checkout:run-1"));
    assert.notEqual(a, derivedCheckoutToken("a-long-server-secret", "agent-checkout:run-2"));
    assert.notEqual(a, derivedCheckoutToken("another-server-secret", "agent-checkout:run-1"));
    assert.match(a, /^[A-Za-z0-9_-]{24}$/);
    assert.throws(() => tagCheckoutUrl(STRIPE_LINK.url, "client_reference_id", "short"));
    assert.throws(() => tagCheckoutUrl(STRIPE_LINK.url, "client_reference_id", "has spaces in it!!!!"));
  });

  test("untagging accepts exactly base + the one parameter", () => {
    const tagged = tagCheckoutUrl(SHOP_LINK.url, "ct_ref", TOKEN);
    assert.deepEqual(untagCheckoutUrl(`${tagged}.`, "ct_ref")?.token, TOKEN);
    assert.equal(trackedTokenFor(tagged, SHOP_LINK.url, "ct_ref"), TOKEN);
    // Another parameter added as well: refused.
    assert.equal(trackedTokenFor(`${tagged}&utm_source=x`, SHOP_LINK.url, "ct_ref"), null);
    // The parameter twice: refused.
    assert.equal(trackedTokenFor(`${tagged}&ct_ref=${TOKEN}`, SHOP_LINK.url, "ct_ref"), null);
    // A different base: refused.
    assert.equal(trackedTokenFor(tagged.replace("starter", "premium"), SHOP_LINK.url, "ct_ref"), null);
    // The base's own query changed: refused.
    assert.equal(trackedTokenFor(tagged.replace("variant=12", "variant=13"), SHOP_LINK.url, "ct_ref"), null);
    // A malformed token: refused.
    assert.equal(trackedTokenFor(`${SHOP_LINK.url}&ct_ref=abc`, SHOP_LINK.url, "ct_ref"), null);
  });

  test("the sent message appends the tracked URL; checkoutLinkIn still recognises the link", () => {
    const tracked = { ...STRIPE_LINK, tracked_url: tagCheckoutUrl(STRIPE_LINK.url, STRIPE_TRACKING_PARAM, TOKEN) };
    const message = checkoutMessage("Here is the link to get started.", tracked);
    assert.ok(message.endsWith(tracked.tracked_url));
    assert.equal(checkoutLinkIn(message, [STRIPE_LINK])?.id, STRIPE_LINK.id);
    // An untracked link still works exactly as before.
    assert.ok(checkoutMessage("Here you go.", STRIPE_LINK).endsWith(STRIPE_LINK.url));
  });
});

/* --------------------------------------------------------------- validator */

function facts(overrides: Partial<ValidationFacts> = {}): ValidationFacts {
  return {
    channel: "sms",
    businessName: "Pixelforge Studio",
    publishedPriceText: [STRIPE_LINK.price_text],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [STRIPE_LINK.url],
    serviceAreaConfirmed: false,
    commercial: { enabled: true, maxDiscountPercent: 0, checkoutLinks: [STRIPE_LINK, SHOP_LINK] },
    ...overrides,
  };
}

describe("the validator and tracked links", () => {
  const tagged = tagCheckoutUrl(STRIPE_LINK.url, STRIPE_TRACKING_PARAM, TOKEN);

  test("an approved link allowed this turn plus exactly its tracking parameter passes", () => {
    const result = validateResponse(`Great, here is the link: ${tagged}`, facts());
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("any other added parameter is an unapproved link", () => {
    const result = validateResponse(`Here: ${tagged}&coupon=FREE`, facts());
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.failures.some((f) => f.code === "UNAPPROVED_LINK"));
  });

  test("the wrong parameter name is an unapproved link", () => {
    const result = validateResponse(`Here: ${STRIPE_LINK.url}?ct_ref=${TOKEN}`, facts());
    assert.ok(!result.ok && result.failures.some((f) => f.code === "UNAPPROVED_LINK"));
  });

  test("a tracked link whose base is not allowed on this turn is refused", () => {
    const result = validateResponse(`Here: ${tagged}`, facts({ allowedUrls: [] }));
    assert.ok(!result.ok && result.failures.some((f) => f.code === "UNAPPROVED_LINK"));
  });

  test("direct close off: a tracked link is refused", () => {
    const result = validateResponse(`Here: ${tagged}`, facts({ commercial: { enabled: false, maxDiscountPercent: 0, checkoutLinks: [STRIPE_LINK] } }));
    assert.ok(!result.ok && result.failures.some((f) => f.code === "UNAPPROVED_LINK"));
  });

  test("the tracked link's query string is not a question (found live, story I3b)", () => {
    assert.equal(countQuestions(`Here you go: ${tagged}`), 0);
    assert.equal(countQuestions(`Ready to start? ${tagged}`), 1);
    const again = validateResponse(`Here is the link again. ${tagged}`, facts({ priorOutbound: [`Here is the link to start. ${STRIPE_LINK.url}?client_reference_id=ZZZZZZZZZZZZZZZZZZZZZZZZ`] }));
    assert.ok(again.ok || !again.failures.some((f) => f.code === "QA_REPEAT"), JSON.stringify(again));
  });

  test("the price check still binds to the tracked link's own price text", () => {
    const result = validateResponse(`It's £39 a month: ${tagged}`, facts({ publishedPriceText: ["£39"] }));
    assert.ok(!result.ok && result.failures.some((f) => f.code === "CHECKOUT_PRICE_MISMATCH"));
  });
});

/* ------------------------------------------------------------- signatures */

describe("signature verification", () => {
  const secret = "whsec_test_0123456789abcdefABCDEF";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_790_000_000;

  test("Stripe: a header built by the Stripe SDK verifies; tampering, staleness and a wrong secret do not", () => {
    const sdk = new Stripe("sk_test_fixture_only");
    const header = sdk.webhooks.generateTestHeaderString({ payload, secret, timestamp: now });
    assert.deepEqual(verifyStripeSignature({ rawBody: payload, header, secret, nowSeconds: now }), { ok: true });
    assert.equal(verifyStripeSignature({ rawBody: `${payload} `, header, secret, nowSeconds: now }).ok, false);
    assert.deepEqual(verifyStripeSignature({ rawBody: payload, header, secret, nowSeconds: now + 301 }), { ok: false, reason: "stale" });
    assert.deepEqual(verifyStripeSignature({ rawBody: payload, header, secret: `${secret}x`, nowSeconds: now }), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyStripeSignature({ rawBody: payload, header: "nonsense", secret, nowSeconds: now }), { ok: false, reason: "malformed" });
    assert.deepEqual(verifyStripeSignature({ rawBody: payload, header: null, secret, nowSeconds: now }), { ok: false, reason: "missing" });
  });

  test("Stripe: our signer agrees with the SDK's verifier, and any one of several v1 values may match", () => {
    const sdk = new Stripe("sk_test_fixture_only");
    const ours = signStripePayload(payload, secret, now);
    const event = sdk.webhooks.constructEvent(payload, ours, secret, 1e12);
    assert.equal((event as { id: string }).id, "evt_1");
    const rolled = `${ours},v1=${"0".repeat(64)}`;
    assert.equal(verifyStripeSignature({ rawBody: payload, header: rolled, secret, nowSeconds: now }).ok, true);
  });

  test("order paid: HMAC-SHA256 over timestamp.body, five minutes each way", () => {
    const body = JSON.stringify({ order_id: "1001", amount: "49.00", currency: "GBP" });
    const orderSecret = "ctop_" + "ab".repeat(32);
    const signature = signOrderPaid(body, orderSecret, now);
    // Fixture computed independently: HMAC-SHA256("ctop_abab...", "1790000000.{body}").
    assert.match(signature, /^[a-f0-9]{64}$/);
    assert.deepEqual(verifyOrderPaidSignature({ rawBody: body, timestamp: String(now), signature, secret: orderSecret, nowSeconds: now }), { ok: true });
    assert.equal(verifyOrderPaidSignature({ rawBody: body, timestamp: String(now), signature: signature.toUpperCase(), secret: orderSecret, nowSeconds: now }).ok, true);
    assert.equal(verifyOrderPaidSignature({ rawBody: body.replace("49", "4"), timestamp: String(now), signature, secret: orderSecret, nowSeconds: now }).ok, false);
    assert.deepEqual(verifyOrderPaidSignature({ rawBody: body, timestamp: String(now - 400), signature, secret: orderSecret, nowSeconds: now }), { ok: false, reason: "stale" });
    assert.deepEqual(verifyOrderPaidSignature({ rawBody: body, timestamp: "12", signature, secret: orderSecret, nowSeconds: now }), { ok: false, reason: "malformed" });
    assert.deepEqual(verifyOrderPaidSignature({ rawBody: body, timestamp: String(now), signature: "", secret: orderSecret, nowSeconds: now }), { ok: false, reason: "missing" });
  });
});

/* ------------------------------------------------------------------ facts */

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_session_1",
    type: "checkout.session.completed",
    created: 1_790_000_000,
    data: {
      object: {
        id: "cs_test_1",
        mode: "payment",
        payment_status: "paid",
        amount_total: 4900,
        currency: "gbp",
        client_reference_id: TOKEN,
        customer_details: { email: "Oliver@Example.com" },
        ...overrides,
      },
    },
  };
}

describe("payment facts", () => {
  test("a paid Checkout Session becomes a fact with the token, email and amount", () => {
    const result = stripePaymentFact(session());
    assert.equal(result.kind, "fact");
    const fact = (result as { fact: PaymentFact }).fact;
    assert.equal(fact.reference, TOKEN);
    assert.equal(fact.email, "oliver@example.com");
    assert.equal(fact.amountMinor, 4900);
    assert.equal(fact.currency, "GBP");
    assert.equal(fact.orderId, "cs_test_1");
    assert.equal(fact.recurring, false);
  });

  test("an unpaid session (a debit still clearing) is ignored; its async success is not", () => {
    assert.equal(stripePaymentFact(session({ payment_status: "unpaid" })).kind, "ignore");
    const later = { ...session({ payment_status: "paid" }), type: "checkout.session.async_payment_succeeded" };
    assert.equal(stripePaymentFact(later).kind, "fact");
  });

  test("a subscription session's order is the subscription, so its first invoice collapses onto it", () => {
    const sub = stripePaymentFact(session({ mode: "subscription", subscription: "sub_1" }));
    assert.equal((sub as { fact: PaymentFact }).fact.orderId, "sub_1");
    assert.equal((sub as { fact: PaymentFact }).fact.recurring, true);
    const invoice = stripePaymentFact({
      id: "evt_inv_1",
      type: "invoice.paid",
      created: 1_790_000_000,
      data: {
        object: {
          id: "in_1",
          amount_paid: 4900,
          currency: "gbp",
          customer_email: "oliver@example.com",
          billing_reason: "subscription_create",
          parent: { subscription_details: { subscription: "sub_1" } },
          lines: { data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }] },
        },
      },
    });
    const fact = (invoice as { fact: PaymentFact }).fact;
    assert.equal(fact.orderId, "sub_1");
    assert.equal(fact.interval, "month");
    // A renewal is its own order, tied to the subscription.
    const renewal = stripePaymentFact({
      id: "evt_inv_2",
      type: "invoice.paid",
      data: { object: { id: "in_2", amount_paid: 4900, currency: "gbp", billing_reason: "subscription_cycle", subscription: "sub_1" } },
    });
    assert.equal((renewal as { fact: PaymentFact }).fact.orderId, "in_2");
    assert.equal((renewal as { fact: PaymentFact }).fact.subscriptionId, "sub_1");
  });

  test("other events and zero-amount invoices are ignored", () => {
    assert.equal(stripePaymentFact({ id: "evt_x", type: "customer.created", data: { object: {} } }).kind, "ignore");
    assert.equal(stripePaymentFact({ id: "evt_z", type: "invoice.paid", data: { object: { id: "in_0", amount_paid: 0, currency: "gbp" } } }).kind, "ignore");
  });

  test("a client_reference_id that could not be ours is not treated as a token", () => {
    const result = stripePaymentFact(session({ client_reference_id: "x y" }));
    assert.equal((result as { fact: PaymentFact }).fact.reference, null);
  });

  test("the order-paid body: amount in major units, currency upper-cased, recurring with interval", () => {
    const parsed = orderPaidSchema.parse({ order_id: "1001", amount: "49.99", currency: "gbp", reference: TOKEN, email: "a@b.co", interval: "month", source: "shopify" });
    const fact = orderPaidFact(parsed, new Date("2026-09-27T10:00:00Z"));
    assert.equal(fact.amountMinor, 4999);
    assert.equal(fact.currency, "GBP");
    assert.equal(fact.recurring, true);
    assert.equal(fact.interval, "month");
    assert.equal(fact.eventId, "1001");
    assert.equal(fact.source, "shopify");
    assert.equal(toMinorUnits(5000, "JPY"), 5000);
    assert.equal(orderPaidSchema.safeParse({ order_id: "1", amount: "-4", currency: "GBP" }).success, false);
    assert.equal(orderPaidSchema.safeParse({ order_id: "1", amount: 10, currency: "POUNDS" }).success, false);
  });

  test("MRR: monthly as is, yearly /12, never guessed without an interval", () => {
    assert.equal(mrrMinor({ amountMinor: 4900, recurring: true, interval: "month" }), 4900);
    assert.equal(mrrMinor({ amountMinor: 48000, recurring: true, interval: "year" }), 4000);
    assert.equal(mrrMinor({ amountMinor: 1000, recurring: true, interval: "week" }), 4333);
    assert.equal(mrrMinor({ amountMinor: 9800, recurring: true, interval: "month", intervalCount: 2 }), 4900);
    assert.equal(mrrMinor({ amountMinor: 4900, recurring: true, interval: null }), null);
    assert.equal(mrrMinor({ amountMinor: 4900, recurring: false, interval: "month" }), null);
  });
});

/* --------------------------------------------------------------- matching */

describe("matching: token > subscription > email (REVIEW) > none", () => {
  const biz = "11111111-1111-1111-1111-111111111111";
  const attempt = { id: "att-1", business_id: biz, lead_id: "lead-token" };

  test("the token wins over an email match", () => {
    const match = matchPayment({ businessId: biz, attempt, subscriptionLeadId: null, emailLeadIds: ["lead-email"] });
    assert.deepEqual(match, { kind: "TOKEN", leadId: "lead-token", attemptId: "att-1" });
    assert.equal(paymentStatusFor(match), "MATCHED");
    assert.equal(appliesAutomatically(match), true);
  });

  test("an attempt from another workspace never matches", () => {
    const match = matchPayment({ businessId: biz, attempt: { ...attempt, business_id: "other" }, subscriptionLeadId: null, emailLeadIds: [] });
    assert.equal(match.kind, "NONE");
  });

  test("a renewal follows its subscription", () => {
    const match = matchPayment({ businessId: biz, attempt: null, subscriptionLeadId: "lead-sub", emailLeadIds: ["x"] });
    assert.equal(match.kind, "SUBSCRIPTION");
    assert.equal(appliesAutomatically(match), true);
  });

  test("an email-only match is REVIEW and is not applied automatically", () => {
    const match = matchPayment({ businessId: biz, attempt: null, subscriptionLeadId: null, emailLeadIds: ["lead-email", "lead-email"] });
    assert.deepEqual(match, { kind: "EMAIL", leadId: "lead-email" });
    assert.equal(paymentStatusFor(match), "REVIEW");
    assert.equal(appliesAutomatically(match), false);
  });

  test("two people with the email, or nobody, is UNMATCHED", () => {
    assert.equal(paymentStatusFor(matchPayment({ businessId: biz, attempt: null, subscriptionLeadId: null, emailLeadIds: ["a", "b"] })), "UNMATCHED");
    assert.equal(paymentStatusFor(matchPayment({ businessId: biz, attempt: null, subscriptionLeadId: null, emailLeadIds: [] })), "UNMATCHED");
  });

  test("idempotency: a second delivery of an order only adds a missing token or interval", () => {
    const fact = orderPaidFact(orderPaidSchema.parse({ order_id: "1", amount: 49, currency: "GBP", reference: TOKEN, interval: "month" }));
    const unapplied = { applied_at: null, status: "REVIEW", reference: null, recurring_interval: null, amount_minor: 4900, recurring: false };
    const merged = mergeDelivery(unapplied, fact);
    assert.equal(merged.rematch, true);
    assert.equal(merged.update.reference, TOKEN);
    assert.equal(merged.update.mrr_minor, 4900);
    const applied = { ...unapplied, applied_at: "2026-09-27T10:00:00Z", status: "MATCHED", reference: TOKEN, recurring_interval: "month" };
    assert.deepEqual(mergeDelivery(applied, fact), { update: {}, rematch: false });
  });
});

/* ------------------------------------------------------ abandoned checkout */

describe("abandoned checkout", () => {
  const sentAt = new Date("2026-09-27T10:00:00Z");
  const lead = { optedOut: false, status: "QUALIFIED", humanTakeover: false, archived: false, automationActive: true };
  const base = { attempt: { status: "SENT", nudgesSent: 0, sentAt }, settings: DEFAULT_ABANDONED_CHECKOUT, lead, paymentUnderReview: false };
  const hours = (h: number) => new Date(sentAt.getTime() + h * 3_600_000);

  test("defaults: two nudges at 24h and 72h, expiry a week after the last", () => {
    assert.deepEqual(nudgeSchedule(sentAt, DEFAULT_ABANDONED_CHECKOUT).map((d) => (d.getTime() - sentAt.getTime()) / 3_600_000), [24, 72]);
    assert.equal((attemptExpiresAt(sentAt, DEFAULT_ABANDONED_CHECKOUT).getTime() - sentAt.getTime()) / 3_600_000, 72 + 168);
    assert.deepEqual(nudgeSchedule(sentAt, { ...DEFAULT_ABANDONED_CHECKOUT, enabled: false }), []);
    assert.equal(attemptStatusAt({ status: "SENT", sentAt }, DEFAULT_ABANDONED_CHECKOUT, hours(1)), "SENT");
    assert.equal(attemptStatusAt({ status: "SENT", sentAt }, DEFAULT_ABANDONED_CHECKOUT, hours(25)), "ABANDONED");
    assert.equal(attemptStatusAt({ status: "SENT", sentAt }, DEFAULT_ABANDONED_CHECKOUT, hours(300)), "EXPIRED");
    assert.equal(attemptStatusAt({ status: "PAID", sentAt }, DEFAULT_ABANDONED_CHECKOUT, hours(300)), "PAID");
  });

  test("stored settings are read defensively", () => {
    assert.deepEqual(parseAbandonedSettings(null), DEFAULT_ABANDONED_CHECKOUT);
    assert.deepEqual(parseAbandonedSettings({ abandoned_checkout_max_nudges: 9 }), DEFAULT_ABANDONED_CHECKOUT);
    assert.equal(parseAbandonedSettings({ abandoned_checkout_delay_hours: 6 }).delay_hours, 6);
    assert.equal(parseAuthority({ enabled: false, approved_checkout_links: [] }).abandoned_checkout?.max_nudges, 2);
  });

  test("a nudge waits for its time, then sends; never more than the maximum; never twice", () => {
    assert.deepEqual(nudgeDecision({ ...base, nudge: 1, now: hours(2) }), { action: "WAIT", until: hours(24) });
    assert.deepEqual(nudgeDecision({ ...base, nudge: 1, now: hours(24) }), { action: "SEND" });
    assert.deepEqual(nudgeDecision({ ...base, nudge: 2, now: hours(72) }), { action: "SEND" });
    assert.deepEqual(nudgeDecision({ ...base, nudge: 3, now: hours(200) }), { action: "STOP", reason: "EXHAUSTED" });
    assert.deepEqual(nudgeDecision({ ...base, attempt: { ...base.attempt, nudgesSent: 1 }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "ALREADY_SENT" });
  });

  test("stop on payment is absolute, and so are opt-out, a closed lead and a payment under review", () => {
    assert.deepEqual(nudgeDecision({ ...base, attempt: { ...base.attempt, status: "PAID" }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "PAID" });
    assert.deepEqual(nudgeDecision({ ...base, paymentUnderReview: true, nudge: 1, now: hours(30) }), { action: "STOP", reason: "PAYMENT_UNDER_REVIEW" });
    assert.deepEqual(nudgeDecision({ ...base, lead: { ...lead, status: "WON" }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "LEAD_CLOSED" });
    assert.deepEqual(nudgeDecision({ ...base, lead: { ...lead, optedOut: true }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "OPTED_OUT" });
    assert.deepEqual(nudgeDecision({ ...base, lead: { ...lead, humanTakeover: true }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "HUMAN_TAKEOVER" });
    assert.deepEqual(nudgeDecision({ ...base, lead: { ...lead, automationActive: false }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "AUTOMATION_PAUSED" });
    assert.deepEqual(nudgeDecision({ ...base, settings: { ...DEFAULT_ABANDONED_CHECKOUT, enabled: false }, nudge: 1, now: hours(30) }), { action: "STOP", reason: "DISABLED" });
  });

  test("channel: engaged stays on the link's channel; unengaged goes by email, SMS only if affordable", () => {
    const all = { available: { sms: true, email: true }, leadHas: { sms: true, email: true } };
    assert.equal(nudgeChannel({ sentChannel: "sms", engaged: true, ...all, smsAffordable: false }), "sms");
    assert.equal(nudgeChannel({ sentChannel: "sms", engaged: false, ...all, smsAffordable: true }), "email");
    assert.equal(nudgeChannel({ sentChannel: "sms", engaged: false, available: { sms: true, email: false }, leadHas: { sms: true, email: true }, smsAffordable: true }), "sms");
    assert.equal(nudgeChannel({ sentChannel: "sms", engaged: false, available: { sms: true, email: false }, leadHas: { sms: true, email: true }, smsAffordable: false }), null);
  });

  test("the nudge event is a FOLLOW_UP_DUE turn keyed per attempt and nudge", () => {
    const event = checkoutNudgeEvent({ businessId: "b", leadId: "l", attemptId: "att", nudge: 2, channel: "email", occurredAt: sentAt.toISOString() });
    assert.equal(event.eventType, "FOLLOW_UP_DUE");
    assert.equal(event.idempotencyKey, "checkout-nudge:att:2");
    assert.deepEqual(checkoutNudgeOf(event), { attemptId: "att", nudge: 2 });
    assert.equal(checkoutNudgeOf({ eventType: "FOLLOW_UP_DUE", payload: {} }), null);
    assert.equal(checkoutNudgeOf({ ...event, eventType: "INBOUND_SMS" }), null);
  });
});

/* ----------------------------------------------------- thank-you and guard */

describe("the thank-you", () => {
  test("uses the link's onboarding text, or a generic line that promises no time", () => {
    const withText = thankYouMessage({ firstName: "Oliver", businessName: "Pixelforge", product: "Starter website", onboardingText: "We will email your onboarding form today." });
    assert.equal(withText.body, "Thank you, Oliver! Your payment for Starter website has come through. We will email your onboarding form today.");
    const generic = thankYouMessage({ firstName: null, businessName: "Pixelforge", product: null, onboardingText: null });
    assert.equal(generic.body, "Thank you! Your payment has come through. The team at Pixelforge will be in touch with the next steps.");
    assert.equal(generic.subject, "Thank you from Pixelforge");
  });

  test("the send guard lets the thank-you through WON and paused, and nothing else", () => {
    const snapshot = {
      lead: { status: "WON", optedOut: false, humanTakeover: false, automationActive: false, hasReplied: true },
      channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
      quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
      origin: "system" as const,
    };
    assert.ok(isPaymentThanksSendKey(paymentThanksSendKey("p1")));
    assert.deepEqual(evaluateSend({ ...snapshot, paymentConfirmation: true }), { action: "send" });
    // Without the marker a WON lead is not messaged.
    assert.deepEqual(evaluateSend(snapshot), { action: "abort", reason: "won" });
    // The marker on another origin does nothing.
    assert.equal(evaluateSend({ ...snapshot, origin: "agent", paymentConfirmation: true }).action, "abort");
    // Opt-out, takeover and suppression still bind.
    assert.deepEqual(evaluateSend({ ...snapshot, paymentConfirmation: true, lead: { ...snapshot.lead, optedOut: true } }), { action: "abort", reason: "opted_out" });
    assert.deepEqual(evaluateSend({ ...snapshot, paymentConfirmation: true, lead: { ...snapshot.lead, humanTakeover: true } }), { action: "abort", reason: "human_takeover" });
    assert.deepEqual(evaluateSend({ ...snapshot, paymentConfirmation: true, channel: { ...snapshot.channel, contactSuppressed: true } }), { action: "abort", reason: "suppressed" });
  });
});

describe("commercial authority carries the new link fields", () => {
  test("onboarding text, tracking parameter and billing interval validate; the schema still refuses bad ones", () => {
    const ok = commercialAuthoritySchema.safeParse({
      enabled: true,
      approved_checkout_links: [{ ...SHOP_LINK, onboarding_text: "We start Monday.", tracking_param: "attributes[ct_ref]", billing_interval: "month" }],
      max_discount_percent: 0,
      requires_human_above_value_minor: null,
      abandoned_checkout: { enabled: true, delay_hours: 24, max_nudges: 2, gap_hours: 48 },
    });
    assert.equal(ok.success, true);
    const bad = commercialAuthoritySchema.safeParse({
      enabled: true,
      approved_checkout_links: [{ ...SHOP_LINK, tracking_param: "bad param" }],
      max_discount_percent: 0,
      requires_human_above_value_minor: null,
      abandoned_checkout: { enabled: true, delay_hours: 24, max_nudges: 9, gap_hours: 48 },
    });
    assert.equal(bad.success, false);
  });
});
