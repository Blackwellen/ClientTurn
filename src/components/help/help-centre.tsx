import * as React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Clock, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { HELP_CATEGORIES, helpCategory, type HelpCategorySlug } from "@/lib/help/categories";
import {
  readingMinutes,
  tableOfContents,
  type HelpArticle,
  type HelpArticleSummary,
  type HelpImageSize,
} from "@/lib/help/contract";
import { MAX_QUERY_LENGTH } from "@/lib/help/search";
import { HelpMarkdown } from "./help-markdown";
import { HelpIcon } from "./help-icons";

/**
 * Help-centre building blocks shared by the public `/help` pages and the
 * in-app `/app/help` pages. Server components; the only difference between
 * the two surfaces is `base` (where links point) and the shell around them.
 *
 * Search is a plain GET form, so it works before hydration and without
 * JavaScript, and a results page is a shareable URL.
 */

export function articleHref(base: string, article: Pick<HelpArticleSummary, "category" | "slug">) {
  return `${base}/${article.category}/${article.slug}`;
}

export function formatUpdated(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function HelpSearchForm({
  base,
  query = "",
  size = "lg",
  autoFocus,
}: {
  base: string;
  query?: string;
  size?: "lg" | "md";
  autoFocus?: boolean;
}) {
  return (
    <form action={base} method="get" role="search" className="relative w-full">
      <label htmlFor="help-search" className="sr-only">
        Search help articles
      </label>
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-content-muted",
          size === "lg" ? "left-4 size-5" : "left-3 size-4",
        )}
      />
      <input
        id="help-search"
        type="search"
        name="q"
        defaultValue={query}
        maxLength={MAX_QUERY_LENGTH}
        autoFocus={autoFocus}
        placeholder="Search for answers, e.g. “connect HubSpot”"
        className={cn(
          "w-full rounded-xl border border-line-strong bg-surface text-content shadow-xs",
          "placeholder:text-content-subtle",
          "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--ct-lime)]",
          size === "lg" ? "h-14 pl-12 pr-28 text-[16px]" : "h-11 pl-9 pr-24 text-[14px]",
        )}
      />
      <button
        type="submit"
        className={cn(
          "absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center rounded-lg bg-[var(--ct-lime)] font-semibold text-[#0B1020]",
          "transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
          size === "lg" ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
        )}
      >
        Search
      </button>
    </form>
  );
}

