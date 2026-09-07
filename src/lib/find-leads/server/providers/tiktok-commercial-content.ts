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
 * TikTok Commercial Content Library: advertisers running paid content.
 *
 * TikTok's answer to the Ad Library, published to meet the EU Digital Services
 * Act. It is a documented public API covering advertisers targeting the EEA and
 * the UK, and querying it is exactly what it is published for — no scraping, no
 * login-walled data, and no personal data of any kind. Like the Meta adapter it
 * returns *advertisers*, never people.
 *
 * Its value for this product is the same signal Meta gives: a business paying
 * for reach has budget and is trying to grow. Its weakness is coverage —
 * TikTok advertisers skew consumer-facing, so it will find a roofing firm
 * marketing to homeowners far more reliably than a commercial property manager.
 * The waterfall handles that by ranking it after the general sources rather
 * than by pretending the coverage is even.
 */

type CommercialContentResponse = {
  data?: {
    videos?: {
      id?: string;
      advertiser_business_ids?: string[];
      advertiser_name?: string;
      first_shown_date?: string;
      audience_countries?: string[];
    }[];
    search_id?: string;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string };
};

function token(): string | undefined {
  return serverEnv.sourcing.tiktokCommercialToken;
}

function countryFor(window: SearchWindow): string {
  const country = window.plan.locations[0]?.country?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : "GB";
}

async function searchCompanies(
  window: SearchWindow,
): Promise<ProviderResponse<CompanyCandidate>> {
  const accessToken = token();
  if (!accessToken) return unconfigured<CompanyCandidate>();

  const terms = window.plan.industries.filter(Boolean);
  if (terms.length === 0) {
    // An unbounded query returns every advertiser in the country, which the run
    // would then pay to enrich. Refusing is the cheaper answer.
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const response = await providerJson<CommercialContentResponse>({
    url: "https://business-api.tiktok.com/open_api/v1.3/research/adlib/ad/query/",
    method: "POST",
    headers: { "access-token": accessToken },
    body: {
      filters: {
        advertiser_business_ids: [],
        ad_published_date_range: {},
        country_code: countryFor(window),
        ad_format: "ALL",
        keyword: terms.slice(0, 3).join(" "),
      },
      max_count: Math.min(Math.max(window.limit, 1), 50),
      search_id: window.cursor ?? undefined,
    },
  });

  if (!response.ok) {
    return providerFailure<CompanyCandidate>(response.code, response.latencyMs);
  }

  // TikTok returns HTTP 200 with an error body, so the payload has to be
  // checked as well as the status — otherwise a rejected query looks like a
  // successful empty result and the run reports "no matches" for what was
  // actually an auth failure.
  if (response.data.error?.code && response.data.error.code !== "0") {
    return providerFailure<CompanyCandidate>("PROVIDER_BAD_RESPONSE", response.latencyMs);
  }

  const byAdvertiser = new Map<string, CompanyCandidate>();

  for (const video of response.data.data?.videos ?? []) {
    const name = video.advertiser_name?.trim();
    const id = video.advertiser_business_ids?.[0]?.trim() ?? name;
    if (!name || !id || byAdvertiser.has(id)) continue;

    byAdvertiser.set(id, {
      externalId: `tiktok_advertiser:${id}`,
      name,
      // No website is published, and guessing one from a display name would
      // poison dedupe. Domain resolution is a later stage's job.
      domain: null,
      websiteUrl: null,
      industry: null,
      employeeCount: null,
      companySize: null,
      description: null,
      location: {
        country: video.audience_countries?.[0] ?? countryFor(window),
        region: null,
        city: null,
        postcode: null,
        lat: null,
        lon: null,
      },
    });
  }

  return {
    ok: true,
    records: [...byAdvertiser.values()],
    costMinor: 0,
    cursor: response.data.data?.has_more ? (response.data.data.search_id ?? null) : null,
    latencyMs: response.latencyMs,
    errorCode: null,
  };
}

export const tiktokCommercialContentProvider: SourcingProvider = {
  key: "tiktok_commercial_content",
  displayName: "TikTok Commercial Content Library",
  capabilities: ["COMPANY_SEARCH"],
  costRank: 2,
  // Published under the DSA and not metered, so a run is not charged for it.
  freeOfCharge: true,
  configured: () => Boolean(token()),
  searchCompanies,
};
