/**
 * Contracts Finder: the UK government's free register of public-sector
 * tenders (contractsfinder.service.gov.uk), read through its OCDS search API.
 * No key, no cost, Open Government Licence.
 *
 *   GET /Published/Notices/OCDS/Search?publishedFrom=&publishedTo=&stages=tender&limit=100
 *   Pagination: `links.next` (a URL carrying `cursor`).
 *   Rate limit: HTTP 403 (and, defensively, 429) means "too many requests";
 *   the documented rule is no further request for 5 minutes.
 *
 * What it feeds: the catalogue's TENDER_PUBLISHED type, as an
 * ORGANISATION-level signal. A tender is evidence about the buying
 * organisation (a council, an NHS trust, a university), with its deadline;
 * it is matched to a company by the buyer's own web domain (the domain of its
 * published contact address or website), and only tenders whose title,
 * description or CPV classification mention one of the workspace's own
 * services or category keywords count.
 *
 * Personal data: a notice's contact point names a person. Only the DOMAIN of
 * the contact e-mail is read (to identify the organisation); the name, the
 * mailbox and the telephone number are never kept or shown.
 *
 * Pure: the HTTP call is an injected `fetch`, so tests run on recorded
 * responses (tests/fixtures/contracts-finder) and never reach the network.
 */

import { truncateSnippet, type IntentEvidence } from "./intent-evidence.ts";
import { strengthCap } from "./intent-catalogue.ts";

export const CONTRACTS_FINDER_BASE = "https://www.contractsfinder.service.gov.uk";
export const CONTRACTS_FINDER_SEARCH_PATH = "/Published/Notices/OCDS/Search";
export const CONTRACTS_FINDER_SOURCE = "Contracts Finder";

/** The documented back-off after a rate-limit response. */
export const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
/** Our own spacing between requests, well inside the service's limits. */
export const MIN_REQUEST_INTERVAL_MS = 1_000;
/** Pages read per search at most (100 notices each). */
export const MAX_PAGES = 5;
/** How far back a search looks, at most. */
export const MAX_LOOKBACK_DAYS = 30;

/* ------------------------------------------------------------- the shape */

type OcdsParty = {
  id?: string;
  name?: string;
  roles?: string[];
  contactPoint?: { email?: string; url?: string };
  details?: { url?: string };
  address?: { postalCode?: string; locality?: string };
};

type OcdsRelease = {
  ocid?: string;
  id?: string;
  date?: string;
  buyer?: { id?: string; name?: string };
  parties?: OcdsParty[];
  tender?: {
    id?: string;
    title?: string;
    description?: string;
    datePublished?: string;
    status?: string;
    classification?: { scheme?: string; id?: string; description?: string };
    additionalClassifications?: { id?: string; description?: string }[];
    value?: { amount?: number; currency?: string };
    tenderPeriod?: { endDate?: string };
  };
};

export type OcdsPackage = { releases?: OcdsRelease[]; links?: { next?: string } };

export type TenderNotice = {
  noticeId: string;
  title: string;
  description: string;
  buyerName: string;
  /** The buyer's own web domain, from its website or contact e-mail. Null when neither is published. */
  buyerDomain: string | null;
  buyerPostcode: string | null;
  deadline: string | null;
  publishedAt: string;
  value: { amount: number; currency: string } | null;
  cpv: string[];
  url: string;
};

/** A host reduced to the organisation's domain: lower-case, no scheme, no www. */
export function domainOf(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const host = raw.includes("@") ? raw.split("@").pop()! : raw.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0];
  const clean = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean) ? clean : null;
}

export function noticeUrl(release: OcdsRelease): string {
  const id = (release.id ?? "").split("-").slice(0, 5).join("-");
  return /^[0-9a-f-]{36}$/.test(id) ? `${CONTRACTS_FINDER_BASE}/Notice/${id}` : CONTRACTS_FINDER_BASE;
}

