import type { Metadata } from "next";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Eye,
  Gauge,
  ListChecks,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCheck,
} from "lucide-react";
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
  StepStrip,
  StepRail,
  TrustRow,
  StatePill,
  IllustrativeTag,
} from "@/components/marketing/public/shell";
import {
  Reveal,
  RevealGrid,
  ScrollProgress,
} from "@/components/marketing/public/reveal";
import {
  PrimaryCta,
  SecondaryCta,
  AnchorCta,
  ActionRow,
} from "@/components/marketing/public/actions";
import { FinalCtaBand } from "@/components/marketing/public/final-cta";
import { Architecture } from "@/components/marketing/public/how-it-works/architecture";
import { DecisionFlow } from "@/components/marketing/public/how-it-works/decision-flow";
import {
  AppFrame,
  DashboardFrame,
  AcquisitionFrame,
  AnalyticsFrame,
} from "@/components/marketing/public/home/app-frames";
import { IllustrativeNote } from "@/components/marketing/public/screen";
import {
  Donut,
  DonutLegend,
  TrendLine,
} from "@/components/marketing/public/charts";

const title = "How It Works";
const description =
  "One conversion system from first signal to final action: inbound follow-up and qualification, outbound sourcing and permitted outreach, decision rules you configure, enforced stop conditions and end-to-end measurement.";
const path = "/how-it-works";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "how lead conversion software works",
    "lead automation workflow",
    "AI lead management workflow",
    "lead qualification automation",
    "B2B prospecting workflow",
    "lead follow-up automation",
    "outbound outreach workflow",
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

