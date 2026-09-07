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

/**
 * The ClientTurn homepage.
 *
 * SEO target is the conversion cluster — lead conversion software, AI lead
 * management, lead follow-up and qualification — not every industry and
 * integration the site mentions; those belong to the destination pages that
 * are actually about them.
 *
 * The page is a Server Component end to end. Only the header, the showcase
 * tabs, the integration filter, the industry carousel controls and the FAQ
 * disclosures ship JavaScript; every diagram on the page is HTML, CSS and
 * SVG, which is what keeps the largest contentful paint the H1 rather than a
 * WebGL scene.
 */

const title = "ClientTurn | AI Lead Acquisition, Follow-Up & Conversion";
const description =
  "Respond to leads faster, automate follow-up, qualify opportunities, book the next step and build new pipeline with ClientTurn.";

export const metadata: Metadata = {
  title,
  description,
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
    </>
  );
}
