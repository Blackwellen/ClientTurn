import Link from "next/link";
import { COMPANY, hasRegisteredDetails } from "@/lib/marketing/company";
import { Container } from "./section";
import { Logo } from "./logo";

const PRODUCT_LINKS = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Results", href: "/#results" },
  { label: "Industries", href: "/#industries" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
] as const;

const LEGAL_LINKS = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookies", href: "/cookies" },
  { label: "Sub-processors", href: "/sub-processors" },
] as const;

const ACCOUNT_LINKS = [
  { label: "Log in", href: "/login" },
  { label: "Start free", href: "/signup" },
  { label: "Contact sales", href: "/contact-sales" },
] as const;

function LinkColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { label: string; href: string }[];
}) {
  return (
    <div>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="rounded-sm text-[13px] text-content-secondary transition-colors hover:text-content"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-surface-sunken/60">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-[13px] leading-relaxed text-content-muted">
              Follow-up, qualification and booking for UK home-service
              businesses running Meta lead ads.
            </p>
            <p className="mt-4 space-x-3 text-[13px] text-content-secondary">
              <a
                href={`mailto:${COMPANY.supportEmail}`}
                className="rounded-sm underline underline-offset-4 hover:text-content"
              >
                {COMPANY.supportEmail}
              </a>
              <a
                href={`mailto:${COMPANY.legalEmail}`}
                className="rounded-sm underline underline-offset-4 hover:text-content"
              >
                {COMPANY.legalEmail}
              </a>
            </p>
          </div>

          <LinkColumn title="Product" links={PRODUCT_LINKS} />
          <LinkColumn title="Account" links={ACCOUNT_LINKS} />
          <LinkColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-content-muted">
            &copy; {new Date().getFullYear()} {COMPANY.product}. All rights
            reserved.
          </p>
          {hasRegisteredDetails() ? (
            <p className="max-w-xl text-[12px] leading-relaxed text-content-muted sm:text-right">
              {COMPANY.product} is a trading name of {COMPANY.registeredName},
              registered in {COMPANY.jurisdiction} no. {COMPANY.companyNumber}.
              Registered office: {COMPANY.registeredAddress}.
            </p>
          ) : (
            <p className="text-[12px] text-content-muted">
              Registered company details are published here before launch.
            </p>
          )}
        </div>
      </Container>
    </footer>
  );
}
