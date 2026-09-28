import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { closeOpportunity, advanceLeadOpportunity } from "@/lib/opportunities/service";
import { parseAuthority } from "@/lib/commercial/authority";
import { queueNotification, queueOutboundMessage, stopAutomationRuns } from "@/lib/jobs/handlers/shared";
import { recordAudit, type AnyAuditAction } from "@/lib/audit";
import { mrrMinor, type PaymentFact } from "./facts";
import type { AttemptRow, ConfirmDeps, InvoiceSettlementDeps, LeadLite, PayableInvoice, PaymentRow } from "./confirm";
import { liveInvoiceDeps } from "@/lib/invoicing/store";
import { InvoiceServiceError, projectOntoQuote, recordPayment as recordInvoicePayment } from "@/lib/invoicing/service-core";
import type { SettlementReviewReason } from "@/lib/invoicing/settlement";
import type { Channel } from "@/lib/messaging/types";

/**
 * The Supabase half of the direct-sale loop: the real `ConfirmDeps`, and the
 * reads the settings screen and the lead page use. Service role, server-only;
 * every query is scoped to the workspace it was asked about.
 *
 * 0143 (checkout_attempts, checkout_payments, payment_endpoints) post-dates
 * the generated database types, so everything goes through one untyped seam.
 */

export function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export const PAYMENT_FIELDS =
  "id, business_id, provider, source, provider_order_id, reference, email, amount_minor, currency, recurring, recurring_interval, mrr_minor, subscription_id, status, match_kind, lead_id, checkout_attempt_id, opportunity_id, applied_at, paid_at, created_at";

