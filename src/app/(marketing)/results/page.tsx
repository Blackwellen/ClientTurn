import * as React from "react";
import type { Metadata } from "next";
import {
  BadgeCheck,
  BarChart3,
  CalendarCheck,
  Download,
  Filter,
  Info,
  Layers,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
} from "lucide-react";
import { METRICS, type MetricDefinition } from "@/lib/analytics/v4-metrics";
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
  TrustRow,
  StatStrip,
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
import {
  AppFrame,
  AnalyticsFrame,
} from "@/components/marketing/public/home/app-frames";
import { IllustrativeNote } from "@/components/marketing/public/screen";
import {
  Donut,
  DonutLegend,
  TrendLine,
  Columns,
} from "@/components/marketing/public/charts";

const title = "Results";
const description =
  "See what ClientTurn measures: the full journey from prospect to won, source attribution, acquisition and outreach performance, and conversion rates — so you know what turns into business and what does not.";
const path = "/results";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "lead conversion analytics",
    "lead generation analytics",
    "sales funnel analytics",
    "prospecting analytics",
    "lead source attribution",
    "outreach performance software",
    "conversion reporting software",
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
 * Structured data. A breadcrumb only.
 *
 * No `aggregateRating` and no performance claims: this page deliberately
 * publishes no customer outcomes, so there is nothing here that a review or
 * results snippet could honestly describe.
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
          name: "Results",
          item: `${siteUrl}${path}`,
        },
      ],
    },
  ],
};

/**
 * The journey, stage by stage.
 *
 * Each stage names the metric the product actually computes, and the
 * definition shown is read from `METRICS` rather than rewritten here — so a
 * change to how a metric is defined reaches this page automatically, and the
 * page can never describe a measurement the product does not make.
 */
const JOURNEY: { icon: typeof Search; metric: MetricDefinition; note: string }[] = [
  {
    icon: Search,
    metric: METRICS.prospects_discovered,
    note: "Find new opportunities",
  },
  {
    icon: BadgeCheck,
    metric: METRICS.prospects_verified,
    note: "Confirm the data is usable",
  },
  {
    icon: Send,
    metric: METRICS.emails_sent,
    note: "Start the conversation",
  },
  {
    icon: MessageSquare,
    metric: METRICS.reply_rate,
    note: "Measure real engagement",
  },
  {
    icon: UserCheck,
    metric: METRICS.leads,
    note: "Capture the opportunity",
  },
  {
    icon: Target,
    metric: METRICS.qualified,
    note: "Identify the best fit",
  },
  {
    icon: CalendarCheck,
    metric: METRICS.booked,
    note: "Booking, demo or quote",
  },
  {
    icon: Trophy,
    metric: METRICS.won,
    note: "Turn pipeline into revenue",
  },
];

const SOURCES = [
  { label: "Website", value: 402, colour: "#2f7ff0" },
  { label: "ClientTurn Sourcing", value: 349, colour: "#4fb3f7" },
  { label: "Manual entry", value: 187, colour: "#9b7ff0" },
  { label: "Reactivation", value: 149, colour: "#5fd39a" },
  { label: "Integrations", value: 124, colour: "#b7f34a" },
  { label: "Other", value: 37, colour: "#5b6577" },
];

/** Metric keys grouped exactly as the product's four analytics views group them. */
const ACQUISITION_KEYS = [
  "sourcing_runs",
  "prospects_discovered",
  "prospects_verified",
  "verification_rate",
  "a_grade_share",
  "intent_matches",
  "prospects_ready",
] as const;

const OUTREACH_KEYS = [
  "emails_sent",
  "sms_segments",
  "whatsapp_messages",
  "delivery_rate",
  "bounce_rate",
  "reply_rate",
  "positive_reply_rate",
  "opt_out_rate",
] as const;

const CONVERSION_KEYS = [
  "leads",
  "leads_promoted",
  "qualified",
  "booked",
  "won",
  "lead_to_qualified",
  "qualified_to_goal",
  "lead_to_won",
  "time_to_conversion",
] as const;

/**
 * The metrics a view reports, named rather than defined at length.
 *
 * The labels come from `METRICS`, so this cannot list a measurement the
 * product does not compute. Each carries its published definition as a title,
 * which keeps the full wording one hover away without turning the section into
 * a glossary the reference does not have.
 */
function MetricNote({ keys }: { keys: readonly string[] }) {
  return (
    <p className="pub-small mt-4">
      Reported here:{" "}
      {keys.map((key, index) => {
        const definition = METRICS[key];
        return (
          <React.Fragment key={key}>
            {index > 0 && ", "}
            <span
              title={definition.definition}
              className="text-[var(--pub-text-secondary)]"
            >
              {definition.label}
            </span>
          </React.Fragment>
        );
      })}
      .
    </p>
  );
}

