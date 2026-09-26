import "server-only";
import { loadHelpIndex } from "@/lib/help/disk";
import { searchArticles } from "@/lib/help/search";
import type { HelpArticle } from "@/lib/help/contract";

/**
 * The bundled help index (V4 §23.11), now derived from the markdown files.
 *
 * The thirteen articles that used to be string literals here live in
 * `content/help/<category>/<slug>.md` (Phase 8.1), so there is exactly one
 * copy of every article. This module is kept only so older call sites that
 * want the bundled floor — without published overrides — have a name to
 * import; anything new should use `@/lib/help/service`, which merges the
 * published `support_articles` rows on top.
 */

export type BundledArticle = HelpArticle;

export function bundledArticles(): HelpArticle[] {
  return loadHelpIndex().articles;
}

export function bundledArticle(slug: string): HelpArticle | undefined {
  return bundledArticles().find((article) => article.slug === slug);
}

/** Ranked search over the bundled floor only. */
export function searchBundled(query: string, limit = 50): HelpArticle[] {
  return searchArticles(bundledArticles(), query, limit);
}