const ATTEMPT_FIELDS = "id, business_id, lead_id, opportunity_id, link_id, channel, status";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export const confirmDeps: ConfirmDeps = {
  async recordPayment(businessId, fact: PaymentFact) {
    const row = {
      business_id: businessId,
      provider: fact.provider,
      source: fact.source,
      external_event_id: fact.eventId,
      provider_order_id: fact.orderId,
      reference: fact.reference,
      email: fact.email,
      amount_minor: fact.amountMinor,
      currency: fact.currency,
      recurring: fact.recurring,
      recurring_interval: fact.interval,
      mrr_minor: mrrMinor({
        amountMinor: fact.amountMinor,
        recurring: fact.recurring,
        interval: fact.interval,
        intervalCount: fact.intervalCount,
      }),
      subscription_id: fact.subscriptionId,
      paid_at: fact.paidAt,
    };
    const { data, error } = await db().from("checkout_payments").insert(row).select(PAYMENT_FIELDS).single();
    if (!error && data) {
      await notePaymentIntent(businessId, (data as PaymentRow).id, fact.paymentIntentId ?? null);
      return { row: data as PaymentRow, inserted: true };
    }
    if (error?.code !== "23505") throw new Error(`payment.confirm: record failed: ${error?.message ?? "no row"}`);
    const { data: existing, error: readError } = await db()
      .from("checkout_payments")
      .select(PAYMENT_FIELDS)
      .eq("business_id", businessId)
      .eq("provider", fact.provider)
      .eq("provider_order_id", fact.orderId)
      .maybeSingle();
    if (readError || !existing) throw new Error("payment.confirm: duplicate order could not be read");
    return { row: existing as PaymentRow, inserted: false };
  },

  async updatePayment(businessId, paymentId, patch) {
    const { error } = await db().from("checkout_payments").update(patch).eq("id", paymentId).eq("business_id", businessId);
    if (error) throw new Error(`payment.confirm: update failed: ${error.message}`);
  },

  async loadPayment(businessId, paymentId) {
    const { data, error } = await db()
      .from("checkout_payments")
      .select(PAYMENT_FIELDS)
      .eq("id", paymentId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw new Error(`payment.confirm: read failed: ${error.message}`);
    return (data as PaymentRow | null) ?? null;
  },

  async attemptByToken(businessId, token) {
    const { data } = await db()
      .from("checkout_attempts")
      .select(ATTEMPT_FIELDS)
      .eq("token", token)
      .eq("business_id", businessId)
      .maybeSingle();
    return (data as AttemptRow | null) ?? null;
  },

  async attemptById(businessId, attemptId) {
    const { data } = await db()
      .from("checkout_attempts")
      .select(ATTEMPT_FIELDS)
      .eq("id", attemptId)
      .eq("business_id", businessId)
      .maybeSingle();
    return (data as AttemptRow | null) ?? null;
  },

  async subscriptionLeadId(businessId, subscriptionId, excludePaymentId) {
    const { data } = await db()
      .from("checkout_payments")
      .select("lead_id")
      .eq("business_id", businessId)
      .eq("subscription_id", subscriptionId)
      .not("applied_at", "is", null)
      .not("lead_id", "is", null)
      .neq("id", excludePaymentId)
      .limit(1)
      .maybeSingle();
    return (data as { lead_id: string | null } | null)?.lead_id ?? null;
  },

  async leadIdsByEmail(businessId, email) {
    const { data, error } = await db()
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .ilike("email", escapeLike(email.trim()))
      .is("archived_at", null)
      .is("anonymised_at", null)
      .limit(5);
    if (error) throw new Error(`payment.confirm: email match failed: ${error.message}`);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  },

  async loadLead(businessId, leadId) {
    const { data } = await db()
      .from("leads")
      .select("id, first_name, email, phone, archived_at, anonymised_at")
      .eq("id", leadId)
      .eq("business_id", businessId)
      .maybeSingle();
    const row = data as {
      id: string;
      first_name: string | null;
      email: string | null;
      phone: string | null;
      archived_at: string | null;
      anonymised_at: string | null;
    } | null;
    if (!row || row.anonymised_at) return null;
    return { id: row.id, first_name: row.first_name, email: row.email, phone: row.phone, archived: Boolean(row.archived_at) } satisfies LeadLite;
  },

  async priorAppliedPayments(businessId, leadId, excludePaymentId) {
    const { count, error } = await db()
      .from("checkout_payments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .not("applied_at", "is", null)
      .neq("id", excludePaymentId);
    if (error) throw new Error(`payment.confirm: prior payments read failed: ${error.message}`);
    return count ?? 0;
  },

  async markAttemptPaid(businessId, attemptId, patch) {
    const { error } = await db()
      .from("checkout_attempts")
      .update(patch)
      .eq("id", attemptId)
      .eq("business_id", businessId)
      .neq("status", "PAID");
    if (error) throw new Error(`payment.confirm: attempt update failed: ${error.message}`);
  },

  async openOpportunity(businessId, leadId, preferredId) {
    if (preferredId) {
      const { data } = await db()
        .from("opportunities")
        .select("id, outcome")
        .eq("id", preferredId)
        .eq("business_id", businessId)
        .eq("outcome", "OPEN")
        .maybeSingle();
      if (data) return data as { id: string; outcome: string };
    }
    const { data } = await db()
      .from("opportunities")
      .select("id, outcome")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("outcome", "OPEN")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string; outcome: string } | null) ?? null;
  },

  async hasWonOpportunity(businessId, leadId) {
    const { data } = await db()
      .from("opportunities")
      .select("id")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("outcome", "WON")
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  },

  async createOpportunity(businessId, leadId) {
    const created = await advanceLeadOpportunity({ businessId, leadId, event: "QUALIFIED" });
    return created.ok ? created.opportunityId : null;
  },

  async setOpportunityValue(businessId, opportunityId, valueMajor, currency) {
    logWriteError(
      await db()
        .from("opportunities")
        .update({ value: Math.round(valueMajor * 100) / 100, currency })
        .eq("id", opportunityId)
        .eq("business_id", businessId)
        .eq("outcome", "OPEN"),
      "payments: record paid value on the opportunity",
      { businessId, opportunityId },
    );
  },

  async closeWon(input) {
    await closeOpportunity({
      businessId: input.businessId,
      opportunityId: input.opportunityId,
      outcome: "WON",
      reason: input.reason,
      payment: input.payment,
    });
    // Automation trigger (gap map §45): a confirmed direct sale.
    const { emitAutomationEvent } = await import("@/lib/automation/events");
    await emitAutomationEvent({
      businessId: input.businessId,
      eventType: "payment.direct_sale",
      payload: { opportunityId: input.opportunityId, payment: input.payment ?? null },
    });
  },

  async stopAutomation(businessId, leadId) {
    await stopAutomationRuns(businessId, leadId, "won");
    logWriteError(
      await db()
        .from("leads")
        .update({ automation_active: false })
        .eq("id", leadId)
        .eq("business_id", businessId)
        .eq("automation_active", true),
      "payments: stop automation",
      { businessId, leadId },
    );
  },

  async checkoutLink(businessId, linkId) {
    if (!linkId) return null;
    const { data } = await db()
      .from("commercial_authority")
      .select("enabled, approved_checkout_links, max_discount_percent, requires_human_above_value_minor")
      .eq("business_id", businessId)
      .maybeSingle();
    const link = parseAuthority(data).approved_checkout_links.find((candidate) => candidate.id === linkId);
    return link ? { product: link.product, onboardingText: link.onboarding_text ?? null } : null;
  },

  async businessName(businessId) {
    const { data } = await db().from("businesses").select("name").eq("id", businessId).maybeSingle();
    return (data as { name: string | null } | null)?.name ?? "the team";
  },

  async queueThankYou(input) {
    return queueOutboundMessage({
      businessId: input.businessId,
      leadId: input.leadId,
      channel: input.channel as Channel,
      body: input.body,
      subject: input.channel === "email" ? input.subject : null,
      // A receipt-like message about the lead's own purchase: transactional.
      // The send guard lets `payment-thanks:` through WON and the paused flag
      // only; opt-out, suppression, takeover, channel health and quiet hours
      // all still bind (send-core.ts).
      origin: "system",
      messageClass: input.channel === "email" ? "TRANSACTIONAL" : null,
      sendKey: input.sendKey,
    });
  },

  async notifyOwner(input) {
    await queueNotification({
      businessId: input.businessId,
      type: "lead_attention",
      title: input.status === "REVIEW" ? "Confirm a payment" : "A payment needs a lead",
      body: input.summary,
      severity: "warning",
      linkUrl: "/app/settings?section=connections#payments",
      entityType: "checkout_payment",
      entityId: input.paymentId,
      dedupeKey: `payment-review:${input.paymentId}`,
    });
  },

  async audit(input) {
    await recordAudit({
      businessId: input.businessId,
      actorType: "provider",
      action: input.action as AnyAuditAction,
      entityType: "checkout_payment",
      entityId: input.entityId,
      metadata: input.metadata,
    });
  },

  now: () => new Date(),

  invoices: invoiceSettlementDeps(),
};