/**
 * Structured data.
 *
 * A breadcrumb and a HowTo describing the inbound path, which is exactly what
 * the page shows. No `aggregateRating`, no `offers` — there is no approved
 * review corpus, and a rich snippet is not worth inventing one for.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        {
          "@type": "ListItem",
          position: 2,
          name: "How It Works",
          item: `${siteUrl}${path}`,
        },
      ],
    },
    {
      "@type": "HowTo",
      name: "How ClientTurn converts an enquiry into a booked opportunity",
      description:
        "The inbound path: capture the enquiry with its source, begin permitted follow-up, qualify against configured rules, and route to booking, handover, nurture or human review.",
      step: [
        {
          "@type": "HowToStep",
          position: 1,
          name: "Capture",
          text: "An enquiry lands from a connected lead source, a form, an import or manual entry, with its source recorded.",
        },
        {
          "@type": "HowToStep",
          position: 2,
          name: "Engage",
          text: "Permitted follow-up begins, inside quiet hours and on a channel the contact is eligible for.",
        },
        {
          "@type": "HowToStep",
          position: 3,
          name: "Qualify",
          text: "Configured questions are asked in order and configured rules decide the outcome.",
        },
        {
          "@type": "HowToStep",
          position: 4,
          name: "Route",
          text: "The enquiry is routed to booking, human handover, nurture or review.",
        },
      ],
    },
  ],
};

const INBOUND_STEPS = [
  { title: "Capture", body: "All enquiries in one inbox, with their source." },
  { title: "Engage", body: "Automated, permitted follow-up." },
  { title: "Qualify", body: "Apply your rules and scoring." },
  { title: "Route", body: "Book, hand over or nurture." },
] as const;

const OUTBOUND_STEPS = [
  { title: "Profile", body: "Tell us about your business." },
  { title: "Search", body: "Turn a plain-English brief into a plan." },
  { title: "Source", body: "Find prospects from licensed providers." },
  { title: "Verify", body: "Check contact details and eligibility." },
  { title: "Outreach", body: "Run controlled campaigns." },
  { title: "Lead", body: "Promote engaged prospects to leads." },
] as const;

const SOURCES = [
  { label: "Website", value: 402, colour: "#2f7ff0" },
  { label: "ClientTurn Sourcing", value: 349, colour: "#4fb3f7" },
  { label: "Manual entry", value: 187, colour: "#9b7ff0" },
  { label: "Reactivation", value: 149, colour: "#5fd39a" },
  { label: "Integrations", value: 124, colour: "#b7f34a" },
  { label: "Other", value: 37, colour: "#5b6577" },
];


export default function HowItWorksPage() {
  return (
    <>
      <ScrollProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* -------------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="hiw-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split">
            <Reveal>
              <SectionEyebrow className="mb-5">How it works</SectionEyebrow>
              <h1 id="hiw-hero" className="pub-h1">
                One conversion system from{" "}
                <span className="pub-accent">first signal</span> to{" "}
                <span className="pub-accent">final action.</span>
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                ClientTurn connects inbound lead conversion and outbound
                acquisition in one operating system — with reviewable targeting,
                policy-aware contact, rules you configure and outcomes you can
                measure end to end.
              </p>

              <ActionRow>
                <PrimaryCta placement="how_it_works_hero" size="lg">
                  Start free
                </PrimaryCta>
                <AnchorCta href="#inbound" size="lg">
                  See the system
                </AnchorCta>
              </ActionRow>

              <TrustRow
                items={[
                  {
                    icon: <Eye className="size-3.5" />,
                    label: "Review targeting before anything is sourced",
                  },
                  {
                    icon: <ListChecks className="size-3.5" />,
                    label: "Qualification rules you configure",
                  },
                  {
                    icon: <BarChart3 className="size-3.5" />,
                    label: "Measured from first signal to won",
                  },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <Architecture />
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* ---------------------------------------------------- inbound --- */}
          <Band id="inbound" aria-labelledby="hiw-inbound">
              <div className="pub-split">
                <div>
                  <div className="pub-head-row">
                    <SectionEyebrow>The inbound path</SectionEyebrow>
                    <StepStrip
                      steps={["Capture", "Follow up", "Qualify", "Book"]}
                    />
                  </div>
                  <h2 id="hiw-inbound" className="pub-h2">
                    Turn enquiries into booked opportunities.
                  </h2>
                  <p className="pub-lead mt-5">
                    Respond quickly, follow up consistently, qualify every
                    enquiry against your own criteria and route it to the right
                    next step — without anyone having to remember to chase.
                  </p>

                  <StepRail steps={INBOUND_STEPS} />
                </div>

                <div>
                  <AppFrame label="ClientTurn lead conversion dashboard showing connection status, lead and booking counts, the conversion funnel and estimated pipeline.">
                    <DashboardFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>
              </div>
          </Band>

          {/* --------------------------------------------------- outbound --- */}
          <Band id="outbound" aria-labelledby="hiw-outbound">
              <div className="pub-split">
                <div>
                  <div className="pub-head-row">
                    <SectionEyebrow>The outbound path</SectionEyebrow>
                    <StepStrip
                      steps={["Profile", "Search", "Source", "Verify", "Outreach"]}
                    />
                  </div>
                  <h2 id="hiw-outbound" className="pub-h2">
                    Find and reach the right customers.
                  </h2>
                  <p className="pub-lead mt-5">
                    Describe the customer you want. ClientTurn builds a
                    structured search plan, shows it to you before it runs,
                    sources from licensed providers, verifies what it finds and
                    coordinates permitted outreach.
                  </p>

                  <StepRail steps={OUTBOUND_STEPS} />
                </div>

                <div>
                  <AppFrame label="ClientTurn Find Leads screen showing a natural-language target, the filters derived from it and a list of verified prospects with scores.">
                    <AcquisitionFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>
              </div>
          </Band>

          {/* -------------------------------------------- decision layer --- */}
          <Band id="decision-layer" aria-labelledby="hiw-decision">
              <div className="pub-head-row">
                <SectionEyebrow>Decision layer</SectionEyebrow>
                <StepStrip
                  steps={["Rules", "Scoring", "Contactability", "Suppression", "Lead"]}
                />
              </div>
              <h2 id="hiw-decision" className="pub-h2">
                Automation with clear boundaries.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Your rules decide what qualifies, who can be contacted and when
                to stop. AI assists inside those boundaries — it never invents
                your criteria, and it never makes a commitment on your behalf.
              </p>

              <div className="pub-split pub-split-narrow mt-10">
                <RevealGrid className="pub-grid pub-grid-3">
                  <PublicCard interactive className="pub-cell">
                    <GlyphTile icon={ListChecks} size={38} glyph={18} />
                    <h3 className="mt-4">Qualification rules</h3>
                    <p>
                      Use your questions, rules and service scope to define what
                      a qualified opportunity is.
                    </p>
                    <ul className="pub-ticks">
                      {[
                        "Custom questions, in your order",
                        "Service and service-area rules",
                        "Automatic routing on the outcome",
                        "Explainable, repeatable outcomes",
                      ].map((item) => (
                        <li key={item}>
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </PublicCard>

                  <PublicCard interactive className="pub-cell">
                    <GlyphTile icon={ShieldCheck} size={38} glyph={18} />
                    <h3 className="mt-4">Contactability &amp; consent</h3>
                    <p>
                      Only contact records that are eligible, based on
                      verification, consent and your policies.
                    </p>
                    <ul className="pub-ticks">
                      {[
                        "Address and number validity",
                        "Channel eligibility per contact",
                        "Consent and relationship checks",
                        "One suppression list, checked before every send",
                      ].map((item) => (
                        <li key={item}>
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </PublicCard>

                  <PublicCard interactive className="pub-cell">
                    <GlyphTile icon={Gauge} size={38} glyph={18} />
                    <h3 className="mt-4">Stop conditions</h3>
                    <p>
                      Automatically stop or pause outreach when a reply, a
                      booking or any other condition is met. None of them can be
                      bypassed.
                    </p>
                    <ul className="pub-ticks">
                      {[
                        "Reply received",
                        "Booking confirmed",
                        "Opt-out or complaint",
                        "Bounce or invalid contact",
                        "Budget or sender-health limits",
                      ].map((item) => (
                        <li key={item}>
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </PublicCard>
                </RevealGrid>

                <PublicCard className="pub-cell">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h3>Example decision flow</h3>
                    <IllustrativeTag>Example</IllustrativeTag>
                  </div>
                  <DecisionFlow />
                </PublicCard>
              </div>
          </Band>

          {/* ----------------------------------------------- measurement --- */}
          <Band aria-labelledby="hiw-measure">
              <div className="pub-head-row">
                <SectionEyebrow>Measure and improve</SectionEyebrow>
                <StepStrip
                  steps={["Sources", "Campaigns", "Outreach", "Conversion"]}
                />
              </div>
              <h2 id="hiw-measure" className="pub-h2">
                See what works and make better decisions.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Every stage is attributed, so you can tell which sources produce
                business rather than which produce volume — and exactly where
                the journey stalls.
              </p>

              <div className="pub-split pub-split-narrow mt-10">
                <div>
                  <AppFrame label="ClientTurn analytics screen showing lead, qualified, appointment and converted counts with conversion and lead-source performance charts.">
                    <AnalyticsFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>

                <div className="pub-grid pub-grid-2">
                  <PublicCard className="pub-cell">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3>Lead sources</h3>
                      <IllustrativeTag />
                    </div>
                    <div className="pub-donut">
                      <Donut
                        slices={SOURCES}
                        total="1,248"
                        totalLabel="Total prospects"
                      />
                      <DonutLegend slices={SOURCES} />
                    </div>
                  </PublicCard>

                  <PublicCard className="pub-cell">
                    <div className="flex items-center justify-between gap-3">
                      <h3>Time to first response</h3>
                      <StatePill tone="info">
                        <Clock className="size-3" aria-hidden /> Median
                      </StatePill>
                    </div>
                    <p>
                      How long a new enquiry waits before it is contacted, and
                      how that has moved across the period.
                    </p>
                    <div className="mt-4">
                      <TrendLine
                        points={[62, 55, 48, 41, 36, 30, 26, 22, 19, 18]}
                        label="Illustrative trend showing median time to first response falling across the period."
                      />
                    </div>
                  </PublicCard>

                  <PublicCard className="pub-cell sm:col-span-2">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3>Campaign performance</h3>
                      <IllustrativeTag />
                    </div>
                    <div className="pub-screen-scroll">
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="text-[var(--pub-text-muted)]">
                            <th scope="col" className="pb-2 text-left font-semibold">
                              Campaign
                            </th>
                            <th scope="col" className="pb-2 text-right font-semibold">
                              Contacted
                            </th>
                            <th scope="col" className="pb-2 text-right font-semibold">
                              Replied
                            </th>
                            <th scope="col" className="pb-2 text-right font-semibold">
                              Booked
                            </th>
                          </tr>
                        </thead>
                        <tbody className="text-[var(--pub-text-secondary)]">
                          {[
                            ["Roofing Q4", 124, 32, "26%"],
                            ["Facilities managers", 98, 18, "18%"],
                            ["Commercial builders", 76, 12, "16%"],
                          ].map(([name, contacted, replied, booked]) => (
                            <tr
                              key={String(name)}
                              className="border-t border-[var(--lr-border-subtle)]"
                            >
                              <th
                                scope="row"
                                className="py-2.5 text-left font-medium text-[var(--pub-text)]"
                              >
                                {name}
                              </th>
                              <td className="py-2.5 text-right tabular-nums">
                                {contacted}
                              </td>
                              <td className="py-2.5 text-right tabular-nums">
                                {replied}
                              </td>
                              <td className="py-2.5 text-right tabular-nums">
                                {booked}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </PublicCard>
                </div>
              </div>
          </Band>

          {/* ------------------------------------------------- final CTA --- */}
          <Reveal>
            <FinalCtaBand
              eyebrow="Ready to see it in action?"
              title={
                <>
                  Turn more opportunities into{" "}
                  <span className="pub-accent">real business.</span>
                </>
              }
              body="Start with your own leads and your own rules. Connect a source, configure your questions and watch the whole path run before you pay anything."
              assurances={["Quick setup", "No card required", "Cancel anytime"]}
              actions={
                <>
                  <PrimaryCta placement="how_it_works_final" size="lg">
                    Start free
                  </PrimaryCta>
                  <SecondaryCta
                    placement="how_it_works_contact_sales"
                    href="/contact-sales"
                    size="lg"
                  >
                    Contact sales
                  </SecondaryCta>
                </>
              }
              points={[
                {
                  icon: <Route className="size-4" />,
                  title: "Inbound and outbound",
                  body: "One system, one pipeline, one set of rules.",
                },
                {
                  icon: <UserCheck className="size-4" />,
                  title: "Your criteria",
                  body: "Qualification you configure, not a black box.",
                },
                {
                  icon: <SlidersHorizontal className="size-4" />,
                  title: "Controls that hold",
                  body: "Stop conditions re-checked before every send.",
                },
                {
                  icon: <TrendingUp className="size-4" />,
                  title: "Measured end to end",
                  body: "From first signal through to won.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
