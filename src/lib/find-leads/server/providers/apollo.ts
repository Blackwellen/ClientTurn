import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import {
  providerFailure,
  type CompanyCandidate,
  type ContactCandidate,
  type ProviderResponse,
  type SearchWindow,
  type SourcingProvider,
} from "./types";

/**
 * Apollo: company discovery and contact discovery.
 *
 * Cost rank 2 for company search — it is not the cheapest way to find a
 * company, but it is the only one here that also resolves decision-makers, so
 * the waterfall reaches for Places first and Apollo second.
 */

type ApolloOrg = {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  short_description?: string;
  country?: string;
  state?: string;
  city?: string;
  postal_code?: string;
};

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  organization?: { id?: string; primary_domain?: string };
};

function key(): string | undefined {
  return serverEnv.sourcing.apolloApiKey;
}

function toCompany(org: ApolloOrg): CompanyCandidate {
  return {
    externalId: org.id ?? null,
    name: org.name ?? "Unknown company",
    domain: org.primary_domain ?? null,
    websiteUrl: org.website_url ?? null,
    industry: org.industry ?? null,
    employeeCount: org.estimated_num_employees ?? null,
    companySize: null,
    description: org.short_description ?? null,
    location: {
      country: org.country ?? null,
      region: org.state ?? null,
      city: org.city ?? null,
      postcode: org.postal_code ?? null,
      lat: null,
      lon: null,
    },
  };
}

/**
 * Apollo pages from 1. The cursor is the page number as a string so the run
 * checkpoint stays a plain scalar and a resumed run continues where it stopped.
 */
function pageFrom(cursor: string | null): number {
  const page = cursor ? Number.parseInt(cursor, 10) : 1;
  return Number.isFinite(page) && page > 0 ? page : 1;
}

async function searchCompanies(
  window: SearchWindow,
): Promise<ProviderResponse<CompanyCandidate>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<CompanyCandidate>();

  const { plan, limit } = window;
  const page = pageFrom(window.cursor);
  const location = plan.locations[0];

  const result = await providerJson<{ organizations?: ApolloOrg[]; pagination?: { total_pages?: number } }>({
    url: "https://api.apollo.io/api/v1/mixed_companies/search",
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      page,
      per_page: Math.min(100, limit),
      q_organization_keyword_tags: plan.industries,
      organization_locations: location
        ? [[location.city, location.region, location.country].filter(Boolean).join(", ")]
        : undefined,
      organization_num_employees_ranges: employeeRanges(plan),
    },
  });

  if (!result.ok) return providerFailure<CompanyCandidate>(result.code, result.latencyMs);

  const records = (result.data.organizations ?? []).map(toCompany);
  const totalPages = result.data.pagination?.total_pages ?? page;

  return {
    ok: true,
    records,
    // Apollo bills per credit consumed rather than reporting a price on the
    // response, so the run reconciles against the price book instead of a
    // figure the provider did not send.
    costMinor: 0,
    cursor: page < totalPages && records.length > 0 ? String(page + 1) : null,
    latencyMs: result.latencyMs,
    errorCode: null,
  };
}

function employeeRanges(plan: SearchWindow["plan"]): string[] | undefined {
  const { minEmployees: min, maxEmployees: max } = plan.company;
  if (min === null && max === null) return undefined;
  return [`${min ?? 1},${max ?? 100000}`];
}

async function findContacts(input: {
  companies: CompanyCandidate[];
  roles: string[];
  limit: number;
}): Promise<ProviderResponse<ContactCandidate>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<ContactCandidate>();

  const domains = input.companies
    .map((company) => company.domain)
    .filter((domain): domain is string => Boolean(domain));

  if (domains.length === 0) {
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const result = await providerJson<{ people?: ApolloPerson[] }>({
    url: "https://api.apollo.io/api/v1/mixed_people/search",
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: {
      page: 1,
      per_page: Math.min(100, input.limit),
      q_organization_domains: domains.join("\n"),
      person_titles: input.roles,
    },
  });

  if (!result.ok) return providerFailure<ContactCandidate>(result.code, result.latencyMs);

  const records = (result.data.people ?? []).map(
    (person): ContactCandidate => ({
      externalId: person.id ?? null,
      firstName: person.first_name ?? null,
      lastName: person.last_name ?? null,
      roleTitle: person.title ?? null,
      // Apollo returns a masked placeholder unless the email was unlocked.
      // Treating that as an address would poison verification, so it is dropped.
      email:
        person.email && !person.email.includes("email_not_unlocked")
          ? person.email
          : null,
      phone: null,
      linkedinUrl: person.linkedin_url ?? null,
      companyExternalId: person.organization?.id ?? null,
      companyDomain: person.organization?.primary_domain ?? null,
    }),
  );

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs: result.latencyMs,
    errorCode: null,
  };
}

export const apolloProvider: SourcingProvider = {
  key: "apollo",
  displayName: "Apollo",
  capabilities: ["COMPANY_SEARCH", "CONTACT_DISCOVERY"],
  costRank: 2,
  configured: () => Boolean(key()),
  searchCompanies,
  findContacts,
};
