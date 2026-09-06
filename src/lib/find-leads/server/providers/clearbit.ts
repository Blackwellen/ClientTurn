import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import {
  providerFailure,
  type CompanyCandidate,
  type ProviderResponse,
  type SourcingProvider,
} from "./types";

/**
 * Clearbit: company enrichment.
 *
 * The most expensive step in the waterfall, which is precisely why stage 6
 * ("Enriching high-fit records") sits after stage 5 ("Cheap pre-filtering").
 * Only candidates that already cleared the fit gate reach this adapter.
 */

type ClearbitCompany = {
  name?: string;
  domain?: string;
  category?: { industry?: string; sector?: string };
  metrics?: { employees?: number; employeesRange?: string };
  description?: string;
  geo?: {
    country?: string;
    state?: string;
    city?: string;
    postalCode?: string;
    lat?: number;
    lng?: number;
  };
};

function key(): string | undefined {
  return serverEnv.sourcing.clearbitApiKey;
}

async function enrichCompanies(input: {
  companies: CompanyCandidate[];
}): Promise<ProviderResponse<CompanyCandidate>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<CompanyCandidate>();

  const records: CompanyCandidate[] = [];
  let latencyMs = 0;

  for (const company of input.companies) {
    if (!company.domain) continue;

    const result = await providerJson<ClearbitCompany>({
      url: `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(company.domain)}`,
      headers: { authorization: `Bearer ${apiKey}` },
    });

    latencyMs += result.latencyMs;

    if (!result.ok) {
      // A 404 from Clearbit means "no data for this domain", which the HTTP
      // helper reports as BAD_RESPONSE. That is a normal outcome for a small
      // UK trade business, not a provider failure — keep the original record.
      if (result.code === "PROVIDER_BAD_RESPONSE") {
        records.push(company);
        continue;
      }
      if (records.length === 0) return providerFailure<CompanyCandidate>(result.code, latencyMs);
      break;
    }

    const data = result.data;
    // Enrichment fills gaps; it never overwrites a value discovery already
    // established, so provenance stays meaningful.
    records.push({
      ...company,
      name: company.name || (data.name ?? company.name),
      industry: company.industry ?? data.category?.industry ?? null,
      employeeCount: company.employeeCount ?? data.metrics?.employees ?? null,
      companySize: company.companySize ?? data.metrics?.employeesRange ?? null,
      description: company.description ?? data.description ?? null,
      location: {
        country: company.location.country ?? data.geo?.country ?? null,
        region: company.location.region ?? data.geo?.state ?? null,
        city: company.location.city ?? data.geo?.city ?? null,
        postcode: company.location.postcode ?? data.geo?.postalCode ?? null,
        lat: company.location.lat ?? data.geo?.lat ?? null,
        lon: company.location.lon ?? data.geo?.lng ?? null,
      },
    });
  }

  return { ok: true, records, costMinor: 0, cursor: null, latencyMs, errorCode: null };
}

export const clearbitProvider: SourcingProvider = {
  key: "clearbit",
  displayName: "Clearbit",
  capabilities: ["COMPANY_ENRICHMENT"],
  costRank: 3,
  configured: () => Boolean(key()),
  enrichCompanies,
};