/**
 * 0173: the PaymentIntent a refund or dispute will name. Written apart from
 * the insert so a database behind the code still records the payment.
 */
async function notePaymentIntent(businessId: string, paymentId: string, paymentIntentId: string | null): Promise<void> {
  if (!paymentIntentId) return;
  const { error } = await db()
    .from("checkout_payments")
    .update({ provider_payment_intent: paymentIntentId.slice(0, 200) })
    .eq("id", paymentId)
    .eq("business_id", businessId);
  if (error && !isSchemaLag(error)) console.error("[payment.confirm] payment intent not recorded", { paymentId, code: error.code });
}

const REVIEW_TITLE: Record<SettlementReviewReason, string> = {
  CURRENCY_MISMATCH: "Check an invoice payment",
  ZERO_AMOUNT: "Check an invoice payment",
  INVOICE_ALREADY_PAID: "An invoice was paid twice",
  INVOICE_NOT_PAYABLE: "Check an invoice payment",
  OVERPAID: "An invoice was overpaid",
  REFUNDED: "A payment was refunded",
  DISPUTED: "A payment was disputed",
};

/**
 * The invoice half of payment.confirm (0173): the pay-token lookup, the
 * invoicing append-payment path, and the owner's review notices.
 */
function invoiceSettlementDeps(): InvoiceSettlementDeps {
  return {
    async invoiceByPayToken(businessId, token) {
      const { data, error } = await db()
        .from("invoices")
        .select("id, business_id, number, status, currency, total_minor, paid_minor, opportunity_id")
        .eq("business_id", businessId)
        .eq("pay_token", token)
        .maybeSingle();
      if (error) {
        // Before 0173 there are no invoice tokens: the token is a checkout attempt's or nobody's.
        if (isSchemaLag(error)) return null;
        throw new Error(`payment.confirm: invoice token lookup failed: ${error.message}`);
      }
      if (!data) return null;
      const row = data as Omit<PayableInvoice, "lead_id"> & { opportunity_id: string };
      const { data: opp } = await db()
        .from("opportunities")
        .select("lead_id")
        .eq("id", row.opportunity_id)
        .eq("business_id", businessId)
        .maybeSingle();
      return {
        id: row.id,
        business_id: row.business_id,
        number: row.number,
        status: row.status,
        currency: row.currency,
        total_minor: Number(row.total_minor),
        paid_minor: Number(row.paid_minor),
        lead_id: (opp as { lead_id: string | null } | null)?.lead_id ?? null,
      };
    },

    async invoicePaymentRecorded(businessId, provider, externalId) {
      const { data, error } = await db()
        .from("invoice_payments")
        .select("amount_minor")
        .eq("business_id", businessId)
        .eq("provider", provider)
        .eq("external_payment_id", externalId)
        .maybeSingle();
      if (error) throw new Error(`payment.confirm: invoice payment read failed: ${error.message}`);
      return data ? Number((data as { amount_minor: number }).amount_minor) : null;
    },

    async recordInvoicePayment(input) {
      try {
        const result = await recordInvoicePayment(liveInvoiceDeps(input.businessId), input.businessId, { kind: "SYSTEM", userId: null }, {
          invoiceId: input.invoiceId,
          amountMinor: input.amountMinor,
          receivedAt: input.receivedAt,
          reference: input.externalId,
          provider: input.provider,
          checkoutPaymentId: input.checkoutPaymentId,
        });
        return result.duplicate ? "DUPLICATE" : "RECORDED";
      } catch (error) {
        if (error instanceof InvoiceServiceError && (error.code === "CONFLICT" || error.code === "NOT_FOUND")) return "CONFLICT";
        throw error;
      }
    },

    async reprojectQuote(businessId, invoiceId) {
      const deps = liveInvoiceDeps(businessId);
      const invoice = await deps.store.loadInvoice(businessId, invoiceId);
      if (invoice?.status === "PAID") await projectOntoQuote(deps, businessId, invoice);
    },

    async paymentByIntent(businessId, paymentIntentId) {
      const { data, error } = await db()
        .from("checkout_payments")
        .select(`${PAYMENT_FIELDS}, invoice_id, review_reason`)
        .eq("business_id", businessId)
        .eq("provider_payment_intent", paymentIntentId)
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isSchemaLag(error)) return null;
        throw new Error(`payment.confirm: payment intent lookup failed: ${error.message}`);
      }
      return (data as PaymentRow | null) ?? null;
    },

    async notify(input) {
      await queueNotification({
        businessId: input.businessId,
        type: "lead_attention",
        title: REVIEW_TITLE[input.reason],
        body: input.summary,
        severity: "warning",
        // The review queue (0175): apply to an invoice, or say what was done.
        linkUrl: "/app/settings?section=quotes#payment-review",
        entityType: input.invoiceId ? "invoice" : "checkout_payment",
        entityId: input.invoiceId ?? input.paymentId,
        dedupeKey: `invoice-payment:${input.paymentId}:${input.reason}`,
      });
    },
  };
}

