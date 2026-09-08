import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { PLATFORM_SCOPES, SCOPE_DESCRIPTIONS } from "@/lib/platform/scopes";
import { listApiKeys } from "@/lib/api-keys/queries";
import {
  listWebhookEndpoints,
  recentWebhookDeliveries,
} from "@/lib/webhooks/queries";
import { listMcpConnections, listMcpPendingApprovals } from "@/lib/mcp/queries";
import { canStoreSecrets } from "@/lib/security/secret-box";
import { serverEnv } from "@/lib/env";
import { ApiKeysPanel } from "@/components/settings/developer/api-keys-panel";
import { WebhooksPanel } from "@/components/settings/developer/webhooks-panel";
import { DeveloperOverview } from "@/components/settings/developer/developer-overview";
import { McpConnectionsPanel } from "@/components/settings/connections/mcp-connections-panel";

/**
 * Settings → Developer.
 *
 * The three ways into this workspace from outside — a key for your own code, a
 * webhook out to your systems, an assistant over MCP — in one place, because
 * they are one decision: what leaves this workspace, and who can act on it.
 * Splitting them across sections is how a customer ends up revoking a key and
 * leaving an assistant connected.
 *
 * The whole section is admin-only to *read*, not just to change. The lists name
 * every credential holding access to the workspace and every address its data is
 * being sent to, which is administrative information in itself.
 */
export async function DeveloperSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");

  if (!canManage) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <h3 className="text-[14px] font-semibold text-content">
          Only admins can see developer settings
        </h3>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] text-content-muted">
          This page lists every API key and webhook with access to this
          workspace. Ask an owner or admin if you need one set up.
        </p>
      </div>
    );
  }

  const [apiKeys, endpoints, deliveries, mcpConnections, mcpApprovals] =
    await Promise.all([
      listApiKeys(),
      listWebhookEndpoints(),
      recentWebhookDeliveries(),
      listMcpConnections(),
      listMcpPendingApprovals(),
    ]);

  const scopeOptions = PLATFORM_SCOPES.map((scope) => ({
    scope,
    label: SCOPE_DESCRIPTIONS[scope],
  }));

  return (
    <div className="space-y-4">
      <DeveloperOverview
        baseUrl={serverEnv.siteUrl}
        // Webhooks need a place to keep a signing secret. Saying so up front is
        // better than letting someone fill in the form and be refused on save.
        secretsAvailable={canStoreSecrets()}
      />

      <ApiKeysPanel
        keys={apiKeys}
        scopeOptions={scopeOptions}
        canManage={canManage}
      />

      <WebhooksPanel
        endpoints={endpoints}
        deliveries={deliveries}
        canManage={canManage}
      />

      <McpConnectionsPanel
        connections={mcpConnections}
        approvals={mcpApprovals}
        scopeOptions={scopeOptions}
        canManage={canManage}
      />
    </div>
  );
}
