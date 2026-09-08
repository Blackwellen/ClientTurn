"use client";

import { ArrowRight } from "lucide-react";
import { Container } from "./section";
import { MarketingSection, SectionIntro } from "./sections/shell";
import { CtaLink } from "./cta";
import { useMediaQuery } from "./hero/hooks/useHeroScroll";

const INDUSTRIES = [
  { name: "Agencies", enquiry: "Retainer enquiry from a paid campaign", action: "Book a scoping call" },
  { name: "Web development", enquiry: "Rebuild of an ageing site", action: "Book a discovery call" },
  { name: "SaaS", enquiry: "Demo request from a pricing page", action: "Book a demo" },
  { name: "Ecommerce", enquiry: "Wholesale or trade account request", action: "Book an account call" },
  { name: "Accountants", enquiry: "Year-end and payroll enquiry", action: "Book an intro call" },
  { name: "Law firms", enquiry: "Commercial contract enquiry", action: "Book a consultation" },
  { name: "Property services", enquiry: "Managed portfolio enquiry", action: "Book a site visit" },
  { name: "Consultancies", enquiry: "Project brief from a referral", action: "Book a scoping call" },
] as const;

type Industry = (typeof INDUSTRIES)[number];

function IndustryCard({ industry, hidden = false }: { industry: Industry; hidden?: boolean }) {
  return (
    <li className="ct-industry ct-panel" aria-hidden={hidden || undefined}>
      <h3>{industry.name}</h3>
      <p>Example enquiry: {industry.enquiry}</p>
      <span><ArrowRight className="size-3.5 shrink-0" aria-hidden />{industry.action}</span>
    </li>
  );
}

/** Two rails drifting in opposite directions. Duplicated once for a seamless loop; the copy is hidden from AT. */
function Rail({ items, reverse = false, animate }: { items: readonly Industry[]; reverse?: boolean; animate: boolean }) {
  return (
    <div className="ct-industry-rail" data-reverse={reverse} data-animate={animate}>
      <ul>
        {items.map(industry => <IndustryCard key={industry.name} industry={industry} />)}
        {animate && items.map(industry => <IndustryCard key={`${industry.name}-loop`} industry={industry} hidden />)}
      </ul>
    </div>
  );
}

export function Industries() {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const narrow = useMediaQuery("(max-width: 899px)");
  const animate = !reduced && !narrow;
  const half = Math.ceil(INDUSTRIES.length / 2);
  return (
    <MarketingSection id="industries" depth={1} glow="left" labelledBy="industries-heading">
      <SectionIntro
        id="industries-heading"
        eyebrow="Industries"
        title={<>Same system.<br />Different final action.</>}
        lead="The follow-up, the questions and the stop conditions work identically across trades — you change the wording and where a qualified lead ends up."
        aside={<p className="ct-intro-note">Eleven trades run on the same engine. Only the questions and the final action change.</p>}
      />
      <div className="ct-industry-rails">
        <Rail items={INDUSTRIES.slice(0, half)} animate={animate} />
        <Rail items={INDUSTRIES.slice(half)} reverse animate={animate} />
      </div>
      <Container>
        <div className="ct-industry-cta"><CtaLink placement="industries" size="lg">Start Free</CtaLink></div>
      </Container>
    </MarketingSection>
  );
}
