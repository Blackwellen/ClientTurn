import * as React from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Container } from "./section";
import {
  COMPANY,
  LEGAL_EFFECTIVE_FROM,
  LEGAL_LAST_UPDATED,
} from "@/lib/marketing/company";

export type LegalSection = {
  id: string;
  heading: string;
  body: React.ReactNode;
};

const RELATED = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Cookie Policy", href: "/cookies" },
  { label: "Sub-processors", href: "/sub-processors" },
] as const;

/**
 * Shared chrome for every published policy: the identity block the Companies
 * Act 2006 and the Electronic Commerce (EC Directive) Regulations 2002 require
 * us to show, the version dates a customer needs in order to tell which
 * version they agreed to, a sticky contents list, and cross-links to the rest
 * of the pack so no policy is a dead end.
 */
export function LegalPage({
  title,
  intro,
  sections,
  operatorNote,
  currentPath,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  /** Optional advisory banner. Omitted on published, in-force policies. */
  operatorNote?: string;
  /** Path of this page, so it is not listed as a related policy. */
  currentPath?: string;
}) {
  const related = RELATED.filter((item) => item.href !== currentPath);

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
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-content-muted">
            <div className="flex gap-2">
              <dt>Version</dt>
              <dd className="font-medium text-content-secondary">
                {LEGAL_LAST_UPDATED}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>In force from</dt>
              <dd className="font-medium text-content-secondary">
                {LEGAL_EFFECTIVE_FROM}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>Governing law</dt>
              <dd className="font-medium text-content-secondary">
                England and Wales
              </dd>
            </div>
          </dl>
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

            {related.length > 0 ? (
              <>
                <h2 className="mt-8 text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">
                  Related
                </h2>
                <ul className="mt-4 space-y-2 border-l border-line pl-4">
                  {related.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded-sm text-[13px] leading-relaxed text-content-secondary transition-colors hover:text-content"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </nav>

          <div className="min-w-0 max-w-2xl">
            <LegalIdentityCard />

            {operatorNote ? (
              <div className="mt-6 flex gap-3 rounded-xl border border-warning-100 bg-warning-50 p-4">
                <Info
                  className="mt-0.5 size-4 shrink-0 text-warning-600"
                  aria-hidden
                />
                <p className="text-[13px] leading-relaxed text-content-secondary">
                  {operatorNote}
                </p>
              </div>
            ) : null}

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
                  <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-content-secondary [&_a]:text-content-accent [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-content [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5">
                    {section.body}
                  </div>
                </section>
              ))}
            </div>

            {related.length > 0 ? (
              <nav
                aria-label="Related policies"
                className="mt-14 border-t border-line-subtle pt-6"
              >
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">
                  The rest of the legal pack
                </h2>
                <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  {related.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-[13px] text-content-accent underline underline-offset-4"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
        </div>
      </Container>
    </div>
  );
}

/**
 * Supplier identity, published on every policy. Companies Act 2006 s.1064 and
 * regulation 6 of the Electronic Commerce (EC Directive) Regulations 2002
 * require the registered name, number, registered office and an electronic
 * contact address to be given in a form that is easily and permanently
 * accessible.
 */
export function LegalIdentityCard() {
  return (
    <div className="rounded-xl border border-line bg-surface-sunken/60 p-5">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">
        Who you are contracting with
      </h2>
      <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-content-secondary">
        <p>
          <strong className="font-semibold text-content">
            {COMPANY.product}
          </strong>{" "}
          is a trading name of{" "}
          <strong className="font-semibold text-content">
            {COMPANY.registeredName}
          </strong>
          , a private company limited by shares registered in{" "}
          {COMPANY.jurisdiction} under company number{" "}
          <a
            href={COMPANY.registerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-content-accent underline underline-offset-4"
          >
            {COMPANY.companyNumber}
          </a>
          .
        </p>
        <p>
          Registered office: {COMPANY.registeredAddress}. This is also our
          address for service of formal notices.
        </p>
        <p>
          Support:{" "}
          <a
            href={`mailto:${COMPANY.supportEmail}`}
            className="text-content-accent underline underline-offset-4"
          >
            {COMPANY.supportEmail}
          </a>{" "}
          · Legal, data protection and formal notices:{" "}
          <a
            href={`mailto:${COMPANY.legalEmail}`}
            className="text-content-accent underline underline-offset-4"
          >
            {COMPANY.legalEmail}
          </a>
          . These are the only two mailboxes we operate.
        </p>
        {COMPANY.vatNumber ? (
          <p>VAT registration number: {COMPANY.vatNumber}.</p>
        ) : (
          <p>
            {COMPANY.registeredName} is not currently registered for VAT. No VAT
            is charged on our invoices, and none may be reclaimed on them. We
            will publish our VAT number here and begin charging VAT from the
            date registration takes effect.
          </p>
        )}
      </div>
    </div>
  );
}
