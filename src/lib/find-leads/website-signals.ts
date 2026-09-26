/**
 * Reading a company's own public website for buying signals.
 *
 * Pure -- no `server-only`, no fetch -- so every rule that decides what a page
 * means is tested without a network. The adapter in
 * `server/providers/website-intent.ts` does the fetching (SSRF-guarded,
 * robots-respecting, bounded) and hands the text here.
 *
 * Everything here reads what a business publishes *about itself*: its careers
 * page, its news posts, the scripts its own site loads. No personal data is
 * extracted, and nothing here would work against a site that blocked us in
 * robots.txt, because the adapter never fetches such a page.
 */

import { truncateSnippet } from "./intent-evidence.ts";

/* ------------------------------------------------------------ discovery */

/**
 * The pages worth reading, in priority order. A homepage and the pages where
 * a company talks about its people, its hiring and its news.
 */
export const DISCOVERY_PATHS = [
  "/",
  "/careers",
  "/jobs",
  "/news",
  "/press",
  "/blog",
  "/about",
  "/team",
] as const;

/** Paths in a sitemap worth reading: dated news, press, blog and job posts. */
const SITEMAP_INTERESTING =
  /\/(news|press|press-releases|blog|insights|updates|announcements|careers|jobs|vacancies|join-us|work-with-us)(\/|$)/i;

/* --------------------------------------------------------------- robots */

export type RobotsRules = {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
};

/**
 * Parses robots.txt for our user agent, falling back to `*`.
 *
 * Deliberately small: groups, Allow/Disallow, `*` and `$` in paths, and
 * Sitemap lines. Anything unparseable is ignored rather than treated as
 * permission -- but an empty file is permission, as the standard says.
 */
export function parseRobots(text: string, userAgent = "clientturnbot"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    if (field === "disallow" && value) current.disallow.push(value);
  }

  const agent = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));

  return {
    allow: chosen.flatMap((group) => group.allow),
    disallow: chosen.flatMap((group) => group.disallow),
    sitemaps,
  };
}

function ruleMatches(rule: string, path: string): number {
  // Longest-match semantics: returns the rule's length when it matches, else -1.
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
  return regex.test(path) ? rule.length : -1;
}

/** True when robots.txt lets us fetch this path. The longest matching rule wins. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const rule of rules.disallow) {
    const length = ruleMatches(rule, path);
    if (length > best) {
      best = length;
      allowed = false;
    }
  }
  for (const rule of rules.allow) {
    const length = ruleMatches(rule, path);
    // A tie goes to Allow, as Google documents.
    if (length >= best && length >= 0) {
      best = length;
      allowed = true;
    }
  }
  return allowed;
}

/* -------------------------------------------------------------- sitemap */

export type SitemapEntry = { loc: string; lastmod: string | null };

/** Parses a sitemap or a sitemap index. Tolerant of namespaces and CDATA. */
export function parseSitemap(xml: string): { index: boolean; entries: SitemapEntry[] } {
  const index = /<sitemapindex[\s>]/i.test(xml);
  const blocks = xml.match(/<(url|sitemap)\b[\s\S]*?<\/\1>/gi) ?? [];
  const entries: SitemapEntry[] = [];

  for (const block of blocks.slice(0, 5_000)) {
    const loc = block.match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1] ?? null;
    entries.push({ loc: loc.trim(), lastmod: lastmod && Number.isFinite(Date.parse(lastmod)) ? new Date(lastmod).toISOString() : null });
  }

  return { index, entries };
}

/**
 * The sitemap entries worth reading: on this company's own host, on a news,
 * press, blog or jobs path, modified inside the freshness window, newest first.
 *
 * An entry without a lastmod is skipped: the point of reading the sitemap is
 * to find *recent* posts, and an undated URL cannot show that.
 */
