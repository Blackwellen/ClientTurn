import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
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
 * LinkedIn as a sourcing provider.
 *
 * There are two lawful routes and this adapter supports both. Neither is
 * scraping, and the difference between them matters enough to state plainly:
 *
 *   1. **Partner API (SNAP / Sales Insights).** LinkedIn runs a partner
 *      programme; approved applications get server-to-server access with a
 *      contract behind it. When `LINKEDIN_SNAP_ACCESS_TOKEN` is present this
 *      adapter calls it directly. Note what it returns: company and role data,
 *      and a member's public profile URL. **It does not return email addresses**
 *      — LinkedIn does not sell those through any API, and any tool claiming
 *      otherwise is getting them somewhere else.
 *
 *   2. **The customer's own session.** The pattern Clay, Surfe and Evaboot use:
 *      the customer opens a list *they* have access to, in *their* logged-in
 *      account, and exports it. Their browser, their account, their data. What
 *      reaches us is an ingested list, and this adapter reads what was
 *      ingested — it never drives a session and holds no LinkedIn credentials.
 *
 *      **This works on a standard LinkedIn account, not only Sales Navigator.**
 *      Sales Navigator buys better filters, saved lists and higher view limits,
 *      so it produces bigger and better-targeted exports — but an ordinary
 *      account's search results export the same way, and the ingest path treats
 *      both identically. Each row records which surface it came from, so
 *      provenance stays honest about the difference.
 *
 * The email is then found by the licensed waterfall — Apollo, Hunter, Clearbit —
 * matching on the LinkedIn URL this adapter supplies. That is exactly how the
 * category works, and it is why the URL is the valuable field here rather than
 * a contact detail LinkedIn was never going to give us.
 *
 * Cost rank 4: contact-grade data, so it runs late, after the cheap
 * company-level sources have already narrowed the set.
 */

/* ------------------------------------------------------------ partner API */

type SnapAccountSearch = {
  elements?: {
    entityUrn?: string;
    companyName?: string;
    website?: string;
    industry?: string;
    employeeCount?: number;
    location?: string;
  }[];
  paging?: { start?: number; total?: number };
};

type SnapLeadSearch = {
  elements?: {
    entityUrn?: string;
    firstName?: string;
    lastName?: string;
    currentPositions?: { title?: string; companyName?: string }[];
    publicProfileUrl?: string;
  }[];
};

function snapToken(): string | undefined {
  return serverEnv.sourcing.linkedinSnapToken;
}

function hostFrom(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return null;
  }
}

async function searchCompanies(
  window: SearchWindow,
): Promise<ProviderResponse<CompanyCandidate>> {
  const token = snapToken();
  if (!token) return unconfigured<CompanyCandidate>();

  const industries = window.plan.industries.filter(Boolean);
  if (industries.length === 0) {
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const params = new URLSearchParams({
    q: "search",
    keywords: industries.slice(0, 3).join(" "),
    count: String(Math.min(Math.max(window.limit, 1), 50)),
    start: window.cursor ?? "0",
  });

  const response = await providerJson<SnapAccountSearch>({
    url: `https://api.linkedin.com/v2/salesApiAccountSearch?${params.toString()}`,
    headers: {
      authorization: `Bearer ${token}`,
      "linkedin-version": "202401",
      "x-restli-protocol-version": "2.0.0",
    },
  });

  if (!response.ok) {
    return providerFailure<CompanyCandidate>(response.code, response.latencyMs);
  }

  const records: CompanyCandidate[] = [];
  for (const element of response.data.elements ?? []) {
    const name = element.companyName?.trim();
    if (!name) continue;

    records.push({
      externalId: element.entityUrn ?? null,
      name,
      domain: hostFrom(element.website),
      websiteUrl: element.website ?? null,
      industry: element.industry ?? null,
      employeeCount: element.employeeCount ?? null,
      companySize: null,
      description: null,
      location: {
        country: null,
        region: element.location ?? null,
        city: null,
        postcode: null,
        lat: null,
        lon: null,
      },
    });
  }

  const start = Number(window.cursor ?? "0") + records.length;
  const total = response.data.paging?.total ?? 0;

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: start < total ? String(start) : null,
    latencyMs: response.latencyMs,
    errorCode: null,
  };
}

/* ------------------------------------------------- contacts: API, then list */

/**
 * Reads an ingested LinkedIn list for the companies in this batch.
 *
 * Used when there is no partner token, and it does not care whether the export
 * came from Sales Navigator or a standard account — both land in the same
 * table with a `surface` recorded on each row. The rows were put there by the
 * customer exporting their own list, so this is a read of our own table rather
 * than a call to LinkedIn: it costs nothing and cannot fail with an auth error.
 */
