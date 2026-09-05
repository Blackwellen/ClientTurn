import * as React from "react";
import { Info } from "lucide-react";
import { Container } from "./section";
import { LEGAL_LAST_UPDATED } from "@/lib/marketing/company";

export type LegalSection = {
  id: string;
  heading: string;
  body: React.ReactNode;
};

export function LegalPage({
  title,
  intro,
  sections,
  operatorNote,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  operatorNote: string;
}) {
  return (
    <div className="bg-bg">
      <Container className="py-14 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-content-accent">
            Legal
          </p>
          <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight text-content sm:text-[40px]">
            {title}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-content-secondary">
            {intro}
          </p>
          <p className="mt-4 text-[13px] text-content-muted">
            Last updated {LEGAL_LAST_UPDATED}
          </p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[240px_1fr] lg:gap-14">
          <nav
            aria-label="On this page"
            className="lg:sticky lg:top-24 lg:self-start"
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">
              On this page
            </h2>
            <ol className="mt-4 space-y-2 border-l border-line pl-4">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded-sm text-[13px] leading-relaxed text-content-secondary transition-colors hover:text-content"
                  >
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 max-w-2xl">
            <div className="flex gap-3 rounded-xl border border-warning-100 bg-warning-50 p-4">
              <Info className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
              <p className="text-[13px] leading-relaxed text-content-secondary">
                {operatorNote}
              </p>
            </div>

            <div className="mt-10 space-y-12">
              {sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-heading`}
                  className="scroll-mt-24"
                >
                  <h2
                    id={`${section.id}-heading`}
                    className="text-[19px] font-semibold tracking-tight text-content"
                  >
                    {section.heading}
                  </h2>
                  <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-content-secondary [&_a]:text-content-accent [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-content [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                    {section.body}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}
