import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { runDunningRetries } from "@/lib/billing/dunning";
import { stripe } from "@/lib/billing/stripe";

/**
 * `billing.daily` (Phase 8.10 / 8.13), enqueued once a day by the daily cron.
 *
 *   1. Dunning: retry each failed subscription invoice at most once a day for
 *      up to 30 days, stopping the moment one is paid (billing/dunning.ts).
 *   2. Overage: add the messaging overage recorded since the last run to each
 *      customer's next Stripe invoice, one invoice item per overage record,
 *      idempotent at Stripe on the record id.
 *
 * Retry-safe throughout: both halves re-read current state before any Stripe
 * call and key their Stripe writes, so a job retried after a timeout neither
 * charges a card twice in a day nor bills an overage twice.
 */
export async function handleBillingDaily(job: ClaimedJob): Promise<void> {
  void job;
  const dunning = await runDunningRetries(new Date());
  const overage = await pushOverageToStripe();
  console.info(
    `[billing.daily] dunning considered=${dunning.considered} retried=${dunning.retried} ` +
      `recovered=${dunning.recovered} failed=${dunning.failed} exhausted=${dunning.exhausted} ` +
      `overage_items=${overage}`,
  );
}

async function pushOverageToStripe(): Promise<number> {
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await db
    .from("usage_overage_events")
    .select("id, business_id, channel, units, amount_minor, billing_period")
    .is("stripe_invoice_item_id", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`billing.daily: overage read failed: ${error.message}`);

  let pushed = 0;
  const customers = new Map<string, string | null>();

  for (const row of (data ?? []) as {
    id: string;
    business_id: string;
    channel: string;
    units: number;
    amount_minor: number;
    billing_period: string;
  }[]) {
    if (!customers.has(row.business_id)) {
      const { data: sub } = await db
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("business_id", row.business_id)
        .maybeSingle();
      customers.set(row.business_id, (sub as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null);
    }
    const customer = customers.get(row.business_id);
    if (!customer || Number(row.amount_minor) <= 0) continue;

    const item = await stripe.invoiceItems.create(
      {
        customer,
        amount: Number(row.amount_minor),
        currency: "gbp",
        description: `${row.channel === "sms" ? "SMS segments" : "WhatsApp messages"} over allowance (${row.units}), ${row.billing_period.slice(0, 7)}`,
        metadata: { kind: "messaging_overage", overage_event_id: row.id, business_id: row.business_id },
      },
      { idempotencyKey: `clientturn-overage:${row.id}` },
    );

    logWriteError(
      await db.from("usage_overage_events").update({ stripe_invoice_item_id: item.id }).eq("id", row.id),
      "billing.daily: record invoice item",
      { businessId: row.business_id },
    );
    pushed += 1;
  }
  return pushed;
}
