"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { planOrder, TRIAL_DAYS, type PlanDefinition } from "@/lib/billing/plans";
import { Container } from "./section";
import { MarketingSection, SectionIntro } from "./sections/shell";
import { CtaLink } from "./cta";
import type { CtaPlacement } from "@/lib/marketing/track";

type Cycle = "monthly" | "annual";

const PLACEMENTS: Record<string, CtaPlacement> = {
  starter: "pricing_starter",
  growth: "pricing_growth",
  pro: "pricing_pro",
  enterprise: "pricing_enterprise",
};

function annualSaving(plan: PlanDefinition) {
  if (plan.monthlyPrice === null || plan.yearlyPrice === null) return 0;
  return plan.monthlyPrice * 12 - plan.yearlyPrice;
}

function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: Cycle;
  onChange: (next: Cycle) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-xs"
    >
      {(["monthly", "annual"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={cycle === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            cycle === option
              ? "bg-accent-600 text-white"
              : "text-content-secondary hover:text-content",
          )}
        >
          {option === "monthly" ? "Monthly" : "Annual"}
        </button>
      ))}
    </div>
  );
}

function PriceLine({ plan, cycle }: { plan: PlanDefinition; cycle: Cycle }) {
  if (plan.monthlyPrice === null || plan.yearlyPrice === null) {
    return (
      <div className="mt-5">
        <p className="text-[28px] font-semibold leading-none tracking-tight text-content">
          Custom
        </p>
        <p className="mt-2 text-[12px] text-content-muted">
          Priced against your lead volume and branches.
        </p>
      </div>
    );
  }

  const monthlyEquivalent =
    cycle === "annual" ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice;
  const saving = annualSaving(plan);

  return (
    <div className="mt-5">
      <p className="flex items-baseline gap-1.5">
        <span className="lr-tabular text-[32px] font-semibold leading-none tracking-tight text-content">
          £{monthlyEquivalent}
        </span>
        <span className="text-[13px] text-content-muted">/ month</span>
      </p>
      <p className="mt-2 text-[12px] text-content-muted">
        {cycle === "annual"
          ? `£${plan.yearlyPrice.toLocaleString("en-GB")} billed yearly — save £${saving.toLocaleString("en-GB")}`
          : "Billed monthly, excluding VAT"}
      </p>
    </div>
  );
}

function PlanCard({ plan, cycle }: { plan: PlanDefinition; cycle: Cycle }) {
  const recommended = plan.recommended;

  return (
    <div
      className={cn("ct-plan ct-panel", recommended && "ct-plan-recommended")}
    >
      {recommended && (
        <span className="ct-plan-badge">
          Recommended
        </span>
      )}

      <h3 className="ct-plan-name">{plan.name}</h3>
      <p className="ct-plan-tagline">
        {plan.tagline}
      </p>

      <PriceLine plan={plan} cycle={cycle} />

      <div className="mt-6">
        {plan.selfServe ? (
          <CtaLink
            placement={PLACEMENTS[plan.id] ?? "pricing_growth"}
            href={`/signup?plan=${plan.id}`}
            variant={recommended ? "primary" : "secondary"}
            size="lg"
            fullWidth
          >
            Start Free
          </CtaLink>
        ) : (
          <Link
            href="/contact-sales"
            className="ct-plan-contact"
          >
            Contact sales
          </Link>
        )}
      </div>

      <ul className="ct-plan-features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <Check className="size-4 shrink-0" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pricing() {
  const [cycle, setCycle] = React.useState<Cycle>("monthly");
  const plans = planOrder();

  return (
    <MarketingSection id="pricing" depth={2} glow="centre" labelledBy="pricing-heading">
      <SectionIntro
        id="pricing-heading"
        align="centre"
        eyebrow="Pricing"
        title="Priced against the jobs it books, not the seats you fill."
        lead={`Every plan starts with a ${TRIAL_DAYS}-day free trial. No card required, cancel any time.`}
      />
      <Container>
        <div className="ct-cycle-row">
          <CycleToggle cycle={cycle} onChange={setCycle} />
        </div>

        <div className="ct-plan-grid">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} cycle={cycle} />
          ))}
        </div>

        <p className="ct-pricing-note">
          Prices in GBP and exclude VAT. Message costs from your SMS or WhatsApp
          provider are billed separately by that provider.
        </p>
      </Container>
    </MarketingSection>
  );
}
