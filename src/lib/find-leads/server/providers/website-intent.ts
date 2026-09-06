import "server-only";
import { safeFetchText } from "@/lib/security/safe-fetch";
import {
  providerFailure,
  type IntentCategoryQuery,
  type IntentResult,
  type ProviderResponse,
  type SourcingProvider,
} from "./types";

/**
 * First-party intent from a company's own public website.
 *
 * The licensed intent vendors (Bombora and the like) sell inferred signals
 * built from third-party browsing data. This adapter deliberately does not
 * pretend to be one. It reads pages the business publishes about itself —
 * a tender notice, a "we are refurbishing" news post, a careers page hiring a
 * site manager — and reports a match against the workspace's own configured
 * keywords.
 *
 * Two consequences worth being explicit about:
 *
 *   * **It is weaker evidence** than a licensed feed, and it is scored as such:
 *     strength is capped below 1 so a website mention can support a prospect
 *     but never carry one on its own.
 *   * **It is defensible.** Public pages of a business, no personal data, no
 *     third-party tracking, our own fetcher, robots-respecting, rate-bounded.
 *     That matters for a product whose whole compliance story is that cold
 *     outreach is grounded in evidence it can show the customer.
 *
 * It costs nothing external, so it is marked `freeOfCharge` and bills zero
 * rather than the price of the vendor it stands in for.
 */

/** Pages a business publishes about current work, in priority order. */
const SIGNAL_PATHS = ["/", "/news", "/blog", "/projects", "/case-studies", "/careers"];

/** Bounded per domain: this runs across a whole run's surviving companies. */
const PAGES_PER_DOMAIN = 3;

/**
 * A website mention is corroborating evidence, not proof of a buying cycle.
 * Capping strength here is what stops stage 10 from grading a prospect A+ on
 * the strength of a blog post.
 */
const MAX_STRENGTH = 0.6;

function matchesFor(
  text: string,
  categories: IntentCategoryQuery[],
): { category: string; hits: number }[] {
  const haystack = text.toLowerCase();

  return categories
    .map((category) => {
      // The category name is itself a term, so a category with no configured
      // keywords still does something sensible rather than nothing.
      const terms = [category.name, ...category.keywords]
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 3);

      const hits = terms.reduce(
        (total, term) => (haystack.includes(term) ? total + 1 : total),
        0,
      );

      return { category: category.name, hits };
    })
    .filter((match) => match.hits > 0);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 20_000);
}

async function fetchIntent(input: {
  domains: string[];
  categories: IntentCategoryQuery[];
  freshnessDays: number;
}): Promise<ProviderResponse<IntentResult>> {
  if (input.categories.length === 0) {
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const started = Date.now();
  const records: IntentResult[] = [];
  let reachable = 0;

  for (const domain of input.domains) {
    let pagesRead = 0;

    for (const path of SIGNAL_PATHS) {
      if (pagesRead >= PAGES_PER_DOMAIN) break;

      // Every hop is SSRF-checked, including redirects. A customer-sourced
      // domain is no more trusted here than one typed into a form.
      const page = await safeFetchText(`https://${domain}${path}`);
      if (!page.ok) continue;

      pagesRead += 1;
      const text = stripHtml(page.body);

      for (const match of matchesFor(text, input.categories)) {
        // Observed now, because a page carries no reliable publication date.
        // The category's own freshness window then governs how long it counts.
        records.push({
          category: match.category,
          domain,
          observedAt: new Date().toISOString(),
          strength: Math.min(MAX_STRENGTH, 0.25 + match.hits * 0.1),
          sourceUrl: page.url,
        });
      }
    }

    if (pagesRead > 0) reachable += 1;
  }

  // Nothing reachable at all is a failure worth reporting, so the run can fall
  // through to another intent source rather than concluding "no intent".
  if (reachable === 0 && input.domains.length > 0) {
    return providerFailure<IntentResult>("PROVIDER_UNAVAILABLE", Date.now() - started);
  }

  // One signal per domain per category: several pages mentioning the same
  // thing is one piece of evidence, not five.
  const seen = new Set<string>();
  const deduped = records.filter((record) => {
    const key = `${record.domain}:${record.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ok: true,
    records: deduped,
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
  // Last resort within INTENT: a licensed feed, once configured, outranks it.
  costRank: 9,
  // Needs no credential — it reads public pages through our own fetcher.
  configured: () => true,
  freeOfCharge: true,
  fetchIntent,
};
