import type { Metadata } from "next";
import {
  Building2,
  Database,
  Gauge,
  Inbox,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  PLANS,
  TRIAL_DAYS,
  ANNUAL_DISCOUNT_PERCENT,
  SMS_CREDIT_BUNDLES,
  MESSAGE_CREDIT_BUNDLES,
} from "@/lib/billing/plans";
import { SOURCING_ALLOWANCES } from "@/lib/billing/sourcing-allowances";
import { WHATSAPP_TOKENS_PER_MESSAGE, whatsappTokenCoverage } from "@/lib/billing/whatsapp-tokens";
import {
  PublicContainer,
  PublicCard,
  SectionEyebrow,
  GlyphTile,
  GridTexture,
  Glow,
} from "@/components/marketing/public/ui";
import {
  Band,
  BandStack,
  TrustRow,
  StatePill,
} from "@/components/marketing/public/shell";
import {
  Reveal,
  RevealGrid,
  ScrollProgress,
} from "@/components/marketing/public/reveal";
import {
  PrimaryCta,
  SecondaryCta,
  ActionRow,
} from "@/components/marketing/public/actions";
import { FinalCtaBand } from "@/components/marketing/public/final-cta";
import { PublicFaq, FaqJsonLd, type FaqItem } from "@/components/marketing/public/faq";
import { PlanGrid } from "@/components/marketing/public/pricing/plan-grid";
import { automaticTaxEnabled, vatCopy } from "@/lib/billing/tax";
import { PlanComparison } from "@/components/marketing/public/pricing/comparison";
import { Columns } from "@/components/marketing/public/charts";
import { VoicePricingBand } from "@/components/marketing/public/revenue/voice-pricing";
import {
  PRO_WITH_VOICE_MONTHLY_GBP,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  VOICE_PACKS_FROM_GBP,
  VOICE_TRIAL_NOTE,
  PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN,
  gbp,
  packSummary,
} from "@/lib/marketing/voice-offer";
import { OG_IMAGES, TWITTER_IMAGES } from "@/lib/marketing/seo";

const title = "Pricing: AI Sales Agent, Voice and Quotes";
const description = `ClientTurn plans from £${PLANS.starter.monthlyPrice} a month. Pro with the AI Voice Sales Agent is ${gbp(PRO_WITH_VOICE_MONTHLY_GBP)} with ${VOICE_ADDON.includedMinutes} minutes, or prepaid minute packs from ${gbp(VOICE_PACKS_FROM_GBP)}. Quotes and payments on every paid plan. ${TRIAL_DAYS}-day trial.`;
const path = "/pricing";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

/**
 * Real self-serve plan prices from the plan catalogue and the voice offer
 * constants, not invented numbers. No aggregateRating: there is no approved
 * review corpus to cite.
 */
const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ClientTurn",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description,
  url: `${siteUrl}${path}`,
  offers: [
    ...[PLANS.starter, PLANS.growth, PLANS.pro]
      .filter((plan) => plan.monthlyPrice !== null)
      .map((plan) => ({
        "@type": "Offer",
        name: `ClientTurn ${plan.name}`,
        price: plan.monthlyPrice,
        priceCurrency: "GBP",
        url: `${siteUrl}${path}`,
        availability: "https://schema.org/InStock",
        category: "SaaS subscription",
      })),
    {
      "@type": "Offer",
      name: "ClientTurn Pro with Voice",
      description: `Pro with the AI Voice Sales Agent: ${VOICE_ADDON.includedMinutes} minutes a month and a dedicated UK number.`,
      price: PRO_WITH_VOICE_MONTHLY_GBP,
      priceCurrency: "GBP",
      url: `${siteUrl}${path}#voice-pricing`,
      availability: "https://schema.org/InStock",
      category: "SaaS subscription",
    },
    ...VOICE_MINUTE_PACKS.map((pack) => ({
      "@type": "Offer",
      name: `Voice minute pack, ${pack.minutes} minutes`,
      price: pack.priceGbp,
      priceCurrency: "GBP",
      url: `${siteUrl}${path}#voice-pricing`,
      availability: "https://schema.org/InStock",
      category: "Prepaid add-on",
    })),
  ],
};

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "AI sales agent pricing UK",
    "AI voice agent for B2B pricing",
    "quote to cash software UK",
    "lead management software pricing",
    "lead generation software pricing",
    "AI prospecting software pricing",
    "lead follow-up software cost",
    "lead automation pricing UK",
  ],
  alternates: { canonical: path },
  openGraph: {
    images: OG_IMAGES,
    title: `${title}`,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    images: TWITTER_IMAGES,
    card: "summary_large_image",
    title: `${title}`,
    description,
  },
};