/* --------------------------------------------------------------- reads */

export type CheckoutAttemptView = {
  id: string;
  linkId: string;
  channel: string;
  sentAt: string;
  status: string;
  nudgesSent: number;
  clickedAt: string | null;
  paidAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  recurring: boolean | null;
  interval: string | null;
};

export type PaymentView = {
  id: string;
  provider: string;
  source: string | null;
  orderId: string;
  email: string | null;
  amountMinor: number;
  currency: string;
  recurring: boolean;
  interval: string | null;
  status: string;
  matchKind: string | null;
  leadId: string | null;
  leadName: string | null;
  paidAt: string;
};

export type LoadResult<T> = { state: "ok"; data: T } | { state: "not_installed" } | { state: "error" };

/** The lead page's checkout history. Never throws. */
export async function loadLeadCheckoutActivity(
  businessId: string,
  leadId: string,
): Promise<LoadResult<{ attempts: CheckoutAttemptView[]; payments: PaymentView[] }>> {
  const [attempts, payments] = await Promise.all([
    db()
      .from("checkout_attempts")
      .select("id, link_id, channel, sent_at, status, nudges_sent, clicked_at, paid_at, amount_minor, currency, recurring, recurring_interval")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("sent_at", { ascending: false })
      .limit(20),
    db()
      .from("checkout_payments")
      .select(PAYMENT_FIELDS)
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("paid_at", { ascending: false })
      .limit(20),
  ]);
  const error = attempts.error ?? payments.error;
  if (error) return isSchemaLag(error) ? { state: "not_installed" } : { state: "error" };
  return {
    state: "ok",
    data: {
      attempts: ((attempts.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        linkId: String(row.link_id),
        channel: String(row.channel),
        sentAt: String(row.sent_at),
        status: String(row.status),
        nudgesSent: Number(row.nudges_sent ?? 0),
        clickedAt: (row.clicked_at as string | null) ?? null,
        paidAt: (row.paid_at as string | null) ?? null,
        amountMinor: row.amount_minor == null ? null : Number(row.amount_minor),
        currency: (row.currency as string | null) ?? null,
        recurring: (row.recurring as boolean | null) ?? null,
        interval: (row.recurring_interval as string | null) ?? null,
      })),
      payments: ((payments.data ?? []) as Record<string, unknown>[]).map((row) => paymentView(row, null)),
    },
  };
}

