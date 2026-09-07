import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import {
  providerFailure,
  type CompanyCandidate,
  type ProviderResponse,
  type SearchWindow,
  type SourcingProvider,
} from "./types";

/**
 * Meta Ad Library: businesses that are currently advertising.
 *
 * A genuine outbound source, and a good one for this product. A company running
 * ads in your area has a marketing budget, is actively trying to grow, and can
 * be found through a **public, documented API with terms that permit exactly
 * this use** — no scraping and no login-walled data.
 *
 * What it returns is an *advertiser*: a page name, a page id, and where the ad
 * ran. It returns no personal data at all — no names, no emails, no phone
 * numbers. That is the correct division of labour here: this adapter finds the
 * company, and the licensed contact providers later in the waterfall find a
 * person at it. Meta is never asked for a human being.
 *
 * Cost rank 1: free to call and pre-filters well, so it runs early, but after
 * Google Places which resolves geography properly.
 *
 * Coverage caveat worth knowing: outside the EU the Ad Library only indexes ads
 * about social issues, elections and politics. For UK and EU advertisers the
 * `ALL` category is available, which is what makes this useful here.
 */

type AdLibraryResponse = {
  data?: {
    id?: string;
    page_id?: string;
    page_name?: string;
    ad_delivery_start_time?: string;
    ad_snapshot_url?: string;
    delivery_by_region?: { region?: string }[];
    publisher_platforms?: string[];
  }[];
  paging?: { cursors?: { after?: string } };
};

function token(): string | undefined {
  return serverEnv.sourcing.metaAdLibraryToken;
}

/**
 * ISO-3166-2 country code for the search.
 *
 * The Ad Library is queried by country, not by radius, so a town-level plan is
 * widened to its country and the geographic narrowing happens later in the
 * pipeline against the company's resolved address. Pretending we can filter to
 * a 40-mile radius here would silently return the wrong set.
 */
function countryFor(window: SearchWindow): string {
  const location = window.plan.locations[0];
  const country = location?.country?.trim().toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country)) return country;
  return "GB";
}

async function searchCompanies(
  window: SearchWindow,
): Promise<ProviderResponse<CompanyCandidate>> {
  const accessToken = token();
  if (!accessToken) return unconfigured<CompanyCandidate>();

  const terms = window.plan.industries.filter(Boolean);
  if (terms.length === 0) {
    // No industry means no search terms, and an unbounded Ad Library query
    // returns every advertiser in the country. Refusing is better than
    // returning noise the run then pays to enrich.
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const params = new URLSearchParams({
    access_token: accessToken,
    search_terms: terms.slice(0, 3).join(" "),
    ad_reached_countries: JSON.stringify([countryFor(window)]),
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields: "id,page_id,page_name,ad_delivery_start_time,delivery_by_region,publisher_platforms",
    limit: String(Math.min(Math.max(window.limit, 1), 100)),
  });
  if (window.cursor) params.set("after", window.cursor);

  const response = await providerJson<AdLibraryResponse>({
    url: `https://graph.facebook.com/v21.0/ads_archive?${params.toString()}`,
  });

  if (!response.ok) {
    return providerFailure<CompanyCandidate>(response.code, response.latencyMs);
  }

  // One advertiser may be running many ads. The unit of interest is the
  // business, so ads collapse by page id — otherwise a company with 40 live
  // creatives would fill the whole batch on its own.
  const byPage = new Map<string, CompanyCandidate>();

  for (const ad of response.data.data ?? []) {
    const pageId = ad.page_id?.trim();
    const name = ad.page_name?.trim();
    if (!pageId || !name || byPage.has(pageId)) continue;

    byPage.set(pageId, {
      externalId: `meta_page:${pageId}`,
      name,
      // The Ad Library gives no website. Domain resolution is a later stage's
      // job, and inventing one from the page name would poison dedupe.
      domain: null,
      websiteUrl: null,
      industry: null,
      employeeCount: null,
      companySize: null,
      description: null,
      location: {
        country: countryFor(window),
        region: ad.delivery_by_region?.[0]?.region ?? null,
        city: null,
        postcode: null,
        lat: null,
        lon: null,
      },
    });
  }

  return {
    ok: true,
    records: [...byPage.values()],
    costMinor: 0,
    cursor: response.data.paging?.cursors?.after ?? null,
    latencyMs: response.latencyMs,
    errorCode: null,
  };
}

export const metaAdLibraryProvider: SourcingProvider = {
  key: "meta_ad_library",
  displayName: "Meta Ad Library",
  capabilities: ["COMPANY_SEARCH"],
  costRank: 1,
  // Meta does not meter the Ad Library, so a run is not charged for it. The
  // router would otherwise bill the price book for calls nobody invoiced us for.
  freeOfCharge: true,
  configured: () => Boolean(token()),
  searchCompanies,
};
