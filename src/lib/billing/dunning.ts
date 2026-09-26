import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { recordAudit } from "@/lib/audit";
import { queueNotification } from "@/lib/jobs/handlers/shared";
import { stripe } from "./stripe";
import { attemptInvoiceCharge } from "./dunning-core";
import {
  DUNNING_WINDOW_DAYS,
  GRACE_FULL_ACCESS_DAYS,
  MAX_DUNNING_ATTEMPTS,
  dayKey,
  dunningDecision,
  dunningNoticeFor,
  exhaustedAfter,
  type DunningLike,
  type DunningNotice,
} from "./lifecycle";

/**
 * Failed-payment recovery (8.10): the owner's rule is "if payment fails, retry
 * charging every day for up to 30 days until it succeeds; stop immediately once
 * paid". Done here rather than in the Stripe dashboard's retry settings so the
 * schedule is code, versioned and tested.
 *
 *   invoice.payment_failed  -> `recordInvoiceFailure`  opens a dunning record
 *   daily cron              -> `runDunningRetries`     retries each open record
 *   invoice.paid            -> `recordInvoicePaid`     closes it, stops retries
 *
 * Grace policy: see lifecycle.ts.
 */

type DunningRow = DunningLike & {
  id: string;
  business_id: string;
  stripe_invoice_id: string;
  stripe_subscription_id: string | null;
  amount_due_minor: number | null;
  currency: string | null;
  notices_sent: string[] | null;
};

const DUNNING_COLUMNS =
  "id, business_id, stripe_invoice_id, stripe_subscription_id, amount_due_minor, currency, status, first_failed_at, attempts, last_attempt_on, notices_sent";

// billing_dunning (0129) post-dates the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** The subscription an invoice belongs to, across Stripe API versions. */
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: unknown }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) {
    return String((legacy as { id: unknown }).id);
  }
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: unknown } | null } | null;
  }).parent;
  const nested = parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "id" in nested) {
    return String((nested as { id: unknown }).id);
  }
  return null;
}

async function businessForCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("subscriptions")
    .select("business_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`dunning: subscription lookup failed: ${error.message}`);
  return (data as { business_id: string } | null)?.business_id ?? null;
}

const portalLink = "/api/billing/portal";

function money(minor: number | null, currency: string | null): string {
  if (minor === null) return "the amount due";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: (currency ?? "gbp").toUpperCase(),
  }).format(minor / 100);
}

const NOTICE_COPY: Record<
  DunningNotice,
  (row: DunningRow) => { title: string; body: string; severity: "info" | "warning" | "error" }
> = {
  failed: (row) => ({
    severity: "warning",
    title: "Your payment didn't go through",
    body:
      `We couldn't take ${money(row.amount_due_minor, row.currency)} for your ClientTurn subscription. ` +
      `We'll try again once a day for up to ${DUNNING_WINDOW_DAYS} days, and stop as soon as it succeeds. ` +
      `Everything keeps running for now; if it is still unpaid in ${GRACE_FULL_ACCESS_DAYS} days, sending and AI pause until it is. ` +
      "Update your card to settle it straight away.",
  }),
  restricted: () => ({
    severity: "error",
    title: "Sending and AI are paused: payment still outstanding",
    body:
      "Your leads are still being captured and nothing has been deleted, but follow-up messages and the AI assistant are paused. " +
      "Queued messages will go out once the payment clears. Update your card to resume.",
  }),
  final_warning: () => ({
    severity: "error",
    title: "Your subscription will be cancelled in a few days",
    body:
      `We have been unable to collect payment for almost ${DUNNING_WINDOW_DAYS} days. ` +
      "If the last retries fail, the subscription will be cancelled and the workspace becomes read-only. Update your card to keep it.",
  }),
  cancelled: () => ({
    severity: "error",
    title: "Subscription cancelled after failed payments",
    body:
      `After ${MAX_DUNNING_ATTEMPTS} daily retries the payment still failed, so the subscription has been cancelled. ` +
      "Your workspace is read-only: your data is intact and can be exported. Resubscribe at any time to carry on.",
  }),
  recovered: () => ({
    severity: "info",
    title: "Payment received, thank you",
    body: "Your subscription is paid and everything is running normally again.",
  }),
};

