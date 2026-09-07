import Link from "next/link";
import { ArrowRight, BarChart3, Building2, Check, Layers, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { PLANS, TRIAL_DAYS, planOrder, type PlanDefinition } from "@/lib/billing/plans";
import { PublicCta } from "../cta-link";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, buttonClass } from "../ui";
import { Reveal } from "../reveal";

/**
 * Pricing preview.
 *
 * Every number on this section is read from `@/lib/billing/plans` — the same
 * catalogue checkout and entitlement checks use. Nothing is transcribed from
 * a design comp, because a price that only exists in marketing markup is a
 * price that will eventually be wrong.
 *
 * It is a *preview*: the headline allowances only, in the order the catalogue
 * defines. The full feature comparison belongs on a dedicated pricing page.
 */

const PLAN_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  starter: User,
  growth: BarChart3,
  pro: Layers,
  enterprise: Building2,
};

const CTA_PLACEMENT = {
  starter: "pricing_starter",
  growth: "pricing_growth",
  pro: "pricing_pro",
  enterprise: "pricing_enterprise",
} as const;

/** The headline allowances a preview card shows. Five at most. */
function previewFeatures(plan: PlanDefinition): string[] {
  return plan.features.slice(0, 5);
}

function priceLabel(plan: PlanDefinition) {
  if (plan.monthlyPrice === null) {
    return { amount: "Custom", suffix: null };
  }
  return { amount: `£${plan.monthlyPrice}`, suffix: "/month" };
}

function PlanCard({ plan }: { plan: PlanDefinition }) {
  const Icon = PLAN_ICON[plan.id] ?? User;
  const { amount, suffix } = priceLabel(plan);
  const placement = CTA_PLACEMENT[plan.id as keyof typeof CTA_PLACEMENT];

  return (
    <div
      role="listitem"
      className={cn(
        "pub-card relative flex h-full min-w-0 flex-col p-5",
        // "Most popular" is the catalogue's own `recommended` flag, not a
        // marketing decision made here.
        plan.recommended &&
          "border-[var(--pub-lime-border)] shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_0_60px_-20px_rgb(183_243_74/0.7)]",
      )}
    >
      {plan.recommended ? (
        <span className="absolute -top-3 right-5 rounded-full bg-[var(--pub-lime)] px-3 py-1 text-[11px] font-semibold text-[var(--pub-lime-ink)]">
          Most popular
        </span>
      ) : null}

      <div className="flex items-center gap-3">
        <span
          className="pub-tile"
          data-solid={plan.recommended ? "true" : undefined}
          style={{ width: 38, height: 38, borderRadius: 10 }}
        >
          <Icon className="size-4.5" strokeWidth={2.1} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-[var(--pub-text)]">{plan.name}</h3>
        </div>
      </div>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-[40px] font-semibold leading-none tracking-[-0.04em] text-[var(--pub-text)]">
          {amount}
        </span>
        {suffix ? (
          <span className="text-[14px] text-[var(--pub-text-muted)]">{suffix}</span>
        ) : null}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-[var(--pub-text-secondary)]">
        {plan.tagline}
      </p>

      <ul className="mt-6 space-y-2.5">
        {previewFeatures(plan).map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <Check
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-[var(--pub-lime)]"
              strokeWidth={2.6}
            />
            <span className="text-[13px] leading-relaxed text-[var(--pub-text-secondary)]">
              {feature}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-7">
        {plan.selfServe ? (
          <PublicCta placement={placement} size="lg" fullWidth arrow>
            Start Free
          </PublicCta>
        ) : (
          <Link href="/contact-sales" className={buttonClass("secondary", "lg", "w-full")}>
            Contact Sales
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function PricingPreviewSection() {
  const plans = planOrder();

  return (
    <PublicSection
      id="pricing"
      labelledBy="pricing-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
          <Glow x="left" y="top" />
        </>
      }
    >
      <PublicContainer>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="pub-eyebrow">Pricing</p>
            <h2 id="pricing-heading" className="pub-h2 mt-5 !text-[clamp(1.8rem,2.9vw,2.6rem)]">
              Start with the volume you need.
              <br />
              <span className="pub-accent">Scale when the pipeline does.</span>
            </h2>
            <p className="pub-lead mt-6">
              Every plan starts with a {TRIAL_DAYS}-day free trial. No card required, and no
              long-term contract — self-serve plans run to the end of the period you have paid
              for and can be cancelled from billing settings.
            </p>
          </div>

          <Link href="/contact-sales" className={buttonClass("secondary", "lg", "shrink-0 lg:mt-14")}>
            Talk to sales
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>

        <div role="list" className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan, index) => (
            <Reveal key={plan.id} delay={index * 0.06} className="h-full min-w-0">
              <PlanCard plan={plan} />
            </Reveal>
          ))}
        </div>

        <p className="pub-small mt-8">
          Prices exclude VAT. Annual billing saves 15%. Included allowances —
          {" "}
          {PLANS.starter.leadLimit} to {PLANS.pro.leadLimit.toLocaleString("en-GB")} new leads a
          month depending on plan — are enforced in the product, not just described here.
        </p>
      </PublicContainer>
    </PublicSection>
  );
}
