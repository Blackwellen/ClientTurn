import "server-only";
import type { Capability } from "../../cost-model";
import type { SearchPlan } from "../../plan";

/**
 * The sourcing provider contract.
 *
 * Every external data source sits behind this interface, for three reasons:
 * the waterfall can order them by cost without knowing what they are, the run
 * can record cost and provenance uniformly, and no React component or route
 * handler ever holds a provider credential. Adapters are the only code in the
 * product that talks to a sourcing vendor.
 *
 * An adapter that is not configured reports `configured: false` and is skipped.
 * It must never return invented records — a run with no configured provider
 * must fail visibly, because a fabricated prospect list is worse than none.
 */

export type CompanyCandidate = {
  /** Provider's own id, kept so a later enrichment can address the same row. */
  externalId: string | null;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  companySize: string | null;
  description: string | null;
  location: {
    country: string | null;
    region: string | null;
    city: string | null;
    postcode: string | null;
    lat: number | null;
    lon: number | null;
  };
};

export type ContactCandidate = {
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  /** Which company candidate this contact belongs to, by domain or external id. */
  companyExternalId: string | null;
  companyDomain: string | null;
};

export type VerificationResult = {
  email: string;
  status: "VALID" | "RISKY" | "INVALID" | "CATCH_ALL" | "UNVERIFIABLE" | "UNKNOWN";
  score: number | null;
};

export type IntentCategoryQuery = {
  name: string;
  keywords: string[];
};

export type IntentResult = {
  /** Matches a category name from the plan's intent list. */
  category: string;
  domain: string;
  observedAt: string;
  strength: number;
  sourceUrl: string | null;
};

/** What every provider call returns, so cost and failure are handled uniformly. */
export type ProviderResponse<T> = {
  ok: boolean;
  records: T[];
  /** Actual spend for this call in pence, from the provider where it reports it. */
  costMinor: number;
  /** Provider's own pagination token, checkpointed so a resume continues. */
  cursor: string | null;
  latencyMs: number;
  errorCode: ProviderErrorCode | null;
};

export type ProviderErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_BAD_RESPONSE"
  | "PROVIDER_NOT_CONFIGURED";

/** Transient failures are worth retrying with backoff; the rest are not. */
export const TRANSIENT_ERRORS: ProviderErrorCode[] = [
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
];

export function isTransient(code: ProviderErrorCode | null): boolean {
  return code !== null && TRANSIENT_ERRORS.includes(code);
}

export type SearchWindow = {
  plan: SearchPlan;
  /** How many records this batch may take, already budget-clamped. */
  limit: number;
  cursor: string | null;
};

export type SourcingProvider = {
  /** Stable key, also used as the cost_events provider and the price book product. */
  key: string;
  /** Shown in the run's provider activity list. Safe for customers to read. */
  displayName: string;
  capabilities: Capability[];
  /**
   * Relative cost rank within a capability. The waterfall tries low numbers
   * first — this is what makes stage 3 cheap and stage 6 expensive rather than
   * the other way round.
   */
  costRank: number;
  /** False when the credential is absent. Unconfigured providers are skipped. */
  configured: () => boolean;
  /**
   * True when this source costs nothing external — reading public pages we
   * fetch ourselves, rather than a metered vendor. The router bills the price
   * book when a provider reports no price, which would otherwise charge a
   * customer's budget for work nobody invoiced us for.
   */
  freeOfCharge?: boolean;

  searchCompanies?: (window: SearchWindow) => Promise<ProviderResponse<CompanyCandidate>>;
  findContacts?: (input: {
    companies: CompanyCandidate[];
    roles: string[];
    limit: number;
  }) => Promise<ProviderResponse<ContactCandidate>>;
  enrichCompanies?: (input: {
    companies: CompanyCandidate[];
  }) => Promise<ProviderResponse<CompanyCandidate>>;
  verifyEmails?: (input: {
    emails: string[];
  }) => Promise<ProviderResponse<VerificationResult>>;
  fetchIntent?: (input: {
    domains: string[];
    /** The workspace's own categories, with the keywords it configured for
     *  each. Matching on a bare category name would be guesswork. */
    categories: IntentCategoryQuery[];
    freshnessDays: number;
  }) => Promise<ProviderResponse<IntentResult>>;
};

/** The present-tense sentence shown beside a provider on the run page. */
export const CAPABILITY_ACTIVITY: Record<Capability, string> = {
  COMPANY_SEARCH: "Searching company data",
  CONTACT_DISCOVERY: "Finding decision makers",
  COMPANY_ENRICHMENT: "Enriching company data",
  CONTACT_ENRICHMENT: "Enriching contact details",
  EMAIL_VERIFICATION: "Finding and verifying emails",
  INTENT: "Checking buying signals",
  WEBSITE_INTELLIGENCE: "Reading public web pages",
};

export const CAPABILITY_UNIT: Record<Capability, string> = {
  COMPANY_SEARCH: "companies",
  CONTACT_DISCOVERY: "contacts",
  COMPANY_ENRICHMENT: "records",
  CONTACT_ENRICHMENT: "records",
  EMAIL_VERIFICATION: "emails",
  INTENT: "signals",
  WEBSITE_INTELLIGENCE: "pages",
};

/** Uniform failure shape, so an adapter never throws into the worker. */
export function providerFailure<T>(
  code: ProviderErrorCode,
  latencyMs = 0,
): ProviderResponse<T> {
  return { ok: false, records: [], costMinor: 0, cursor: null, latencyMs, errorCode: code };
}
