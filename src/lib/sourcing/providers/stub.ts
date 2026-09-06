import {
  providerFailure,
  type CompanyCandidate,
  type CompanySearchProvider,
  type CompanySearchQuery,
  type ContactCandidate,
  type ContactDiscoveryProvider,
  type ContactDiscoveryQuery,
  type ContactEnrichmentProvider,
  type CompanyEnrichmentProvider,
  type EmailVerificationProvider,
  type IntentProvider,
  type IntentSignal,
  type ProviderDescriptor,
  type ProviderResult,
  type VerificationOutcome,
  type WebsiteFacts,
  type WebsiteIntelligenceProvider,
} from "../provider-types.ts";

/**
 * Development providers. They perform no network I/O and return deterministic,
 * obviously-synthetic data, so the whole sourcing pipeline — budgets, gates,
 * dedupe, scoring, compliance classification, run state — is exercisable end to
 * end without a single vendor contract. The same role `messaging/stub.ts` plays
 * for the carrier layer.
 *
 * Two rules keep this honest:
 *
 *   1. Everything it emits is branded `example` / `Example` and carries
 *      `provider: "stub"` provenance, so synthetic data can never be mistaken
 *      for a real prospect in the UI or in an export.
 *   2. It is deterministic given the same query — a seeded hash, not
 *      `Math.random()` — so a test asserting on run counters is stable.
 *
 * This is NOT a fixture generator for demos: V4 §112 forbids fake data on
 * customer surfaces. It exists so the engine can be built and tested before the
 * data vendors are chosen.
 */

/** FNV-1a. Small, fast, and stable across runs and machines. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length];
}

function ok<T>(data: T, costMinor: number, latencyMs = 12): ProviderResult<T> {
  return { ok: true, data, costMinor, provider: "stub", latencyMs };
}

const descriptor = (
  capability: ProviderDescriptor["capability"],
  cost: number,
): ProviderDescriptor => ({
  name: "stub",
  capability,
  estimatedUnitCostMinor: cost,
  countries: ["*"],
  rateLimitPerMinute: 10_000,
  configured: true,
});

const CITIES = ["Bournemouth", "Poole", "Southampton", "Bristol", "Reading"] as const;
const SIZES = ["1-10", "11-50", "51-200", "201-500"] as const;
const FIRST = ["Alex", "Sam", "Jordan", "Casey", "Morgan", "Riley"] as const;
const LAST = ["Fielding", "Marsh", "Okafor", "Nowak", "Ahmed", "Brennan"] as const;

/* --------------------------------------------------------- company search */

export class StubCompanySearchProvider implements CompanySearchProvider {
  readonly descriptor = descriptor("COMPANY_SEARCH", 1);

  async searchCompanies(
    query: CompanySearchQuery,
  ): Promise<ProviderResult<CompanyCandidate[]>> {
    const industry = query.industries[0] ?? "Services";
    const country = query.locations[0]?.country ?? "GB";
    const excluded = new Set((query.excludeDomains ?? []).map((d) => d.toLowerCase()));

    const companies: CompanyCandidate[] = [];
    for (let i = 0; i < Math.min(query.limit, 50); i += 1) {
      const seed = hash(`${industry}:${country}:${i}`);
      const slug = `${industry.toLowerCase().replace(/[^a-z]+/g, "-")}-${i + 1}`;
      const domain = `${slug}.example`;
      if (excluded.has(domain)) continue;

      companies.push({
        name: `Example ${titleCase(industry)} ${i + 1}`,
        domain,
        websiteUrl: `https://${domain}`,
        industry,
        companySize: pick(SIZES, seed),
        employeeCount: 5 + (seed % 400),
        location: {
          city: query.locations[0]?.city ?? pick(CITIES, seed),
          country,
        },
        registrationId: null,
        description: `Synthetic ${industry} record produced by the stub provider.`,
        externalIds: { stub: String(seed) },
      });
    }

    return ok(companies, companies.length * this.descriptor.estimatedUnitCostMinor);
  }
}

/* ------------------------------------------------------ contact discovery */

export class StubContactDiscoveryProvider implements ContactDiscoveryProvider {
  readonly descriptor = descriptor("CONTACT_DISCOVERY", 4);

