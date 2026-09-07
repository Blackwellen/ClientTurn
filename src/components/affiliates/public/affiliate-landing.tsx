import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  LineChart,
  Link2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  describeAttribution,
  describeCommission,
  describePayout,
  describeRate,
  type ProgrammePolicy,
} from "@/lib/affiliates/programme";
import {
  PublicContainer,
  PublicCard,
  SectionEyebrow,
  GlyphTile,
  buttonClass,
} from "@/components/marketing/public/ui";
import {
  Band,
  BandStack,
  StepRail,
} from "@/components/marketing/public/shell";
import { RevealStagger, RevealItem } from "@/components/marketing/public/reveal";
import { PublicFaq, type FaqItem } from "@/components/marketing/public/faq";
import { FinalCtaBand } from "@/components/marketing/public/final-cta";
import { AffiliateHero } from "./affiliate-hero";

/**
 * The public affiliate programme page (V4 §29).
 *
 * Built from the same `--pub-*` system as the rest of the public site, so the
 * partner funnel looks like the product it is selling. It previously carried
 * its own colours, container widths and header — which is exactly how a page
 * ends up looking like a different company's.
 *
 * Every commercial claim is generated from the live programme policy: the
 * rate, the attribution window, the hold period and the payout threshold all
 * come from the database. Nothing here states a term the ledger would not
 * honour, and there is no earnings claim anywhere on the page.
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
    <>
      <AffiliateHero
        policy={policy}
        ctaHref={ctaHref}
        ctaLabel={ctaLabel}
        signedIn={signedIn}
      />

      <PublicContainer>
        <BandStack>
          <CommissionExplainer policy={policy} />
          <WhoItIsFor />

          <Band aria-labelledby="affiliate-faq-heading">
            <PublicFaq
              id="affiliate-faq"
              eyebrow="Questions"
              title="Everything about how the programme works."
              items={faqs(policy)}
            />
          </Band>

          <Band divided={false}>
            <FinalCtaBand
              eyebrow="Ready to start earning?"
              title={
                <>
                  Earn by helping businesses{" "}
                  <span className="pub-accent">grow.</span>
                </>
              }
              body="It is free to join, and there is nothing to set up until you have something to be paid. Applications are reviewed before your links go live."
              actions={
                <>
                  <Link href={ctaHref} className={buttonClass("primary", "lg")}>
                    {ctaLabel}
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                  {!signedIn && (
                    <Link
                      href="/affiliates/login"
                      className={buttonClass("secondary", "lg")}
                    >
                      Log in to partner portal
                    </Link>
                  )}
                </>
              }
              points={[
                {
                  icon: <Wallet className="size-4" />,
                  title: "Free to join",
                  body: "No fee, no minimum, no exclusivity.",
                },
                {
                  icon: <Link2 className="size-4" />,
                  title: "Tracking you can audit",
                  body: "Every referral and its state, in your portal.",
                },
                {
                  icon: <Coins className="size-4" />,
                  title: describeRate(policy),
                  body: "Commission on referred customers who pay.",
                },
                {
                  icon: <ShieldCheck className="size-4" />,
                  title: "Terms that match the ledger",
                  body: "The same rules your statements use.",
                },
              ]}
            />
          </Band>
        </BandStack>
      </PublicContainer>
    </>
  );
}

/* ------------------------------------------------------------------- hero -- */



/* --------------------------------------------------------------- benefits -- */

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
  ];

  return (
    <Band aria-labelledby="affiliate-commission">
      <SectionEyebrow className="mb-5">How commission works</SectionEyebrow>
      <h2 id="affiliate-commission" className="pub-h2">
        The whole programme, in one place.
      </h2>
      <p className="pub-lead mt-5 max-w-3xl">
        No small print that contradicts the headline. These are the same terms
        your partner dashboard and your payout statements use, generated from
        the same policy the ledger applies.
      </p>

      <StepRail steps={steps} />

      <div className="pub-grid pub-grid-2 mt-12">
        <PublicCard className="pub-cell">
          <div className="pub-cell-row">
            <GlyphTile icon={ShieldCheck} size={38} glyph={17} />
            <div>
              <h3>Refunds and chargebacks</h3>
              <p>
                If a customer refunds or charges back, the commission for that
                payment is reversed. If it had already been paid to you, an
                adjustment is applied against future earnings — we never rewrite
                a payout you have already received.
              </p>
            </div>
          </div>
        </PublicCard>

        <PublicCard className="pub-cell">
          <div className="pub-cell-row">
            <GlyphTile icon={LineChart} size={38} glyph={17} />
            <div>
              <h3>What is not eligible</h3>
              <p>
                Self-referrals, referrals to a business you already own or bill
                for, and accounts created through paid search on our own brand
                terms.
              </p>
            </div>
          </div>
        </PublicCard>
      </div>
    </Band>
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
    <Band aria-labelledby="affiliate-audience">
      <div className="pub-split pub-split-narrow">
        <div>
          <SectionEyebrow className="mb-5">Who it is for</SectionEyebrow>
          <h2 id="affiliate-audience" className="pub-h2">
            If you already talk to people who run these businesses.
          </h2>
          <p className="pub-lead mt-5">
            Roofers, installers, electricians, cleaners. You are not selling —
            you are pointing them at something that answers their leads faster
            than they can.
          </p>
        </div>

        <RevealStagger as="ul" className="grid gap-3 sm:grid-cols-2">
          {AUDIENCES.map((audience) => (
            <RevealItem
              as="li"
              key={audience}
              className="flex items-center gap-3 rounded-[11px] border border-[var(--pub-border)] bg-[var(--pub-bg-raised)] px-4 py-3.5 text-[0.85rem] text-[var(--pub-text-secondary)]"
            >
              <CheckCircle2
                className="size-[18px] shrink-0 text-[var(--pub-lime)]"
                aria-hidden
              />
              {audience}
            </RevealItem>
          ))}
        </RevealStagger>
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------- faq -- */

function faqs(policy: ProgrammePolicy): FaqItem[] {
  return [
    {
      q: "How much can I earn?",
      a: `${describeCommission(policy)} There is no cap, and no minimum you have to hit to stay in the programme. What you earn depends entirely on how many customers you refer — we publish no average, because we have no honest one to publish.`,
    },
    {
      q: "How does tracking work?",
      a: "Your link sets a signed, server-side cookie when someone clicks it. When they sign up, we resolve that cookie to your account. The cookie cannot be edited by the visitor, and a query parameter alone is not trusted after signup.",
    },
    { q: "How long does attribution last?", a: describeAttribution(policy) },
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
}