export function parseReleases(pkg: OcdsPackage): TenderNotice[] {
  const out: TenderNotice[] = [];
  for (const release of pkg.releases ?? []) {
    const tender = release.tender;
    if (!tender?.title) continue;
    const buyerParty =
      (release.parties ?? []).find((p) => p.roles?.includes("buyer") && (!release.buyer?.id || p.id === release.buyer.id)) ??
      (release.parties ?? []).find((p) => p.roles?.includes("buyer"));
    const buyerName = release.buyer?.name ?? buyerParty?.name;
    if (!buyerName) continue;
    const publishedAt = tender.datePublished ?? release.date;
    if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) continue;
    const cpv = [tender.classification, ...(tender.additionalClassifications ?? [])]
      .map((c) => c?.description?.trim())
      .filter((c): c is string => Boolean(c));
    out.push({
      noticeId: release.id ?? release.ocid ?? tender.id ?? tender.title,
      title: tender.title.trim(),
      description: (tender.description ?? "").trim(),
      buyerName: buyerName.trim(),
      buyerDomain: domainOf(buyerParty?.details?.url) ?? domainOf(buyerParty?.contactPoint?.url) ?? domainOf(buyerParty?.contactPoint?.email),
      buyerPostcode: buyerParty?.address?.postalCode ?? null,
      deadline: tender.tenderPeriod?.endDate ?? null,
      publishedAt,
      value: typeof tender.value?.amount === "number" ? { amount: tender.value.amount, currency: tender.value.currency ?? "GBP" } : null,
      cpv,
      url: noticeUrl(release),
    });
  }
  return out;
}

/* ------------------------------------------------------------ matching */

