import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicContainer, buttonClass } from "@/components/marketing/public/ui";
import { HelpArticleView } from "@/components/help/help-centre";
import { HelpViewBeacon } from "@/components/help/help-view-beacon";
import { helpCategory, isHelpCategory } from "@/lib/help/categories";
import { loadHelpIndex } from "@/lib/help/disk";
import { getHelpArticleForRender, relatedArticles } from "@/lib/help/service";

/**
 * A public help article.
 *
 * Statically generated from the markdown files and revalidated every five
 * minutes, so a published `support_articles` override reaches the public page
 * without a deploy. A slug that only exists as a database row renders on
 * first request (`dynamicParams` defaults to true).
 */
export const revalidate = 300;

/** Article text can come from a database row; `<` is escaped so it can never close the script tag. */
function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com").replace(/\/$/, "");

export function generateStaticParams() {
  return loadHelpIndex().articles.map((article) => ({
    category: article.category,
    slug: article.slug,
  }));
}

type Params = Promise<{ category: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const found = await getHelpArticleForRender(slug);
  if (!found) return { title: "Help centre" };
  const { article } = found;
  const path = `/help/${article.category}/${article.slug}`;
  const firstShot = article.screenshots[0];
  return {
    title: `${article.title} · Help centre`,
    description: article.summary,
    keywords: article.keywords,
    alternates: { canonical: path },
    openGraph: {
      title: `${article.title} · ClientTurn`,
      description: article.summary,
      url: path,
      siteName: "ClientTurn",
      locale: "en_GB",
      type: "article",
      ...(article.updated ? { modifiedTime: article.updated } : {}),
      ...(firstShot ? { images: [{ url: firstShot.src, alt: firstShot.alt }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${article.title} · ClientTurn`,
      description: article.summary,
    },
  };
}

export default async function HelpArticlePage({ params }: { params: Params }) {
  const { category, slug } = await params;
  if (!isHelpCategory(category)) notFound();

  const found = await getHelpArticleForRender(slug);
  if (!found) notFound();
  const { article, imageSizes } = found;

  // One canonical URL per article: an override that moved it to another
  // category, or a hand-typed wrong category, lands on the right one.
  if (article.category !== category) {
    permanentRedirect(`/help/${article.category}/${article.slug}`);
  }

  const related = await relatedArticles(article);
  const categoryMeta = helpCategory(article.category)!;
  const path = `/help/${article.category}/${article.slug}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Help centre", item: `${siteUrl}/help` },
      { "@type": "ListItem", position: 3, name: categoryMeta.title, item: `${siteUrl}/help/${categoryMeta.slug}` },
      { "@type": "ListItem", position: 4, name: article.title, item: `${siteUrl}${path}` },
    ],
  };
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title,
    description: article.summary,
    url: `${siteUrl}${path}`,
    inLanguage: "en-GB",
    ...(article.updated ? { dateModified: article.updated } : {}),
    articleSection: categoryMeta.title,
    keywords: article.keywords.join(", "),
    publisher: { "@type": "Organization", name: "ClientTurn", url: siteUrl },
    ...(article.screenshots[0] ? { image: `${siteUrl}${article.screenshots[0].src}` } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(articleJsonLd) }} />
      <HelpViewBeacon slug={article.slug} />
      <PublicContainer narrow className="py-12 sm:py-16">
        <HelpArticleView
          base="/help"
          article={article}
          imageSizes={imageSizes}
          related={related}
          breadcrumbs={[
            { label: "Help centre", href: "/help" },
            { label: categoryMeta.title, href: `/help/${categoryMeta.slug}` },
            { label: article.title },
          ]}
          footer={
            <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[15px] font-semibold text-content">Still stuck?</p>
                <p className="mt-1 text-[13.5px] text-content-secondary">
                  Customers can raise a ticket from the help button inside the app. Not a customer yet? Talk to us.
                </p>
              </div>
              <Link href="/contact-sales" className={buttonClass("secondary", "md", "shrink-0")}>
                Contact us
              </Link>
            </div>
          }
        />
      </PublicContainer>
    </>
  );
}
