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
  rateRange,
  tierLine,
  ctaHref,
  ctaLabel,
  signedIn,
}: {
  policy: ProgrammePolicy;
  /** "6% to 10%", from the live tier table. */
  rateRange: string;
  /** The tier ladder in one sentence, from the live tier table. */
  tierLine: string;
  ctaHref: string;
  ctaLabel: string;
  signedIn: boolean;
}) {
  return (
    <>
      <AffiliateHero
        policy={policy}
        rateRange={rateRange}
        ctaHref={ctaHref}
        ctaLabel={ctaLabel}
        signedIn={signedIn}
      />

      <PublicContainer>
        <BandStack>
          <CommissionExplainer policy={policy} tierLine={tierLine} />
          <WhoItIsFor />

          <Band aria-labelledby="affiliate-faq-heading">
            <PublicFaq
              id="affiliate-faq"
              eyebrow="Questions"
              title="Everything about how the programme works."
              items={faqs(policy, rateRange, tierLine)}
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
                  title: `${rateRange} one-off`,
                  body: "On each referred customer's first payment.",
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

function CommissionExplainer({ policy, tierLine }: { policy: ProgrammePolicy; tierLine: string }) {
  const steps = [
    {
      title: "What counts as a referral",
      body: `Someone clicks your link and creates a ClientTurn account. ${describeAttribution(policy)}`,
    },
    {
      title: "When you start earning",
      body: `Commission is earned once, when a referred account makes its first payment. ${describeCommission(policy)} Your tier sets the rate: ${tierLine}.`,
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
        The same terms your dashboard and payout statements use.
      </p>

      <StepRail steps={steps} />

      <div className="pub-grid pub-grid-2 mt-12">
        <PublicCard className="pub-cell">
          <div className="pub-cell-row">
            <GlyphTile icon={ShieldCheck} size={38} glyph={17} />
            <div>
              <h3>Refunds and chargebacks</h3>
              <p>
                The commission for that payment is reversed. If already paid, it
                is adjusted against future earnings.
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
  "B2B and industry communities",
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
            Agencies, studios, SaaS founders and accountants. You point them at
            faster lead replies; no selling required.
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

function faqs(policy: ProgrammePolicy, rateRange: string, tierLine: string): FaqItem[] {
  return [
    {
      q: "How much can I earn?",
      a: `A one-off commission of ${rateRange} on each referred customer's first payment, including the full amount of an annual plan. Renewals do not earn commission. No cap on the number of customers. We publish no average earnings, because we have no honest one.`,
    },
    {
      q: "Is the commission recurring?",
      a: "No. You are paid once per referred customer, when they make their first payment. It is calculated on that whole first payment, excluding VAT, so an annual plan pays on the full annual amount.",
    },
    {
      q: "How do tiers work?",
      a: `Your tier sets your one-off rate: ${tierLine}. Tiers are checked daily; a lower tier only applies at the monthly review.`,
    },
    {
      q: "How does tracking work?",
      a: "Your link carries a signed referral that cannot be edited. If the visitor accepts cookies, we keep it in a first-party cookie for your referral window. If they do not, it travels in the page address to sign-up during that visit, with nothing stored on their device. There are no promo codes: your link is how a customer is credited to you.",
    },
    { q: "How long does attribution last?", a: describeAttribution(policy) },
    { q: "When do I get paid?", a: describePayout(policy) },
    {
      q: "What if a customer refunds?",
      a: "If the first payment is refunded or charged back, its commission is reversed. If it was still pending, your balance simply drops. If it had already been paid to you, a matching adjustment is applied to future earnings; if the partnership ends before that is recovered, we write it off rather than invoice you.",
    },
    {
      q: "Can I promote through paid ads?",
      a: "Yes, with one exception: no bidding on ClientTurn brand terms or close variants, and no ads that imply you are ClientTurn. Referrals from brand-term ads are not eligible.",
    },
    {
      q: "Can I use ClientTurn branding?",
      a: "Yes. The Resources Hub in your partner portal has approved logos, screenshots, ad creative and copy.",
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
      a: "Payouts run through Stripe, which collects and holds your identity and bank details. We store only your tax country, entity type and the last four characters of your tax reference, never your bank details. Payout statements are remittance advice, not VAT invoices; if you are VAT registered, you send us a VAT invoice for each payout (we do not self-bill).",
    },
  ];
}
