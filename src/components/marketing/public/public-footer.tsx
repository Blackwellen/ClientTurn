import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { COMPANY, hasRegisteredDetails } from "@/lib/marketing/company";
import { PublicContainer, buttonClass } from "./ui";
import {
  FOOTER_COMPANY,
  FOOTER_LEGAL,
  FOOTER_PARTNERS,
  FOOTER_PRODUCT,
  FOOTER_RESOURCES,
  FOOTER_SOLUTIONS,
  type NavLink,
} from "./nav-data";

/**
 * The public footer.
 *
 * Seven columns on desktop, four on tablet, stacked on mobile. Every link
 * resolves — the partner and legal columns in particular are load-bearing:
 * the affiliate routes are the real programme routes, not the customer
 * signup flow, and the legal column carries the disclosure duties the
 * Companies Act and the E-Commerce Regulations put on the operating company.
 *
 * No social links are rendered: ClientTurn holds no public social accounts
 * yet, and a placeholder profile link is a dead end, not a trust signal.
 */

function FooterColumn({ title, links }: { title: string; links: readonly NavLink[] }) {
  return (
    <div>
      <h3 className="pub-footer-heading">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            <Link href={link.href} className="pub-footer-link">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-footer">
      <PublicContainer className="py-16 sm:py-20">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12 xl:grid-cols-[1.7fr_repeat(6,minmax(0,1fr))]">
          <div className="sm:col-span-2 lg:col-span-4 xl:col-span-1">
            <Logo href="/" height={56} imgClassName="h-11 w-auto" />
            <p className="pub-small mt-5 max-w-xs">
              AI-assisted lead acquisition, follow-up, qualification and conversion — in one
              connected system.
            </p>
            <Link href="/signup" className={`${buttonClass("primary", "sm")} mt-6`}>
              Start Free
            </Link>
            <p className="pub-small mt-6">
              <a
                href={`mailto:${COMPANY.supportEmail}`}
                className="pub-footer-link underline underline-offset-4"
              >
                {COMPANY.supportEmail}
              </a>
            </p>
          </div>

          <FooterColumn title="Product" links={FOOTER_PRODUCT} />
          <FooterColumn title="Solutions" links={FOOTER_SOLUTIONS} />
          <FooterColumn title="Resources" links={FOOTER_RESOURCES} />
          <FooterColumn title="Company" links={FOOTER_COMPANY} />
          <FooterColumn title="Partners" links={FOOTER_PARTNERS} />
          <FooterColumn title="Legal & trust" links={FOOTER_LEGAL} />
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-[var(--pub-border)] pt-7 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-[12px] text-[var(--pub-text-muted)]">
              &copy; {new Date().getFullYear()} {COMPANY.product}. All rights reserved.
            </p>
            {hasRegisteredDetails() ? (
              <p className="max-w-2xl text-[12px] leading-relaxed text-[var(--pub-text-muted)]">
                {COMPANY.product} is a trading name of {COMPANY.registeredName}, registered in{" "}
                {COMPANY.jurisdiction} no. {COMPANY.companyNumber}. Registered office:{" "}
                {COMPANY.registeredAddress}.
              </p>
            ) : null}
          </div>

          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <li>
              <Link href="/privacy" className="pub-footer-link">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms" className="pub-footer-link">
                Terms
              </Link>
            </li>
            <li>
              {/* Plain link, not a live indicator: the footer does not query
                  the status service, so it must not assert an uptime state. */}
              <Link href="/status" className="pub-footer-link">
                Status
              </Link>
            </li>
          </ul>
        </div>
      </PublicContainer>
    </footer>
  );
}
