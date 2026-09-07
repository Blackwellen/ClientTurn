import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Coins,
  Heart,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  describeAttribution,
  describeCommission,
  describePayout,
  describeRate,
  type ProgrammePolicy,
} from "@/lib/affiliates/programme";

/**
 * The public affiliate programme page (V4 §29).
 *
 * Uses the dark marketing surface rather than the app's light chrome, because
 * this is a recruitment page and belongs to the marketing site.
 *
 * Every commercial claim on this page is generated from the live programme
 * policy — the rate, the attribution window, the hold period and the payout
 * threshold all come from the database. Nothing here states a term the ledger
 * would not honour.
 *
 * The hero card shows illustrative figures. They are labelled as an example and
 * are never presented as either the visitor's own numbers or as a typical
 * partner's earnings.
 */
export function AffiliateLanding({
  policy,
  ctaHref,
  ctaLabel,
  signedIn,
}: {
  policy: ProgrammePolicy;
  ctaHref: string;
  ctaLabel: string;
  signedIn: boolean;
}) {
  return (
    <main className="bg-[#050814] text-white">
      <Hero policy={policy} ctaHref={ctaHref} ctaLabel={ctaLabel} />
      <Benefits />
      <CommissionExplainer policy={policy} />
      <WhoItIsFor />
      <Faq policy={policy} />
      <ClosingCta ctaHref={ctaHref} ctaLabel={ctaLabel} signedIn={signedIn} />
    </main>
  );
}

/* ------------------------------------------------------------------- hero -- */

