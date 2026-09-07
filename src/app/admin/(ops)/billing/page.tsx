import * as React from "react";
import { z } from "zod";
import { getBillingView } from "@/lib/admin/billing";
import { BILLING_VIEWS, SUBSCRIPTION_STATUSES } from "@/lib/admin/billing-types";
import { ADMIN_RANGES } from "@/lib/admin/types";
import { BillingView } from "@/components/admin/billing/billing-view";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  view: z.enum(BILLING_VIEWS).default("subscriptions").catch("subscriptions"),
  q: z.string().trim().max(80).default("").catch(""),
  plan: z
    .enum(["all", "trial", "starter", "growth", "pro", "enterprise"])
    .default("all")
    .catch("all"),
  status: z.enum(["all", ...SUBSCRIPTION_STATUSES]).default("all").catch("all"),
  cycle: z.enum(["all", "month", "year"]).default("all").catch("all"),
  range: z.enum(ADMIN_RANGES).default("30d").catch("30d"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
  size: z.coerce.number().int().min(10).max(50).default(10).catch(10),
  subscription: z.string().trim().max(64).optional().catch(undefined),
});

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const params = paramsSchema.parse({
    view: first(raw.view),
    q: first(raw.q),
    plan: first(raw.plan),
    status: first(raw.status),
    cycle: first(raw.cycle),
    range: first(raw.range),
    page: first(raw.page),
    size: first(raw.size),
    subscription: first(raw.subscription),
  });

  const data = await getBillingView(
    {
      view: params.view,
      q: params.q,
      plan: params.plan,
      status: params.status,
      cycle: params.cycle,
      range: params.range,
      page: params.page,
      pageSize: params.size,
    },
    params.subscription,
  );

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
          Billing
        </h1>
        <p className="mt-1 text-[14px] text-content-muted">
          Manage subscriptions, invoices, credits and entitlements across all customers.
          Stripe remains the source of truth; changes made here are made in Stripe.
        </p>
      </div>

      <BillingView
        data={data}
        filters={{
          search: params.q,
          plan: params.plan,
          status: params.status,
          cycle: params.cycle,
        }}
      />
    </div>
  );
}
