"use client";

import * as React from "react";
import { PlugZap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { ReadOnlyNotice } from "@/components/settings/notices";
import {
  CATEGORY_LABELS,
  providerAvailability,
  summariseConnections,
  type IntegrationCategory,
  type ProviderCardModel,
} from "@/lib/integrations/catalog";
import { ConnectionCard } from "./connection-card";
import { AppMarketplace } from "./app-marketplace";
import { ConnectionGroup } from "./connection-group";
import { ConnectionHealthSummary } from "./connection-health-summary";
import { ConnectionSetupDrawer } from "./connection-setup-drawer";

/**
 * Categories are laid out in rows rather than stacked full width: lead sources
 * take a row of their own, then messaging sits beside booking and CRM beside
 * email. Each row is a 5-column grid so the panels keep a stable 3/2 split.
 */
const ROWS: { category: IntegrationCategory; span: string; columns: 1 | 2 | 3 | 5 }[][] =
  [
    [{ category: "leads", span: "xl:col-span-5", columns: 5 }],
    [
      { category: "messaging", span: "xl:col-span-3", columns: 3 },
      { category: "booking", span: "xl:col-span-2", columns: 2 },
    ],
    [
      { category: "crm", span: "xl:col-span-3", columns: 3 },
      { category: "email", span: "xl:col-span-2", columns: 1 },
    ],
  ];

export function ConnectionsSettings({
  cards,
  lastCheckedAt,
  canManage,
}: {
  cards: ProviderCardModel[];
  lastCheckedAt: string | null;
  canManage: boolean;
}) {
  const [setup, setSetup] = React.useState<ProviderCardModel | null>(null);

  const summary = React.useMemo(
    () => summariseConnections(cards, lastCheckedAt),
    [cards, lastCheckedAt],
  );

  const byCategory = React.useMemo(() => {
    const map = new Map<IntegrationCategory, ProviderCardModel[]>();
    for (const card of cards) {
      const list = map.get(card.definition.category) ?? [];
      list.push(card);
      map.set(card.definition.category, list);
    }
    return map;
  }, [cards]);

  if (cards.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={PlugZap}
            title="No connections configured"
            description="Once your Client Turn workspace is provisioned, the connections available on your plan appear here."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ConnectionHealthSummary summary={summary} canManage={canManage} />
      <AppMarketplace canManage={canManage} />

      {!canManage && (
        <ReadOnlyNotice message="You can see the state of every connection. Only an owner or admin can connect, test or disconnect a provider." />
      )}

      {ROWS.map((row, index) => {
        const panels = row.filter(
          (entry) => (byCategory.get(entry.category)?.length ?? 0) > 0,
        );
        if (panels.length === 0) return null;

        return (
          <div key={index} className="grid gap-4 xl:grid-cols-5">
            {panels.map((entry) => {
              const inCategory = byCategory.get(entry.category) ?? [];
              const connected = inCategory.filter((card) => {
                const availability = providerAvailability(card);
                return (
                  availability === "CONNECTED" || availability === "SYSTEM_MANAGED"
                );
              }).length;

              return (
                <div key={entry.category} className={entry.span}>
                  <ConnectionGroup
                    id={entry.category}
                    title={CATEGORY_LABELS[entry.category]}
                    connected={connected}
                    total={inCategory.length}
                    columns={entry.columns}
                  >
                    {inCategory.map((card) => (
                      <ConnectionCard
                        key={card.definition.id}
                        model={card}
                        canManage={canManage}
                        onOpenSetup={setSetup}
                      />
                    ))}
                  </ConnectionGroup>
                </div>
              );
            })}
          </div>
        );
      })}

      <p className="text-[12px] text-content-subtle">
        Access tokens and API keys are held server-side only and are never shown
        here.
      </p>

      {/* Keyed by provider so switching provider remounts the panel with
          empty credential fields rather than resetting them in an effect. */}
      {setup && (
        <ConnectionSetupDrawer
          key={setup.definition.id}
          model={setup}
          onClose={() => setSetup(null)}
        />
      )}
    </div>
  );
}
