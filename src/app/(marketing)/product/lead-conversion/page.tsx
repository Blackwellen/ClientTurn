import type { Metadata } from "next";
import { LeadConversionHero } from "@/components/marketing/lead-conversion/hero/lead-conversion-hero";
import { LeakSection } from "@/components/marketing/lead-conversion/leak/leak-section";
import { CoreEngineSection } from "@/components/marketing/lead-conversion/core-engine/core-engine-section";
import { JourneySection } from "@/components/marketing/lead-conversion/journey/journey-section";
import { LeadConversionIntegrations } from "@/components/marketing/lead-conversion/lead-conversion-integrations";
import { LeadConversionFinalCta } from "@/components/marketing/lead-conversion/lead-conversion-final-cta";
import "./lead-conversion.css";
import { OG_IMAGES, TWITTER_IMAGES } from "@/lib/marketing/seo";

const title = "Lead conversion software for inbound enquiries";
const description =
  "Respond to inbound leads faster, automate follow-up, qualify enquiries and route the right opportunities to booking or your team with ClientTurn.";
const path = "/product/lead-conversion";
const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

/**
 * Structured data. No aggregateRating and no offers price here — there is no
 * approved review corpus for this product, and inventing one to win a rich
 * snippet would be fabricated social proof the brand rules forbid.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: title, item: `${siteUrl}${path}` },
      ],
    },
    {
      "@type": "SoftwareApplication",
      name: "ClientTurn Lead Conversion",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Lead follow-up and qualification",
      operatingSystem: "Web",
      description,
      url: `${siteUrl}${path}`,
      featureList: [
        "Instant follow-up on new Meta and Google leads",
        "Deterministic qualification against configured rules",
        "Multi-channel sequencing across SMS, WhatsApp and email",
        "Automatic stop conditions and quiet-hours enforcement",
        "Booking handover to Google Calendar or Calendly",
        "Lead reactivation for past enquiries",
      ],
    },
  ],
};

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "lead conversion software",
    "lead follow-up automation",
    "lead qualification software",
    "inbound lead management",
    "service business lead management",
    "appointment booking automation",
    "warm lead follow-up",
    "lead routing software",
    "lead reactivation",
    "conversion analytics",
  ],
  alternates: { canonical: "/product/lead-conversion" },
  openGraph: {
    images: OG_IMAGES,
    title: `${title}`,
    description,
    url: "/product/lead-conversion",
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

export default function LeadConversionPage() {
  return (
    <div className="lcp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <LeadConversionHero />
      <LeakSection />
      <CoreEngineSection />
      <JourneySection />
      <LeadConversionIntegrations />
      <LeadConversionFinalCta />
    </div>
  );
}
