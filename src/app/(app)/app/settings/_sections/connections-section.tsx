import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getIntegrationsView } from "@/lib/integrations/queries";
import { loadEmailAccount } from "@/lib/email/store";
import { canStoreSecrets } from "@/lib/security/secret-box";
import { ConnectionsSettings } from "@/components/settings/connections/connections-settings";
import { EmailMailboxPanel } from "@/components/settings/connections/email-mailbox-panel";

export async function ConnectionsSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");

  const [view, emailAccount] = await Promise.all([
    getIntegrationsView(workspace.businessId),
    // Settings only. `loadEmailAccount` never returns a password, so this is
    // safe to render into a client component.
    loadEmailAccount(workspace.businessId),
  ]);

  return (
    <div className="space-y-4">
      {/* The workspace's own mailbox leads the section: it is the connection
          that decides whether email campaigns can run at all, and it is the
          one customers set up by hand rather than through OAuth. */}
      <EmailMailboxPanel
        account={emailAccount}
        canManage={canManage}
        secretsAvailable={canStoreSecrets()}
      />

      <ConnectionsSettings
        cards={view.cards}
        lastCheckedAt={view.lastCheckedAt}
        canManage={canManage}
      />
    </div>
  );
}
