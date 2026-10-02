import "server-only";
import type { OAuthConfig } from "@/lib/integrations/oauth";
import { getOAuthProviderConfig } from "@/lib/integrations/providers/registry";
// Populates the registry (see the note in integration-health.ts).
import "@/lib/integrations/providers/all";
import { zohoRefreshConfig } from "@/lib/integrations/providers/zoho-crm";

/**
 * The OAuth config to refresh one stored connection with. Every provider's
 * token endpoint is fixed except Zoho's, which is the data centre the
 * connection was made against (stored in `integration_secrets.extra`).
 */
export function refreshConfigFor(providerType: string, extra: unknown): OAuthConfig | null {
  if (providerType === "zoho_crm") return zohoRefreshConfig(extra);
  return getOAuthProviderConfig(providerType);
}
