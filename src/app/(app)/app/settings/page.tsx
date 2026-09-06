import * as React from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import {
  SettingsFormSkeleton,
  SettingsTableSkeleton,
} from "@/components/settings/settings-skeleton";
import { parseSettingsSection } from "@/lib/settings/types";
import { WorkspaceSection } from "./_sections/workspace-section";
import { ConnectionsSection } from "./_sections/connections-section";
import { TeamSection } from "./_sections/team-section";
import { BillingSection } from "./_sections/billing-section";

export const metadata: Metadata = { title: "Settings · Client Turn" };
export const dynamic = "force-dynamic";

/**
 * Settings is one route with a `?section=` query rather than four sibling
 * pages, so every workspace configuration surface stays in one place. Only the
 * requested section's data is fetched — Stripe, the provider catalogue and the
 * team list are never loaded for someone editing business hours.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const section = parseSettingsSection(params.section);

  const fallback =
    section === "team" ? (
      <SettingsTableSkeleton />
    ) : (
      <SettingsFormSkeleton cards={section === "connections" ? 3 : 2} />
    );

  return (
    <div className="space-y-5">
      <PageHeader
        size="lg"
        title="Settings"
        description="Manage your workspace, connections, team and billing all in one place."
      />

      <SettingsSectionNav active={section} />

      <React.Suspense key={section} fallback={fallback}>
        {section === "workspace" && <WorkspaceSection />}
        {section === "connections" && <ConnectionsSection />}
        {section === "team" && <TeamSection />}
        {section === "billing" && <BillingSection />}
      </React.Suspense>
    </div>
  );
}
