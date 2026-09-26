import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseCategory, type HelpCategorySlug } from "./categories";
import {
  compareArticles,
  type HelpArticle,
  type HelpArticleSummary,
  type HelpImageSize,
} from "./contract";
import { imageSizesFor, loadHelpIndex } from "./disk";
import { searchArticles, MAX_QUERY_LENGTH } from "./search";

/**
 * HelpService — the one source every help surface reads (Phase 8.1-8.5).
 *
 * The public `/help` pages, `/app/help`, the support popout and the Support
 * Copilot all come through here, so an article can never say one thing in the
 * product and another on the website.
 *
 * Two layers, merged by slug:
 *
 *   1. **Files** — `content/help/<category>/<slug>.md`, versioned with the code
 *      and validated by `tests/help-center.test.ts`. The floor.
 *   2. **Published `support_articles` rows** — a platform admin's override.
 *      A row with the same slug replaces the file; a row with a new slug adds
 *      an article. The database wins because it is the thing that can be
 *      corrected without a deploy.
 *
 * Search is ranked in memory by `./search.ts`. No customer text is ever
 * interpolated into a query: the database read below takes no input at all.
 */

type ViewCounts = Map<string, number>;

async function readOverrides(): Promise<{ rows: HelpArticle[]; views: ViewCounts }> {
  const views: ViewCounts = new Map();
  try {
    const admin = createAdminClient();
    const [articles, counts] = await Promise.all([
      admin
        .from("support_articles")
        .select("slug, title, summary, category, keywords, body_markdown, view_count, updated_at")
        .eq("status", "PUBLISHED")
        .limit(1000),
      admin.from("help_article_views").select("slug, view_count").limit(5000),
    ]);

    // The views table arrives with migration 0128; until it is applied the
    // read fails and the index is simply unranked by popularity.
    for (const row of counts.data ?? []) views.set(row.slug, Number(row.view_count) || 0);

    const rows: HelpArticle[] = (articles.data ?? []).map((row) => ({
      slug: row.slug,
      title: row.title,
      summary: row.summary ?? "",
      // Resolved against the file's category below when it overrides one.
      category: normaliseCategory(row.category),
      keywords: row.keywords ?? [],
      order: 1000,
      updated: row.updated_at ? row.updated_at.slice(0, 10) : null,
      screenshots: [],
      body: row.body_markdown,
      source: "database",
      viewCount: Math.max(row.view_count ?? 0, views.get(row.slug) ?? 0),
    }));
    return { rows, views };
  } catch {
    // No service credentials (a static build without secrets, a local run
    // without `.env`): the bundled articles are still a complete help centre.
    return { rows: [], views };
  }
}

/** Every article, files merged with published overrides. Memoised per request. */
export const listHelpArticles = cache(async (): Promise<HelpArticle[]> => {
  const files = loadHelpIndex().articles;
  const { rows, views } = await readOverrides();

  const bySlug = new Map<string, HelpArticle>();
  for (const article of files) {
    bySlug.set(article.slug, { ...article, viewCount: views.get(article.slug) ?? 0 });
  }
  for (const row of rows) {
    const file = bySlug.get(row.slug);
    bySlug.set(row.slug, {
      ...row,
      // An override keeps the file's place unless the row names a category of
      // its own, and inherits the file's order, keywords and screenshots when
      // it has none.
      category: file ? normaliseCategory(row.category, file.category) : row.category,
      order: file?.order ?? row.order,
      keywords: row.keywords.length > 0 ? row.keywords : (file?.keywords ?? []),
      screenshots: file?.screenshots ?? [],
      updated: row.updated ?? file?.updated ?? null,
    });
  }

  return [...bySlug.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || compareArticles(a, b),
  );
});

export function toSummary(article: HelpArticle): HelpArticleSummary {
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    category: article.category,
    updated: article.updated,
    order: article.order,
  };
}

export async function getHelpArticle(slug: string): Promise<HelpArticle | null> {
  const articles = await listHelpArticles();
  return articles.find((article) => article.slug === slug) ?? null;
}

/** The article plus the pixel sizes of its images, for layout-stable figures. */
export async function getHelpArticleForRender(
  slug: string,
): Promise<{ article: HelpArticle; imageSizes: Record<string, HelpImageSize> } | null> {
  const article = await getHelpArticle(slug);
  if (!article) return null;
  return { article, imageSizes: imageSizesFor(article) };
}

export async function articlesInCategory(category: HelpCategorySlug): Promise<HelpArticle[]> {
  const articles = await listHelpArticles();
  return articles.filter((article) => article.category === category).sort(compareArticles);
}

/** Articles grouped by category, each group in curated order. */
export async function helpIndexByCategory(): Promise<Map<HelpCategorySlug, HelpArticle[]>> {
  const grouped = new Map<HelpCategorySlug, HelpArticle[]>();
  for (const article of await listHelpArticles()) {
    const list = grouped.get(article.category) ?? [];
    list.push(article);
    grouped.set(article.category, list);
  }
  for (const list of grouped.values()) list.sort(compareArticles);
  return grouped;
}

export async function searchHelp(query: string, limit = 8): Promise<HelpArticleSummary[]> {
  const articles = await listHelpArticles();
  return searchArticles(articles, query.slice(0, MAX_QUERY_LENGTH), limit).map(toSummary);
}

/**
 * Counts one view. Only a slug that exists is counted, so a crafted request
 * cannot fill the table with junk rows. Failure is swallowed: a view count is
 * never worth failing a page for.
 */
export async function recordHelpView(slug: string): Promise<void> {
  try {
    const article = await getHelpArticle(slug);
    if (!article) return;
    const admin = createAdminClient();
    await admin.rpc("record_help_article_view", { p_slug: article.slug });
  } catch {
    // Not applied yet, or no credentials — nothing to record against.
  }
}

/** Neighbours in the same category, for "Related articles". */
export async function relatedArticles(article: HelpArticle, limit = 4): Promise<HelpArticleSummary[]> {
  const siblings = await articlesInCategory(article.category);
  return siblings
    .filter((other) => other.slug !== article.slug)
    .slice(0, limit)
    .map(toSummary);
}