export function recentSitemapEntries(input: {
  entries: SitemapEntry[];
  domain: string;
  now: Date;
  freshnessDays: number;
  limit: number;
}): SitemapEntry[] {
  const host = input.domain.replace(/^www\./, "").toLowerCase();
  const cutoff = input.now.getTime() - input.freshnessDays * 86_400_000;

  return input.entries
    .filter((entry) => {
      if (!entry.lastmod) return false;
      const time = Date.parse(entry.lastmod);
      if (!Number.isFinite(time) || time < cutoff || time > input.now.getTime() + 86_400_000) return false;
      try {
        const url = new URL(entry.loc);
        if (url.hostname.replace(/^www\./, "").toLowerCase() !== host) return false;
        return SITEMAP_INTERESTING.test(url.pathname) && url.pathname.split("/").filter(Boolean).length >= 2;
      } catch {
        return false;
      }
    })
    .sort((a, b) => Date.parse(b.lastmod!) - Date.parse(a.lastmod!))
    .slice(0, Math.max(0, input.limit));
}

/* ------------------------------------------------------------ page text */

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .slice(0, 30_000);
}

/** The text either side of a match, for the evidence snippet. */
export function snippetAround(text: string, index: number, length: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return truncateSnippet(`${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`);
}

/**
 * The page's own publication date, where it states one.
 *
 * Read from the markup a publisher uses to date an article: Open Graph
 * `article:published_time`, JSON-LD `datePublished`, or a `<time datetime>`
 * element. The most recent wins. Null when the page is undated, and an undated
 * page is scored as mid-window, never as today.
 */
export function publishedDate(html: string, now: Date = new Date()): string | null {
  const candidates: string[] = [];
  const patterns = [
    /<meta[^>]+property=["']article:(?:published|modified)_time["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:(?:published|modified)_time["']/gi,
    /"date(?:Published|Posted|Modified)"\s*:\s*"([^"]+)"/gi,
    /<time[^>]+datetime=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) candidates.push(match[1]);
  }

  const times = candidates
    .map((value) => Date.parse(value))
    // A date in the future is a template artefact, not a publication.
    .filter((time) => Number.isFinite(time) && time <= now.getTime() + 86_400_000);
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

/* ------------------------------------------------------- keyword matches */

export type KeywordCategory = { name: string; keywords: string[] };

/** The workspace's configured terms found on a page, with the first snippet. */
export function keywordMatches(
  text: string,
  categories: KeywordCategory[],
): { category: string; hits: number; snippet: string }[] {
  const haystack = text.toLowerCase();

  return categories
    .map((category) => {
      // The category name is itself a term, so a category with no configured
      // keywords still does something sensible rather than nothing.
      const terms = [...new Set([category.name, ...category.keywords]
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 3))];

      let hits = 0;
      let snippet = "";
      for (const term of terms) {
        const index = haystack.indexOf(term);
        if (index < 0) continue;
        hits += 1;
        if (!snippet) snippet = snippetAround(text, index, term.length);
      }
      return { category: category.name, hits, snippet };
    })
    .filter((match) => match.hits > 0);
}

/* ---------------------------------------------------------------- hiring */

