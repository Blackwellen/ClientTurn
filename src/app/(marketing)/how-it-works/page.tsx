import type { Metadata } from "next";
import {
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Eye,
  Gauge,
  ListChecks,
  MessageSquare,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import "../evaluation.css";
import {
  PublicContainer,
  PublicCard,
  SectionEyebrow,
  SectionHeading,
  GlyphTile,
  GridTexture,
  Glow,
} from "@/components/marketing/public/ui";
import {
  Panel,
  PanelStack,
  StepStrip,
  StepRail,
  TrustRow,
  StatePill,
  IllustrativeTag,
} from "@/components/marketing/public/shell";
import { Reveal } from "@/components/marketing/public/reveal";
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
  Screen,
  ScreenTable,
  ScreenBlock,
  ScreenRows,
  Pill,
  RangeChip,
  FunnelBars,
} from "@/components/marketing/public/screen";
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
  {
    title: "Capture",
    body: "An enquiry lands from a connected lead source, a form, an import or manual entry — with its source recorded.",
  },
  {
    title: "Engage",
    body: "Permitted follow-up begins, inside quiet hours and on a channel this contact is eligible for.",
  },
  {
    title: "Qualify",
    body: "Your questions are asked in order and your rules decide. The same answers always reach the same verdict.",
  },
  {
    title: "Route",
    body: "Booking, handover, nurture or review — anything the rules cannot match confidently goes to a person.",
  },
] as const;

const OUTBOUND_STEPS = [
  {
    title: "Profile",
    body: "Your business, services and ideal customer, held once and reused by every search.",
  },
  {
    title: "Search",
    body: "Describe who you want in plain English. ClientTurn turns it into a structured search plan.",
  },
  {
    title: "Source",
    body: "You approve the targeting, then the plan runs against licensed data providers.",
  },
  {
    title: "Verify",
    body: "Contact details and company data are checked for validity, freshness and eligibility.",
  },
  {
    title: "Outreach",
    body: "Email-first sequences run under sender limits, suppression checks and campaign budgets.",
  },
  {
    title: "Lead",
    body: "A prospect who engages is promoted to a lead and joins the same qualification path.",
  },
] as const;

const SOURCES = [
  { label: "Website", value: 402, colour: "#2f7ff0" },
  { label: "ClientTurn Sourcing", value: 349, colour: "#4fb3f7" },
  { label: "Manual entry", value: 187, colour: "#9b7ff0" },
  { label: "Reactivation", value: 149, colour: "#5fd39a" },
  { label: "Integrations", value: 124, colour: "#b7f34a" },
  { label: "Other", value: 37, colour: "#5b6577" },
];