export default function ResultsPage() {
  return (
    <>
      <ScrollProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* -------------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="results-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split">
            <Reveal>
              <SectionEyebrow className="mb-5">Results</SectionEyebrow>
              <h1 id="results-hero" className="pub-h1">
                Know what turns into business —{" "}
                <span className="pub-accent">and what does not.</span>
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                ClientTurn gives you visibility across acquisition, outreach and
                conversion, so you can see where opportunities come from, how
                they move, and where they stall.
              </p>

              <ActionRow>
                <PrimaryCta placement="results_hero" size="lg">
                  Start free
                </PrimaryCta>
                <AnchorCta href="#journey" size="lg">
                  See the analytics
                </AnchorCta>
              </ActionRow>

              <TrustRow
                items={[
                  {
                    icon: <BarChart3 className="size-3.5" />,
                    label: "The full journey, first signal to revenue",
                  },
                  {
                    icon: <Layers className="size-3.5" />,
                    label: "Compare channels and campaigns",
                  },
                  {
                    icon: <Target className="size-3.5" />,
                    label: "See what is working and what is not",
                  },
                  {
                    icon: <Sparkles className="size-3.5" />,
                    label: "Decisions from your own data",
                  },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <div>
                  <AppFrame label="ClientTurn analytics screen showing lead, qualified, appointment and converted counts with conversion and lead-source performance charts.">
                    <AnalyticsFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* ---------------------------------------------------- journey --- */}
          <Band id="journey" aria-labelledby="results-journey">
              <div className="pub-head-row">
                <SectionEyebrow>The complete journey</SectionEyebrow>
                <StepStrip steps={["Acquire", "Engage", "Qualify", "Convert"]} />
              </div>
              <h2 id="results-journey" className="pub-h2">
                From opportunity to outcome.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Every stage is counted and attributed, with the same definition
                used everywhere it appears — so two reports can never disagree
                about what a &ldquo;qualified lead&rdquo; is.
              </p>

              <ol className="pub-journey">
                {JOURNEY.map((stage, index) => (
                  <li key={stage.metric.key}>
                    <PublicCard
                      interactive
                      className="pub-journey-card"
                      title={stage.metric.definition}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <GlyphTile icon={stage.icon} size={30} glyph={14} />
                        <span className="pub-journey-step">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <h3>{stage.metric.label}</h3>
                      <p>{stage.note}</p>
                    </PublicCard>
                  </li>
                ))}
              </ol>
          </Band>

          {/* ------------------------------------------------ attribution --- */}
          <Band aria-labelledby="results-sources">
              <div className="pub-split pub-split-narrow">
                <div>
                  <SectionEyebrow className="mb-5">
                    Source attribution
                  </SectionEyebrow>
                  <h2 id="results-sources" className="pub-h2">
                    See which channels create your best opportunities.
                  </h2>
                  <p className="pub-lead mt-5">
                    Compare inbound, ClientTurn sourcing, manual entry,
                    reactivation and your connected integrations — not by
                    volume, but by what each one actually produced.
                  </p>

                  <PublicCard className="pub-cell mt-8">
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <h3>Prospects by source</h3>
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
                </div>

                <PublicCard className="pub-cell">
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <h3>Volume by source</h3>
                    <StatePill tone="muted">Last 30 days</StatePill>
                  </div>
                  <Columns
                    height={200}
                    label="Illustrative prospect volume by source over the last 30 days"
                    bars={SOURCES.map((source) => ({
                      label: source.label,
                      value: source.value,
                      colour: source.colour,
                    }))}
                  />
                </PublicCard>
              </div>
          </Band>

          {/* ------------------------- acquisition + outreach performance --- */}
          <Band>
            <div className="pub-columns">
              <Reveal className="pub-column">
                <div aria-labelledby="results-acquisition">
                  <SectionEyebrow className="mb-5">
                    Acquisition performance
                  </SectionEyebrow>
                  <h2 id="results-acquisition" className="pub-h2 !text-[clamp(1.7rem,2.4vw,2.4rem)]">
                    Measure the efficiency of your prospecting.
                  </h2>
                  <p className="pub-lead mt-5">
                    Sourcing runs, verification quality, grading and intent — so
                    you can judge the pipeline you are building, not just its size.
                  </p>
  
                  <StatStrip
                    className="mt-8"
                    items={[
                      { value: "24", label: "Sourcing runs" },
                      { value: "892", label: "Verified prospects" },
                      { value: "71%", label: "Verification rate" },
                      { value: "428", label: "Intent matches" },
                    ]}
                  />
                  <p className="mt-3 flex justify-end">
                    <IllustrativeTag />
                  </p>
  
                  <PublicCard className="pub-cell mt-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3>Sourcing performance</h3>
                      <StatePill tone="muted">Last 30 days</StatePill>
                    </div>
                    <Columns
                      height={168}
                      label="Illustrative verified prospects produced per sourcing run across the period"
                      bars={[
                        { label: "1 Aug", value: 210, colour: "#2f7ff0" },
                        { label: "5 Aug", value: 265, colour: "#2f7ff0" },
                        { label: "10 Aug", value: 240, colour: "#2f7ff0" },
                        { label: "15 Aug", value: 360, colour: "#2f7ff0" },
                        { label: "20 Aug", value: 300, colour: "#2f7ff0" },
                        { label: "25 Aug", value: 330, colour: "#2f7ff0" },
                        { label: "30 Aug", value: 245, colour: "#2f7ff0" },
                      ]}
                    />
                  </PublicCard>

                  <MetricNote keys={ACQUISITION_KEYS} />
                </div>
              </Reveal>
  
              <Reveal delay={0.06} className="pub-column">
                <div aria-labelledby="results-outreach">
                  <SectionEyebrow className="mb-5">
                    Outreach performance
                  </SectionEyebrow>
                  <h2 id="results-outreach" className="pub-h2 !text-[clamp(1.7rem,2.4vw,2.4rem)]">
                    Understand engagement across your campaigns.
                  </h2>
                  <p className="pub-lead mt-5">
                    Delivery, bounces, replies and opt-outs across every supported
                    channel — email, SMS and WhatsApp, where your plan and the
                    contact&rsquo;s eligibility allow it.
                  </p>
  
                  <StatStrip
                    className="mt-8"
                    items={[
                      { value: "12,486", label: "Emails sent" },
                      { value: "98%", label: "Delivery rate" },
                      { value: "6.8%", label: "Reply rate" },
                      { value: "2.1%", label: "Positive replies" },
                    ]}
                  />
                  <p className="mt-3 flex justify-end">
                    <IllustrativeTag />
                  </p>
  
                  <PublicCard className="pub-cell mt-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3>Replies by channel</h3>
                      <StatePill tone="muted">Last 30 days</StatePill>
                    </div>
                    <Columns
                      height={168}
                      label="Illustrative reply rate by channel across the period"
                      bars={[
                        { label: "Email", value: 84, colour: "#2f7ff0" },
                        { label: "SMS", value: 52, colour: "#4fb3f7" },
                        { label: "WhatsApp", value: 31, colour: "#7bd36f" },
                      ]}
                    />
                  </PublicCard>

                  <MetricNote keys={OUTREACH_KEYS} />
                </div>
              </Reveal>
            </div>
          </Band>

          {/* ------------------------------------------------- conversion --- */}
          <Band aria-labelledby="results-conversion">
              <div className="pub-split">
                <div>
                  <SectionEyebrow className="mb-5">
                    Conversion performance
                  </SectionEyebrow>
                  <h2 id="results-conversion" className="pub-h2">
                    See what leads to real business.
                  </h2>
                  <p className="pub-lead mt-5">
                    Qualification, bookings, wins and the rates between them,
                    with the median time it took to get there.
                  </p>

                  <StatStrip
                    className="mt-8"
                    items={[
                      { value: "312", label: "Qualified" },
                      { value: "186", label: "Booked" },
                      { value: "98", label: "Won" },
                      { value: "12 days", label: "Median time to conversion" },
                    ]}
                  />
                  <p className="mt-3 flex justify-end">
                    <IllustrativeTag />
                  </p>

                  <MetricNote keys={CONVERSION_KEYS} />
                </div>

                <div className="pub-grid">
                  <PublicCard className="pub-cell">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3>Time to conversion</h3>
                      <StatePill tone="info">Median 12 days</StatePill>
                    </div>
                    <p>
                      How long a lead takes to reach its conversion goal, and
                      whether that is shortening.
                    </p>
                    <div className="mt-4">
                      <TrendLine
                        points={[78, 66, 54, 44, 36, 30, 25, 21, 18, 16]}
                        label="Illustrative trend showing median time to conversion falling across the period."
                      />
                    </div>
                  </PublicCard>

                  <PublicCard className="pub-cell">
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
                              Leads
                            </th>
                            <th scope="col" className="pb-2 text-right font-semibold">
                              Qualified
                            </th>
                            <th scope="col" className="pb-2 text-right font-semibold">
                              Won
                            </th>
                          </tr>
                        </thead>
                        <tbody className="text-[var(--pub-text-secondary)]">
                          {[
                            ["Property managers Q4", 124, 32, 9],
                            ["Facilities managers", 98, 18, 6],
                            ["Commercial builders", 76, 12, 4],
                          ].map(([name, leads, qualified, won]) => (
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
                              <td className="py-2.5 text-right tabular-nums">{leads}</td>
                              <td className="py-2.5 text-right tabular-nums">
                                {qualified}
                              </td>
                              <td className="py-2.5 text-right tabular-nums">{won}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </PublicCard>
                </div>
              </div>
          </Band>

          {/* --------------------------------------- detailed analytics --- */}
          <Band aria-labelledby="results-detail">
              <div className="pub-split pub-split-narrow">
                <div>
                  <SectionEyebrow className="mb-5">
                    Detailed analytics
                  </SectionEyebrow>
                  <h2 id="results-detail" className="pub-h2">
                    Explore your data in depth.
                  </h2>
                  <p className="pub-lead mt-5">
                    Four views — overview, acquisition, outreach and conversion
                    — each filterable by period, source and campaign, and each
                    exportable as CSV from the same aggregation the screen
                    itself is drawn from.
                  </p>

                  <RevealGrid className="pub-grid pub-grid-2 mt-8">
                    <PublicCard interactive className="pub-cell">
                      <div className="pub-cell-row">
                        <GlyphTile icon={Layers} size={36} glyph={16} />
                        <div>
                          <h3>Four analytics views</h3>
                          <p>
                            Overview, acquisition, outreach and conversion, each
                            with its own metric set.
                          </p>
                        </div>
                      </div>
                    </PublicCard>

                    <PublicCard interactive className="pub-cell">
                      <div className="pub-cell-row">
                        <GlyphTile icon={Filter} size={36} glyph={16} />
                        <div>
                          <h3>Filters that carry</h3>
                          <p>
                            Period, source and campaign filters live in the URL,
                            so a view can be shared as a link.
                          </p>
                        </div>
                      </div>
                    </PublicCard>

                    <PublicCard interactive className="pub-cell">
                      <div className="pub-cell-row">
                        <GlyphTile icon={Download} size={36} glyph={16} />
                        <div>
                          <h3>CSV export</h3>
                          <p>
                            Exports reuse the identical aggregation, so the file
                            can never disagree with the screen.
                          </p>
                        </div>
                      </div>
                    </PublicCard>

                    <PublicCard interactive className="pub-cell">
                      <div className="pub-cell-row">
                        <GlyphTile icon={ShieldCheck} size={36} glyph={16} />
                        <div>
                          <h3>One definition each</h3>
                          <p>
                            Every metric has a single published definition,
                            shown wherever the metric appears.
                          </p>
                        </div>
                      </div>
                    </PublicCard>
                  </RevealGrid>
                </div>

                <div>
                  <AppFrame label="ClientTurn analytics screen showing lead, qualified, appointment and converted counts with conversion and lead-source performance charts.">
                    <AnalyticsFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>
              </div>
          </Band>

          {/* -------------------------------------------------- evidence --- */}
          <Band aria-labelledby="results-evidence">
              <SectionEyebrow className="mb-5">Customer evidence</SectionEyebrow>
              <h2 id="results-evidence" className="pub-h2">
                What we will not put on this page.
              </h2>

              <div className="pub-evidence mt-8">
                <span className="pub-ring pub-ring-lg" aria-hidden>
                  <Info className="size-4" />
                </span>
                <div>
                  <h3>No customer results are published here yet.</h3>
                  <p>
                    Every figure on this page is illustrative sample data used to
                    show what the product measures. None of it describes a real
                    customer, an average, or an outcome you should expect.
                    Verified customer stories will appear here when the evidence,
                    the methodology and the timeframe can all be published
                    responsibly — and not before.
                  </p>
                </div>
              </div>
          </Band>

          {/* ------------------------------------------------- final CTA --- */}
          <Reveal>
            <FinalCtaBand
              eyebrow="Ready to see your own numbers?"
              title={
                <>
                  Measure the journey.{" "}
                  <span className="pub-accent">Improve the next one.</span>
                </>
              }
              body="Connect a source, run your first sequence and watch the whole funnel populate with your own data rather than ours."
              actions={
                <>
                  <PrimaryCta placement="results_final" size="lg">
                    Start free
                  </PrimaryCta>
                  <SecondaryCta
                    placement="results_contact_sales"
                    href="/contact-sales"
                    size="lg"
                  >
                    Contact sales
                  </SecondaryCta>
                </>
              }
              points={[
                {
                  icon: <BarChart3 className="size-4" />,
                  title: "Full pipeline visibility",
                  body: "Every stage counted, from first signal to won.",
                },
                {
                  icon: <Target className="size-4" />,
                  title: "Know what works",
                  body: "Attribution by source, campaign and sequence.",
                },
                {
                  icon: <TrendingUp className="size-4" />,
                  title: "Improve deliberately",
                  body: "Compare periods and see where it moved.",
                },
                {
                  icon: <Download className="size-4" />,
                  title: "Take it with you",
                  body: "CSV export from the same aggregation.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