const NUMBER = new Intl.NumberFormat("en-GB");

const SMS_FROM = SMS_CREDIT_BUNDLES[0];
const WHATSAPP_FROM = MESSAGE_CREDIT_BUNDLES.filter(
  (bundle) => bundle.channel === "whatsapp",
).sort((a, b) => a.priceGbp - b.priceGbp)[0];
const WHATSAPP_FROM_COVERS = whatsappTokenCoverage(WHATSAPP_FROM.credits);

const FAQS: FaqItem[] = [
  {
    q: "How much does the AI Voice Sales Agent cost?",
    a: `Pro with Voice is ${gbp(PRO_WITH_VOICE_MONTHLY_GBP)} a month with ${VOICE_ADDON.includedMinutes} minutes of AI calls and a dedicated UK number, or Pro alone is ${gbp(PLANS.pro.monthlyPrice as number)}. On ${PLANS.starter.name} and ${PLANS.growth.name}, voice is a prepaid add-on: minute packs (${packSummary()}) plus a number at ${gbp(VOICE_NUMBER_MONTHLY_GBP)} a month, and premium voices add ${gbp(PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN)} a minute. Included minutes don't roll over, packs never expire, and there is no overage. ${VOICE_TRIAL_NOTE}`,
  },
  {
    q: "Who does the voice agent call?",
    a: "Only leads who asked for a call or agreed to one on your form, inside calling hours in their own time zone. Every call opens by saying it is an AI assistant calling from your business. It never makes cold calls.",
  },
  {
    q: "Are quotes, signatures and invoices extra?",
    a: "No. Branded quotes, a simple electronic signature with an audit trail, and invoices with payment links come with every paid plan. Payments go through your own Stripe account, so Stripe's fees apply and ClientTurn takes no share.",
  },
  {
    q: "Is there a free trial, and do I need a card?",
    a: `Yes, ${TRIAL_DAYS} days. A card is required and checked by Stripe, but nothing is charged until the trial ends, and you can cancel before then. Trial allowances are smaller than any paid plan, and sourcing and cold email are off.`,
  },
  {
    q: "Can I cancel at any time?",
    a: "Yes. Cancel from your billing settings and the plan runs to the end of the period you paid for. No cancellation fee and no minimum term.",
  },
  {
    q: "Can I change plan later?",
    a: "Yes, in either direction. Upgrades apply immediately; downgrades take effect at the end of the current billing period, so you keep what you paid for. If your usage is above the lower plan's allowance, you are told which limits will apply before you confirm.",
  },
  {
    q: "Do you offer annual billing?",
    a: `Yes. Annual billing is ${ANNUAL_DISCOUNT_PERCENT}% cheaper than monthly for the same plan, charged once for the year.`,
  },
  {
    q: "What happens if I exceed an allowance?",
    a: "There is no overage, so you are never billed after the fact. You are warned near a limit, and at it the affected activity stops. SMS and WhatsApp can continue on prepaid bundles; everything else waits for the next period or an upgrade.",
  },
  {
    q: "How does sourcing usage work?",
    a: `Each plan includes a monthly allowance of verified prospects: ${NUMBER.format(SOURCING_ALLOWANCES.starter.verifiedProspects)} on Starter, ${NUMBER.format(SOURCING_ALLOWANCES.growth.verifiedProspects)} on Growth and ${NUMBER.format(SOURCING_ALLOWANCES.pro.verifiedProspects)} on Pro. A prospect counts once it is sourced and verified, not when it appears in an estimate. You approve the targeting first, so no allowance goes on a search you did not want.`,
  },
  {
    q: "How do communication allowances work?",
    a: `Each plan includes UK SMS segments for a first text to every lead (${NUMBER.format(PLANS.starter.smsSegmentAllowance)} on ${PLANS.starter.name}, ${NUMBER.format(PLANS.growth.smsSegmentAllowance)} on ${PLANS.growth.name}, ${NUMBER.format(PLANS.pro.smsSegmentAllowance)} on ${PLANS.pro.name}), counted in segments because a long SMS uses more than one; follow-up email from your own mailbox is not counted. Extra SMS comes in prepaid bundles from £${SMS_FROM.priceGbp} for ${NUMBER.format(SMS_FROM.credits)} segments. WhatsApp is a paid add-on from ${PLANS.growth.name} with no included messages or platform fee, paid in prepaid tokens (from £${WHATSAPP_FROM.priceGbp} for ${NUMBER.format(WHATSAPP_FROM.credits)} tokens, about ${NUMBER.format(WHATSAPP_FROM_COVERS.replies)} replies or ${NUMBER.format(WHATSAPP_FROM_COVERS.marketing)} marketing messages), and needs an approved business sender.`,
  },
  {
    q: "Can I get a refund on top-up credit?",
    a: "Top-up credit is prepaid and does not expire. A purchase can be refunded only if none of it has been used. Credit and WhatsApp tokens are used oldest purchase first, have no cash value and cannot be exchanged or transferred.",
  },
  {
    q: "Are taxes included?",
    // True either way: "added at checkout" only once Stripe Tax is switched
    // on (STRIPE_AUTOMATIC_TAX, billing/tax.ts).
    a: vatCopy(automaticTaxEnabled()).faq,
  },
  {
    q: "How does Enterprise pricing work?",
    a: "Enterprise is priced against your requirements: lead volume, sourcing, messaging, users and workspaces. It includes a data processing agreement, a dedicated support contact and onboarding assistance. Talk to sales for a quote.",
  },
  {
    q: "Do you charge per user or per workspace?",
    a: "Per workspace. Each plan includes a number of users, and the price does not change as you add people up to that limit. Beyond it, move up a plan or talk to us about Enterprise.",
  },
];

