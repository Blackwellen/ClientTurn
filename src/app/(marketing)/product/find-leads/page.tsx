import type { Metadata } from "next";
import { FindLeadsHero } from "@/components/marketing/find-leads/hero/find-leads-hero";
import { BusinessLearningSection } from "@/components/marketing/find-leads/business-learning/business-learning-section";
import { SearchPlanSection } from "@/components/marketing/find-leads/search-plan/search-plan-section";
import { ChapterB } from "@/components/marketing/find-leads/chapter-b";
import { ChapterC } from "@/components/marketing/find-leads/chapter-c";
import { AcquisitionAnalyticsSection } from "@/components/marketing/find-leads/analytics/acquisition-analytics-section";
import { FindLeadsFinalCta } from "@/components/marketing/find-leads/final-cta/find-leads-final-cta";
import "./find-leads.css";

const title = "AI Lead Generation & Prospecting Software";
const description =
  "Describe your ideal customer, review a structured search plan, source and verify prospects, score fit and coordinate permitted outreach with ClientTurn.";
const path = "/product/find-leads";

/** Absolute URL for structured data, which cannot use a relative path. */
const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "AI lead generation software",
    "AI prospecting software",
    "B2B prospecting software",
    "verified B2B leads",
    "prospect sourcing software",
    "lead sourcing automation",
    "prospect verification",
    "AI sales prospecting",
    "buyer intent software",
    "lead scoring software",
    "outbound campaign software",
    "prospect-to-lead conversion",
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
 * Deliberately no `aggregateRating` and no `offers` price: there is no
 * approved review corpus for this product, and inventing one to win a rich
 * snippet would be exactly the fabricated social proof the brand rules
 * forbid. The FAQ entries below are answered in the page body.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "ClientTurn Find Leads",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Lead generation and B2B prospecting",
      operatingSystem: "Web",
      description,
      url: `${siteUrl}${path}`,
      featureList: [
        "Natural-language search planning",
        "Structured search plan review before provider spend",
        "Prospect sourcing through licensed providers",
        "Email verification and deduplication",
        "Explainable deterministic prospect scoring",
        "Buying-intent monitoring from permitted sources",
        "Email-first acquisition campaigns with limits",
        "Prospect-to-lead promotion with conversation continuity",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Can I review the search before ClientTurn spends anything?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Your description becomes a structured search plan covering industries, locations, roles, company size, intent, exclusions, minimum grade, result target and review mode. You review and edit it before a sourcing run starts, and the plan allowance is checked first.",
          },
        },
        {
          "@type": "Question",
          name: "How is a prospect scored?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "AI extracts features and evidence; deterministic code computes the score. Six weighted factors — ideal customer fit, role and authority, geography, likely need, buying intent and data quality — each carry their own evidence, source, freshness and confidence.",
          },
        },
        {
          "@type": "Question",
          name: "Where does the data come from?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Licensed data providers, verification providers, public sources whose terms permit the use, your connected systems and datasets you supply. There is no general web crawl and no browser automation.",
          },
        },
        {
          "@type": "Question",
          name: "Which channel is used for cold outreach?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Email first. Cold SMS and WhatsApp are not used by default, and social channels are manual or API-gated. Every send is re-checked against suppression, contactability and campaign limits immediately beforehand.",
          },
        },
        {
          "@type": "Question",
          name: "What happens when a prospect replies?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The prospect can be promoted to a lead. The same conversation is carried across rather than restarted, so qualification and follow-up begin with the full outreach and sourcing history attached.",
          },
        },
      ],
    },
  ],
};

/**
 * /product/find-leads — the public acquisition page for Find Leads.
 *
 * A server component composing seven sections, five of which contain a small
 * interactive island. The narrative order is the product's own: describe,
 * learn the business, plan, source, review, score, prioritise, reach out,
 * promote, measure.
 */
export default function FindLeadsProductPage() {
  return (
    <div className="fl">
      <script
        type="application/ld+json"
        // Static, author-controlled object — no user input reaches this string.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <FindLeadsHero />
      <BusinessLearningSection />
      <SearchPlanSection />
      <ChapterB />
      <ChapterC />
      <AcquisitionAnalyticsSection />
      <FindLeadsFinalCta />
    </div>
  );
}
