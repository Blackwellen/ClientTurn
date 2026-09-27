import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicContainer } from "@/components/marketing/public/ui";
import {
  HelpArticleRow,
  HelpBreadcrumbs,
  HelpSearchForm,
} from "@/components/help/help-centre";
import { HelpIcon } from "@/components/help/help-icons";
import { HELP_CATEGORY_SLUGS, helpCategory, isHelpCategory } from "@/lib/help/categories";
import { articlesInCategory, toSummary } from "@/lib/help/service";

export const revalidate = 300;

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com").replace(/\/$/, "");

export function generateStaticParams() {
  return HELP_CATEGORY_SLUGS.map((category) => ({ category }));
}

type Params = Promise<{ category: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { category: slug } = await params;
  const category = helpCategory(slug);
  if (!category) return { title: "Help centre" };
  const path = `/help/${category.slug}`;
  const title = `${category.title} · Help centre`;
  return {
    title,
    description: category.description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title}`,
      description: category.description,
      url: path,
      siteName: "ClientTurn",
      locale: "en_GB",
      type: "website",
    },
    twitter: { card: "summary", title: `${title}`, description: category.description },
  };
}

export default async function HelpCategoryPage({ params }: { params: Params }) {
  const { category: slug } = await params;
  if (!isHelpCategory(slug)) notFound();
  const category = helpCategory(slug)!;
  const articles = await articlesInCategory(slug);
  // An empty category is not a page worth indexing or landing on.
  if (articles.length === 0) notFound();

  const path = `/help/${category.slug}`;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Help centre", item: `${siteUrl}/help` },
      { "@type": "ListItem", position: 3, name: category.title, item: `${siteUrl}${path}` },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <PublicContainer narrow className="py-12 sm:py-16">
        <div className="mx-auto max-w-3xl">
          <HelpBreadcrumbs
            items={[
              { label: "Help centre", href: "/help" },
              { label: category.title },
            ]}
          />
          <div className="mt-6 flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--ct-lime)] text-[#0B1020]"
            >
              <HelpIcon icon={category.icon} className="size-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-content sm:text-[38px]">
                {category.title}
              </h1>
              <p className="mt-2 text-[16px] text-content-secondary">{category.description}</p>
            </div>
          </div>
          <div className="mt-8">
            <HelpSearchForm base="/help" size="md" />
          </div>
          <ul className="mt-8 grid gap-2.5">
            {articles.map((article) => (
              <li key={article.slug}>
                <HelpArticleRow base="/help" article={toSummary(article)} />
              </li>
            ))}
          </ul>
        </div>
      </PublicContainer>
    </>
  );
}