function Hero({
  policy,
  ctaHref,
  ctaLabel,
}: {
  policy: ProgrammePolicy;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-white/5">
      {/* A single soft lime bloom behind the hero. Decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-0 size-[620px] rounded-full opacity-[0.16] blur-[120px]"
        style={{ background: "var(--ct-lime)" }}
      />

      <div className="relative mx-auto grid w-full max-w-[1520px] gap-12 px-[max(5vw,28px)] py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-center lg:py-24">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ct-lime)]">
            Affiliate Programme
          </p>
          <h1 className="mt-4 text-[44px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[58px] lg:text-[64px]">
            Earn by helping
            <br />
            businesses grow.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#9fb0c4]">
            Join the ClientTurn affiliate programme and earn commission for every
            new customer you refer. It&rsquo;s a win for you, and a bigger future
            for the businesses you support.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={ctaHref}
              className={cn(
                "inline-flex h-[52px] items-center gap-2 rounded-[10px] px-6",
                "bg-[var(--ct-lime)] text-[15px] font-semibold text-[var(--ct-midnight)]",
                "transition-colors hover:bg-[#a6e238]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              )}
            >
              {ctaLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/affiliates/login"
              className="inline-flex h-[52px] items-center rounded-[10px] border border-white/15 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/5"
            >
              Log in to Partner Portal
            </Link>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-8 gap-y-3">
            {["Free to join", "Simple tracking", "Real commission"].map((point) => (
              <li key={point} className="flex items-center gap-2 text-[14.5px] text-white">
                <CheckCircle2
                  className="size-[18px] shrink-0 text-[var(--ct-lime)]"
                  aria-hidden
                />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <ExampleCard policy={policy} />
      </div>
    </section>
  );
}

/**
 * The illustrative earnings card.
 *
 * Explicitly labelled as an example. These are not real partner figures, not a
 * typical result and not the visitor's own numbers, and the caption says so —
 * an unlabelled dashboard mock on a recruitment page is an earnings claim.
 */
function ExampleCard({ policy }: { policy: ProgrammePolicy }) {
  const bars = [28, 34, 46, 40, 52, 47, 44, 62, 71, 76, 84, 100];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  return (
    <figure className="m-0 min-w-0">
      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-[var(--ct-lime)] text-[18px] font-bold text-[var(--ct-midnight)]">
              C
            </span>
            <div>
              <p className="text-[16px] font-semibold text-white">ClientTurn</p>
              <p className="text-[12.5px] text-[#8fa0b5]">Affiliate Partner</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9fb0c4]">
            <span
              className="size-1.5 rounded-full bg-[var(--ct-lime)]"
              aria-hidden
            />
            Example
          </span>
        </div>

        <dl className="mt-7 grid grid-cols-3 gap-4">
          <div>
            <dt className="text-[12.5px] text-[#8fa0b5]">Total Earnings</dt>
            <dd className="mt-1 text-[28px] font-bold leading-none tracking-[-0.02em] text-white">
              £2,840
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-[#8fa0b5]">Referred Customers</dt>
            <dd className="mt-1 text-[28px] font-bold leading-none tracking-[-0.02em] text-white">
              14
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-[#8fa0b5]">Conversion Rate</dt>
            <dd className="mt-1 text-[28px] font-bold leading-none tracking-[-0.02em] text-white">
              28%
            </dd>
          </div>
        </dl>

        <div className="mt-8 flex h-[130px] items-end gap-2" aria-hidden>
          {bars.map((height, index) => (
            <span
              key={months[index]}
              className="min-w-0 flex-1 rounded-t-[3px]"
              style={{
                height: `${height}%`,
                background:
                  index === bars.length - 1
                    ? "var(--ct-lime)"
                    : "rgba(183, 243, 74, 0.42)",
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex gap-2" aria-hidden>
          {months.map((month) => (
            <span
              key={month}
              className="min-w-0 flex-1 text-center text-[10.5px] text-[#75869b]"
            >
              {month}
            </span>
          ))}
        </div>
      </div>

      <figcaption className="mt-3 text-[12px] leading-relaxed text-[#75869b]">
        An illustration of the partner dashboard, not real partner earnings.
        What you earn depends entirely on how many customers you refer, at{" "}
        {describeRate(policy)} commission.
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------- benefits -- */

const BENEFITS = [
  {
    icon: Users,
    title: "Attract new customers",
    body: "Introduce businesses to a platform that actually delivers.",
  },
  {
    icon: Coins,
    title: "Earn recurring commission",
    body: "Get paid for every customer you refer, with ongoing earnings.",
  },
  {
    icon: BarChart3,
    title: "Make a real difference",
    body: "Help businesses generate more leads, book more jobs and grow faster.",
  },
  {
    icon: Heart,
    title: "Partner with a trusted brand",
    body: "Built for UK home-service businesses, with tracking you can audit.",
  },
];

function Benefits() {
  return (
    <section className="border-b border-white/5">
      <ul className="mx-auto grid w-full max-w-[1520px] gap-px bg-white/5 px-[max(5vw,28px)] py-14 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-white/5">
        {BENEFITS.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <li key={benefit.title} className="bg-[#050814] px-0 py-4 lg:px-7 lg:py-2">
              <span className="flex size-12 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.03]">
                <Icon className="size-5 text-[var(--ct-lime)]" aria-hidden />
              </span>
              <h3 className="mt-4 text-[17px] font-semibold text-white">
                {benefit.title}
              </h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-[#9fb0c4]">
                {benefit.body}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------- how it works -- */

function CommissionExplainer({ policy }: { policy: ProgrammePolicy }) {
  const steps = [
    {
      title: "What counts as a referral",
      body: `Someone clicks your link and creates a ClientTurn account. ${describeAttribution(policy)}`,
    },
    {
      title: "When you start earning",
      body: `Commission is earned when a referred account becomes a paying customer. ${describeCommission(policy)}`,
    },
    {
      title: "Approval and hold",
      body: `Each commission is held for ${policy.holdDays} days against refunds and chargebacks, then approved automatically.`,
    },
    {
      title: "Getting paid",
      body: describePayout(policy),
    },
    {
      title: "Refunds and chargebacks",
      body: "If a customer refunds or charges back, the commission for that payment is reversed. If it had already been paid to you, an adjustment is applied against future earnings — we never rewrite a payout you have received.",
    },
    {
      title: "What is not eligible",
      body: "Self-referrals, referrals to a business you already own or bill for, and accounts created through paid search on our own brand terms.",
    },
  ];

  return (
    <section className="border-b border-white/5">
      <div className="mx-auto w-full max-w-[1520px] px-[max(5vw,28px)] py-16 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-white sm:text-[42px]">
            How commission works
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#9fb0c4]">
            The whole programme in one place, with no small print that
            contradicts it. These are the same terms your partner dashboard and
            your payout statements use.
          </p>
        </div>

        <ol className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="text-[12.5px] font-semibold tabular-nums text-[var(--ct-lime)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-[17px] font-semibold text-white">
                {step.title}
              </h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-[#9fb0c4]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- who it's for -- */

const AUDIENCES = [
  "Consultants and business advisors",
  "Marketing agencies",
  "Creators and newsletter writers",
  "Trade and industry communities",
  "Software and integration partners",
  "Existing ClientTurn customers",
];

function WhoItIsFor() {
  return (
    <section className="border-b border-white/5">
      <div className="mx-auto grid w-full max-w-[1520px] gap-10 px-[max(5vw,28px)] py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:py-20">
        <div>
          <h2 className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-white sm:text-[42px]">
            Who it&rsquo;s for
          </h2>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-[#9fb0c4]">
            If you already talk to people who run home-service businesses —
            roofers, installers, electricians, cleaners — this will feel natural.
            You are not selling; you are pointing them at something that answers
            their leads faster than they can.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {AUDIENCES.map((audience) => (
            <li
              key={audience}
              className="flex items-center gap-2.5 rounded-[11px] border border-white/10 bg-white/[0.02] px-4 py-3.5 text-[14.5px] text-white"
            >
              <ShieldCheck
                className="size-[18px] shrink-0 text-[var(--ct-lime)]"
                aria-hidden
              />
              {audience}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- faq -- */

function Faq({ policy }: { policy: ProgrammePolicy }) {
  const items = [
    {
      q: "How much can I earn?",
      a: `${describeCommission(policy)} There is no cap, and no minimum you have to hit to stay in the programme. What you earn depends entirely on how many customers you refer.`,
    },
    {
      q: "How does tracking work?",
      a: "Your link sets a signed, server-side cookie when someone clicks it. When they sign up, we resolve that cookie to your account. The cookie cannot be edited by the visitor and a query parameter alone is not trusted after signup.",
    },
    {
      q: "How long does attribution last?",
      a: describeAttribution(policy),
    },
    { q: "When do I get paid?", a: describePayout(policy) },
    {
      q: "What if a customer refunds?",
      a: "The commission for that payment is reversed. If it was still pending, your balance simply drops. If it had already been paid to you, a matching adjustment is applied to future earnings.",
    },
    {
      q: "Can I promote through paid ads?",
      a: "Yes, with one exception: no bidding on ClientTurn brand terms or close variants, and no ads that imply you are ClientTurn. Referrals from brand-term ads are not eligible.",
    },
    {
      q: "Can I use ClientTurn branding?",
      a: "Yes — the Resources Hub in your partner portal has approved logos, screenshots, ad creative and copy, all versioned. Please use those rather than recreating our brand yourself.",
    },
    {
      q: "Can I refer my own business?",
      a: "No. Self-referrals do not earn commission, including the same billing entity or payment method under a different name.",
    },
    {
      q: "Do I need to be a ClientTurn customer?",
      a: "No. Anyone approved into the programme can refer, whether or not they use the product themselves.",
    },
    {
      q: "How are tax details handled?",
      a: "Payouts run through Stripe, which collects and holds your identity and bank details. We store only your tax country, entity type and the last four characters of your tax reference — never the full reference, and never your bank details.",
    },
  ];

  return (
    <section className="border-b border-white/5">
      <div className="mx-auto w-full max-w-[1520px] px-[max(5vw,28px)] py-16 lg:py-20">
        <h2 className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-white sm:text-[42px]">
          Questions
        </h2>

        <dl className="mt-10 grid gap-x-12 gap-y-7 lg:grid-cols-2">
          {items.map((item) => (
            <div key={item.q} className="border-t border-white/8 pt-5">
              <dt className="text-[16.5px] font-semibold text-white">{item.q}</dt>
              <dd className="mt-2 text-[14.5px] leading-relaxed text-[#9fb0c4]">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ closing cta -- */

function ClosingCta({
  ctaHref,
  ctaLabel,
  signedIn,
}: {
  ctaHref: string;
  ctaLabel: string;
  signedIn: boolean;
}) {
  return (
    <section>
      <div className="mx-auto w-full max-w-[1520px] px-[max(5vw,28px)] py-16 lg:py-24">
        <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-8 py-12 text-center sm:px-14">
          <h2 className="text-[32px] font-bold leading-tight tracking-[-0.02em] text-white sm:text-[40px]">
            Ready to start earning?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-[#9fb0c4]">
            Applications are reviewed within two working days. It&rsquo;s free to
            join, and there is nothing to set up until you have something to be
            paid.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={ctaHref}
              className="inline-flex h-[52px] items-center gap-2 rounded-[10px] bg-[var(--ct-lime)] px-6 text-[15px] font-semibold text-[var(--ct-midnight)] transition-colors hover:bg-[#a6e238]"
            >
              {ctaLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            {!signedIn && (
              <Link
                href="/affiliates/login"
                className="inline-flex h-[52px] items-center rounded-[10px] border border-white/15 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/5"
              >
                Log in to Partner Portal
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
