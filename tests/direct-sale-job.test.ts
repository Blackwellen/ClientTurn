import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyLinked, confirmPayment, type ConfirmDeps, type PaymentRow } from "../src/lib/payments/confirm.ts";
import { orderPaidFact, orderPaidSchema, stripePaymentFact, type PaymentFact } from "../src/lib/payments/facts.ts";

/**
 * payment.confirm with in-memory fakes: the whole apply sequence, its
 * idempotency, and the REVIEW / UNMATCHED / linked paths, with no database.
 */

const BIZ = "11111111-1111-1111-1111-111111111111";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";

function world() {
  const payments: PaymentRow[] = [];
  const attempts = [
    { id: "att-1", business_id: BIZ, lead_id: "lead-1", opportunity_id: "opp-1", link_id: "starter-site", channel: "sms", status: "ABANDONED", token: TOKEN },
  ];
  const leads = [
    { id: "lead-1", first_name: "Oliver", email: "oliver@example.com", phone: "+447700900001", archived: false, automation: true },
    { id: "lead-2", first_name: "Priya", email: "priya@example.com", phone: null, archived: false, automation: true },
  ];
  const opportunities = [{ id: "opp-1", lead_id: "lead-1", outcome: "OPEN", value: 0, currency: "GBP" }];
  const sent: { sendKey: string; channel: string; body: string; leadId: string }[] = [];
  const events: string[] = [];
  const notices: string[] = [];
  const audits: string[] = [];
  let seq = 0;

  const deps: ConfirmDeps = {
    async recordPayment(businessId, fact: PaymentFact) {
      const existing = payments.find((p) => p.business_id === businessId && p.provider === fact.provider && p.provider_order_id === fact.orderId);
      if (existing) return { row: { ...existing }, inserted: false };
      const row: PaymentRow = {
        id: `pay-${++seq}`,
        business_id: businessId,
        provider: fact.provider,
        source: fact.source,
        provider_order_id: fact.orderId,
        reference: fact.reference,
        email: fact.email,
        amount_minor: fact.amountMinor,
        currency: fact.currency,
        recurring: fact.recurring,
        recurring_interval: fact.interval,
        mrr_minor: null,
        subscription_id: fact.subscriptionId,
        status: "UNMATCHED",
        match_kind: null,
        lead_id: null,
        checkout_attempt_id: null,
        opportunity_id: null,
        applied_at: null,
      };
      payments.push(row);
      return { row: { ...row }, inserted: true };
    },
    async updatePayment(_b, id, patch) {
      Object.assign(payments.find((p) => p.id === id)!, patch);
    },
    async loadPayment(_b, id) {
      const row = payments.find((p) => p.id === id);
      return row ? { ...row } : null;
    },
    async attemptByToken(businessId, token) {
      return attempts.find((a) => a.business_id === businessId && a.token === token) ?? null;
    },
    async attemptById(_b, id) {
      return attempts.find((a) => a.id === id) ?? null;
    },
    async subscriptionLeadId(_b, sub, exclude) {
      return payments.find((p) => p.subscription_id === sub && p.applied_at && p.lead_id && p.id !== exclude)?.lead_id ?? null;
    },
    async leadIdsByEmail(_b, email) {
      return leads.filter((l) => l.email === email).map((l) => l.id);
    },
    async loadLead(_b, id) {
      const lead = leads.find((l) => l.id === id);
      return lead ? { id: lead.id, first_name: lead.first_name, email: lead.email, phone: lead.phone, archived: lead.archived } : null;
    },
    async priorAppliedPayments(_b, leadId, exclude) {
      return payments.filter((p) => p.lead_id === leadId && p.applied_at && p.id !== exclude).length;
    },
    async markAttemptPaid(_b, id, patch) {
      const attempt = attempts.find((a) => a.id === id)!;
      if (attempt.status !== "PAID") Object.assign(attempt, patch);
    },
    async openOpportunity(_b, leadId, preferred) {
      return (
        opportunities.find((o) => o.id === preferred && o.outcome === "OPEN") ??
        opportunities.find((o) => o.lead_id === leadId && o.outcome === "OPEN") ??
        null
      );
    },
    async hasWonOpportunity(_b, leadId) {
      return opportunities.find((o) => o.lead_id === leadId && o.outcome === "WON")?.id ?? null;
    },
    async createOpportunity(_b, leadId) {
      const id = `opp-new-${leadId}`;
      opportunities.push({ id, lead_id: leadId, outcome: "OPEN", value: 0, currency: "GBP" });
      return id;
    },
    async setOpportunityValue(_b, id, value, currency) {
      const opp = opportunities.find((o) => o.id === id)!;
      if (opp.outcome === "OPEN") Object.assign(opp, { value, currency });
    },
    async closeWon(input) {
      const opp = opportunities.find((o) => o.id === input.opportunityId)!;
      opp.outcome = "WON";
      // closeOpportunity's event dedupe key: one opportunity.won per opportunity.
      const key = `opportunity.won:${opp.id}`;
      if (!events.includes(key)) events.push(key);
      const lead = leads.find((l) => l.id === opp.lead_id);
      if (lead) lead.automation = false;
    },
    async stopAutomation(_b, leadId) {
      leads.find((l) => l.id === leadId)!.automation = false;
    },
    async checkoutLink(_b, linkId) {
      return linkId === "starter-site" ? { product: "Starter website", onboardingText: "We will email your onboarding form today." } : null;
    },
    async businessName() {
      return "Pixelforge Studio";
    },
    async queueThankYou(input) {
      if (!sent.some((m) => m.sendKey === input.sendKey)) sent.push({ sendKey: input.sendKey, channel: input.channel, body: input.body, leadId: input.leadId });
      return `msg-${input.sendKey}`;
    },
    async notifyOwner(input) {
      notices.push(`${input.status}:${input.paymentId}`);
    },
    async audit(input) {
      audits.push(input.action);
    },
    now: () => new Date("2026-09-27T11:00:00Z"),
  };
  return { deps, payments, attempts, leads, opportunities, sent, events, notices, audits };
}

