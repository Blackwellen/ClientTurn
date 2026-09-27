import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { unconfigured } from "./http";
import { isEmailOrigin } from "../../email-origin";
import {
  emptyLinkedinFilters,
  matchesIngestedLead,
  type LinkedinFilters,
} from "../../linkedin-filters";
import type {
  CompanyCandidate,
  ContactCandidate,
  ProviderResponse,
  SourcingProvider,
} from "./types";

/**
 * The customer's own imported list, as a contact source for sourcing runs.
 *
 * This is the only LinkedIn-related route in sourcing, and it never talks to
 * LinkedIn. It reads rows the customer imported themselves
 * (`prospect.import_linkedin_list`): LinkedIn's export of their own
 * 1st-degree connections, or any list they own.
 *
 * What is deliberately not here:
 *
 *   * **No LinkedIn search.** LinkedIn's partner search APIs are closed to new
 *     partners and their request formats are not published, and LinkedIn's
 *     terms forbid using member data to identify sales prospects. A server-side
 *     search that guessed at undocumented parameters was removed.
 *   * **No session automation or scraping**, of LinkedIn or Sales Navigator.
 *
 * LinkedIn returns no email through any route, so an address here is present
 * only when the customer's own file carried one, and it is verified before
 * use like any other.
 *
 * The provider key stays `linkedin_sales_navigator` so existing agent source
 * settings and provenance rows keep working; the name shown is plain.
 */

/** Provenance providers the list route reads: the current writer and the first one. */
const LIST_PROVIDERS = ["linkedin_list_import", "linkedin_sales_navigator"];

/**
 * Reads the imported list for the companies in this batch.
 *
 * The domain filter is in SQL, through the inner join, so the limit applies to
 * rows that can match. The plan's title and seniority filters are applied too:
 * a list is the customer's own selection, but the plan is what this run was
 * asked for. Rows already turned into prospects at import are skipped, so a
 * run never creates the same person twice.
 */
async function readIngestedList(
  businessId: string,
  domains: string[],
  limit: number,
  filters: LinkedinFilters,
): Promise<ContactCandidate[]> {
  if (domains.length === 0) return [];

  const wanted = [...new Set(domains.map((domain) => domain.toLowerCase()))];
  const admin = createAdminClient();
  const { data } = await admin
    .from("prospect_data_sources")
    .select("value_json, company_id, prospect_companies!inner ( domain )")
    .eq("business_id", businessId)
    .in("provider", LIST_PROVIDERS)
    .eq("field_name", "linkedin_lead")
    .is("prospect_id", null)
    .in("prospect_companies.domain", wanted)
    .order("obtained_at", { ascending: false })
    // Headroom for the title filter below, which cannot be expressed in SQL
    // against the JSON blob without a scan per term.
    .limit(Math.min(1000, Math.max(limit, 1) * 4));

  const wantedSet = new Set(wanted);
  const records: ContactCandidate[] = [];

  for (const row of data ?? []) {
    if (records.length >= limit) break;
    const blob = (row.value_json ?? {}) as Record<string, unknown>;
    const company = row.prospect_companies as unknown as { domain: string | null } | null;
    const domain = company?.domain?.toLowerCase() ?? null;
    if (!domain || !wantedSet.has(domain)) continue;

    const first = typeof blob.firstName === "string" ? blob.firstName : null;
    const last = typeof blob.lastName === "string" ? blob.lastName : null;
    if (!first && !last) continue;

    const roleTitle = typeof blob.roleTitle === "string" ? blob.roleTitle : null;
    if (!matchesIngestedLead({ roleTitle }, filters)) continue;

    const email = typeof blob.email === "string" ? blob.email : null;

    records.push({
      externalId: null,
      firstName: first,
      lastName: last,
      roleTitle,
      email,
      emailOrigin: email && isEmailOrigin(blob.emailOrigin) ? blob.emailOrigin : undefined,
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
  linkedin?: LinkedinFilters;
}): Promise<ProviderResponse<ContactCandidate>> {
  if (!input.businessId) return unconfigured<ContactCandidate>();

  const domains = input.companies
    .map((company) => company.domain)
    .filter((domain): domain is string => Boolean(domain));

  const records = await readIngestedList(
    input.businessId,
    domains,
    input.limit,
    input.linkedin ?? emptyLinkedinFilters(),
  );
  return { ok: true, records, costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
}

export const linkedinSalesNavigatorProvider: SourcingProvider = {
  key: "linkedin_sales_navigator",
  displayName: "LinkedIn list import",
  // Contacts only: the list names people at companies, and never supplies a
  // company search.
  capabilities: ["CONTACT_DISCOVERY"],
  costRank: 4,
  // A read of our own table.
  freeOfCharge: true,
  // Always available: reporting "unconfigured" when a customer has imported
  // their own list would hide their own data from them.
  configured: () => true,
  findContacts,
};
