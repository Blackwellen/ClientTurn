import type { Metadata } from "next";
import { FaqJsonLd } from "@/components/marketing/public/faq";
import { Hero } from "@/components/marketing/public/home/hero";
import { GrowthPathSection } from "@/components/marketing/public/home/growth-path";
import { HowItWorksSection } from "@/components/marketing/public/home/how-it-works";
import { CapabilitiesSection } from "@/components/marketing/public/home/capabilities";
import { ProductProofSection } from "@/components/marketing/public/home/product-proof";
import { IntegrationsSection } from "@/components/marketing/public/home/integrations";
import { IndustriesSection } from "@/components/marketing/public/home/industries";
import { PricingPreviewSection } from "@/components/marketing/public/home/pricing-preview";
import { FaqPreviewSection } from "@/components/marketing/public/home/faq-preview";
import { HOME_FAQS } from "@/components/marketing/public/home/faq-data";
import { FinalCtaSection } from "@/components/marketing/public/home/final-cta";
import {
  QuotesPaymentsSection,
  RevenueJourneySection,
  VoiceAgentSection,
} from "@/components/marketing/public/revenue/sections";
import { PLANS, planOrder } from "@/lib/billing/plans";
import {
  PRO_WITH_VOICE_MONTHLY_GBP,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
} from "@/lib/marketing/voice-offer";

/**
 * The ClientTurn homepage.
 *
 * SEO target is the AI sales agent cluster for UK B2B: AI lead follow-up and
 * qualification, the AI voice sales agent (#voice-agent) and quote to cash
 * (#quotes-and-payments). Not every industry and integration the site
 * mentions; those belong to the pages that are actually about them.
 *
 * The page is a Server Component end to end. Only the header, the showcase
 * tabs, the integration filter, the industry carousel controls and the FAQ
 * disclosures ship JavaScript; every diagram on the page is HTML, CSS and
 * SVG, which is what keeps the largest contentful paint the H1 rather than a
 * WebGL scene.
 */

const title = "ClientTurn | AI Sales Agent for UK B2B: Follow-Up, Voice & Quotes";
const description =
  "The AI sales agent for UK B2B teams: instant lead follow-up, AI calls to leads who asked for one, qualification, branded quotes, e-signature and payment in one conversation.";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com").replace(/\/$/, "");

/**
 * SoftwareApplication with the real self-serve offers (plan catalogue plus
 * the voice offer constants). No aggregateRating: there are no reviews to cite.
 */
const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ClientTurn",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "AI sales agent",
  operatingSystem: "Web",
  url: siteUrl,
  description,
  featureList: [
    "Instant AI lead follow-up by email, SMS and WhatsApp",
    "AI Voice Sales Agent that calls leads who asked for a call, with AI disclosure",
    "Deterministic qualification against your own rules",
    "Branded quotes priced by your catalogue and rules",
    "Simple electronic signature with audit trail",
    "Invoices and payment links through your own Stripe account",
    "Revenue attribution to source and campaign",
  ],
  offers: [
    ...planOrder()
      .filter((plan) => plan.selfServe && plan.monthlyPrice !== null)
      .map((plan) => ({
        "@type": "Offer",
        name: `ClientTurn ${plan.name}`,
        price: plan.monthlyPrice,
        priceCurrency: "GBP",
        url: `${siteUrl}/pricing`,
        availability: "https://schema.org/InStock",
      })),
    {
      "@type": "Offer",
      name: `ClientTurn ${PLANS.pro.name} with Voice`,
      description: `${VOICE_ADDON.includedMinutes} AI call minutes a month and a dedicated UK number.`,
      price: PRO_WITH_VOICE_MONTHLY_GBP,
      priceCurrency: "GBP",
      url: `${siteUrl}/pricing#voice-pricing`,
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "AggregateOffer",
      name: "Voice minute packs",
      lowPrice: Math.min(...VOICE_MINUTE_PACKS.map((pack) => pack.priceGbp)),
      highPrice: Math.max(...VOICE_MINUTE_PACKS.map((pack) => pack.priceGbp)),
      offerCount: VOICE_MINUTE_PACKS.length,
      priceCurrency: "GBP",
      url: `${siteUrl}/pricing#voice-pricing`,
    },
  ],
};

export const metadata: Metadata = {
  // Absolute: the title already leads with the brand, so the root layout's
  // "%s | ClientTurn" template would repeat it.
  title: { absolute: title },
  description,
  keywords: [
    "AI sales agent UK",
    "AI voice agent for B2B",
    "AI lead follow up",
    "quote to cash software UK",
    "lead qualification software",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    url: "/",
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

export default function HomePage() {
  return (
    <>
      <Hero />
      <GrowthPathSection />
      <HowItWorksSection />

      {/* The revenue story: one agent across the journey, then the two
          capabilities that make it end in revenue rather than a booked call. */}
      <RevenueJourneySection />
      <VoiceAgentSection />
      <QuotesPaymentsSection />

      <CapabilitiesSection />
      <ProductProofSection />
      <IntegrationsSection />
      <IndustriesSection />

      {/* Pricing, FAQ and the closing panel read as one conversion region,
          but stay separate components: each has its own heading, its own
          analytics and its own reasons to change. */}
      <PricingPreviewSection />
      <FaqPreviewSection />
      <FinalCtaSection />

      {/* Structured data describes only the questions rendered above. */}
      <FaqJsonLd items={HOME_FAQS.map((faq) => ({ q: faq.q, a: faq.a }))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
    </>
  );
}
