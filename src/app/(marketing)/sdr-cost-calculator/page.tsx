import type { Metadata } from "next";
import {
  PublicContainer,
  SectionEyebrow,
  GridTexture,
  Glow,
} from "@/components/marketing/public/ui";
import { Band } from "@/components/marketing/public/shell";
import { PublicFaq, FaqJsonLd, type FaqItem } from "@/components/marketing/public/faq";
import { SdrCalculator } from "@/components/marketing/public/sdr-calculator/calculator";
import { PLANS } from "@/lib/billing/plans";
import { PRO_WITH_VOICE_MONTHLY_GBP, gbp } from "@/lib/marketing/voice-offer";
import {
  AUTO_ENROLMENT,
  EMPLOYER_NI,
  FIGURES_CHECKED_ON,
  HOLIDAY_SOURCE,
  SICKNESS_SOURCE,
  TAX_YEAR,
} from "@/lib/marketing/sdr-calculator";
import "./sdr-calculator.css";

const title = "SDR Cost Calculator UK: AI SDR vs Hiring an SDR";
const description = `Compare the fully loaded cost of a UK SDR (salary, employer NI, pension, recruitment, tools, ramp-up) with an AI SDR on ClientTurn from ${gbp(PLANS.starter.monthlyPrice as number)} a month. ${TAX_YEAR} tax figures, your own conversion rates.`;
const path = "/sdr-cost-calculator";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "SDR cost calculator UK",
    "AI SDR vs human SDR cost",
    "cost of hiring an SDR UK",
    "AI SDR cost",
    "sales development rep cost",
  ],
  alternates: { canonical: path },
  openGraph: {
    title,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

const FAQS: FaqItem[] = [
  {
    q: "How much does an SDR cost in the UK?",
    a: `More than the salary. On top of pay, employers add National Insurance (${EMPLOYER_NI.rate * 100}% above ${gbp(EMPLOYER_NI.secondaryThresholdAnnual)} in ${TAX_YEAR}), an auto-enrolment pension, recruitment, tools, management time and a ramp-up period. Enter your own figures above.`,
  },
  {
    q: "Can an AI SDR replace a human SDR?",
    a: "Not for everything. ClientTurn handles the volume work: replying fast, following up, qualifying and booking. Relationship building and complex negotiation still need a person.",
  },
  {
    q: "Does ClientTurn make cold calls?",
    a: "No. The AI Voice Sales Agent only calls leads who asked for a call or agreed to one on your form, and says it is an AI assistant at the start of every call.",
  },
  {
    q: "What does ClientTurn cost?",
    a: `Plans start at ${gbp(PLANS.starter.monthlyPrice as number)} a month. Pro with the AI Voice Sales Agent is ${gbp(PRO_WITH_VOICE_MONTHLY_GBP)}. Every plan has monthly allowances and no overage; Enterprise is priced per contract.`,
  },
];

const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "SDR cost calculator",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires JavaScript",
  url: `${siteUrl}${path}`,
  description,
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: 0, priceCurrency: "GBP" },
  publisher: { "@type": "Organization", name: "ClientTurn", url: siteUrl },
};

export default function SdrCostCalculatorPage() {
  return (
    <>
      <FaqJsonLd items={FAQS} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
              { "@type": "ListItem", position: 2, name: "SDR cost calculator", item: `${siteUrl}${path}` },
            ],
          }),
        }}
      />

      <section className="pub-page-hero sdrc-hero" aria-labelledby="sdrc-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <SectionEyebrow className="mb-4">SDR cost calculator</SectionEyebrow>
          <h1 id="sdrc-hero" className="pub-h1 sdrc-h1">
            AI SDR vs hiring an SDR. <span className="pub-accent">What it really costs.</span>
          </h1>
          <p className="pub-lead mt-4 max-w-2xl">
            A fully loaded UK hire against a ClientTurn plan, on your salary, activity and conversion rates.
          </p>
        </PublicContainer>
      </section>

      <PublicContainer>
        <SdrCalculator />

        <p className="sdrc-footnote">
          These are estimates from your inputs, not a quote and not financial advice. Tax figures are for{" "}
          {TAX_YEAR}, checked <span className="sdrc-nowrap">{FIGURES_CHECKED_ON}</span> (
          <a href={EMPLOYER_NI.source} target="_blank" rel="noopener noreferrer">NI</a>,{" "}
          <a href={AUTO_ENROLMENT.source} target="_blank" rel="noopener noreferrer">pension</a>,{" "}
          <a href={HOLIDAY_SOURCE} target="_blank" rel="noopener noreferrer">holiday</a> on gov.uk;{" "}
          <a href={SICKNESS_SOURCE} target="_blank" rel="noopener noreferrer">sickness</a> from ONS). ClientTurn
          prices exclude VAT. An AI agent is not a like-for-like replacement for every SDR task: relationship
          building and complex negotiation still need a person.
        </p>

        <Band aria-labelledby="sdrc-faq-heading" className="sdrc-faq">
          <PublicFaq
            id="sdrc-faq"
            eyebrow="Questions"
            title="Before you decide."
            items={FAQS}
          />
        </Band>
      </PublicContainer>
    </>
  );
}
