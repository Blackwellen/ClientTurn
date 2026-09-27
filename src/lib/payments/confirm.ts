/**
 * `payment.confirm`: what happens when money arrives (the direct-sale loop,
 * step 3).
 *
 * Written against a small set of dependencies (`ConfirmDeps`) rather than
 * Supabase directly, so tests/direct-sale-job.test.ts runs the whole
 * sequence with in-memory fakes. The real dependencies are in ./confirm-deps.ts.
 *
 * Every step re-reads current state and is idempotent on its own, so a job
 * retried at any point finishes the work without repeating any of it:
 *
 *   1. record the payment -- one row per (workspace, provider, order id); a
 *      second delivery may only add a token or an interval (mergeDelivery);
 *   2. match it -- token > known subscription > email (facts.ts). An email
 *      match is REVIEW and stops here until a person confirms; no match is
 *      UNMATCHED and stops here. The owner is told either way;
 *   3. apply it (certain matches, and a person's link):
 *        - the checkout attempt -> PAID (conditional: once);
 *        - on the lead's FIRST payment only: the open opportunity takes the
 *          amount (MRR for a subscription) and closes WON through
 *          `closeOpportunity`, which emits `opportunity.won` (webhooks and
 *          the CRM push follow from the outbox) and stops the lead's
 *          automation; the thank-you is queued on the normal send path with
 *          a send key unique to the payment, so a retry never sends twice;
 *        - a renewal is recorded as revenue against the lead; no second WON,
 *          no second thank-you;
 *        - the payment is stamped applied (the revenue ledger entry).
 */

import {
  appliesAutomatically,
  matchPayment,
  mergeDelivery,
  mrrMinor,
  paymentStatusFor,
  toMajorUnits,
  wonReason,
  type PaymentFact,
  type PaymentMatch,
} from "./facts.ts";
import { thankYouMessage } from "./abandoned.ts";
import { paymentThanksSendKey } from "./send-keys.ts";

export type PaymentRow = {
  id: string;
  business_id: string;
  provider: string;
  source: string | null;
  provider_order_id: string;
  reference: string | null;
  email: string | null;
  amount_minor: number;
  currency: string;
  recurring: boolean;
  recurring_interval: string | null;
  mrr_minor: number | null;
  subscription_id: string | null;
  status: string;
  match_kind: string | null;
  lead_id: string | null;
  checkout_attempt_id: string | null;
  opportunity_id: string | null;
  applied_at: string | null;
};

export type AttemptRow = {
  id: string;
  business_id: string;
  lead_id: string;
  opportunity_id: string | null;
  link_id: string;
  channel: string;
  status: string;
};

export type LeadLite = {
  id: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  archived: boolean;
};

export type OpportunityLite = { id: string; outcome: string };

export type ConfirmDeps = {
  /** Insert-or-read on (business, provider, order id). */
  recordPayment(businessId: string, fact: PaymentFact): Promise<{ row: PaymentRow; inserted: boolean }>;
  updatePayment(businessId: string, paymentId: string, patch: Record<string, unknown>): Promise<void>;
  loadPayment(businessId: string, paymentId: string): Promise<PaymentRow | null>;
  attemptByToken(businessId: string, token: string): Promise<AttemptRow | null>;
  attemptById(businessId: string, attemptId: string): Promise<AttemptRow | null>;
  subscriptionLeadId(businessId: string, subscriptionId: string, excludePaymentId: string): Promise<string | null>;
  leadIdsByEmail(businessId: string, email: string): Promise<string[]>;
  loadLead(businessId: string, leadId: string): Promise<LeadLite | null>;
  /** Other payments already applied for this lead (a renewal or a second purchase). */
  priorAppliedPayments(businessId: string, leadId: string, excludePaymentId: string): Promise<number>;
  /** Conditional: only an attempt that is not PAID yet. */
  markAttemptPaid(businessId: string, attemptId: string, patch: Record<string, unknown>): Promise<void>;
  openOpportunity(businessId: string, leadId: string, preferredId: string | null): Promise<OpportunityLite | null>;
  hasWonOpportunity(businessId: string, leadId: string): Promise<string | null>;
  createOpportunity(businessId: string, leadId: string): Promise<string | null>;
  setOpportunityValue(businessId: string, opportunityId: string, valueMajor: number, currency: string): Promise<void>;
  closeWon(input: {
    businessId: string;
    opportunityId: string;
    reason: string;
    payment: { amount_minor: number; currency: string; recurring: boolean; interval: string | null; mrr_minor: number | null; payment_id: string };
  }): Promise<void>;
  stopAutomation(businessId: string, leadId: string): Promise<void>;
  checkoutLink(businessId: string, linkId: string | null): Promise<{ product: string; onboardingText: string | null } | null>;
  businessName(businessId: string): Promise<string>;
  queueThankYou(input: {
    businessId: string;
    leadId: string;
    channel: string;
    body: string;
    subject: string;
    sendKey: string;
  }): Promise<string | null>;
  notifyOwner(input: { businessId: string; paymentId: string; status: "REVIEW" | "UNMATCHED"; summary: string }): Promise<void>;
  audit(input: { businessId: string; action: string; entityId: string; metadata: Record<string, unknown> }): Promise<void>;
  now(): Date;
};

