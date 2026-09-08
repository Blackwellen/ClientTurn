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
 * Companies House: is this actually a company?
 *
 * The UK register, free, official, and the only source that can answer the one
 * question the compliance engine most needs and previously could not ask.
 *
 * ## The gap this closes
 *
 * `policy/types.ts` has distinguished `CORPORATE`, `SOLE_TRADER`, `PARTNERSHIP`
 * and `INDIVIDUAL` since the packs were written, and the packs treat them
 * differently for good reason: under PECR the corporate-subscriber exemption
 * from consent applies to incorporated bodies and LLPs, and **not** to sole
 * traders or unincorporated partnerships, who are treated as individuals.
 *
 * But nothing could ever produce those middle two values. `contact-legality`
 * returns only `CORPORATE | INDIVIDUAL | UNKNOWN`, derived from the *email
 * domain* — so a sole trader trading as "Northgate Roofing" from
 * `hello@northgateroofing.co.uk` was classified `CORPORATE`, and the pack's
 * careful distinction was unreachable from sourced data. The rule existed and
 * was unenforceable.
 *
 * A register match is what makes it answerable. It is also the cheapest
 * possible answer: the API is free, and a lookup costs one call against a
 * name we already hold.
 *
 * ## What a miss means, and what it does not
 *
 * **A miss is not proof of a sole trader.** A company can be absent from a
 * name search because it trades under a name that differs from its registered
 * one, which is extremely common — "Northgate Roofing" may be registered as
 * "N. Hartley Ltd". So a miss yields `UNKNOWN`, never `SOLE_TRADER`, and
 * `UNKNOWN` is the conservative value: the packs put it in
 * `reviewSubscriberTypes`, so it reaches a person rather than being contacted
 * on an assumption.
 *
 * A *hit* is strong evidence, and it is the direction that matters — it is what
 * lets a workspace assert the corporate exemption with something behind it.
 */

type CompanySearchItem = {
  company_number?: string;
  title?: string;
  company_status?: string;
  company_type?: string;
  address_snippet?: string;
  date_of_creation?: string;
};

function key(): string | undefined {
  return serverEnv.sourcing.companiesHouseApiKey;
}

/**
 * Company types that are incorporated bodies or LLPs.
 *
 * These are the ones PECR's corporate-subscriber exemption covers. Everything
 * else on the register -- and the register does list some unincorporated forms
 * -- is deliberately absent, so an unrecognised type yields UNKNOWN rather than
 * being waved through as corporate.
 */
const CORPORATE_TYPES = new Set([
  "ltd",
  "plc",
  "llp",
  "private-limited-guarant-nsc",
  "private-limited-guarant-nsc-limited-exemption",
  "private-unlimited",
  "private-unlimited-nsc",
  "old-public-company",
  "private-limited-shares-section-30-exemption",
  "northern-ireland",
  "northern-ireland-other",
  "scottish-partnership",
  "limited-partnership",
  "royal-charter",
  "industrial-and-provident-society",
  "registered-society-non-jurisdictional",
  "community-interest-company",
  "charitable-incorporated-organisation",
  "scottish-charitable-incorporated-organisation",
]);

/** What a register lookup concluded about one trading name. */
export type RegistryVerdict = {
  /** The register's own subscriber classification, for `policy/types.ts`. */
  subscriberType: "CORPORATE" | "PARTNERSHIP" | "UNKNOWN";
  companyNumber: string | null;
  registeredName: string | null;
  status: string | null;
  companyType: string | null;
  /** A sentence for the prospect record. Written for a customer to read. */
  reason: string;
};

const UNRESOLVED: RegistryVerdict = {
  subscriberType: "UNKNOWN",
  companyNumber: null,
  registeredName: null,
  status: null,
  companyType: null,
  reason:
    "No match on the Companies House register for this trading name. That does not mean they are not a company — many trade under a name that differs from the registered one — so this is left for a person to confirm rather than assumed either way.",
};

/**
 * Normalises for comparison, not for display.
 *
 * Suffixes are stripped because "Northgate Roofing" and "Northgate Roofing
 * Limited" are the same company, and punctuation because "N.H. Ltd" and "NH
 * Ltd" are too. Deliberately conservative: this only decides whether a match is
 * close enough to trust, and a false match asserts a corporate exemption that
 * does not apply.
 */