/** Sends a notice once per invoice: the `notices_sent` array is the watermark. */
async function sendNotice(row: DunningRow, notice: DunningNotice): Promise<void> {
  if ((row.notices_sent ?? []).includes(notice)) return;

  const copy = NOTICE_COPY[notice](row);
  await queueNotification({
    businessId: row.business_id,
    type: "billing",
    severity: copy.severity,
    title: copy.title,
    body: copy.body,
    linkUrl:
      notice === "cancelled"
        ? "/start-trial"
        : notice === "recovered"
          ? "/app/settings?section=billing"
          : portalLink,
    dedupeKey: `dunning:${row.stripe_invoice_id}:${notice}`,
  });

  logWriteError(
    await db()
      .from("billing_dunning")
      .update({ notices_sent: [...(row.notices_sent ?? []), notice] })
      .eq("id", row.id),
    "dunning: record notice",
    { businessId: row.business_id, notice },
  );
  row.notices_sent = [...(row.notices_sent ?? []), notice];
}

/* ------------------------------------------------------------ webhooks */

/**
 * `invoice.payment_failed`. Opens the dunning record for a subscription
 * invoice -- once: the daily retry's own failures emit this event too, and
 * must not reset the clock or the attempt count.
 */
export async function recordInvoiceFailure(invoice: Stripe.Invoice, eventId: string): Promise<void> {
  const subscriptionId = subscriptionIdOfInvoice(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId || !invoice.id) return;

  const businessId = await businessForCustomer(customerId);
  if (!businessId) return;

  assertWrite(
    await db()
      .from("subscriptions")
      .update({ status: "PAST_DUE" })
      .eq("business_id", businessId)
      .in("status", ["TRIALING", "ACTIVE", "PAST_DUE", "UNPAID"]),
    "stripe webhook: mark past due",
    { eventId, businessId },
  );

  // One-off purchases (top-ups) are not subscription invoices; only a failed
  // subscription charge is dunned.
  if (!subscriptionId) return;

  const insert = await db()
    .from("billing_dunning")
    .insert({
      business_id: businessId,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      amount_due_minor: invoice.amount_due ?? null,
      currency: invoice.currency ?? null,
      status: "OPEN",
    })
    .select(DUNNING_COLUMNS)
    .maybeSingle();
  assertWrite(insert, "stripe webhook: open dunning", { eventId, businessId }, {
    ignoreCodes: ["23505"],
  });

  const row = insert.data as DunningRow | null;
  if (!row) return; // already open: a retry's own failure

  await recordAudit({
    businessId,
    actorType: "provider",
    action: "billing.plan_changed",
    entityType: "subscription",
    metadata: { status: "PAST_DUE", stripe_event: "invoice.payment_failed", invoice: invoice.id },
  });
  await sendNotice(row, "failed");
}

/** `invoice.paid`. Stops retrying that invoice, immediately. */
export async function recordInvoicePaid(invoice: Stripe.Invoice, eventId: string): Promise<void> {
  if (!invoice.id) return;

  const closed = await db()
    .from("billing_dunning")
    .update({ status: "RECOVERED", resolved_at: new Date().toISOString() })
    .eq("stripe_invoice_id", invoice.id)
    .eq("status", "OPEN")
    .select(DUNNING_COLUMNS);
  assertWrite(closed, "stripe webhook: close dunning", { eventId, invoice: invoice.id });

  for (const row of (closed.data ?? []) as DunningRow[]) {
    // Don't wait for customer.subscription.updated to lift the pause.
    assertWrite(
      await db()
        .from("subscriptions")
        .update({ status: "ACTIVE" })
        .eq("business_id", row.business_id)
        .in("status", ["PAST_DUE", "UNPAID"]),
      "stripe webhook: clear past due",
      { eventId, businessId: row.business_id },
    );
    await sendNotice(row, "recovered");
  }
}

/* ------------------------------------------------------------ daily job */

export type DunningRunSummary = {
  considered: number;
  retried: number;
  recovered: number;
  failed: number;
  exhausted: number;
  closed: number;
};

/**
 * The daily retry. Safe to run any number of times a day: each record is
 * claimed for today with a conditional update before Stripe is touched, and
 * the charge itself is idempotent per invoice per day at Stripe.
 */