function phrase(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * The first of the workspace's keywords the notice mentions, as a whole
 * phrase, in its title, description or CPV descriptions. With no keywords
 * configured nothing matches: a tender is only evidence of a need the
 * workspace sells to.
 */
export function matchedKeyword(notice: TenderNotice, keywords: readonly string[]): string | null {
  const haystack = phrase([notice.title, notice.description, ...notice.cpv].join(" "));
  for (const keyword of keywords) {
    const needle = phrase(keyword);
    if (needle.trim().length >= 3 && haystack.includes(needle)) return keyword.trim();
  }
  return null;
}

/** True while the notice is still open to bids (no deadline counts as open). */
export function isOpen(notice: TenderNotice, now: Date): boolean {
  return !notice.deadline || Date.parse(notice.deadline) > now.getTime();
}

export type TenderSignal = {
  category: null;
  domain: string;
  observedAt: string;
  strength: number;
  sourceUrl: string;
  evidence: IntentEvidence;
  buyer: { name: string; domain: string; postcode: string | null };
  deadline: string | null;
};

export function tenderSnippet(notice: TenderNotice, keyword: string): string {
  const closes = notice.deadline ? `, closes ${notice.deadline.slice(0, 10)}` : "";
  return truncateSnippet(`${notice.buyerName} published a tender: "${notice.title}"${closes} (matched "${keyword}")`);
}

/**
 * The TENDER_PUBLISHED signals for the companies asked about: an open notice
 * from a buyer whose domain is one of `domains`, mentioning a workspace
 * keyword. One per (buyer, notice).
 */
export function tenderSignals(input: {
  notices: readonly TenderNotice[];
  domains: readonly string[];
  keywords: readonly string[];
  now: Date;
}): TenderSignal[] {
  const wanted = new Set(input.domains.map((d) => domainOf(d)).filter((d): d is string => Boolean(d)));
  const out: TenderSignal[] = [];
  const seen = new Set<string>();
  for (const notice of input.notices) {
    if (!notice.buyerDomain || !wanted.has(notice.buyerDomain) || !isOpen(notice, input.now)) continue;
    const keyword = matchedKeyword(notice, input.keywords);
    if (!keyword) continue;
    const key = `${notice.buyerDomain}|${notice.noticeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      category: null,
      domain: notice.buyerDomain,
      observedAt: new Date(Date.parse(notice.publishedAt)).toISOString(),
      strength: strengthCap("TENDER_PUBLISHED", 0.85),
      sourceUrl: notice.url,
      evidence: {
        kind: "TRIGGER_EVENT",
        source: CONTRACTS_FINDER_SOURCE,
        reference: notice.url,
        observedAt: new Date(Date.parse(notice.publishedAt)).toISOString(),
        snippet: tenderSnippet(notice, keyword),
        intentType: "TENDER_PUBLISHED",
      },
      buyer: { name: notice.buyerName, domain: notice.buyerDomain, postcode: notice.buyerPostcode },
      deadline: notice.deadline,
    });
  }
  return out;
}

/* ------------------------------------------------------------- the client */

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type SearchOutcome =
  | { ok: true; notices: TenderNotice[]; pages: number; truncated: boolean }
  | { ok: false; code: "PROVIDER_RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_BAD_RESPONSE" | "PROVIDER_TIMEOUT"; notices: TenderNotice[] };

export function searchUrl(publishedFrom: Date, publishedTo: Date, limit = 100): string {
  const params = new URLSearchParams({
    publishedFrom: publishedFrom.toISOString().slice(0, 19) + "Z",
    publishedTo: publishedTo.toISOString().slice(0, 19) + "Z",
    stages: "tender",
    limit: String(limit),
  });
  return `${CONTRACTS_FINDER_BASE}${CONTRACTS_FINDER_SEARCH_PATH}?${params.toString()}`;
}

/**
 * A rate-respecting client. One instance per process holds the cooldown and
 * the request spacing, so every workspace's searches share the budget.
 */
export function createContractsFinderClient(deps: {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  userAgent?: string;
  timeoutMs?: number;
}) {
  let blockedUntil = 0;
  let lastRequestAt = 0;

  async function get(url: string): Promise<{ ok: true; body: OcdsPackage } | { ok: false; code: Exclude<SearchOutcome, { ok: true }>["code"] }> {
    if (deps.now() < blockedUntil) return { ok: false, code: "PROVIDER_RATE_LIMIT" };
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - deps.now();
    if (wait > 0) await deps.sleep(wait);
    lastRequestAt = deps.now();
    // Only ever the service's own host: a `links.next` pointing elsewhere is not followed.
    if (!url.startsWith(`${CONTRACTS_FINDER_BASE}/`)) return { ok: false, code: "PROVIDER_BAD_RESPONSE" };
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 20_000);
      try {
        response = await deps.fetch(url, {
          headers: { accept: "application/json", "user-agent": deps.userAgent ?? "ClientTurn (+https://clientturn.com)" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return { ok: false, code: error instanceof Error && error.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE" };
    }
    if (response.status === 403 || response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      blockedUntil = deps.now() + Math.max(RATE_LIMIT_COOLDOWN_MS, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
      return { ok: false, code: "PROVIDER_RATE_LIMIT" };
    }
    if (response.status >= 500) return { ok: false, code: "PROVIDER_UNAVAILABLE" };
    if (response.status !== 200) return { ok: false, code: "PROVIDER_BAD_RESPONSE" };
    try {
      return { ok: true, body: (await response.json()) as OcdsPackage };
    } catch {
      return { ok: false, code: "PROVIDER_BAD_RESPONSE" };
    }
  }

  return {
    /** Tenders published in [from, to], following `links.next` up to MAX_PAGES. */
    async search(from: Date, to: Date, maxPages = MAX_PAGES): Promise<SearchOutcome> {
      const notices: TenderNotice[] = [];
      let url: string | undefined = searchUrl(from, to);
      let pages = 0;
      while (url && pages < maxPages) {
        const page = await get(url);
        if (!page.ok) {
          // Keep what earlier pages found; the caller decides whether a partial read is usable.
          return pages === 0 ? { ok: false, code: page.code, notices } : { ok: true, notices, pages, truncated: true };
        }
        pages += 1;
        notices.push(...parseReleases(page.body));
        url = page.body.links?.next;
      }
      return { ok: true, notices, pages, truncated: Boolean(url) };
    },
    blockedUntil: () => blockedUntil,
  };
}

/** The search window for a freshness setting: at most MAX_LOOKBACK_DAYS back. */
export function lookbackWindow(now: Date, freshnessDays: number): { from: Date; to: Date } {
  const days = Math.max(1, Math.min(MAX_LOOKBACK_DAYS, Math.floor(freshnessDays || MAX_LOOKBACK_DAYS)));
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}
