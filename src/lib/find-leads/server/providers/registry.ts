import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Capability } from "../../cost-model";
import { apolloProvider } from "./apollo";
import { clearbitProvider } from "./clearbit";
import { googlePlacesProvider } from "./google-places";
import { hunterProvider } from "./hunter";
import type { SourcingProvider } from "./types";

/**
 * The sourcing provider registry.
 *
 * One list, ordered by cost rank. The waterfall in `router.ts` walks it; no
 * caller anywhere else picks a provider by name, which is what keeps "try the
 * cheap source first" a property of the system rather than of whoever wrote
 * the most recent stage.
 */

const PROVIDERS: SourcingProvider[] = [
  googlePlacesProvider,
  hunterProvider,
  apolloProvider,
  clearbitProvider,
];

export function allProviders(): SourcingProvider[] {
  return PROVIDERS;
}

export function providerByKey(key: string): SourcingProvider | null {
  return PROVIDERS.find((provider) => provider.key === key) ?? null;
}

/**
 * Configured providers for a capability, cheapest first.
 *
 * `unhealthy` comes from the admin provider-health view: a source that is
 * currently down is skipped in favour of an alternative rather than burning
 * the run's retry budget on it.
 */
export function providersFor(
  capability: Capability,
  unhealthy: Set<string> = new Set(),
): SourcingProvider[] {
  return PROVIDERS.filter(
    (provider) =>
      provider.capabilities.includes(capability) &&
      provider.configured() &&
      !unhealthy.has(provider.key),
  ).sort((a, b) => a.costRank - b.costRank);
}

/** True when nothing can serve a capability the run actually needs. */
export function capabilityAvailable(
  capability: Capability,
  unhealthy: Set<string> = new Set(),
): boolean {
  return providersFor(capability, unhealthy).length > 0;
}

/**
 * Providers the platform currently considers unhealthy.
 *
 * Read from the same `integrations` health rows the Admin → System page shows,
 * so operator knowledge of an outage actually changes routing instead of only
 * being displayed.
 */
export async function unhealthyProviders(): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("provider_type, status")
    .in(
      "provider_type",
      PROVIDERS.map((provider) => provider.key),
    )
    .in("status", ["ACTION_REQUIRED", "DISCONNECTED"]);

  return new Set((data ?? []).map((row) => row.provider_type));
}
