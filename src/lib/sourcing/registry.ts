import "server-only";
import {
  orderByCost,
  type CompanyEnrichmentProvider,
  type CompanySearchProvider,
  type ContactDiscoveryProvider,
  type ContactEnrichmentProvider,
  type EmailVerificationProvider,
  type IntentProvider,
  type ProviderCapability,
  type ProviderDescriptor,
  type WebsiteIntelligenceProvider,
} from "./provider-types";
import {
  StubCompanyEnrichmentProvider,
  StubCompanySearchProvider,
  StubContactDiscoveryProvider,
  StubContactEnrichmentProvider,
  StubEmailVerificationProvider,
  StubIntentProvider,
  StubWebsiteIntelligenceProvider,
} from "./providers/stub";

/**
 * Provider selection for the acquisition layer.
 *
 * Selection is explicit and logged, mirroring `messaging/registry.ts`: a
 * workspace must never be left guessing whether its sourcing run called a real
 * data vendor or a development sink. Nothing here reads a customer setting —
 * provider priority is platform configuration (§47.2).
 *
 * Real adapters register themselves here as they are built. Until then the stub
 * is the only implementation, which is why `usingStubProviders()` exists: the
 * admin surface and the run UI use it to say plainly that results are synthetic.
 */

type Registry = {
  companySearch: CompanySearchProvider[];
  contactDiscovery: ContactDiscoveryProvider[];
  companyEnrichment: CompanyEnrichmentProvider[];
  contactEnrichment: ContactEnrichmentProvider[];
  emailVerification: EmailVerificationProvider[];
  websiteIntelligence: WebsiteIntelligenceProvider[];
  intent: IntentProvider[];
};

let cached: Registry | null = null;
let announced = false;

function build(): Registry {
  // Ordered most-preferred first within each capability. Real adapters go
  // ahead of the stub; the stub is always last so it is only ever reached when
  // nothing else is configured.
  const registry: Registry = {
    companySearch: [new StubCompanySearchProvider()],
    contactDiscovery: [new StubContactDiscoveryProvider()],
    companyEnrichment: [new StubCompanyEnrichmentProvider()],
    contactEnrichment: [new StubContactEnrichmentProvider()],
    emailVerification: [new StubEmailVerificationProvider()],
    websiteIntelligence: [new StubWebsiteIntelligenceProvider()],
    intent: [new StubIntentProvider()],
  };

  if (!announced) {
    announced = true;
    console.info(
      "[sourcing] no data vendors configured — using stub providers. " +
        "Sourcing results are synthetic and must not be presented to a customer.",
    );
  }

  return registry;
}

export function getProviderRegistry(): Registry {
  cached ??= build();
  return cached;
}

/** Test seam, matching `resetMessagingProvider`. */
export function resetProviderRegistry() {
  cached = null;
  announced = false;
}

/**
 * True while every capability is served only by the stub.
 *
 * Surfaces that could otherwise present synthetic records as real prospects
 * check this and say so. §112 forbids fake data on a customer surface; this is
 * how that rule is enforced rather than merely intended.
 */
export function usingStubProviders(): boolean {
  const registry = getProviderRegistry();
  return Object.values(registry)
    .flat()
    .every((provider) => provider.descriptor.name === "stub");
}

/** Cheapest-first failover chain for one capability in one country. */
export function chainFor<K extends keyof Registry>(
  capability: K,
  country: string | null,
): Registry[K] {
  const registry = getProviderRegistry();
  return orderByCost(registry[capability] as { descriptor: ProviderDescriptor }[], country) as Registry[K];
}

/** Everything the admin Providers surface needs, without exposing instances. */
export function describeProviders(): (ProviderDescriptor & { capability: ProviderCapability })[] {
  const registry = getProviderRegistry();
  return Object.values(registry)
    .flat()
    .map((provider) => provider.descriptor);
}
