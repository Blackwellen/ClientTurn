import "server-only";
import { safeFetchText } from "@/lib/security/safe-fetch";
import { recencyStrength, type IntentEvidenceKind } from "../../intent-evidence";
import {
  DISCOVERY_PATHS,
  detectTechnologies,
  hiringRoleMatches,
  isPathAllowed,
  keywordMatches,
  parseRobots,
  parseSitemap,
  publishedDate,
  recentSitemapEntries,
  stripHtml,
  type RobotsRules,
} from "../../website-signals";
import {
  providerFailure,
  type IntentCategoryQuery,
  type IntentResult,
  type IntentWants,
  type ProviderResponse,
  type SourcingProvider,
} from "./types";

/**
 * First-party intent from a company's own public website.
 *
 * The licensed intent vendors (Bombora and the like) sell inferred signals
 * built from third-party browsing data. This adapter deliberately does not
 * pretend to be one. It reads pages the business publishes about itself and
 * reports what they show:
 *
 *   * **Keyword mentions** of the workspace's own configured intent terms.
 *   * **Recent news, press and blog posts**, found through the site's own
 *     sitemap.xml and limited to entries modified inside the freshness window.
 *   * **Hiring** for the specific roles the plan asked about, on careers and
 *     jobs pages (HIRING).
 *   * **Technology in use**, fingerprinted from the markup the site serves
 *     (TECHNOLOGY). The rules live in `website-signals.ts`, pure and tested.
 *
 * Two consequences worth being explicit about:
 *
 *   * **It is weaker evidence** than a register filing, and it is scored as
 *     such: strength is capped at MAX_STRENGTH, weighted by how recent the
 *     content is dated and by how many distinct things matched.
 *   * **It is defensible.** Public pages of a business, no personal data, no
 *     third-party tracking, our own SSRF-guarded fetcher, robots.txt read and
 *     obeyed before any page, and a hard page budget per domain.
 *
 * It costs nothing external, so it is marked `freeOfCharge` and bills zero.
 */

/** Pages read per domain, not counting robots.txt and the sitemap. */
const PAGES_PER_DOMAIN = 6;

/** Recent sitemap posts read per domain, inside that budget. */
const SITEMAP_POSTS = 3;

/**
 * A website mention is corroborating evidence, not proof of a buying cycle.
 * Capping strength here is what stops stage 10 from grading a prospect A+ on
 * the strength of a blog post.
 */
const MAX_STRENGTH = 0.6;

const SOURCE = "Company website";

type Page = { url: string; html: string; datedAt: string | null };

async function readRobots(domain: string): Promise<RobotsRules> {
  const result = await safeFetchText(`https://${domain}/robots.txt`);
  // No robots.txt (or an unreadable one) is permission, as the standard says.
  // A site that wants us out can say so, and the user agent names us.
  return result.ok ? parseRobots(result.body) : { allow: [], disallow: [], sitemaps: [] };
}

/** Recent post URLs from the site's own sitemap, with their lastmod dates. */
async function recentPosts(
  domain: string,
  robots: RobotsRules,
  freshnessDays: number,
  now: Date,
): Promise<{ url: string; lastmod: string | null }[]> {
  const declared = robots.sitemaps.find((url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "") === domain.replace(/^www\./, "");
    } catch {
      return false;
    }
  });
  const first = declared ?? `https://${domain}/sitemap.xml`;
  if (!isPathAllowed(robots, new URL(first).pathname)) return [];

  const root = await safeFetchText(first, { allowXml: true });
  if (!root.ok) return [];
  let parsed = parseSitemap(root.body);

  // A sitemap index: read one child, preferring the one that lists posts.
  if (parsed.index) {
    const child =
      parsed.entries.find((entry) => /post|news|blog|press|job|career/i.test(entry.loc)) ??
      parsed.entries[0];
    if (!child || !isPathAllowed(robots, new URL(child.loc).pathname)) return [];
    const fetched = await safeFetchText(child.loc, { allowXml: true });
    if (!fetched.ok) return [];
    parsed = parseSitemap(fetched.body);
    if (parsed.index) return [];
  }

  return recentSitemapEntries({
    entries: parsed.entries,
    domain,
    now,
    freshnessDays,
    limit: SITEMAP_POSTS,
  }).map((entry) => ({ url: entry.loc, lastmod: entry.lastmod }));
}

async function readPages(
  domain: string,
  freshnessDays: number,
  now: Date,
): Promise<Page[]> {
  const robots = await readRobots(domain);
  const posts = await recentPosts(domain, robots, freshnessDays, now);

  const queue: { url: string; lastmod: string | null }[] = [
    { url: `https://${domain}/`, lastmod: null },
    ...posts,
    ...DISCOVERY_PATHS.filter((path) => path !== "/").map((path) => ({
      url: `https://${domain}${path}`,
      lastmod: null,
    })),
  ];

  const pages: Page[] = [];
  const seen = new Set<string>();

  for (const entry of queue) {
    if (pages.length >= PAGES_PER_DOMAIN) break;
    const path = new URL(entry.url).pathname;
    if (seen.has(path) || !isPathAllowed(robots, path)) continue;
    seen.add(path);

    // Every hop is SSRF-checked, including redirects. A customer-sourced
    // domain is no more trusted here than one typed into a form.
    const page = await safeFetchText(entry.url);
    if (!page.ok) continue;

    // A redirect to the homepage (a missing /careers, say) is not a new page.
    const landed = new URL(page.url).pathname;
    if (landed !== path && seen.has(landed)) continue;
    seen.add(landed);

    pages.push({ url: page.url, html: page.body, datedAt: publishedDate(page.body, now) ?? entry.lastmod });
  }

  return pages;
}