export type ConfirmOutcome =
  | "APPLIED"
  | "RENEWAL_RECORDED"
  | "REVIEW"
  | "UNMATCHED"
  | "DUPLICATE"
  | "ALREADY_APPLIED";

/** The thank-you's send key: one per payment, whatever retries. */
export const thankYouSendKey = paymentThanksSendKey;

/** Where the thank-you goes: the channel the link went out on, else the lead's email, else SMS. */
export function thankYouChannel(attempt: AttemptRow | null, lead: LeadLite): string | null {
  if (attempt?.channel) return attempt.channel;
  if (lead.email) return "email";
  if (lead.phone) return "sms";
  return null;
}

/** Runs for a fresh delivery: record, then match and apply. */
export async function confirmPayment(
  deps: ConfirmDeps,
  input: { businessId: string; fact: PaymentFact },
): Promise<{ outcome: ConfirmOutcome; paymentId: string }> {
  const { row, inserted } = await deps.recordPayment(input.businessId, input.fact);

  if (!inserted) {
    const merge = mergeDelivery(row, input.fact);
    if (Object.keys(merge.update).length > 0) await deps.updatePayment(input.businessId, row.id, merge.update);
    if (row.applied_at) return { outcome: "ALREADY_APPLIED", paymentId: row.id };
    // A person linked it and the apply has not finished: finish it.
    if (row.status === "LINKED") return applyLinked(deps, input.businessId, row.id);
    // Unapplied: match again. A certain match (a token that just arrived, or
    // a retry of a job that crashed mid-apply) is applied; an uncertain one
    // was already recorded and reported, so it is not reported twice.
    return matchAndApply(deps, input.businessId, row.id, { reportUncertain: false });
  }

  return matchAndApply(deps, input.businessId, row.id, { reportUncertain: true });
}

/** Runs when a person linked a payment to a lead (payment.link_to_lead). */
export async function applyLinked(
  deps: ConfirmDeps,
  businessId: string,
  paymentId: string,
): Promise<{ outcome: ConfirmOutcome; paymentId: string }> {
  const payment = await deps.loadPayment(businessId, paymentId);
  if (!payment) throw new Error("payment.confirm: the payment is gone");
  if (payment.applied_at) return { outcome: "ALREADY_APPLIED", paymentId };
  if (payment.status !== "LINKED" || !payment.lead_id) return { outcome: "DUPLICATE", paymentId };
  const attempt = payment.checkout_attempt_id ? await deps.attemptById(businessId, payment.checkout_attempt_id) : null;
  return apply(deps, payment, { leadId: payment.lead_id, attempt, kind: "MANUAL" });
}

async function matchAndApply(
  deps: ConfirmDeps,
  businessId: string,
  paymentId: string,
  options: { reportUncertain: boolean },
): Promise<{ outcome: ConfirmOutcome; paymentId: string }> {
  const payment = await deps.loadPayment(businessId, paymentId);
  if (!payment) throw new Error("payment.confirm: the payment is gone");
  if (payment.applied_at) return { outcome: "ALREADY_APPLIED", paymentId };

  const attempt = payment.reference ? await deps.attemptByToken(businessId, payment.reference) : null;
  const subscriptionLeadId =
    !attempt && payment.subscription_id
      ? await deps.subscriptionLeadId(businessId, payment.subscription_id, payment.id)
      : null;
  const emailLeadIds =
    !attempt && !subscriptionLeadId && payment.email ? await deps.leadIdsByEmail(businessId, payment.email) : [];

  const match = matchPayment({ businessId, attempt, subscriptionLeadId, emailLeadIds });

  if (!appliesAutomatically(match)) {
    if (!options.reportUncertain) return { outcome: "DUPLICATE", paymentId: payment.id };
    const status = paymentStatusFor(match) as "REVIEW" | "UNMATCHED";
    await deps.updatePayment(businessId, payment.id, {
      status,
      match_kind: match.kind === "EMAIL" ? "EMAIL" : null,
      // The candidate is recorded for the person to confirm; nothing is applied.
      lead_id: match.kind === "EMAIL" ? match.leadId : null,
    });
    await deps.notifyOwner({
      businessId,
      paymentId: payment.id,
      status,
      summary:
        status === "REVIEW"
          ? "A payment matched a lead by email only. Confirm it to mark the lead won."
          : "A payment arrived that matches no lead. Link it to the right lead.",
    });
    await deps.audit({
      businessId,
      action: "payment.received",
      entityId: payment.id,
      metadata: { status, match: match.kind, provider: payment.provider, amount_minor: payment.amount_minor, currency: payment.currency },
    });
    return { outcome: status, paymentId: payment.id };
  }

  return apply(deps, payment, {
    leadId: (match as Extract<PaymentMatch, { leadId: string }>).leadId,
    attempt: match.kind === "TOKEN" ? attempt : null,
    kind: match.kind,
  });
}