function paymentView(row: Record<string, unknown>, leadName: string | null): PaymentView {
  return {
    id: String(row.id),
    provider: String(row.provider),
    source: (row.source as string | null) ?? null,
    orderId: String(row.provider_order_id),
    email: (row.email as string | null) ?? null,
    amountMinor: Number(row.amount_minor ?? 0),
    currency: String(row.currency),
    recurring: Boolean(row.recurring),
    interval: (row.recurring_interval as string | null) ?? null,
    status: String(row.status),
    matchKind: (row.match_kind as string | null) ?? null,
    leadId: (row.lead_id as string | null) ?? null,
    leadName,
    paidAt: String(row.paid_at),
  };
}

/**
 * Payments waiting for a person to say who paid: REVIEW (email-only
 * candidate) and UNMATCHED. An invoice payment under review (0173
 * match_kind INVOICE) is not a direct sale and is resolved in Settings ->
 * Quotes & invoices instead, so it is left out here; so is a payment a person
 * already dismissed there (0175). Never throws.
 */
export async function loadPaymentsNeedingReview(businessId: string): Promise<LoadResult<PaymentView[]>> {
  const query = (withResolution: boolean) => {
    let q = db()
      .from("checkout_payments")
      .select(`${PAYMENT_FIELDS}, leads(first_name, last_name, email)`)
      .eq("business_id", businessId)
      .in("status", ["REVIEW", "UNMATCHED"])
      .or("match_kind.is.null,match_kind.neq.INVOICE");
    if (withResolution) q = q.is("review_resolved_at", null);
    return q.order("paid_at", { ascending: false }).limit(50);
  };
  let { data, error } = await query(true);
  // Before 0175 there is no resolution column: every REVIEW / UNMATCHED row is open.
  if (error && isSchemaLag(error)) ({ data, error } = await query(false));
  if (error) return isSchemaLag(error) ? { state: "not_installed" } : { state: "error" };
  return {
    state: "ok",
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const lead = row.leads as { first_name: string | null; last_name: string | null; email: string | null } | null;
      const name = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email : null;
      return paymentView(row, name ?? null);
    }),
  };
}