type Best = { hits: Set<string>; snippet: string; url: string; datedAt: string | null };

function keep(best: Best | undefined, page: Page, terms: string[], snippet: string): Best {
  const next = best ?? { hits: new Set<string>(), snippet, url: page.url, datedAt: page.datedAt };
  for (const term of terms) next.hits.add(term);
  // The most recently dated page is the evidence shown.
  if (page.datedAt && (!next.datedAt || page.datedAt > next.datedAt)) {
    next.snippet = snippet;
    next.url = page.url;
    next.datedAt = page.datedAt;
  }
  return next;
}

function evidenceFor(input: {
  kind: IntentEvidenceKind;
  category: string | null;
  domain: string;
  best: Best;
  now: Date;
  freshnessDays: number;
  /** Current-state evidence (the live markup) counts as observed now. */
  current?: boolean;
}): IntentResult | null {
  const datedAt = input.current ? input.now.toISOString() : input.best.datedAt;
  const strength = recencyStrength({
    hits: input.best.hits.size,
    datedAt,
    now: input.now,
    freshnessDays: input.freshnessDays,
    max: MAX_STRENGTH,
  });
  // Dated outside the freshness window: not a current signal.
  if (strength <= 0) return null;

  const observedAt = datedAt ?? input.now.toISOString();
  return {
    category: input.category,
    domain: input.domain,
    observedAt,
    strength,
    sourceUrl: input.best.url,
    evidence: {
      kind: input.kind,
      source: SOURCE,
      reference: input.best.url,
      observedAt,
      snippet: input.best.snippet,
    },
  };
}

async function fetchIntent(input: {
  domains: string[];
  categories: IntentCategoryQuery[];
  freshnessDays: number;
  wants?: IntentWants;
}): Promise<ProviderResponse<IntentResult>> {
  const kinds = new Set(input.wants?.kinds ?? []);
  const roles = kinds.has("HIRING") ? (input.wants?.hiringRoles ?? []) : [];
  const technologies = new Set(kinds.has("TECHNOLOGY") ? (input.wants?.technologies ?? []) : []);

  if (input.categories.length === 0 && roles.length === 0 && technologies.size === 0) {
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const started = Date.now();
  const now = new Date();
  const records: IntentResult[] = [];
  let reachable = 0;

  for (const domain of input.domains) {
    // A malformed sitemap or URL on one site must not throw into the worker:
    // that domain is treated as unreachable and the batch carries on.
    const pages = await readPages(domain, input.freshnessDays, now).catch(() => [] as Page[]);
    if (pages.length === 0) continue;
    reachable += 1;

    const byCategory = new Map<string, Best>();
    let hiring: Best | undefined;
    let tech: Best | undefined;

    for (const page of pages) {
      const text = stripHtml(page.html);

      for (const match of keywordMatches(text, input.categories)) {
        // Hits are distinct pages mentioning the category: a term repeated on
        // one page is one piece of evidence, the same need on the homepage,
        // a news post and the careers page is three.
        byCategory.set(
          match.category,
          keep(byCategory.get(match.category), page, [page.url], match.snippet),
        );
      }

      if (roles.length > 0) {
        const found = hiringRoleMatches(text, roles);
        if (found.length > 0) {
          hiring = keep(hiring, page, found.map((f) => f.role.toLowerCase()), `Hiring: ${found.map((f) => f.role).join(", ")}. ${found[0].snippet}`);
        }
      }

      if (technologies.size > 0) {
        const found = detectTechnologies(page.html).filter((t) => technologies.has(t.key));
        if (found.length > 0) {
          tech = keep(tech, page, found.map((f) => f.key), `Uses ${found.map((f) => f.label).join(", ")} (found ${found[0].marker})`);
        }
      }
    }

    for (const [category, best] of byCategory) {
      const result = evidenceFor({ kind: "WEBSITE_MENTION", category, domain, best, now, freshnessDays: input.freshnessDays });
      if (result) records.push(result);
    }
    if (hiring) {
      const result = evidenceFor({ kind: "HIRING", category: null, domain, best: hiring, now, freshnessDays: input.freshnessDays });
      if (result) records.push(result);
    }
    if (tech) {
      const result = evidenceFor({ kind: "TECHNOLOGY", category: null, domain, best: tech, now, freshnessDays: input.freshnessDays, current: true });
      if (result) records.push(result);
    }
  }

  // Nothing reachable at all is a failure worth reporting, so the run can fall
  // through to another intent source rather than concluding "no intent".
  if (reachable === 0 && input.domains.length > 0) {
    return providerFailure<IntentResult>("PROVIDER_UNAVAILABLE", Date.now() - started);
  }

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs: Date.now() - started,
    errorCode: null,
  };
}

export const websiteIntentProvider: SourcingProvider = {
  key: "website_signals",
  displayName: "Website signals",
  capabilities: ["INTENT", "WEBSITE_INTELLIGENCE"],
  // Last within INTENT: the register's dated filings outrank a web page.
  costRank: 9,
  // Needs no credential — it reads public pages through our own fetcher.
  configured: () => true,
  freeOfCharge: true,
  fetchIntent,
};
