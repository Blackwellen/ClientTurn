import * as React from "react";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export const metadata: Metadata = { title: "Settings · Client Turn" };
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await requireWorkspace();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description={`Everything that governs how Client Turn behaves for ${workspace.businessName}.`}
      />
      <SettingsTabs isOwner={workspace.role === "owner"} />
      <div className="max-w-4xl">{children}</div>
    </div>
  );
}
