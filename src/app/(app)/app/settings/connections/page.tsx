import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { PlugZap } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getIntegrationsView } from "@/lib/integrations/queries";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/integrations/catalog";
import { SectionHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/feedback";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { IntegrationCard } from "@/components/integrations/integration-card";

export const metadata: Metadata = { title: "Connections · Client Turn" };
export const dynamic = "force-dynamic";

export default async function ConnectionsSettingsPage() {
  const workspace = await requireWorkspace();
  const view = await getIntegrationsView(workspace.businessId);
  const canManage = hasRole(workspace.role, "admin");

  const totalCount = view.cards.length;
  const connectedCount = view.cards.filter((card) => card.connected).length;
  const attentionCount = view.cards.filter(
    (card) => card.status === "ACTION_REQUIRED" || card.status === "DEGRADED",
  ).length;
  const planGatedCount = view.cards.filter(
    (card) => card.block?.kind === "plan",
  ).length;
  const notConnectedCount = Math.max(totalCount - connectedCount, 0);

  return (
    <div className="space-y-5">
      {totalCount === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={PlugZap}
              title="No connections configured"
              description="Once your Client Turn workspace is provisioned, the connections available on your plan will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Connected"
              value={`${connectedCount} of ${totalCount}`}
              hint="Providers with a live, working connection to this workspace."
            />
            <KpiCard
              label="Needs attention"
              value={attentionCount.toLocaleString("en-GB")}
              hint="Connections that are degraded or need reconnecting."
            />
            <KpiCard
              label="Not connected"
              value={notConnectedCount.toLocaleString("en-GB")}
              hint="Available providers that have not been connected yet."
            />
            <KpiCard
              label="Plan-gated"
              value={planGatedCount.toLocaleString("en-GB")}
              hint="Providers not included on your current plan."
            />
          </div>

          {!canManage && (
            <ReadOnlyNotice message="You can see the state of every connection. Only an owner or admin can connect or disconnect a provider." />
          )}

          {CATEGORY_ORDER.map((category) => {
            const cards = view.cards.filter(
              (card) => card.definition.category === category,
            );
            if (cards.length === 0) return null;

            const connectedInCategory = cards.filter((card) => card.connected).length;

            return (
              <Card key={category}>
                <CardHeader>
                  <SectionHeader
                    title={CATEGORY_LABELS[category]}
                    description={`${connectedInCategory} of ${cards.length} connected`}
                  />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {cards.map((card) => (
                      <IntegrationCard
                        key={card.definition.id}
                        model={card}
                        canManage={canManage}
                        metaPages={card.definition.id === "meta" ? view.meta.pages : undefined}
                        metaForms={card.definition.id === "meta" ? view.meta.forms : undefined}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}

      <p className="text-content-subtle text-[12px]">
        Access tokens and API keys are held server-side only and are never shown
        here. Booking behaviour is set in{" "}
        <Link
          href="/app/settings/workspace"
          className="text-content-accent focus-visible:outline-content-accent rounded-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Settings → Workspace
        </Link>
        .
      </p>
    </div>
  );
}