const tokenFact = (): PaymentFact =>
  (stripePaymentFact({
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1_790_000_000,
    data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 295000, currency: "gbp", client_reference_id: TOKEN, customer_details: { email: "someone-else@example.com" } } },
  }) as { fact: PaymentFact }).fact;

describe("payment.confirm (fakes)", () => {
  test("a token-matched payment: attempt PAID, opportunity WON with the amount, automation stopped, thank-you queued", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: tokenFact() });
    assert.equal(result.outcome, "APPLIED");
    assert.equal(w.attempts[0].status, "PAID");
    assert.equal(w.opportunities[0].outcome, "WON");
    assert.equal(w.opportunities[0].value, 2950);
    assert.deepEqual(w.events, ["opportunity.won:opp-1"]);
    assert.equal(w.leads[0].automation, false);
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0].channel, "sms");
    assert.equal(w.sent[0].leadId, "lead-1");
    assert.match(w.sent[0].body, /Thank you, Oliver! Your payment for Starter website has come through\. We will email your onboarding form today\./);
    assert.equal(w.sent[0].sendKey, `payment-thanks:${result.paymentId}`);
    const payment = w.payments[0];
    assert.equal(payment.status, "MATCHED");
    assert.equal(payment.match_kind, "TOKEN");
    assert.ok(payment.applied_at);
    assert.ok(w.audits.includes("payment.confirmed"));
  });

  test("the same delivery twice, or the job retried, does nothing twice", async () => {
    const w = world();
    await confirmPayment(w.deps, { businessId: BIZ, fact: tokenFact() });
    const again = await confirmPayment(w.deps, { businessId: BIZ, fact: { ...tokenFact(), eventId: "evt_1_redelivered" } });
    assert.equal(again.outcome, "ALREADY_APPLIED");
    assert.equal(w.sent.length, 1);
    assert.equal(w.events.length, 1);
    assert.equal(w.payments.length, 1);
  });

  test("a crash after the close: the retried job finishes without closing or thanking twice", async () => {
    const w = world();
    let failOnce = true;
    const failing: ConfirmDeps = {
      ...w.deps,
      async updatePayment(b, id, patch) {
        if (failOnce && patch.applied_at) {
          failOnce = false;
          throw new Error("database down");
        }
        return w.deps.updatePayment(b, id, patch);
      },
    };
    await assert.rejects(confirmPayment(failing, { businessId: BIZ, fact: tokenFact() }));
    assert.equal(w.opportunities[0].outcome, "WON");
    assert.equal(w.payments[0].applied_at, null);
    // The job is retried with the same payload.
    const retried = await confirmPayment(failing, { businessId: BIZ, fact: tokenFact() });
    assert.equal(retried.outcome, "APPLIED");
    assert.ok(w.payments[0].applied_at);
    assert.equal(w.events.length, 1);
    assert.equal(w.sent.length, 1);
  });

  test("an email-only match is REVIEW: recorded, the owner told, nothing applied", async () => {
    const w = world();
    const fact = orderPaidFact(orderPaidSchema.parse({ order_id: "1001", amount: "49.00", currency: "GBP", email: "priya@example.com", source: "shopify" }));
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact });
    assert.equal(result.outcome, "REVIEW");
    assert.equal(w.payments[0].status, "REVIEW");
    assert.equal(w.payments[0].lead_id, "lead-2");
    assert.equal(w.payments[0].applied_at, null);
    assert.equal(w.sent.length, 0);
    assert.deepEqual(w.notices, [`REVIEW:${result.paymentId}`]);
  });

  test("no match is UNMATCHED and kept, never dropped", async () => {
    const w = world();
    const fact = orderPaidFact(orderPaidSchema.parse({ order_id: "1002", amount: 10, currency: "GBP", email: "nobody@example.com" }));
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact });
    assert.equal(result.outcome, "UNMATCHED");
    assert.equal(w.payments.length, 1);
    assert.deepEqual(w.notices, [`UNMATCHED:${result.paymentId}`]);
  });

  test("a person links it: the same apply (a new opportunity when none is open), one thank-you", async () => {
    const w = world();
    const fact = orderPaidFact(orderPaidSchema.parse({ order_id: "1001", amount: "49.00", currency: "GBP", email: "priya@example.com" }));
    const { paymentId } = await confirmPayment(w.deps, { businessId: BIZ, fact });
    Object.assign(w.payments[0], { status: "LINKED", match_kind: "MANUAL", lead_id: "lead-2" });
    const result = await applyLinked(w.deps, BIZ, paymentId);
    assert.equal(result.outcome, "APPLIED");
    assert.equal(w.payments[0].status, "LINKED");
    assert.equal(w.payments[0].match_kind, "MANUAL");
    assert.equal(w.opportunities.find((o) => o.lead_id === "lead-2")?.outcome, "WON");
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0].channel, "email");
    assert.match(w.sent[0].body, /The team at Pixelforge Studio will be in touch with the next steps\./);
    assert.equal((await applyLinked(w.deps, BIZ, paymentId)).outcome, "ALREADY_APPLIED");
    assert.equal(w.sent.length, 1);
  });

  test("a later delivery that brings the token upgrades a REVIEW to a certain match", async () => {
    const w = world();
    const base = { order_id: "sub_9", amount: 49, currency: "GBP", email: "priya@example.com", interval: "month" as const };
    await confirmPayment(w.deps, { businessId: BIZ, fact: orderPaidFact(orderPaidSchema.parse(base)) });
    assert.equal(w.payments[0].status, "REVIEW");
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: orderPaidFact(orderPaidSchema.parse({ ...base, reference: TOKEN, event_id: "e2" })) });
    assert.equal(result.outcome, "APPLIED");
    assert.equal(w.payments[0].lead_id, "lead-1");
    assert.equal(w.payments[0].status, "MATCHED");
    assert.equal(w.payments.length, 1);
  });

  test("a subscription renewal is recorded against the lead: no second WON, no second thank-you", async () => {
    const w = world();
    const first = orderPaidFact(orderPaidSchema.parse({ order_id: "sub_1", subscription_id: "sub_1", amount: 49, currency: "GBP", reference: TOKEN, interval: "month" }));
    await confirmPayment(w.deps, { businessId: BIZ, fact: first });
    assert.equal(w.opportunities[0].value, 49);
    const renewal = orderPaidFact(orderPaidSchema.parse({ order_id: "in_2", subscription_id: "sub_1", amount: 49, currency: "GBP", interval: "month" }));
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: renewal });
    assert.equal(result.outcome, "RENEWAL_RECORDED");
    assert.equal(w.payments[1].lead_id, "lead-1");
    assert.equal(w.payments[1].match_kind, "SUBSCRIPTION");
    assert.equal(w.events.length, 1);
    assert.equal(w.sent.length, 1);
  });
});
