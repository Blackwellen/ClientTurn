/**
 * Help search ranking (Phase 8.5 for the help centre).
 *
 * One ranking for every surface — the public `/help` page, `/app/help` and the
 * support popout — so the same query can never return different answers in
 * different places.
 *
 * It runs in memory over the merged article index rather than in SQL. The
 * index is small (hundreds of articles, not millions), the bundled articles
 * are files and not rows, and doing it here means no customer-typed text is
 * ever spliced into a PostgREST filter string. The previous `.or()` filter
 * was built by string concatenation, broke on a comma and never looked at
 * `keywords`; there is now no filter string to break.
 *
 * Pure: relative imports only.
 */

import { helpCategory } from "./categories.ts";
import { stripCode, type HelpArticle } from "./contract.ts";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "how", "i", "in", "is", "it", "my", "of", "on", "or", "the", "to",
  "what", "when", "where", "which", "why", "with", "you", "your",
]);

export const MAX_QUERY_LENGTH = 120;

/** Lower-cased search terms, punctuation removed, stop words dropped. */
export function tokenize(query: string): string[] {
  const words = query
    .slice(0, MAX_QUERY_LENGTH)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !STOP_WORDS.has(word));
  // "how do I" on its own is still a query; keep the words rather than
  // returning nothing for a question made entirely of stop words.
  return [...new Set(meaningful.length > 0 ? meaningful : words)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word or word-prefix matches: "mail" finds "mailbox", "api" does not find "rapid". */
function countMatches(haystack: string, term: string): number {
  if (!haystack) return 0;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}`, "g");
  return haystack.match(pattern)?.length ?? 0;
}

function normalise(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

type Scorable = Pick<HelpArticle, "title" | "summary" | "keywords" | "category" | "body"> & {
  viewCount?: number;
};

/**
 * Relevance of one article to a tokenised query, and how many of the terms it
 * matched. Weights: title > keywords > summary > category > body.
 */
export function scoreArticle(
  article: Scorable,
  terms: string[],
  phrase = "",
): { score: number; matched: number } {
  const title = normalise(article.title);
  const summary = normalise(article.summary);
  const keywords = article.keywords.map(normalise);
  const category = normalise(helpCategory(article.category)?.title ?? article.category);
  const body = normalise(stripCode(article.body));

  let score = 0;
  let matched = 0;

  for (const term of terms) {
    let termScore = 0;
    const inTitle = countMatches(title, term);
    if (inTitle) termScore += 10 + (new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`).test(title) ? 2 : 0);
    if (keywords.some((keyword) => keyword === term)) termScore += 9;
    else if (keywords.some((keyword) => countMatches(keyword, term) > 0)) termScore += 6;
    if (countMatches(summary, term)) termScore += 4;
    if (countMatches(category, term)) termScore += 2;
    termScore += Math.min(3, countMatches(body, term));
    if (termScore > 0) matched += 1;
    score += termScore;
  }

  const wholePhrase = normalise(phrase).trim();
  if (wholePhrase.length > 2 && terms.length > 1) {
    if (title.includes(wholePhrase)) score += 15;
    else if (summary.includes(wholePhrase)) score += 6;
    else if (body.includes(wholePhrase)) score += 3;
  }

  return { score, matched };
}

/**
 * Ranks articles for a query.
 *
 * Articles matching every term come first. If nothing matches every term, the
 * best partial matches are returned instead, so a query with one misspelt
 * word still finds something. An empty query returns the most viewed, then
 * the curated order.
 */
export function searchArticles<T extends Scorable>(
  articles: T[],
  query: string,
  limit = 8,
): T[] {
  const terms = tokenize(query);
  const byPopularity = (a: T, b: T) => (b.viewCount ?? 0) - (a.viewCount ?? 0);

  if (terms.length === 0) {
    return [...articles].sort(byPopularity).slice(0, limit);
  }

  const scored = articles
    .map((article) => ({ article, ...scoreArticle(article, terms, query) }))
    .filter((row) => row.score > 0);

  const complete = scored.filter((row) => row.matched === terms.length);
  const pool = complete.length > 0 ? complete : scored;

  return pool
    .sort(
      (a, b) =>
        b.matched - a.matched ||
        b.score - a.score ||
        (b.article.viewCount ?? 0) - (a.article.viewCount ?? 0) ||
        a.article.title.localeCompare(b.article.title),
    )
    .slice(0, limit)
    .map((row) => row.article);
}