export function HelpArticleRow({ base, article }: { base: string; article: HelpArticleSummary }) {
  const category = helpCategory(article.category);
  return (
    <Link
      href={articleHref(base, article)}
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3.5",
        "transition-colors duration-150 hover:border-line-strong hover:bg-surface-hover",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
      )}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
      >
        <HelpIcon icon={category?.icon} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold text-content">{article.title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-content-muted">{article.summary}</span>
        {category ? (
          <span className="mt-1.5 block text-[11.5px] font-medium uppercase tracking-[0.08em] text-content-subtle">
            {category.title}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden className="mt-2 size-4 shrink-0 text-content-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

export function HelpSearchResults({
  base,
  query,
  results,
  emptyAction,
}: {
  base: string;
  query: string;
  results: HelpArticleSummary[];
  emptyAction?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="help-results-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="help-results-title" className="text-[18px] font-semibold text-content">
          {results.length === 0
            ? `No articles match “${query}”`
            : `${results.length} ${results.length === 1 ? "article" : "articles"} for “${query}”`}
        </h2>
        <Link href={base} className="text-[13px] font-medium text-content-muted underline-offset-4 hover:text-content hover:underline">
          Browse all categories
        </Link>
      </div>
      {results.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-sunken/60 px-5 py-8 text-center">
          <p className="text-[14px] text-content-secondary">
            Try fewer or different words. For example the name of the tool you are connecting, or the page you are on.
          </p>
          {emptyAction ? <div className="mt-4 flex justify-center">{emptyAction}</div> : null}
        </div>
      ) : (
        <ul className="grid gap-2.5">
          {results.map((article) => (
            <li key={article.slug}>
              <HelpArticleRow base={base} article={article} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HelpCategoryGrid({
  base,
  grouped,
}: {
  base: string;
  grouped: Map<HelpCategorySlug, HelpArticleSummary[]>;
}) {
  // A category with nothing in it is hidden rather than shown as a promise.
  const categories = HELP_CATEGORIES.filter((category) => (grouped.get(category.slug)?.length ?? 0) > 0);
  return (
    <ul className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {categories.map((category) => {
        const articles = grouped.get(category.slug) ?? [];
        return (
          <li key={category.slug} className="flex">
            <div className="flex w-full flex-col rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ct-lime)] text-[#0B1020]"
                >
                  <HelpIcon icon={category.icon} className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold text-content">
                    <Link
                      href={`${base}/${category.slug}`}
                      className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
                    >
                      {category.title}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-[13px] leading-snug text-content-muted">{category.description}</p>
                </div>
              </div>
              <ul className="mt-4 flex-1 space-y-1.5 border-t border-line pt-3.5">
                {articles.slice(0, 4).map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={articleHref(base, article)}
                      className="block rounded-sm text-[13.5px] leading-snug text-content-secondary hover:text-content hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href={`${base}/${category.slug}`}
                className="mt-4 inline-flex items-center gap-1.5 self-start rounded-sm text-[13px] font-semibold text-content hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
              >
                {articles.length === 1 ? "1 article" : `All ${articles.length} articles`}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export type Crumb = { label: string; href?: string };

export function HelpBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-content-muted">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <ChevronRight aria-hidden className="size-3.5 text-content-subtle" /> : null}
            {item.href ? (
              <Link href={item.href} className="rounded-sm hover:text-content hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-content-secondary">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function HelpArticleView({
  base,
  article,
  imageSizes,
  related,
  breadcrumbs,
  footer,
}: {
  base: string;
  article: HelpArticle;
  imageSizes: Record<string, HelpImageSize>;
  related: HelpArticleSummary[];
  breadcrumbs: Crumb[];
  /** Surface-specific help: contact support in the app, sign-up publicly. */
  footer?: React.ReactNode;
}) {
  const toc = tableOfContents(article.body);
  const updated = formatUpdated(article.updated);
  const category = helpCategory(article.category);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-14">
      <article className="min-w-0 max-w-[760px]">
        <HelpBreadcrumbs items={breadcrumbs} />
        <header className="mt-5 border-b border-line pb-6">
          {category ? (
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-content-muted">
              {category.title}
            </p>
          ) : null}
          <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-content sm:text-[38px]">
            {article.title}
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-content-secondary">{article.summary}</p>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-content-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock aria-hidden className="size-3.5" />
              {readingMinutes(article.body)} min read
            </span>
            {updated ? <span>Updated {updated}</span> : null}
          </p>
        </header>

        <div className="mt-6">
          <HelpMarkdown
            body={article.body}
            imageSizes={imageSizes}
            screenshots={article.screenshots}
            helpBase={base}
          />
        </div>

        {footer ? <div className="mt-12">{footer}</div> : null}
      </article>

      <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
        {toc.length > 1 ? (
          <nav aria-label="On this page">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">On this page</h2>
            <ol className="mt-3 space-y-2 border-l border-line pl-4">
              {toc.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="block rounded-sm text-[13px] leading-snug text-content-secondary hover:text-content">
                    {item.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {related.length > 0 ? (
          <nav aria-label="Related articles">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-content-muted">
              More in {category?.title ?? "this category"}
            </h2>
            <ul className="mt-3 space-y-2 border-l border-line pl-4">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link href={articleHref(base, item)} className="block rounded-sm text-[13px] leading-snug text-content-secondary hover:text-content">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </aside>
    </div>
  );
}