  async findContacts(
    query: ContactDiscoveryQuery,
  ): Promise<ProviderResult<ContactCandidate[]>> {
    if (!query.companyDomain) {
      return providerFailure("stub", "NOT_FOUND", "No company domain supplied", false);
    }

    const contacts: ContactCandidate[] = [];
    for (let i = 0; i < Math.min(query.limit, 5); i += 1) {
      const seed = hash(`${query.companyDomain}:${i}`);
      const first = pick(FIRST, seed);
      const last = pick(LAST, seed >> 3);

      contacts.push({
        firstName: first,
        lastName: last,
        roleTitle: query.roles[i % Math.max(1, query.roles.length)] ?? "Operations Manager",
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${query.companyDomain}`,
        phone: null,
        linkedinUrl: null,
        companyDomain: query.companyDomain,
        externalIds: { stub: String(seed) },
      });
    }

    return ok(contacts, contacts.length * this.descriptor.estimatedUnitCostMinor);
  }
}

/* ------------------------------------------------------------- enrichment */

export class StubCompanyEnrichmentProvider implements CompanyEnrichmentProvider {
  readonly descriptor = descriptor("COMPANY_ENRICHMENT", 2);

  async enrichCompany(domain: string): Promise<ProviderResult<Partial<CompanyCandidate>>> {
    const seed = hash(domain);
    return ok(
      {
        companySize: pick(SIZES, seed),
        employeeCount: 5 + (seed % 400),
        description: `Synthetic enrichment for ${domain}.`,
      },
      this.descriptor.estimatedUnitCostMinor,
    );
  }
}

export class StubContactEnrichmentProvider implements ContactEnrichmentProvider {
  readonly descriptor = descriptor("CONTACT_ENRICHMENT", 8);

  async enrichContact(input: {
    email?: string | null;
    companyDomain?: string | null;
  }): Promise<ProviderResult<Partial<ContactCandidate>>> {
    if (!input.email) {
      return providerFailure("stub", "NOT_FOUND", "No email to enrich", false);
    }
    const seed = hash(input.email);
    return ok(
      { roleTitle: pick(["Operations Manager", "Facilities Manager", "Director"], seed) },
      this.descriptor.estimatedUnitCostMinor,
    );
  }
}

/* ----------------------------------------------------------- verification */

export class StubEmailVerificationProvider implements EmailVerificationProvider {
  readonly descriptor = descriptor("EMAIL_VERIFICATION", 1);

  async verifyEmail(email: string): Promise<ProviderResult<VerificationOutcome>> {
    const seed = hash(email);
    // A deliberately mixed distribution, so downstream gates and the
    // verification-rate metric are exercised rather than always seeing VALID.
    const bucket = seed % 10;
    const result: VerificationOutcome["result"] =
      bucket < 6 ? "VALID" : bucket < 8 ? "CATCH_ALL" : bucket === 8 ? "RISKY" : "INVALID";

    return ok(
      { result, score: (seed % 100) / 100, detail: { provider: "stub" } },
      this.descriptor.estimatedUnitCostMinor,
    );
  }
}

/* -------------------------------------------------- website intelligence */

export class StubWebsiteIntelligenceProvider implements WebsiteIntelligenceProvider {
  readonly descriptor = descriptor("WEBSITE_INTELLIGENCE", 1);

  async fetchSite(url: string, maxPages: number): Promise<ProviderResult<WebsiteFacts>> {
    return ok(
      {
        url,
        title: "Example business",
        text:
          "Synthetic website content produced by the stub provider. " +
          "It describes an example services business operating in the south of England.",
        pagesFetched: Math.min(maxPages, 3),
      },
      this.descriptor.estimatedUnitCostMinor,
    );
  }
}

/* ---------------------------------------------------------------- intent */

export class StubIntentProvider implements IntentProvider {
  readonly descriptor = descriptor("INTENT", 2);

  async findSignals(input: {
    signalTypes: string[];
    keywords: string[];
    companyDomains?: string[];
    since: string;
    limit: number;
  }): Promise<ProviderResult<IntentSignal[]>> {
    const domains = input.companyDomains ?? [];
    const signals: IntentSignal[] = [];

    for (let i = 0; i < Math.min(input.limit, domains.length || 3); i += 1) {
      const domain = domains[i] ?? `example-${i}.example`;
      const seed = hash(`${domain}:${input.since}`);
      const signalType = input.signalTypes[seed % Math.max(1, input.signalTypes.length)] ?? "NEWS";

      signals.push({
        signalType,
        companyDomain: domain,
        companyName: null,
        sourceUrl: `https://${domain}/news/${seed % 1000}`,
        observedAt: new Date().toISOString(),
        confidence: 0.5 + (seed % 40) / 100,
        evidenceSummary: `Synthetic ${signalType.toLowerCase()} signal for ${domain}.`,
        dedupeKey: `stub:${domain}:${signalType}:${input.since.slice(0, 10)}`,
      });
    }

    return ok(signals, signals.length * this.descriptor.estimatedUnitCostMinor);
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