const HIRING_PAGE = /\b(we['’]?re hiring|we are hiring|join (our|the) team|open (roles|positions|vacancies)|current (vacancies|openings)|careers|apply now)\b/i;

/**
 * Roles the plan asked about, named on a careers or jobs page.
 *
 * A role counts only on a page that reads as a hiring page, so "our Head of
 * Marketing, Sam" on an About page is not mistaken for a vacancy. Returns one
 * entry per distinct role found, each with its own snippet.
 */
export function hiringRoleMatches(
  text: string,
  roles: string[],
): { role: string; snippet: string }[] {
  if (!HIRING_PAGE.test(text)) return [];
  const haystack = text.toLowerCase();
  const found: { role: string; snippet: string }[] = [];

  for (const role of new Set(roles.map((r) => r.trim()).filter((r) => r.length >= 3))) {
    const index = haystack.indexOf(role.toLowerCase());
    if (index < 0) continue;
    found.push({ role, snippet: snippetAround(text, index, role.length) });
  }
  return found;
}

/* ------------------------------------------------------------ technology */

/**
 * Technologies a B2B seller commonly targets, fingerprinted from markup the
 * site itself serves: script hosts, asset paths and generator tags. Each
 * pattern is a string the vendor's own embed puts on the page, so a match is
 * evidence of use rather than of a mention in a blog post.
 */
export const TECH_FINGERPRINTS = [
  { key: "SHOPIFY", label: "Shopify", patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/] },
  { key: "WOOCOMMERCE", label: "WooCommerce", patterns: [/\/plugins\/woocommerce\//i, /woocommerce-(?:page|no-js)/i] },
  { key: "WORDPRESS", label: "WordPress", patterns: [/\/wp-content\//i, /\/wp-includes\//i, /<meta[^>]+generator[^>]+WordPress/i] },
  { key: "WEBFLOW", label: "Webflow", patterns: [/data-wf-page=/i, /assets\.website-files\.com/i, /<meta[^>]+generator[^>]+Webflow/i] },
  { key: "SQUARESPACE", label: "Squarespace", patterns: [/static1\.squarespace\.com/i] },
  { key: "WIX", label: "Wix", patterns: [/static\.wixstatic\.com/i, /<meta[^>]+generator[^>]+Wix\.com/i] },
  { key: "MAGENTO", label: "Magento / Adobe Commerce", patterns: [/Magento_[A-Z][A-Za-z]+\//, /mage\/cookies/i] },
  { key: "BIGCOMMERCE", label: "BigCommerce", patterns: [/cdn\d*\.bigcommerce\.com/i] },
  { key: "HUBSPOT", label: "HubSpot", patterns: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i, /js\.hs-analytics\.net/i] },
  { key: "SALESFORCE", label: "Salesforce (Pardot / Account Engagement)", patterns: [/pi\.pardot\.com/i, /go\.pardot\.com/i, /service\.force\.com/i] },
  { key: "INTERCOM", label: "Intercom", patterns: [/widget\.intercom\.io/i, /js\.intercomcdn\.com/i] },
  { key: "DRIFT", label: "Drift", patterns: [/js\.driftt\.com/i] },
  { key: "ZENDESK", label: "Zendesk", patterns: [/static\.zdassets\.com/i] },
  { key: "STRIPE", label: "Stripe", patterns: [/js\.stripe\.com/i] },
  { key: "KLAVIYO", label: "Klaviyo", patterns: [/static\.klaviyo\.com/i] },
  { key: "MAILCHIMP", label: "Mailchimp", patterns: [/chimpstatic\.com/i, /list-manage\.com/i] },
  { key: "CALENDLY", label: "Calendly", patterns: [/assets\.calendly\.com/i] },
  { key: "SEGMENT", label: "Segment", patterns: [/cdn\.segment\.com/i] },
] as const satisfies readonly { key: string; label: string; patterns: readonly RegExp[] }[];

export type TechnologyKey = (typeof TECH_FINGERPRINTS)[number]["key"];
export const TECHNOLOGY_KEYS = TECH_FINGERPRINTS.map((entry) => entry.key) as unknown as readonly [
  TechnologyKey,
  ...TechnologyKey[],
];
export const TECHNOLOGY_LABELS: Record<TechnologyKey, string> = Object.fromEntries(
  TECH_FINGERPRINTS.map((entry) => [entry.key, entry.label]),
) as Record<TechnologyKey, string>;

/** Technologies found in raw HTML (not stripped text: the markers are in tags). */
export function detectTechnologies(html: string): { key: TechnologyKey; label: string; marker: string }[] {
  const found: { key: TechnologyKey; label: string; marker: string }[] = [];
  for (const entry of TECH_FINGERPRINTS) {
    for (const pattern of entry.patterns) {
      const match = html.match(pattern);
      if (match) {
        found.push({ key: entry.key, label: entry.label, marker: truncateSnippet(match[0], 80) });
        break;
      }
    }
  }
  return found;
}
