import type { Metadata } from "next";
import { ClientTurnExperience } from "@/components/marketing/world/ClientTurnExperience";
import { Industries } from "@/components/marketing/industries";
import { IntegrationStrip } from "@/components/marketing/integration-strip";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { LandingMotion } from "@/components/marketing/landing-motion";

const title = "Turn Facebook leads into booked jobs — automatically";
const description =
  "ClientTurn contacts every new Meta lead within seconds, follows up when they do not reply, asks your qualification questions and sends sales-ready enquiries to your team or booking calendar. Built for UK home-service businesses.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: `${title} · ClientTurn`,
    description,
    url: "/",
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

export default function LandingPage() {
  return (
    <div className="ct-landing">
      <LandingMotion />
      <ClientTurnExperience />
      <IntegrationStrip />
      <Industries />
      <Pricing />
      <Faq />
      <FinalCta />
    </div>
  );
}