async function readIngestedList(
  businessId: string,
  domains: string[],
  limit: number,
): Promise<ContactCandidate[]> {
  if (domains.length === 0) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("prospect_data_sources")
    .select("value_json, company_id, prospect_companies ( domain )")
    .eq("business_id", businessId)
    .eq("provider", "linkedin_sales_navigator")
    .eq("field_name", "linkedin_lead")
    .limit(limit);

  const wanted = new Set(domains.map((domain) => domain.toLowerCase()));
  const records: ContactCandidate[] = [];

  for (const row of data ?? []) {
    const blob = (row.value_json ?? {}) as Record<string, unknown>;
    const company = row.prospect_companies as unknown as { domain: string | null } | null;
    const domain = company?.domain?.toLowerCase() ?? null;
    if (!domain || !wanted.has(domain)) continue;

    const first = typeof blob.firstName === "string" ? blob.firstName : null;
    const last = typeof blob.lastName === "string" ? blob.lastName : null;
    if (!first && !last) continue;

    records.push({
      externalId: typeof blob.entityUrn === "string" ? blob.entityUrn : null,
      firstName: first,
      lastName: last,
      roleTitle: typeof blob.roleTitle === "string" ? blob.roleTitle : null,
      // Never from LinkedIn. The waterfall's licensed providers resolve the
      // address from the profile URL below.
      email: null,
      phone: null,
      linkedinUrl: typeof blob.publicProfileUrl === "string" ? blob.publicProfileUrl : null,
      companyExternalId: null,
      companyDomain: domain,
    });
  }

  return records;
}

async function findContacts(input: {
  companies: CompanyCandidate[];
  roles: string[];
  limit: number;
  businessId?: string;
}): Promise<ProviderResponse<ContactCandidate>> {
  const token = snapToken();
  const domains = input.companies
    .map((company) => company.domain)
    .filter((domain): domain is string => Boolean(domain));

  if (!token) {
    // No partner contract: fall back to what the customer ingested themselves.
    if (!input.businessId) return unconfigured<ContactCandidate>();
    const records = await readIngestedList(input.businessId, domains, input.limit);
    return { ok: true, records, costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const params = new URLSearchParams({
    q: "search",
    keywords: input.roles.slice(0, 3).join(" "),
    count: String(Math.min(Math.max(input.limit, 1), 50)),
  });

  const response = await providerJson<SnapLeadSearch>({
    url: `https://api.linkedin.com/v2/salesApiLeadSearch?${params.toString()}`,
    headers: {
      authorization: `Bearer ${token}`,
      "linkedin-version": "202401",
      "x-restli-protocol-version": "2.0.0",
    },
  });

  if (!response.ok) {
    return providerFailure<ContactCandidate>(response.code, response.latencyMs);
  }

  const byName = new Map(
    input.companies
      .filter((company) => company.domain)
      .map((company) => [company.name.toLowerCase(), company.domain!]),
  );

  const records: ContactCandidate[] = [];
  for (const element of response.data.elements ?? []) {
    const position = element.currentPositions?.[0];
    const companyDomain = position?.companyName
      ? (byName.get(position.companyName.toLowerCase()) ?? null)
      : null;

    // A lead we cannot attach to a company in this batch is not usable — it
    // would become a prospect with no employer, which nothing downstream can
    // score or contact.
    if (!companyDomain) continue;

    records.push({
      externalId: element.entityUrn ?? null,
      firstName: element.firstName ?? null,
      lastName: element.lastName ?? null,
      roleTitle: position?.title ?? null,
      // LinkedIn returns no email through any API. This stays null and the
      // waterfall resolves it from the profile URL.
      email: null,
      phone: null,
      linkedinUrl: element.publicProfileUrl ?? null,
      companyExternalId: null,
      companyDomain,
    });
  }

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs: response.latencyMs,
    errorCode: null,
  };
}

export const linkedinSalesNavigatorProvider: SourcingProvider = {
  key: "linkedin_sales_navigator",
  displayName: "LinkedIn",
  capabilities: ["COMPANY_SEARCH", "CONTACT_DISCOVERY"],
  costRank: 4,
  // A partner seat is billed by LinkedIn as a subscription, not per call, and
  // the ingested-list route is a read of our own table. Neither is metered
  // per record, so a run is not charged per result.
  freeOfCharge: true,
  // Configured either way: with a partner token the API route is live, and
  // without one the ingested-list route still works. Reporting "unconfigured"
  // when a customer has uploaded their own export would hide their own data
  // from them.
  configured: () => true,
  searchCompanies,
  findContacts,
};