export async function runDunningRetries(now = new Date()): Promise<DunningRunSummary> {
  const summary: DunningRunSummary = {
    considered: 0,
    retried: 0,
    recovered: 0,
    failed: 0,
    exhausted: 0,
    closed: 0,
  };

  const { data, error } = await db()
    .from("billing_dunning")
    .select(DUNNING_COLUMNS)
    .eq("status", "OPEN")
    .order("first_failed_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`dunning: read open records failed: ${error.message}`);

  const today = dayKey(now);

  for (const row of (data ?? []) as DunningRow[]) {
    summary.considered += 1;
    const decision = dunningDecision(row, now);

    if (decision.action === "exhaust") {
      await exhaust(row, now);
      summary.exhausted += 1;
      continue;
    }

    const notice = dunningNoticeFor(new Date(row.first_failed_at), now);
    if (notice) await sendNotice(row, notice);

    if (decision.action !== "retry") continue;

    // Claim today's attempt. Losing the claim means another worker has it.
    const claim = await db()
      .from("billing_dunning")
      .update({ last_attempt_on: today, last_attempt_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "OPEN")
      .or(`last_attempt_on.is.null,last_attempt_on.lt.${today}`)
      .select("id");
    assertWrite(claim, "dunning: claim attempt", { businessId: row.business_id });
    if (!claim.data?.length) continue;

    summary.retried += 1;
    const result = await attemptInvoiceCharge(stripe, row.stripe_invoice_id, today);

    if (result.outcome === "paid") {
      assertWrite(
        await db()
          .from("billing_dunning")
          .update({
            status: "RECOVERED",
            attempts: row.attempts + (result.alreadyPaid ? 0 : 1),
            resolved_at: now.toISOString(),
            last_error: null,
          })
          .eq("id", row.id),
        "dunning: recovered",
        { businessId: row.business_id },
      );
      assertWrite(
        await db()
          .from("subscriptions")
          .update({ status: "ACTIVE" })
          .eq("business_id", row.business_id)
          .in("status", ["PAST_DUE", "UNPAID"]),
        "dunning: clear past due",
        { businessId: row.business_id },
      );
      await sendNotice(row, "recovered");
      summary.recovered += 1;
      continue;
    }

    if (result.outcome === "closed") {
      assertWrite(
        await db()
          .from("billing_dunning")
          .update({
            status: "CLOSED",
            resolved_at: now.toISOString(),
            last_error: `Invoice ${result.invoiceStatus}.`,
          })
          .eq("id", row.id),
        "dunning: closed",
        { businessId: row.business_id },
      );
      summary.closed += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    assertWrite(
      await db()
        .from("billing_dunning")
        .update({ attempts, last_error: result.declineCode ?? result.error })
        .eq("id", row.id),
      "dunning: record failed attempt",
      { businessId: row.business_id },
    );
    summary.failed += 1;

    if (exhaustedAfter(attempts)) {
      await exhaust({ ...row, attempts }, now);
      summary.exhausted += 1;
    }
  }

  return summary;
}

/**
 * Thirty days and thirty retries without a payment: cancel at Stripe, mark the
 * record exhausted and the workspace cancelled (read-only, data intact).
 */
async function exhaust(row: DunningRow, now: Date): Promise<void> {
  if (row.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(row.stripe_subscription_id, {
        invoice_now: false,
        prorate: false,
      });
    } catch (error) {
      // Already cancelled (e.g. by Stripe's own retry settings) is the outcome
      // wanted; anything else is retried by the next day's run.
      const code = (error as { code?: string }).code;
      if (code !== "resource_missing") {
        const message = error instanceof Error ? error.message : String(error);
        if (!/canceled|cancelled/i.test(message)) throw error;
      }
    }
  }

  assertWrite(
    await db()
      .from("billing_dunning")
      .update({ status: "EXHAUSTED", resolved_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "OPEN"),
    "dunning: exhausted",
    { businessId: row.business_id },
  );
  assertWrite(
    await db()
      .from("subscriptions")
      .update({ status: "CANCELLED", cancelled_at: now.toISOString() })
      .eq("business_id", row.business_id),
    "dunning: cancel subscription",
    { businessId: row.business_id },
  );
  await recordAudit({
    businessId: row.business_id,
    actorType: "system",
    action: "billing.plan_changed",
    entityType: "subscription",
    metadata: { status: "CANCELLED", reason: "dunning_exhausted", invoice: row.stripe_invoice_id },
  });
  await sendNotice(row, "cancelled");
}

/** The open dunning record for a workspace, for the billing view and banner. */
export async function getOpenDunning(businessId: string): Promise<{
  firstFailedAt: string;
  attempts: number;
  amountDueMinor: number | null;
  currency: string | null;
} | null> {
  const { data, error } = await db()
    .from("billing_dunning")
    .select("first_failed_at, attempts, amount_due_minor, currency")
    .eq("business_id", businessId)
    .eq("status", "OPEN")
    .order("first_failed_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const row = data as {
    first_failed_at: string;
    attempts: number;
    amount_due_minor: number | null;
    currency: string | null;
  } | null;
  return row
    ? {
        firstFailedAt: row.first_failed_at,
        attempts: row.attempts,
        amountDueMinor: row.amount_due_minor === null ? null : Number(row.amount_due_minor),
        currency: row.currency,
      }
    : null;
}