async function apply(
  deps: ConfirmDeps,
  payment: PaymentRow,
  how: { leadId: string; attempt: AttemptRow | null; kind: "TOKEN" | "SUBSCRIPTION" | "MANUAL" | "EMAIL" | "NONE" },
): Promise<{ outcome: ConfirmOutcome; paymentId: string }> {
  const businessId = payment.business_id;
  const lead = await deps.loadLead(businessId, how.leadId);
  if (!lead) {
    // The lead was deleted between the send and the payment: keep the money
    // visible for a person rather than drop it.
    await deps.updatePayment(businessId, payment.id, { status: "UNMATCHED", match_kind: null, lead_id: null });
    await deps.notifyOwner({ businessId, paymentId: payment.id, status: "UNMATCHED", summary: "A payment arrived for a lead that no longer exists." });
    return { outcome: "UNMATCHED", paymentId: payment.id };
  }

  const interval = payment.recurring_interval as PaymentFact["interval"];
  const mrr = payment.mrr_minor ?? mrrMinor({ amountMinor: payment.amount_minor, recurring: payment.recurring, interval });
  const paidAt = deps.now().toISOString();

  if (how.attempt) {
    await deps.markAttemptPaid(businessId, how.attempt.id, {
      status: "PAID",
      paid_at: paidAt,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      recurring: payment.recurring,
      recurring_interval: payment.recurring_interval,
      provider: payment.provider,
      provider_order_id: payment.provider_order_id,
      payment_id: payment.id,
    });
  }

  const prior = await deps.priorAppliedPayments(businessId, lead.id, payment.id);
  const firstPayment = prior === 0 && how.kind !== "SUBSCRIPTION";
  let opportunityId: string | null = null;

  if (firstPayment) {
    // Value is MRR for a subscription, the amount otherwise (major units).
    const valueMinor = payment.recurring && mrr !== null ? mrr : payment.amount_minor;
    const close = async (id: string) => {
      await deps.setOpportunityValue(businessId, id, toMajorUnits(valueMinor, payment.currency), payment.currency);
      await deps.closeWon({
        businessId,
        opportunityId: id,
        reason: wonReason({
          provider: payment.provider,
          source: payment.source,
          amountMinor: payment.amount_minor,
          currency: payment.currency,
          recurring: payment.recurring,
          interval,
          orderId: payment.provider_order_id,
        }),
        payment: {
          amount_minor: payment.amount_minor,
          currency: payment.currency,
          recurring: payment.recurring,
          interval: payment.recurring_interval,
          mrr_minor: mrr,
          payment_id: payment.id,
        },
      });
      opportunityId = id;
    };

    const open = await deps.openOpportunity(businessId, lead.id, how.attempt?.opportunity_id ?? null);
    if (open) {
      await close(open.id);
    } else {
      // A retry after the close, or a lead marked won by hand before paying:
      // the deal is already WON and is not closed twice.
      const won = await deps.hasWonOpportunity(businessId, lead.id);
      if (won) {
        opportunityId = won;
      } else {
        const created = await deps.createOpportunity(businessId, lead.id);
        if (created) await close(created);
      }
    }
  }

  // Follow-up and nudges end with a payment, first or not.
  await deps.stopAutomation(businessId, lead.id);

  let thankYouMessageId: string | null = null;
  if (firstPayment) {
    const channel = thankYouChannel(how.attempt, lead);
    if (channel) {
      const [link, businessName] = await Promise.all([
        deps.checkoutLink(businessId, how.attempt?.link_id ?? null),
        deps.businessName(businessId),
      ]);
      const message = thankYouMessage({
        firstName: lead.first_name,
        businessName,
        product: link?.product ?? null,
        onboardingText: link?.onboardingText ?? null,
      });
      thankYouMessageId = await deps.queueThankYou({
        businessId,
        leadId: lead.id,
        channel,
        body: message.body,
        subject: message.subject,
        sendKey: thankYouSendKey(payment.id),
      });
    }
  }

  await deps.updatePayment(businessId, payment.id, {
    status: how.kind === "MANUAL" ? "LINKED" : "MATCHED",
    match_kind: how.kind === "MANUAL" ? "MANUAL" : how.kind,
    lead_id: lead.id,
    checkout_attempt_id: how.attempt?.id ?? payment.checkout_attempt_id,
    opportunity_id: opportunityId ?? payment.opportunity_id,
    mrr_minor: mrr,
    applied_at: paidAt,
  });

  await deps.audit({
    businessId,
    action: "payment.confirmed",
    entityId: payment.id,
    metadata: {
      lead_id: lead.id,
      match: how.kind,
      first_payment: firstPayment,
      opportunity_id: opportunityId,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      recurring: payment.recurring,
      interval: payment.recurring_interval,
      thank_you_message_id: thankYouMessageId,
    },
  });

  return { outcome: firstPayment ? "APPLIED" : "RENEWAL_RECORDED", paymentId: payment.id };
}
