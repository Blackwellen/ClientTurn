import "server-only";
import type { OAuthConfig, TokenResponse } from "@/lib/integrations/oauth";
import type { ProviderType } from "@/lib/integrations/catalog";

/**
 * Registry contract every OAuth-based provider adapter implements. The
 * generic connect/callback routes never know provider-specific detail beyond
 * this shape — one adapter module per platform, registered here.
 *
 * `identify` runs immediately after token exchange to resolve a human-readable
 * account reference (never a token) for the integration row, and the scopes
 * actually granted.
 */
export type ProviderAdapter = {
  getConfig: () => OAuthConfig | null;
  identify: (
    token: TokenResponse,
  ) => Promise<{ externalAccountId: string | null; displayName: string | null; scopes: string[] }>;
};

const registry = new Map<string, ProviderAdapter>();

export function registerOAuthProvider(provider: ProviderType, adapter: ProviderAdapter) {
  registry.set(provider, adapter);
}

export function isOAuthProvider(provider: string): provider is ProviderType {
  return registry.has(provider);
}

export function getOAuthProviderConfig(provider: string): OAuthConfig | null {
  return registry.get(provider)?.getConfig() ?? null;
}

export function getOAuthProviderAdapter(provider: string): ProviderAdapter | null {
  return registry.get(provider) ?? null;
}