const STOP_STATES = [
  {
    icon: MessageSquare,
    title: "Reply received",
    body: "The sequence stops and the lead moves into qualification.",
    tone: "go" as const,
    state: "Stopped",
  },
  {
    icon: CalendarCheck,
    title: "Booking confirmed",
    body: "The sequence stops. Nothing further is sent about that opportunity.",
    tone: "go" as const,
    state: "Stopped",
  },
  {
    icon: ShieldCheck,
    title: "Opt-out or complaint",
    body: "The contact is suppressed across every campaign, permanently.",
    tone: "stop" as const,
    state: "Suppressed",
  },
  {
    icon: Gauge,
    title: "Sender health or budget",
    body: "Sending pauses until the problem is resolved or the limit is raised.",
    tone: "hold" as const,
    state: "Paused",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- built from a local constant; no user input reaches this string.
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
                    icon: <ShieldCheck className="size-3.5" />,
                    label: "Eligibility re-checked before every send",
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
        <PanelStack>
          {/* ---------------------------------------------------- inbound --- */}
          <Reveal>
            <Panel id="inbound" aria-labelledby="hiw-inbound">
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
                </div>

                <Screen
                  active="Leads"
                  title="Leads"
                  meta={<RangeChip>All sources</RangeChip>}
                  label="The ClientTurn leads list, showing each lead with its source, current status and last activity, above a qualification outcome summary."
                >
                  <ScreenTable
                    head={["Name", "Source", "Status", "Last activity"]}
                    rows={[
                      [
                        "Sarah Mitchell",
                        "Website",
                        <Pill key="s" tone="new">
                          New
                        </Pill>,
                        "2 minutes ago",
                      ],
                      [
                        "James Carter",
                        "Meta Lead Ads",
                        <Pill key="j" tone="progress">
                          In follow-up
                        </Pill>,
                        "18 minutes ago",
                      ],
                      [
                        "Rachel Brooks",
                        "Phone",
                        <Pill key="r" tone="won">
                          Qualified
                        </Pill>,
                        "1 hour ago",
                      ],
                      [
                        "Emma Lewis",
                        "Website",
                        <Pill key="e" tone="neutral">
                          Review
                        </Pill>,
                        "2 hours ago",
                      ],
                    ]}
                  />
                  <ScreenBlock title="Qualification outcome">
                    <p className="text-[11.5px] leading-relaxed text-[#4a5568]">
                      Service in scope · Postcode inside your area · Timing
                      within 30 days — <strong>Qualified</strong>, routed to
                      booking.
                    </p>
                  </ScreenBlock>
                </Screen>
              </div>

              <StepRail steps={INBOUND_STEPS} />
            </Panel>
          </Reveal>

          {/* --------------------------------------------------- outbound --- */}
          <Reveal>
            <Panel id="outbound" aria-labelledby="hiw-outbound">
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
                </div>

                <Screen
                  active="Find Leads"
                  title="Search plan"
                  meta={<RangeChip>Review before running</RangeChip>}
                  label="The Find Leads search plan, showing the industry, location, company size and role a search will target, with estimated matched, contactable and verified counts."
                >
                  <ScreenBlock title="Targeting">
                    <ScreenRows
                      rows={[
                        ["Industry", "Property management"],
                        ["Location", "Within 40 miles of Bournemouth"],
                        ["Company size", "5 to 200 employees"],
                        ["Role", "Property or facilities manager"],
                      ]}
                    />
                  </ScreenBlock>

                  <ScreenBlock
                    title="Estimated results"
                    action={
                      <span className="text-[11px] font-semibold text-[#3f6b10]">
                        Review before sourcing
                      </span>
                    }
                  >
                    <FunnelBars
                      rows={[
                        { label: "Matched", value: 1200, colour: "#2f7ff0" },
                        { label: "Contactable", value: 860, colour: "#4fb3f7" },
                        { label: "Verified", value: 640, colour: "#7bd36f" },
                      ]}
                    />
                  </ScreenBlock>
                </Screen>
              </div>

              <StepRail steps={OUTBOUND_STEPS} />
            </Panel>
          </Reveal>

          {/* -------------------------------------------- decision layer --- */}
          <Reveal>
            <Panel id="decision-layer" aria-labelledby="hiw-decision">
              <div className="pub-head-row">
                <SectionEyebrow>Decision layer</SectionEyebrow>
                <StepStrip
                  steps={["Rules", "Scoring", "Contactability", "Suppression"]}
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

              <div className="pub-split pub-split-wide mt-10">
                <div className="pub-grid pub-grid-2">
                  <PublicCard interactive className="pub-cell">
                    <GlyphTile icon={ListChecks} size={38} glyph={18} />
                    <h3 className="mt-4">Qualification rules</h3>
                    <p>
                      Your configured questions, service scope and routing rules
                      define what a qualified opportunity is.
                    </p>
                    <ul className="pub-ticks">
                      {[
                        "Custom questions, in your order",
                        "Service and service-area rules",
                        "Automatic routing on the outcome",
                        "Deterministic, repeatable verdicts",
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
                    <h3 className="mt-4">Contactability and consent</h3>
                    <p>
                      Every channel is checked against relationship type,
                      opt-out status, policy and provider availability before a
                      send.
                    </p>
                    <ul className="pub-ticks">
                      {[
                        "Address and number validity",
                        "Channel eligibility per contact",
                        "Consent and relationship checks",
                        "Quiet hours and attempt limits",
                      ].map((item) => (
                        <li key={item}>
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </PublicCard>

                  <PublicCard interactive className="pub-cell">
                    <GlyphTile icon={Sparkles} size={38} glyph={18} />
                    <h3 className="mt-4">Explainable scoring</h3>
                    <p>
                      Prospect scores show the evidence behind them, where it
                      came from, how fresh it is and how confident the match is
                      — rather than a number with no argument attached.
                    </p>
                  </PublicCard>

                  <PublicCard interactive className="pub-cell">
                    <GlyphTile icon={Target} size={38} glyph={18} />
                    <h3 className="mt-4">Suppression</h3>
                    <p>One list, re-checked immediately before every send.</p>
                    <ul className="pub-ticks">
                      {[
                        "Opt-out",
                        "Invalid contact",
                        "Complaint",
                        "Already booked",
                        "Active conversation",
                        "Platform suppression",
                      ].map((item) => (
                        <li key={item}>
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </PublicCard>
                </div>

                <PublicCard className="pub-cell">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h3>Example decision flow</h3>
                    <IllustrativeTag>Example</IllustrativeTag>
                  </div>
                  <DecisionFlow />
                </PublicCard>
              </div>
            </Panel>
          </Reveal>

          {/* -------------------------------------------- stop conditions --- */}
          <Reveal>
            <Panel aria-labelledby="hiw-stop">
              <div className="pub-split pub-split-narrow">
                <div>
                  <SectionEyebrow className="mb-5">
                    Stop conditions
                  </SectionEyebrow>
                  <h2 id="hiw-stop" className="pub-h2">
                    ClientTurn knows when to stop.
                  </h2>
                  <p className="pub-lead mt-5">
                    Chasing someone who has already replied, already booked or
                    already asked you to stop is how automation loses a
                    customer. Every stop condition is re-checked immediately
                    before each send, and none of them can be bypassed.
                  </p>
                  <ul className="pub-checks">
                    {[
                      "A reply ends the sequence and opens the conversation.",
                      "A confirmed booking ends the sequence.",
                      "Opt-outs, bounces and complaints suppress the contact permanently.",
                      "Won work stops further outreach on that opportunity.",
                      "A paused campaign, an exhausted budget or a sender-health problem holds everything queued behind it.",
                    ].map((item) => (
                      <li key={item}>
                        <CheckCircle2 className="size-4" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pub-grid pub-grid-2">
                  {STOP_STATES.map((item) => (
                    <PublicCard key={item.title} interactive className="pub-cell">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <GlyphTile icon={item.icon} size={38} glyph={17} />
                        <StatePill tone={item.tone}>{item.state}</StatePill>
                      </div>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </PublicCard>
                  ))}
                </div>
              </div>
            </Panel>
          </Reveal>

          {/* ----------------------------------------------- measurement --- */}
          <Reveal>
            <Panel aria-labelledby="hiw-measure">
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

              <div className="pub-split pub-split-wide mt-10">
                <Screen
                  active="Analytics"
                  title="Prospect to customer journey"
                  meta={<RangeChip />}
                  label="The ClientTurn analytics view, showing counts at each stage from prospects discovered through verified, contacted, replies, qualified and converted, to won."
                >
                  <FunnelBars
                    rows={[
                      { label: "Prospects", value: 1248, colour: "#2f7ff0" },
                      { label: "Verified", value: 892, colour: "#4fb3f7" },
                      { label: "Contacted", value: 604, colour: "#7f9df5" },
                      { label: "Replies", value: 428, colour: "#9b7ff0" },
                      { label: "Qualified", value: 312, colour: "#5fd39a" },
                      { label: "Converted", value: 186, colour: "#7bd36f" },
                      { label: "Won", value: 98, colour: "#b7f34a" },
                    ]}
                  />
                </Screen>

                <div className="pub-grid">
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
                </div>
              </div>
            </Panel>
          </Reveal>

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
        </PanelStack>
      </PublicContainer>
    </>
  );
}
