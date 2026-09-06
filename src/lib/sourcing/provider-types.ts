/**
 * Provider abstraction for the acquisition layer (V4 §58).
 *
 * The rule this file exists to enforce: **no customer flow depends on one
 * vendor**. Every external capability sits behind an interface that declares
 * what it can do and what it costs, so the orchestrator can pick the cheapest
 * sufficient operation and fail over when one provider is down.
 *
 * Pure — no `server-only`, no Supabase — so adapters and the waterfall logic
 * are unit-testable without a database.
 *
 * Cost is expressed in minor units and never leaves the server. It exists here
 * because the orchestrator needs it to make spending decisions, not because any
 * customer surface will render it.
 */

export type ProviderCapability =
  | "COMPANY_SEARCH"
  | "CONTACT_DISCOVERY"
  | "COMPANY_ENRICHMENT"
  | "CONTACT_ENRICHMENT"
  | "EMAIL_VERIFICATION"
  | "INTENT"
  | "WEBSITE_INTELLIGENCE";

/** What a provider says about itself, so the orchestrator can route without
 *  knowing the vendor. */
export type ProviderDescriptor = {
  name: string;
  capability: ProviderCapability;
  /** Estimated minor units per unit of work. Reconciled against the real cost
   *  after the call; this is for planning, not billing. */
  estimatedUnitCostMinor: number;
  /** ISO country codes this provider can serve, or "*" for global. */
  countries: string[];
  /** Requests per minute the adapter will accept before it starts refusing. */
  rateLimitPerMinute: number;
  /** False when credentials are absent. The registry still lists it, so the
   *  admin surface can show "configured: no" rather than hiding it. */
  configured: boolean;
};

export type ProviderResult<T> =
  | { ok: true; data: T; costMinor: number; provider: string; latencyMs: number }
  | {
      ok: false;
      provider: string;
      errorCode: "RATE_LIMITED" | "NOT_CONFIGURED" | "NOT_FOUND" | "PROVIDER_ERROR" | "TIMEOUT";
      message: string;
      /** True when trying a different provider might work. */
      retryable: boolean;
      costMinor: number;
    };

/* ------------------------------------------------------------------ shapes */

export type CompanyCandidate = {
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  industry: string | null;
  companySize: string | null;
  employeeCount: number | null;
  location: { city?: string; region?: string; country?: string; postcode?: string };
  registrationId: string | null;
  description: string | null;
  externalIds: Record<string, string>;
};

export type ContactCandidate = {
  firstName: string | null;
  lastName: string | null;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
  externalIds: Record<string, string>;
};

export type CompanySearchQuery = {
  industries: string[];
  locations: { country?: string; region?: string; city?: string; radiusMiles?: number }[];
  employeeRange?: { min?: number; max?: number };
  keywords?: string[];
  excludeDomains?: string[];
  limit: number;
};

export type ContactDiscoveryQuery = {
  companyDomain: string;
  companyName: string;
  roles: string[];
  limit: number;
};

export type VerificationOutcome = {
  result: "VALID" | "RISKY" | "INVALID" | "CATCH_ALL" | "UNKNOWN" | "UNVERIFIABLE";
  score: number | null;
  detail: Record<string, unknown>;
};

export type WebsiteFacts = {
  url: string;
  title: string | null;
  /** Extracted, bounded text. Deliberately capped — a page is evidence, not a
   *  document store, and untrusted text should not grow without limit. */
  text: string;
  pagesFetched: number;
};

export type IntentSignal = {
  signalType: string;
  companyDomain: string | null;
  companyName: string | null;
  sourceUrl: string | null;
  observedAt: string;
  confidence: number;
  evidenceSummary: string;
  /** Stable key so the same underlying signal from two runs collapses. */
  dedupeKey: string;
};

/* -------------------------------------------------------------- interfaces */

export interface CompanySearchProvider {
  readonly descriptor: ProviderDescriptor;
  searchCompanies(query: CompanySearchQuery): Promise<ProviderResult<CompanyCandidate[]>>;
}

export interface ContactDiscoveryProvider {
  readonly descriptor: ProviderDescriptor;
  findContacts(query: ContactDiscoveryQuery): Promise<ProviderResult<ContactCandidate[]>>;
}

export interface CompanyEnrichmentProvider {
  readonly descriptor: ProviderDescriptor;
  enrichCompany(domain: string): Promise<ProviderResult<Partial<CompanyCandidate>>>;
}

export interface ContactEnrichmentProvider {
  readonly descriptor: ProviderDescriptor;
  enrichContact(input: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    companyDomain?: string | null;
  }): Promise<ProviderResult<Partial<ContactCandidate>>>;
}

export interface EmailVerificationProvider {
  readonly descriptor: ProviderDescriptor;
  verifyEmail(email: string): Promise<ProviderResult<VerificationOutcome>>;
}

export interface WebsiteIntelligenceProvider {
  readonly descriptor: ProviderDescriptor;
  fetchSite(url: string, maxPages: number): Promise<ProviderResult<WebsiteFacts>>;
}

export interface IntentProvider {
  readonly descriptor: ProviderDescriptor;
  findSignals(input: {
    signalTypes: string[];
    keywords: string[];
    companyDomains?: string[];
    industries?: string[];
    locations?: string[];
    since: string;
    limit: number;
  }): Promise<ProviderResult<IntentSignal[]>>;
}

export type AnyProvider =
  | CompanySearchProvider
  | ContactDiscoveryProvider
  | CompanyEnrichmentProvider
  | ContactEnrichmentProvider
  | EmailVerificationProvider
  | WebsiteIntelligenceProvider
  | IntentProvider;

/* --------------------------------------------------------------- helpers */

export function providerFailure(
  provider: string,
  errorCode: Extract<ProviderResult<never>, { ok: false }>["errorCode"],
  message: string,
  retryable = true,
): Extract<ProviderResult<never>, { ok: false }> {
  return { ok: false, provider, errorCode, message, retryable, costMinor: 0 };
}

/**
 * True when a provider serves the given country. `"*"` means global; an empty
 * list means the adapter has not declared coverage and is treated as global
 * rather than as serving nothing.
 */
export function servesCountry(descriptor: ProviderDescriptor, country: string | null): boolean {
  if (descriptor.countries.length === 0) return true;
  if (descriptor.countries.includes("*")) return true;
  if (!country) return true;
  return descriptor.countries.includes(country.toUpperCase());
}

/**
 * Orders candidate providers cheapest-first among those that are configured and
 * serve the country. Unconfigured providers are dropped rather than ordered
 * last, so a failover chain never stalls on a vendor with no credentials.
 */
export function orderByCost<T extends { descriptor: ProviderDescriptor }>(
  providers: T[],
  country: string | null,
): T[] {
  return providers
    .filter((p) => p.descriptor.configured && servesCountry(p.descriptor, country))
    .sort((a, b) => a.descriptor.estimatedUnitCostMinor - b.descriptor.estimatedUnitCostMinor);
}
