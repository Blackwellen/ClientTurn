"use client";

import type * as React from "react";
import { usePathname } from "next/navigation";
import { Building2, CreditCard, PlugZap, Users } from "lucide-react";
import { TabLink, TabLinkBar } from "@/components/ui/tabs";
import { SETTINGS_TABS } from "@/lib/settings/types";

const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  workspace: Building2,
  connections: PlugZap,
  team: Users,
  billing: CreditCard,
};

export function SettingsTabs({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();

  return (
    <TabLinkBar aria-label="Settings sections">
      {SETTINGS_TABS.filter((tab) => !tab.ownerOnly || isOwner).map((tab) => {
        const href = `/app/settings/${tab.segment}`;
        const Icon = TAB_ICONS[tab.segment];
        return (
          <TabLink key={tab.segment} href={href} active={pathname === href}>
            {Icon && <Icon className="size-3.5" />}
            {tab.label}
          </TabLink>
        );
      })}
    </TabLinkBar>
  );
}
