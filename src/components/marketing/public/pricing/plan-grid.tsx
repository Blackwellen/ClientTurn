"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PLANS,
  planOrder,
  ANNUAL_DISCOUNT_PERCENT,
  TRIAL_DAYS,
  type PlanDefinition,
} from "@/lib/billing/plans";
import { SOURCING_ALLOWANCES } from "@/lib/billing/sourcing-allowances";
import { buttonClass } from "../ui";
import {
  trackCta,
  trackEngagement,
  withCampaignParams,
  type CtaPlacement,
} from "@/lib/marketing/track";

/**
 * The plan grid and its billing toggle.
 *
 * Every figure comes from the plan catalogue (`lib/billing/plans`) and the
 * seeded Find Leads allowances (`lib/billing/sourcing-allowances`) — nothing
 * is written here. That is deliberate: a public price that disagreed with what
 * checkout charges is the worst bug this page could have, so the page cannot
 * express a number the product does not hold.
 *
 * The recommended plan is whichever the catalogue marks `recommended`. It is
 * not a popularity claim, and it is never described as one.
 */

type Cycle = "monthly" | "annual";

const PLACEMENTS: Record<string, CtaPlacement> = {
  starter: "pricing_starter",
  growth: "pricing_growth",
  pro: "pricing_pro",
  enterprise: "pricing_enterprise",
};

const NUMBER = new Intl.NumberFormat("en-GB");

/** What each plan card leads with. Allowances, never infrastructure units. */
function cardFeatures(plan: PlanDefinition): string[] {
  const sourcing = SOURCING_ALLOWANCES[plan.id];

  if (plan.id === "enterprise") {
    return [
      "Custom inbound lead volume",
      "Custom sourcing and verified prospect allowance",
      "Custom messaging volume",
      "Custom user and workspace limits",
      "AI assistant included",
      "Dedicated support contact and a DPA",
    ];
  }

  return [
    `${NUMBER.format(plan.leadLimit)} new leads a month`,
    `${NUMBER.format(sourcing.verifiedProspects)} verified prospects a month`,
    `${NUMBER.format(sourcing.emailSends)} outbound emails a month`,
    `${NUMBER.format(plan.smsSegmentAllowance)} UK SMS segments${plan.whatsappEnabled ? " + WhatsApp" : ""}`,
    `${plan.userLimit} ${plan.userLimit === 1 ? "user" : "users"}`,
    "AI assistant included",
  ];
}

function PriceBlock({ plan, cycle }: { plan: PlanDefinition; cycle: Cycle }) {
  if (plan.monthlyPrice === null || plan.yearlyPrice === null) {
    return (
      <>
        <p className="pub-plan-price">
          <b>Custom</b>
        </p>
        <p className="pub-plan-sub">
          Priced against your lead volume, sourcing allowance and team.
        </p>
      </>
    );
  }

  const perMonth =
    cycle === "annual" ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice;
  const saving = plan.monthlyPrice * 12 - plan.yearlyPrice;

  return (
    <>
      <p className="pub-plan-price">
        <b>£{NUMBER.format(perMonth)}</b>
        <span>/ month</span>
      </p>
      <p className="pub-plan-sub">
        {cycle === "annual"
          ? `£${NUMBER.format(plan.yearlyPrice)} billed yearly — save £${NUMBER.format(saving)}`
          : "Billed monthly, excluding VAT"}
      </p>
    </>
  );
}

export function PlanGrid() {
  const [cycle, setCycle] = React.useState<Cycle>("monthly");

  function choose(next: Cycle) {
    setCycle(next);
    trackEngagement("pricing_toggle_change", next);
  }

  return (
    <>
      <div className="pub-cycle-row">
        <div className="pub-cycle" role="group" aria-label="Billing period">
          {(["monthly", "annual"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={cycle === option}
              onClick={() => choose(option)}
            >
              {option === "monthly" ? "Monthly" : "Annual"}
              {option === "annual" && (
                <span className="pub-cycle-save">
                  Save {ANNUAL_DISCOUNT_PERCENT}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/*
        The price changes when the toggle does, and a sighted user sees it
        immediately. `aria-live` announces the same change to a screen-reader
        user instead of leaving them to hunt for what moved.
      */}
      <div className="pub-plans" aria-live="polite">
        {planOrder().map((plan) => (
          <PlanCard key={plan.id} plan={plan} cycle={cycle} />
        ))}
      </div>

      <p className="pub-small mt-8 text-center">
        All plans include a {TRIAL_DAYS}-day free trial. No card required to
        start. Prices exclude VAT.
      </p>
    </>
  );
}

function PlanCard({ plan, cycle }: { plan: PlanDefinition; cycle: Cycle }) {
  const recommended = plan.recommended;
  const href = plan.selfServe ? `/signup?plan=${plan.id}` : "/contact-sales";
  const placement = PLACEMENTS[plan.id] ?? "pricing_growth";
  const [resolved, setResolved] = React.useState(href);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- campaign params come from the browser URL, unavailable during SSR.
    setResolved(plan.selfServe ? withCampaignParams(href, placement) : href);
  }, [href, placement, plan.selfServe]);

  return (
    <div
      className={cn("pub-card pub-plan", recommended && "pub-card-lit")}
      data-recommended={recommended ? "true" : undefined}
    >
      {recommended && <span className="pub-plan-badge">Recommended</span>}

      <h3 className="pub-plan-name">{plan.name}</h3>
      <p className="pub-plan-for">{plan.tagline}</p>

      <PriceBlock plan={plan} cycle={cycle} />

      <Link
        href={resolved}
        prefetch={false}
        onClick={() => trackCta(placement)}
        className={buttonClass(recommended ? "primary" : "secondary", "md")}
      >
        {plan.selfServe ? "Start free" : "Contact sales"}
        <ArrowRight aria-hidden className="size-4" />
      </Link>

      <ul className="pub-plan-features">
        {cardFeatures(plan).map((feature) => (
          <li key={feature}>
            <Check className="size-3.5" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { PLANS };
