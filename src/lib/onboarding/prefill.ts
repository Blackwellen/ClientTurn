/**
 * Prefilling onboarding from the customer's own website (Phase 8.29).
 *
 * The owner types one address; we read their home page once and fill in what
 * it says plainly: the site's name (offered as a hint for the workspace name,
 * never filled in for them), an industry, a phone number and a short
 * description. Their own site, about themselves, read with their consent, so
 * nothing here is a third-party enrichment.
 *
 * Deterministic on purpose, like the website analysis worker: a keyword that
 * is on the page, not a model's guess. Whatever this finds is a suggestion the
 * owner can change before anything is saved.
 *
 * Pure: no imports, no network. The server action fetches (SSRF-safe) and
 * passes the HTML in.
 */

export type SitePrefill = {
  /** The site's own name, from og:site_name or the title. */
  siteName: string | null;
  description: string | null;
  /** One of the onboarding industry labels, or null when nothing matched clearly. */
  industry: string | null;
  phone: string | null;
};

/** Accepts "acme.co.uk", "www.acme.co.uk/about" or a full URL; returns an https origin URL, or null. */
export function normaliseWebsite(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 300) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
    return `${url.protocol}//${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&#8211;": "–",
  "&#8212;": "—",
  "&#038;": "&",
  "&lt;": "<",
  "&gt;": ">",
};

function decode(value: string): string {
  return value
    .replace(/&[a-z0-9#]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, key: string): string | null {
  // Attribute order varies between sites: property/name before or after content.
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]?.trim()) return decode(match[1]);
  }
  return null;
}

const GENERIC_TITLE = /^(home|homepage|home page|welcome|index|official site|official website)$/i;

/**
 * The business's name from a page title such as "Home | Acme Digital" or
 * "Acme Digital – Web design in Leeds": the segment that is not generic, and
 * the shortest when more than one is left (the tagline is the longer one).
 */
export function nameFromTitle(title: string): string | null {
  const parts = decode(title)
    .split(/\s[|–—:·•-]\s|\s[|–—·•]|[|–—·•]\s/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !GENERIC_TITLE.test(part));
  if (parts.length === 0) return null;
  const best = parts.length === 1 ? parts[0] : [...parts].sort((a, b) => a.length - b.length)[0];
  return best.length <= 80 ? best : null;
}

/**
 * Industry keywords, most specific first within each entry. Scored by how
 * many distinct phrases appear, so one passing mention does not outvote a
 * page that is plainly about something else. Labels match `INDUSTRY_OPTIONS`
 * in `src/lib/settings/types.ts` (a test checks every one).
 */
export const INDUSTRY_KEYWORDS: readonly [string, readonly string[]][] = [
  ["SEO agency", ["seo agency", "search engine optimisation", "search engine optimization", "technical seo", "link building", "local seo"]],
  ["Advertising / paid media agency", ["ppc agency", "paid media", "paid social", "google ads", "meta ads", "pay per click"]],
  ["Marketing agency", ["marketing agency", "digital marketing", "content marketing", "social media marketing", "email marketing", "growth marketing"]],
  ["Web / design studio", ["web design", "website design", "web development", "design studio", "branding agency", "ux design", "website build"]],
  ["Product-led SaaS", ["start for free", "free plan", "sign up free", "no credit card required"]],
  ["Enterprise software", ["enterprise software", "enterprise platform", "request a demo", "proof of concept", "on-premise"]],
  ["B2B SaaS", ["saas", "software platform", "book a demo", "free trial", "api integration", "integrations"]],
  ["Subscription ecommerce", ["subscription box", "monthly subscription", "subscribe and save", "subscribe & save"]],
  ["Ecommerce brand", ["add to basket", "add to cart", "shop now", "free delivery", "free uk delivery", "checkout"]],
  ["Managed IT services (MSP)", ["managed it", "it support", "managed service provider", "helpdesk", "microsoft 365"]],
  ["Cybersecurity", ["cyber security", "cybersecurity", "penetration testing", "cyber essentials", "security operations"]],
  ["IT consultancy", ["it consultancy", "it consulting", "digital transformation", "systems integration"]],
  ["Accountancy practice", ["chartered accountants", "accountancy", "accountants", "tax returns", "corporation tax", "year end accounts"]],
  ["Bookkeeping", ["bookkeeping", "bookkeeper", "xero", "quickbooks"]],
  ["Law firm", ["solicitors", "law firm", "legal services", "sra regulated", "employment law", "conveyancing"]],
  ["Recruitment agency", ["recruitment agency", "recruitment", "recruiters", "executive search", "talent acquisition", "vacancies"]],
  ["Management consultancy", ["management consultancy", "management consulting", "strategy consulting", "operational improvement", "consultancy"]],
];

export function guessIndustry(text: string): string | null {
  const corpus = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  let best: { label: string; score: number } | null = null;
  for (const [label, phrases] of INDUSTRY_KEYWORDS) {
    const score = phrases.filter((phrase) => corpus.includes(phrase)).length;
    // Strictly greater: on a tie the earlier, more specific entry wins.
    if (score > 0 && (!best || score > best.score)) best = { label, score };
  }
  return best?.label ?? null;
}

/** A UK number the business publishes: a tel: link first, then the page text. */
export function findPhone(html: string, text: string): string | null {
  const tel = html.match(/href=["']tel:([+0-9 ()-]{7,20})["']/i);
  const candidate = tel?.[1] ?? text.match(/(?:\+44\s?\(0\)\s?|\+44\s?|\b0)\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/)?.[0] ?? null;
  if (!candidate) return null;
  const digits = candidate.replace(/[^0-9+]/g, "");
  return digits.length >= 10 && digits.length <= 14 ? candidate.trim().slice(0, 30) : null;
}

/** Tags, scripts and styles out; readable text in. */
export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).slice(0, 40_000);
}

export function extractSitePrefill(html: string): SitePrefill {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const siteName = metaContent(html, "og:site_name") ?? nameFromTitle(title);
  const description = metaContent(html, "description") ?? metaContent(html, "og:description");
  const text = htmlToText(html);
  return {
    siteName: siteName && siteName.length >= 2 ? siteName.slice(0, 80) : null,
    description: description ? description.slice(0, 300) : null,
    industry: guessIndustry(`${title} ${description ?? ""} ${text}`),
    phone: findPhone(html, text),
  };
}
