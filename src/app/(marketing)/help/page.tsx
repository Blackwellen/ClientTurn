import type { Metadata } from "next";
import Link from "next/link";
import { PublicContainer, SectionEyebrow, buttonClass } from "@/components/marketing/public/ui";
import {
  HelpCategoryGrid,
  HelpSearchForm,
  HelpSearchResults,
} from "@/components/help/help-centre";
import { helpIndexByCategory, searchHelp, toSummary } from "@/lib/help/service";
import type { HelpCategorySlug } from "@/lib/help/categories";
import type { HelpArticleSummary } from "@/lib/help/contract";

const title = "Help centre";
const description =
  "Step-by-step guides for ClientTurn: getting started, finding and qualifying leads, booking, reactivation, Copilot, integrations, the API and compliance.";
const path = "/help";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: ["ClientTurn help", "ClientTurn guides", "lead follow-up help", "CRM integration guide"],
  alternates: { canonical: path },
  openGraph: {
    title: `${title}`,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title}`,
    description,
  },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
    { "@type": "ListItem", position: 2, name: title, item: `${siteUrl}${path}` },
  ],
};

export default async function HelpCentrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (raw ?? "").trim().slice(0, 120);

  const [grouped, results] = await Promise.all([
    helpIndexByCategory(),
    query ? searchHelp(query, 20) : Promise.resolve([] as HelpArticleSummary[]),
  ]);
  const summaries = new Map<HelpCategorySlug, HelpArticleSummary[]>(
    [...grouped.entries()].map(([slug, articles]) => [slug, articles.map(toSummary)]),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <section className="border-b border-line">
        <PublicContainer narrow className="py-14 sm:py-20">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <SectionEyebrow pill>{title}</SectionEyebrow>
            <h1 className="pub-h2 mt-5">
              How can we <span className="text-[var(--pub-lime)]">help?</span>
            </h1>
            <p className="pub-lead mt-4 max-w-2xl">
              Guides for every part of ClientTurn, written against the product as it ships.
            </p>
            <div className="mt-8 w-full max-w-2xl">
              <HelpSearchForm base={path} query={query} />
            </div>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer narrow className="py-12 sm:py-16">
        {query ? (
          <HelpSearchResults
            base={path}
            query={query}
            results={results}
            emptyAction={
              <Link href="/contact-sales" className={buttonClass("secondary", "md")}>
                Ask us directly
              </Link>
            }
          />
        ) : (
          <HelpCategoryGrid base={path} grouped={summaries} />
        )}
      </PublicContainer>
    </>
  );
}