function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\b(limited|ltd|plc|llp|llc|company|co|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Looks one trading name up on the register.
 *
 * Exported on its own because the compliance path needs it for a single
 * prospect, outside any sourcing run.
 */
export async function lookupCompany(name: string): Promise<RegistryVerdict> {
  const apiKey = key();
  if (!apiKey || !name.trim()) return UNRESOLVED;

  const result = await providerJson<{ items?: CompanySearchItem[] }>({
    url: `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`,
    headers: {
      // Companies House uses HTTP Basic with the key as the username and an
      // empty password.
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });

  if (!result.ok) return UNRESOLVED;

  const wanted = normaliseName(name);
  const match = (result.data.items ?? []).find(
    (item) => item.title && normaliseName(item.title) === wanted,
  );

  // Only an exact normalised match counts. Companies House search is fuzzy and
  // will happily return "Northgate Roofing Supplies Ltd" for "Northgate
  // Roofing" -- a different company, whose incorporation says nothing about
  // the one we are about to contact.
  if (!match?.company_number) return UNRESOLVED;

  const type = (match.company_type ?? "").toLowerCase();
  const status = match.company_status ?? null;

  if (!CORPORATE_TYPES.has(type)) {
    return {
      ...UNRESOLVED,
      companyNumber: match.company_number,
      registeredName: match.title ?? null,
      status,
      companyType: match.company_type ?? null,
      reason: `Found on the register as "${match.title}", but its type (${match.company_type}) is not one the corporate-subscriber exemption clearly covers, so it is left for a person to confirm.`,
    };
  }

  // A dissolved company is a real finding, not a near-miss: contacting one is
  // pointless, and the record should say so rather than reporting a clean
  // corporate match.
  if (status && status !== "active") {
    return {
      subscriberType: "UNKNOWN",
      companyNumber: match.company_number,
      registeredName: match.title ?? null,
      status,
      companyType: match.company_type ?? null,
      reason: `Found on the register as "${match.title}", but its status is "${status}" rather than active.`,
    };
  }

  return {
    subscriberType: type === "limited-partnership" || type === "scottish-partnership"
      ? "PARTNERSHIP"
      : "CORPORATE",
    companyNumber: match.company_number,
    registeredName: match.title ?? null,
    status,
    companyType: match.company_type ?? null,
    reason: `Confirmed on the Companies House register as "${match.title}" (${match.company_number}), an active ${match.company_type}.`,
  };
}

/**
 * Enriches companies with their register identity.
 *
 * `COMPANY_ENRICHMENT` rather than a capability of its own: what it adds is
 * facts about a company we already found, which is exactly what that capability
 * means. It is free, so it runs before any paid enricher in the waterfall.
 */
async function enrichCompanies(input: {
  companies: CompanyCandidate[];
}): Promise<ProviderResponse<CompanyCandidate>> {
  if (!key()) return unconfigured<CompanyCandidate>();

  const records: CompanyCandidate[] = [];
  const startedAt = Date.now();

  for (const company of input.companies) {
    if (!company.name) continue;

    const verdict = await lookupCompany(company.name);
    if (!verdict.companyNumber) continue;

    records.push({
      ...company,
      // The registered name is the legal identity and belongs on the record;
      // the trading name the customer recognises is kept as-is elsewhere.
      registrationId: verdict.companyNumber,
      registeredName: verdict.registeredName,
      subscriberType: verdict.subscriberType,
      registryReason: verdict.reason,
    } as CompanyCandidate);
  }

  if (records.length === 0 && input.companies.length > 0) {
    return providerFailure<CompanyCandidate>(
      "PROVIDER_BAD_RESPONSE",
      Date.now() - startedAt,
    );
  }

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs: Date.now() - startedAt,
    errorCode: null,
  };
}

export const companiesHouseProvider: SourcingProvider = {
  key: "companies_house",
  displayName: "Companies House",
  capabilities: ["COMPANY_ENRICHMENT"],
  // Free and official, so it runs before anything metered.
  costRank: 0,
  freeOfCharge: true,
  configured: () => Boolean(key()),
  enrichCompanies,
};
