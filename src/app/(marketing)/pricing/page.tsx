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
  SMS_OVERAGE_BUNDLES,
} from "@/lib/billing/plans";
import {
  SOURCING_ALLOWANCES,
  AUTOMATIC_OVERAGE_DEFAULT_ON,
} from "@/lib/billing/sourcing-allowances";
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
import { PlanComparison } from "@/components/marketing/public/pricing/comparison";
import { Columns } from "@/components/marketing/public/charts";

const title = "Pricing";
const description = `ClientTurn plans from £${PLANS.starter.monthlyPrice} a month. Clear monthly allowances for inbound leads, verified prospects, communications and users, with a ${TRIAL_DAYS}-day free trial and no card required to start.`;
const path = "/pricing";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "lead management software pricing",
    "lead generation software pricing",
    "AI prospecting software pricing",
    "lead follow-up software cost",
    "lead automation pricing UK",
  ],
  alternates: { canonical: path },
  openGraph: {
    title: `${title} · ClientTurn`,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} · ClientTurn`,
    description,
  },
};

const NUMBER = new Intl.NumberFormat("en-GB");

const FAQS: FaqItem[] = [
  {
    q: "Is there a free trial?",
    a: `Yes — ${TRIAL_DAYS} days, and no card is required to start. You can connect a lead source, configure your follow-up and qualification and watch the whole flow run before you pay anything. Trial workspaces have smaller allowances than any paid plan, and sourcing and cold email are off during the trial.`,
  },
  {
    q: "Do I need a card to start?",
    a: "No. You create a workspace with an email address, and you are only asked for payment details when you choose a paid plan.",
  },
  {
    q: "Can I cancel at any time?",
    a: "Yes. Self-serve plans are cancelled from your billing settings and run to the end of the period you have already paid for. There is no cancellation fee and no minimum term.",
  },
  {
    q: "Can I change plan later?",
    a: "Yes, in either direction. Upgrades take effect immediately with your allowances raised straight away; downgrades take effect at the end of the current billing period, so you keep what you paid for.",
  },
  {
    q: "Do you offer annual billing?",
    a: `Yes. Annual billing is ${ANNUAL_DISCOUNT_PERCENT}% cheaper than paying monthly for the same plan, charged once for the year.`,
  },
  {
    q: "What happens if I exceed an allowance?",
    a: `Automatic overage is ${AUTOMATIC_OVERAGE_DEFAULT_ON ? "on" : "off"} by default. You are warned as you approach a limit, and when you reach it the affected activity stops rather than continuing to bill you. You can then upgrade, buy additional capacity, or wait for the next period. Nothing runs past a limit unless you have explicitly turned automatic overage on and set a monthly cap.`,
  },
  {
    q: "How does sourcing usage work?",
    a: `Each plan includes a monthly allowance of verified prospects and sourcing runs. A prospect counts once it has been sourced and verified, not when it appears in a search estimate — you review the targeting before a run happens, so you are never charged for a search you did not want. Starter includes ${NUMBER.format(SOURCING_ALLOWANCES.starter.verifiedProspects)} verified prospects a month, Growth ${NUMBER.format(SOURCING_ALLOWANCES.growth.verifiedProspects)} and Pro ${NUMBER.format(SOURCING_ALLOWANCES.pro.verifiedProspects)}.`,
  },
  {
    q: "How do communication allowances work?",
    a: `Each plan includes a monthly email allowance and a number of UK SMS segments. A long SMS is billed as more than one segment, which is why the allowance is counted in segments rather than messages. WhatsApp is available from ${PLANS.growth.name} upward and needs an approved business sender. Additional SMS credits can be bought in bundles from £${SMS_OVERAGE_BUNDLES[0].priceGbp} for ${NUMBER.format(SMS_OVERAGE_BUNDLES[0].credits)} segments.`,
  },
  {
    q: "Are taxes included?",
    a: "No. All prices shown exclude VAT, which is added at checkout where it applies.",
  },
  {
    q: "Can I downgrade?",
    a: "Yes. A downgrade applies from the start of your next billing period. If your current usage is above the lower plan's allowance, you will be told which limits will apply before you confirm.",
  },
  {
    q: "How does Enterprise pricing work?",
    a: "Enterprise is priced against your actual requirements — lead volume, sourcing allowance, messaging volume, users and workspaces — rather than from a public rate card. It also covers the things procurement usually asks for: a data processing agreement, a dedicated support contact and onboarding assistance. Talk to sales and we will put a number against your numbers.",
  },
  {
    q: "Do you charge per user or per workspace?",
    a: "Per workspace. Each plan includes a number of users, and the price does not change as you add people up to that limit. If you need more users than your plan includes, that is a reason to move up a plan or to talk to us about Enterprise.",
  },
];

export default function PricingPage() {
  return (
    <>
      <ScrollProgress />
      <FaqJsonLd items={FAQS} />
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
                Choose a plan around your lead, sourcing, communication and team
                requirements. Clear monthly allowances, no hidden usage, and
                nothing runs past a limit you have not agreed to.
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
                    label: `${TRIAL_DAYS}-day trial, no card required`,
                  },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <PublicCard className="pub-cell">
                <div className="mb-6 flex items-center justify-between gap-3">
                  <h3>Included verified prospects a month</h3>
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
                  Enterprise allowances are a starting point, not a ceiling —
                  they are set against your requirements.
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

          {/* ------------------------------------------------ usage rules --- */}
          <Band aria-labelledby="pricing-usage">
              <SectionEyebrow className="mb-5">Usage explained</SectionEyebrow>
              <h2 id="pricing-usage" className="pub-h2">
                Simple allowances. Clear limits.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Everything you need to find, engage and convert opportunities,
                counted in units you actually recognise — leads, prospects,
                messages and people.
              </p>

              <RevealGrid className="pub-grid pub-grid-4 mt-10">
                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Inbox} size={38} glyph={18} />
                  <h3 className="mt-4">Inbound leads</h3>
                  <p>
                    Enquiries from your website, forms, connected lead sources,
                    imports and manual entry. Counted once, when the lead is
                    created.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Included on every plan
                  </p>
                </PublicCard>

                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Database} size={38} glyph={18} />
                  <h3 className="mt-4">Sourcing and prospects</h3>
                  <p>
                    Verified prospects from licensed data providers, with an
                    explainable fit score. A prospect counts when it is sourced
                    and verified — never at the estimate stage.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Monthly allowance per plan
                  </p>
                </PublicCard>

                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Mail} size={38} glyph={18} />
                  <h3 className="mt-4">Communications</h3>
                  <p>
                    Email, SMS and — from {PLANS.growth.name} — WhatsApp, sent
                    through connected providers. Every send passes permission,
                    contactability and compliance checks first.
                  </p>
                  <p className="mt-3 text-[var(--pub-lime)]">
                    Monthly allowance per plan
                  </p>
                </PublicCard>

                <PublicCard interactive className="pub-cell">
                  <GlyphTile icon={Users} size={38} glyph={18} />
                  <h3 className="mt-4">Users and teams</h3>
                  <p>
                    Add team members, set roles and manage who can change what.
                    Billing is per workspace, not per seat, up to the plan
                    limit.
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
                Every figure below is the allowance the product actually
                enforces. A tick means included; a dash means not included on
                that plan.
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
                    Each plan includes a monthly email allowance and a number of
                    UK SMS segments, with WhatsApp available from{" "}
                    {PLANS.growth.name}. A long SMS costs more than one segment,
                    which is why the allowance is counted that way rather than in
                    messages.
                  </p>
                  <ul className="pub-ticks">
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Every send is checked for opt-out, eligibility and quiet
                        hours immediately beforehand.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Additional SMS credits are sold in fixed bundles — from £
                        {SMS_OVERAGE_BUNDLES[0].priceGbp} for{" "}
                        {NUMBER.format(SMS_OVERAGE_BUNDLES[0].credits)} segments —
                        so a top-up is never open-ended.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        WhatsApp needs an approved business sender and approved
                        templates for first contact. That is part of setup.
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
                    Your sourcing allowance covers verified prospects, the runs
                    that produce them, the searches you keep, and the intent
                    monitors watching for buying signals.
                  </p>
                  <ul className="pub-ticks">
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        You review and approve the targeting before a run
                        executes, so allowance is never spent on a search you did
                        not want.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        A prospect counts once, when it has been sourced and
                        verified — not when it appears in an estimate.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        Sourcing and cold email are off during the free trial and
                        switch on with your first paid plan.
                      </span>
                    </li>
                  </ul>
                </div>
              </Reveal>
  
              <Reveal className="pub-column">
                <div aria-labelledby="pricing-overage">
                  <div className="pub-cell-row">
                    <GlyphTile icon={Wallet} size={44} glyph={20} />
                    <div>
                      <SectionEyebrow className="mb-3">
                        Overage and limits
                      </SectionEyebrow>
                      <h2
                        id="pricing-overage"
                        className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]"
                      >
                        Stay in control.
                      </h2>
                    </div>
                  </div>
                  <p className="pub-lead mt-5">
                    Automatic overage is{" "}
                    <strong className="text-[var(--pub-text)]">
                      {AUTOMATIC_OVERAGE_DEFAULT_ON ? "on" : "off"} by default
                    </strong>
                    . A limit you did not agree to is not a limit — so reaching
                    one stops the activity rather than quietly billing you for
                    more.
                  </p>
                  <ul className="pub-ticks">
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        You are warned as you approach a limit, in the product.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        At the limit, the affected activity stops. Everything else
                        keeps running.
                      </span>
                    </li>
                    <li>
                      <ShieldCheck className="size-3.5" aria-hidden />
                      <span>
                        If you do turn overage on, you set a monthly spend cap
                        with it.
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
                    Custom lead volume, sourcing allowance, messaging volume, user
                    and workspace limits — plus the commercial and security
                    requirements procurement will ask about.
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
              body={`Start on the ${TRIAL_DAYS}-day trial without a card, and move to a paid plan only once you have seen it work on your own leads.`}
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
                  body: "Overage off by default, no minimum term.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
