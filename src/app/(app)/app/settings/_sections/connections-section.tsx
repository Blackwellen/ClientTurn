import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getIntegrationsView } from "@/lib/integrations/queries";
import { loadEmailAccount } from "@/lib/email/store";
import { canStoreSecrets } from "@/lib/security/secret-box";
import { ConnectionsSettings } from "@/components/settings/connections/connections-settings";
import { EmailMailboxPanel } from "@/components/settings/connections/email-mailbox-panel";
import { DiscoveryStatusCard } from "@/components/settings/connections/discovery-status";
import { getStatusSummary } from "@/lib/status/service";
import { loadSenderHealth, type SenderHealth } from "@/lib/settings/ai-selling-queries";
import { DomainHealthCard } from "@/components/settings/ai-selling/domain-health-card";
import { SectionLoadError } from "@/components/settings/ai-selling/section-load-error";
import { ChannelControls } from "@/components/settings/connections/channel-controls";
import { ConnectResultToast } from "@/components/settings/connections/connect-result-toast";
import { SocialAccountsCard } from "@/components/settings/connections/social-accounts-card";
import { loadProviderExtras } from "@/lib/integrations/extras";
import { listSocialAccounts } from "@/lib/outreach/social-outreach";
import { PaymentsSection, PaymentsSectionSkeleton } from "@/components/settings/connections/payments-section";

export async function ConnectionsSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");

  const [view, emailAccount, status, senderHealth, extras, socialAccounts] = await Promise.all([
    getIntegrationsView(workspace.businessId),
    // Settings only. `loadEmailAccount` never returns a password, so this is
    // safe to render into a client component.
    loadEmailAccount(workspace.businessId),
    // Platform-wide health for the Discovery group. Distinct from the cards
    // above, which are this customer's own connections (§28's Connections /
    // Status note): a provider can be healthy platform-wide while this
    // workspace's mailbox is disconnected.
    getStatusSummary(),
    // SPF / DKIM / DMARC for the sending domains, from the daily domain-health
    // job. Fails on its own: a broken read must not take the mailbox form down.
    loadSenderHealth(workspace.businessId).then(
      (value): SenderHealth | null => value,
      () => null,
    ),
    // Per-provider details for the drawer: webhook key (admins only), Meta
    // Pages and token expiry, Slack channel, CRM push status.
    loadProviderExtras({ businessId: workspace.businessId, canManage }).catch(() => ({})),
    // The accounts Find Leads' social queue sends from (ASSISTED).
    listSocialAccounts(workspace.businessId).catch(() => []),
  ]);

  const discoveryStatus =
    status.groups.find((group) => group.name === "Discovery")?.status ??
    "OPERATIONAL";

  return (
    <div className="space-y-4" data-tour="settings-connections">
      <React.Suspense fallback={null}>
        <ConnectResultToast />
      </React.Suspense>
      {/* The workspace's own mailbox leads the section: it is the connection
          that decides whether email campaigns can run at all, and it is the
          one customers set up by hand rather than through OAuth. */}
      <EmailMailboxPanel
        account={emailAccount}
        canManage={canManage}
        secretsAvailable={canStoreSecrets()}
      />

      {senderHealth ? (
        <DomainHealthCard domains={senderHealth.domains} senders={senderHealth.senders} />
      ) : (
        <SectionLoadError title="Sending domain health" href="/app/settings?section=connections" />
      )}

      <ConnectionsSettings
        cards={view.cards}
        lastCheckedAt={view.lastCheckedAt}
        canManage={canManage}
        extras={extras}
      />

      {/* Payment confirmation for the direct-sale loop (0143). */}
      <React.Suspense fallback={<PaymentsSectionSkeleton />}>
        <PaymentsSection />
      </React.Suspense>

      <SocialAccountsCard
        canManage={canManage}
        accounts={socialAccounts.map((account) => ({
          id: account.id,
          platform: account.platform,
          tier: account.tier,
          displayName: account.displayName,
          handle: account.handle,
          status: account.status,
        }))}
      />

      {/* CRM import (§29) and WhatsApp templates (§45): loaded on their own so
          a slow provider read never holds up the connection cards. */}
      <React.Suspense fallback={null}>
        <ChannelControls />
      </React.Suspense>

      <DiscoveryStatusCard status={discoveryStatus} />
    </div>
  );
}