/* ------------------------------------------------------------ endpoints */

export type EndpointKind = "STRIPE" | "ORDER_PAID";

export type EndpointView = {
  id: string;
  kind: EndpointKind;
  active: boolean;
  hasSecret: boolean;
  lastReceivedAt: string | null;
  lastError: string | null;
};

/** The workspace's payment endpoints, never with their secrets. Never throws. */
export async function loadPaymentEndpoints(businessId: string): Promise<LoadResult<EndpointView[]>> {
  const { data, error } = await db()
    .from("payment_endpoints")
    .select("id, kind, active, secret_ciphertext, last_received_at, last_error")
    .eq("business_id", businessId);
  if (error) return isSchemaLag(error) ? { state: "not_installed" } : { state: "error" };
  return {
    state: "ok",
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      kind: row.kind as EndpointKind,
      active: Boolean(row.active),
      hasSecret: Boolean(row.secret_ciphertext),
      lastReceivedAt: (row.last_received_at as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
    })),
  };
}

/** For a webhook route: the endpoint and its sealed secret. Service role only. */
export async function endpointForDelivery(
  endpointId: string,
  kind: EndpointKind,
): Promise<{ id: string; business_id: string; secret_ciphertext: string | null } | null> {
  const { data } = await db()
    .from("payment_endpoints")
    .select("id, business_id, secret_ciphertext")
    .eq("id", endpointId)
    .eq("kind", kind)
    .eq("active", true)
    .maybeSingle();
  return (data as { id: string; business_id: string; secret_ciphertext: string | null } | null) ?? null;
}

/** Bookkeeping on a delivery; never fails the request. */
export async function noteEndpointDelivery(endpointId: string, error: string | null): Promise<void> {
  const patch: Record<string, unknown> = error
    ? { last_error: error.slice(0, 200) }
    : { last_received_at: new Date().toISOString(), last_error: null };
  await db()
    .from("payment_endpoints")
    .update(patch)
    .eq("id", endpointId)
    .then(
      () => undefined,
      () => undefined,
    );
}

/* ---------------------------------------------------------- attempts */

export type AttemptForNudge = {
  id: string;
  business_id: string;
  lead_id: string;
  link_id: string;
  channel: string;
  sent_url: string;
  sent_at: string;
  status: string;
  nudges_sent: number;
  tracking_param: string;
};

export async function loadAttemptForNudge(attemptId: string): Promise<AttemptForNudge | null> {
  const { data, error } = await db()
    .from("checkout_attempts")
    .select("id, business_id, lead_id, link_id, channel, sent_url, sent_at, status, nudges_sent, tracking_param")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw new Error(`checkout.nudge: read failed: ${error.message}`);
  return (data as AttemptForNudge | null) ?? null;
}

/** A payment for the lead still waiting for a person (never nudge someone who may have paid). */
export async function paymentUnderReview(businessId: string, leadId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("checkout_payments")
    .select("id")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .is("applied_at", null)
    .limit(1);
  // When unsure, do not chase: a read error counts as "under review".
  if (error) return true;
  return (data ?? []).length > 0;
}
