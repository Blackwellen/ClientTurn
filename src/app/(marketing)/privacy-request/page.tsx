import * as React from "react";
import type { Metadata } from "next";
import { PublicContainer, SectionEyebrow } from "@/components/marketing/public/ui";
import { PrivacyRequestForm } from "@/components/marketing/public/privacy-request/privacy-request-form";
import { OG_IMAGES } from "@/lib/marketing/seo";

export const metadata: Metadata = {
  title: "Privacy request",
  description:
    "Ask to see, correct, restrict or erase personal data held about you, object to marketing, challenge an automated decision or make a data protection complaint.",
  alternates: { canonical: "/privacy-request" },
  openGraph: { title: "Privacy request", url: "/privacy-request", images: OG_IMAGES },
};

/**
 * Public data-subject request intake (Phase 6).
 *
 * Unauthenticated by design (the person has no account): route-guards lists
 * the whole (marketing) tree as public. The form's server action carries the
 * rate limit, bot checks and the verification email; nothing is acted on until
 * the person confirms from their inbox.
 */
export default function PrivacyRequestPage() {
  return (
    <main className="py-16 sm:py-20">
      <PublicContainer narrow>
        <SectionEyebrow>Your data</SectionEyebrow>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight sm:text-[40px]">
          Make a privacy request
        </h1>
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed opacity-80">
          <p>
            You can ask for a copy of the personal data held about you, have it
            corrected, restrict how it is used, object to marketing or to being
            scored, ask a person to review an automated decision, or have it
            erased.
          </p>
          <p>
            If you ask for erasure, your details are removed. A record that you
            must not be contacted again is kept as a one-way code rather than as
            your address, so you are not contacted again by mistake.
          </p>
          <p>
            We acknowledge every request and complaint within 30 days and
            respond within one month. You can also complain to the Information
            Commissioner&rsquo;s Office at ico.org.uk.
          </p>
        </div>

        <div className="mt-10">
          <PrivacyRequestForm />
        </div>
      </PublicContainer>
    </main>
  );
}
