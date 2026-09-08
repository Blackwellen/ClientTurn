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
export type ProviderIdentity = {
  externalAccountId: string | null;
  displayName: string | null;
  scopes: string[];
  /**
   * Non-secret facts the provider needs on every later call, stored on
   * `integrations.config`.
   *
   * This exists because a token on its own is not enough to send anything. Meta
   * needs the Page id; WhatsApp needs the phone number id and the WhatsApp
   * Business Account it belongs to. Before this field, six call sites read
   * `config.pageId` and **nothing ever wrote it** — every Meta connection
   * completed OAuth and then failed every send with "not connected", which is
   * the worst shape of bug: the setup flow reports success and the feature is
   * simply dead.
   *
   * Never a credential. Tokens go to `integration_secrets`, which the workspace
   * cannot read; this row is readable by any member.
   */
  config?: Record<string, unknown>;
};

export type ProviderAdapter = {
  getConfig: () => OAuthConfig | null;
  identify: (token: TokenResponse) => Promise<ProviderIdentity>;
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
