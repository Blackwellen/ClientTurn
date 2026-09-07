import type { Metadata } from "next";
import { LeadConversionHero } from "@/components/marketing/lead-conversion/hero/lead-conversion-hero";
import { LeakSection } from "@/components/marketing/lead-conversion/leak/leak-section";
import { CoreEngineSection } from "@/components/marketing/lead-conversion/core-engine/core-engine-section";
import { JourneySection } from "@/components/marketing/lead-conversion/journey/journey-section";
import { LeadConversionIntegrations } from "@/components/marketing/lead-conversion/lead-conversion-integrations";
import { LeadConversionFinalCta } from "@/components/marketing/lead-conversion/lead-conversion-final-cta";
import "./lead-conversion.css";

const title = "Lead conversion software for inbound enquiries";
const description =
  "Respond to inbound leads faster, automate follow-up, qualify enquiries and route the right opportunities to booking or your team with ClientTurn.";

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
    title: `${title} · ClientTurn`,
    description,
    url: "/product/lead-conversion",
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

export default function LeadConversionPage() {
  return (
    <div className="lcp">
      <LeadConversionHero />
      <LeakSection />
      <CoreEngineSection />
      <JourneySection />
      <LeadConversionIntegrations />
      <LeadConversionFinalCta />
    </div>
  );
}
