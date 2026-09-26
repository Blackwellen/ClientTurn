"use client";

import * as React from "react";
import { Check, CreditCard, Lock } from "lucide-react";
import { startTrialCheckout } from "@/lib/billing/checkout-actions";

export type PickerPlan = {
  id: "starter" | "growth" | "pro";
  name: string;
  tagline: string;
  monthlyPrice: number;
  yearlyPrice: number;
  recommended: boolean;
  features: string[];
};

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

/**
 * Plan choice before Checkout. Prices come from the plan catalogue; the card
 * is collected by Stripe, never by this page.
 */
export function StartTrialPicker({
  plans,
  trialDays,
  annualDiscountPercent,
}: {
  plans: PickerPlan[];
  trialDays: number | null;
  annualDiscountPercent: number;
}) {
  const [interval, setBillingInterval] = React.useState<"month" | "year">("month");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function choose(plan: PickerPlan["id"]) {
    setPending(plan);
    setError(null);
    const result = await startTrialCheckout({ plan, interval });
    if (result.ok) {
      window.location.assign(result.url);
      return;
    }
    setPending(null);
    setError(result.error);
  }

  return (
    <section aria-label="Choose a plan" className="mt-8">
      <div
        role="radiogroup"
        aria-label="Billing interval"
        className="inline-flex rounded-[10px] border border-[rgba(150,170,190,0.28)] p-1"
      >
        {(["month", "year"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={interval === value}
            onClick={() => setBillingInterval(value)}
            className={`h-8 rounded-[7px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)] ${
              interval === value ? "bg-[var(--auth-lime)] text-[#071009]" : "text-[#cbd5e1] hover:text-white"
            }`}
          >
            {value === "month" ? "Monthly" : `Yearly (save ${annualDiscountPercent}%)`}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-[13px] text-[#fca5a5]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const price = interval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
          return (
            <article
              key={plan.id}
              className={`flex flex-col rounded-[14px] border bg-[#0a131b] p-5 ${
                plan.recommended ? "border-[var(--auth-lime)]" : "border-[rgba(150,170,190,0.28)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[16px] font-semibold text-[#f8fafc]">{plan.name}</h2>
                {plan.recommended ? (
                  <span className="rounded-full bg-[rgba(183,243,74,0.14)] px-2 py-0.5 text-[11px] font-semibold text-[var(--auth-lime)]">
                    Most chosen
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] text-[#96a1b3]">{plan.tagline}</p>
              <p className="mt-4 text-[24px] font-semibold text-[#f8fafc]">
                {GBP.format(price)}
                <span className="text-[13px] font-normal text-[#96a1b3]">
                  {interval === "month" ? " / month" : " / year"}
                </span>
              </p>
              <p className="text-[12px] text-[#96a1b3]">
                {trialDays ? `£0 today, first payment after ${trialDays} days` : "Charged today"} · excl. VAT
              </p>
              <ul className="mt-4 flex-1 space-y-1.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[13px] text-[#cbd5e1]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--auth-lime)]" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => choose(plan.id)}
                disabled={pending !== null}
                aria-busy={pending === plan.id}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-[9px] bg-[var(--auth-lime)] px-3 text-[13px] font-semibold text-[#071009] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
              >
                <CreditCard className="size-4" aria-hidden />
                {pending === plan.id
                  ? "Opening secure checkout…"
                  : trialDays
                    ? `Start trial on ${plan.name}`
                    : `Subscribe to ${plan.name}`}
              </button>
            </article>
          );
        })}
      </div>

      <p className="mt-5 flex items-center gap-2 text-[12px] text-[#96a1b3]">
        <Lock className="size-3.5" aria-hidden />
        Card details are entered on Stripe&apos;s secure checkout and never reach ClientTurn. During the trial,
        trial limits apply whichever plan you choose; the plan&apos;s full limits start with your first payment.
      </p>
    </section>
  );
}
