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

/**
 * Passed to `getConfig` on the callback leg only (never on the initial
 * connect/authorize redirect, where none of this exists yet). Exists for
 * Zoho's Multi DC flow: the authorization server appends `location` and
 * `accounts-server` to its redirect once the user's actual data center is
 * known, and the token exchange must go to *that* DC using *that* DC's
 * client secret -- see the header comment on zoho-crm.ts. Every other
 * provider's `getConfig` ignores this and keeps working unchanged, since a
 * zero-argument function is assignable wherever one taking an optional
 * argument is expected.
 */
export type OAuthCallbackHint = { searchParams: URLSearchParams };

export type ProviderAdapter = {
  getConfig: (hint?: OAuthCallbackHint) => OAuthConfig | null;
  identify: (token: TokenResponse) => Promise<ProviderIdentity>;
  /**
   * Optional. Runs once, immediately after the generic callback has written
   * the `integrations`/`integration_secrets` rows -- the first point at which
   * an `integrationId` exists. Exists for a provider whose connection is not
   * complete on token exchange alone (Calendly must additionally register a
   * webhook subscription and needs the row's own id to build the callback
   * URL; Zoho must persist which data center it authenticated against so a
   * later token refresh hits the same one). A thrown error fails the whole
   * connect attempt, the same as a failed token exchange -- a Connect button
   * that reports success while a required follow-up call silently failed is
   * worse than one that fails loudly here.
   */
  afterConnect?: (params: {
    integrationId: string;
    businessId: string;
    token: TokenResponse;
    searchParams: URLSearchParams;
  }) => Promise<void>;
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