export default function PricingPage() {
  return (
    <>
      <ScrollProgress />
      <FaqJsonLd items={FAQS} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
              {
                "@type": "ListItem",
                position: 2,
                name: "Pricing",
                item: `${siteUrl}${path}`,
              },
            ],
          }),
        }}
      />

      {/* -------------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="pricing-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split">
            <Reveal>
              <SectionEyebrow className="mb-5">Pricing</SectionEyebrow>
              <h1 id="pricing-hero" className="pub-h1">
                Start with the volume you need.{" "}
                <span className="pub-accent">
                  Scale when the pipeline does.
                </span>
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                Clear monthly allowances, no hidden usage, and nothing runs past
                a limit you have not agreed to.
              </p>

              <TrustRow
                items={[
                  {
                    icon: <Search className="size-3.5" />,
                    label: "Find new prospects",
                  },
                  {
                    icon: <Inbox className="size-3.5" />,
                    label: "Convert more enquiries",
                  },
                  {
                    icon: <Sparkles className="size-3.5" />,
                    label: "AI assistant on every plan",
                  },
                  {
                    icon: <Gauge className="size-3.5" />,
                    label: `${TRIAL_DAYS}-day trial, nothing charged until it ends`,
                  },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <PublicCard className="pub-cell">
                <div className="mb-6 flex items-center justify-between gap-3">
                  <h2>Included verified prospects a month</h2>
                  <StatePill tone="muted">By plan</StatePill>
                </div>
                <Columns
                  height={210}
                  label="Included verified prospects a month by plan"
                  bars={[
                    {
                      label: "Starter",
                      value: SOURCING_ALLOWANCES.starter.verifiedProspects,
                      colour: "#2f7ff0",
                    },
                    {
                      label: "Growth",
                      value: SOURCING_ALLOWANCES.growth.verifiedProspects,
                      colour: "#4fb3f7",
                    },
                    {
                      label: "Pro",
                      value: SOURCING_ALLOWANCES.pro.verifiedProspects,
                      colour: "#7bd36f",
                    },
                    {
                      label: "Enterprise",
                      value: SOURCING_ALLOWANCES.enterprise.verifiedProspects,
                      colour: "#b7f34a",
                    },
                  ]}
                />
                <p className="pub-small mt-5">
                  Enterprise allowances are set against your requirements.
                </p>
              </PublicCard>
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* ------------------------------------------------------ plans --- */}
          <Band id="plans" aria-label="Plans">
              <PlanGrid />
          </Band>

          {/* -------------------------------------------- voice and quotes --- */}
          <Band id="voice-pricing" aria-labelledby="voice-pricing-heading">
            <VoicePricingBand />
          </Band>

          {/* ------------------------------------------------ usage rules --- */}
          <Band aria-labelledby="pricing-usage">
              <SectionEyebrow className="mb-5">Usage explained</SectionEyebrow>
              <h2 id="pricing-usage" className="pub-h2">
                Simple allowances. Clear limits.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Counted in units you recognise: leads, prospects, messages and
                people.
              </p>

              <RevealGrid className="pub-grid pub-grid-4 mt-10">
                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Inbox} size={38} glyph={18} />
                  <h3 className="mt-4">Inbound leads</h3>
                  <p>
                    Forms, lead sources, imports and manual entry. Counted once,
                    when the lead is created.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Included on every plan
                  </p>
                </PublicCard>

                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Database} size={38} glyph={18} />
                  <h3 className="mt-4">Sourcing and prospects</h3>
                  <p>
                    Prospects from Companies House, business listings and company websites. Counted when
                    verified, never at the estimate stage.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Monthly allowance per plan
                  </p>
                </PublicCard>

                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Mail} size={38} glyph={18} />
                  <h3 className="mt-4">Communications</h3>
                  <p>
                    A first SMS to every lead, email from your own mailbox, and
                    a WhatsApp add-on from {PLANS.growth.name}. Every send is
                    checked first.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Monthly allowance per plan
                  </p>
                </PublicCard>

                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Users} size={38} glyph={18} />
                  <h3 className="mt-4">Users and teams</h3>
                  <p>
                    Roles and permissions included. Billed per workspace, not
                    per seat, up to the plan limit.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Varies by plan
                  </p>
                </PublicCard>
              </RevealGrid>
          </Band>

          {/* ------------------------------------------------ comparison --- */}
          <Band aria-labelledby="pricing-compare">
              <SectionEyebrow className="mb-5">Plan comparison</SectionEyebrow>
              <h2 id="pricing-compare" className="pub-h2">
                Find the right plan for your business.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Every figure is the allowance the product enforces. A dash means
                not included.
              </p>

              <PlanComparison />
          </Band>

          {/* -------------------------------- allowances in more detail --- */}
          <Band>
            <div className="pub-columns">
              <Reveal className="pub-column">
                <div aria-labelledby="pricing-comms">
                  <div className="pub-cell-row">
                    <GlyphTile icon={Mail} size={44} glyph={20} />
                    <div>
                      <SectionEyebrow className="mb-3">
                        Communication allowance
                      </SectionEyebrow>
                      <h2
                        id="pricing-comms"
                        className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]"
                      >
                        Reach out with confidence.
                      </h2>
                    </div>
                  </div>
                  <p className="pub-lead mt-5">
                    Enough UK SMS segments for a first text to every lead, with
                    follow-up email from your own mailbox.
                  </p>
                  <ul className="pub-ticks">
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Every send checked for opt-out, eligibility and quiet
                        hours just beforehand.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Extra SMS in fixed prepaid bundles, from £
                        {SMS_FROM.priceGbp} for {NUMBER.format(SMS_FROM.credits)}{" "}
                        segments.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        WhatsApp add-on from {PLANS.growth.name}: prepaid tokens,{" "}
                        {WHATSAPP_TOKENS_PER_MESSAGE.SERVICE} per reply,{" "}
                        {WHATSAPP_TOKENS_PER_MESSAGE.MARKETING} per marketing
                        template, from £{WHATSAPP_FROM.priceGbp} for{" "}
                        {NUMBER.format(WHATSAPP_FROM.credits)}.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        No platform fee. Needs an approved business sender.
                        Tokens have no cash value.
                      </span>
                    </li>
                  </ul>
                </div>
              </Reveal>
  
              <Reveal delay={0.06} className="pub-column">
                <div aria-labelledby="pricing-sourcing">
                  <div className="pub-cell-row">
                    <GlyphTile icon={Database} size={44} glyph={20} />
                    <div>
                      <SectionEyebrow className="mb-3">
                        Sourcing and prospects
                      </SectionEyebrow>
                      <h2
                        id="pricing-sourcing"
                        className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]"
                      >
                        Verified prospects, within your plan.
                      </h2>
                    </div>
                  </div>
                  <p className="pub-lead mt-5">
                    Covers verified prospects, sourcing runs, saved searches and
                    intent monitors.
                  </p>
                  <ul className="pub-ticks">
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        You approve the targeting before a run, so no allowance
                        goes on unwanted searches.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        A prospect counts once, when sourced and verified, not
                        at the estimate stage.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Sourcing and cold email are off in the trial and switch
                        on with a paid plan.
                      </span>
                    </li>
                  </ul>
                </div>
              </Reveal>
  
              <Reveal className="pub-column">
                <div aria-labelledby="pricing-limits">
                  <div className="pub-cell-row">
                    <GlyphTile icon={Wallet} size={44} glyph={20} />
                    <div>
                      <SectionEyebrow className="mb-3">
                        Limits and top-ups
                      </SectionEyebrow>
                      <h2
                        id="pricing-limits"
                        className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]"
                      >
                        Stay in control.
                      </h2>
                    </div>
                  </div>
                  <p className="pub-lead mt-5">
                    There is{" "}
                    <strong className="text-[var(--pub-text)]">
                      no overage
                    </strong>
                    . Reaching a limit stops the activity rather than billing
                    you for more.
                  </p>
                  <ul className="pub-ticks">
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>In-product warnings as you approach a limit.</span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        At the limit, only the affected activity stops.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Prepaid SMS credit and WhatsApp tokens are the only way
                        past. Nothing beyond what you bought.
                      </span>
                    </li>
                  </ul>
                </div>
              </Reveal>
  
              <Reveal delay={0.06} className="pub-column">
                <div aria-labelledby="pricing-enterprise">
                  <div className="pub-cell-row">
                    <GlyphTile icon={Building2} size={44} glyph={20} />
                    <div>
                      <SectionEyebrow className="mb-3">
                        Enterprise
                      </SectionEyebrow>
                      <h2
                        id="pricing-enterprise"
                        className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]"
                      >
                        Built for larger organisations.
                      </h2>
                    </div>
                  </div>
                  <p className="pub-lead mt-5">
                    Custom volumes, users and workspaces, plus the terms
                    procurement will ask about.
                  </p>
                  <ActionRow>
                    <SecondaryCta
                      placement="pricing_page_contact_sales"
                      href="/contact-sales"
                      withArrow
                    >
                      Contact sales
                    </SecondaryCta>
                    <SecondaryCta
                      placement="pricing_page_contact_sales"
                      href="/enterprise"
                    >
                      See enterprise capabilities
                    </SecondaryCta>
                  </ActionRow>
                </div>
              </Reveal>
            </div>
          </Band>

          {/* -------------------------------------------------------- FAQ --- */}
          <Band aria-labelledby="pricing-faq-heading">
              <PublicFaq
                id="pricing-faq"
                eyebrow="Frequently asked questions"
                title="Everything you need to know."
                items={FAQS}
                event="pricing_faq_expand"
                aside={
                  <p className="pub-small">
                    Cannot find your answer?{" "}
                    <a className="pub-link" href="/contact-sales">
                      Contact our team
                    </a>
                  </p>
                }
              />
          </Band>

          {/* ------------------------------------------------- final CTA --- */}
          <Reveal>
            <FinalCtaBand
              eyebrow="Ready to get started?"
              title={
                <>
                  Turn more opportunities into{" "}
                  <span className="pub-accent">real business.</span>
                </>
              }
              body={`${TRIAL_DAYS}-day trial: add a card, pay nothing until it ends, cancel any time before.`}
              actions={
                <>
                  <PrimaryCta placement="pricing_page_final" size="lg">
                    Start free
                  </PrimaryCta>
                  <SecondaryCta
                    placement="pricing_page_contact_sales"
                    href="/contact-sales"
                    size="lg"
                  >
                    Contact sales
                  </SecondaryCta>
                </>
              }
              points={[
                {
                  icon: <Search className="size-4" />,
                  title: "Find new prospects",
                  body: "Sourcing and verification inside your allowance.",
                },
                {
                  icon: <Inbox className="size-4" />,
                  title: "Convert more enquiries",
                  body: "Follow-up, qualification and booking.",
                },
                {
                  icon: <TrendingUp className="size-4" />,
                  title: "Scale when it works",
                  body: "Move up a plan the moment the volume justifies it.",
                },
                {
                  icon: <Wallet className="size-4" />,
                  title: "No surprise bills",
                  body: "No overage, prepaid top-ups only, no minimum term.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
