/**
 * Paid enrichment vendors are OFF (CLAUDE.md resolved conflict 7, owner
 * decision 2026-09-28): Apollo, Hunter and Clearbit stay disabled in
 * production. Hunter proved unreliable and the other two are a compliance
 * risk; contact data comes from first-party, free sources only (company
 * websites, Companies House, Google Places for discovery, the customer's own
 * CRM or imports). The privacy policy's "we do not enrich it from external
 * data brokers" must stay true, and none of the three is on the
 * sub-processor list.
 *
 * The adapters are kept for possible future use behind ONE explicit switch,
 * `ENABLE_PAID_ENRICHMENT`, which defaults off. With it off:
 *
 *   * `env.ts` does not read APOLLO_API_KEY, HUNTER_API_KEY or
 *     CLEARBIT_API_KEY at all, so an adapter reports itself unconfigured even
 *     if a key is set in the environment;
 *   * the provider registry drops the three from every list it returns
 *     (`providersFor`, `allProviders`, `providerByKey`), so no run, admin
 *     action or health check can reach them.
 *
 * Turning it on is a legal change, not a config change: the privacy policy,
 * the sub-processor list and the Art 14 source notices must be updated first.
 * `tests/entitlement-holes.test.ts` asserts the default is off and that the
 * privacy wording and the sub-processor list agree with it.
 *
 * Pure: reads only the env object it is given.
 */

/** Registry keys of the paid enrichment vendors. */
export const PAID_ENRICHMENT_PROVIDER_KEYS = ["apollo", "hunter", "clearbit"] as const;
export type PaidEnrichmentProviderKey = (typeof PAID_ENRICHMENT_PROVIDER_KEYS)[number];

/** Their env keys, never read while the switch is off. */
export const PAID_ENRICHMENT_ENV_KEYS = ["APOLLO_API_KEY", "HUNTER_API_KEY", "CLEARBIT_API_KEY"] as const;

type EnvLike = Record<string, string | undefined>;

/** Exactly "true" (case-insensitive) enables them; anything else, including unset, is off. */
export function paidEnrichmentEnabled(env: EnvLike = process.env): boolean {
  return (env.ENABLE_PAID_ENRICHMENT ?? "").trim().toLowerCase() === "true";
}

export function isPaidEnrichmentProvider(key: string): key is PaidEnrichmentProviderKey {
  return (PAID_ENRICHMENT_PROVIDER_KEYS as readonly string[]).includes(key);
}

/** The providers a registry may expose: paid ones only when the switch is on. */
export function allowedProviders<T extends { key: string }>(providers: readonly T[], enabled: boolean): T[] {
  return enabled ? [...providers] : providers.filter((provider) => !isPaidEnrichmentProvider(provider.key));
}

/** A paid vendor's API key, or undefined while the switch is off. */
export function paidEnrichmentKey(env: EnvLike, name: (typeof PAID_ENRICHMENT_ENV_KEYS)[number]): string | undefined {
  if (!paidEnrichmentEnabled(env)) return undefined;
  return env[name] || undefined;
}
