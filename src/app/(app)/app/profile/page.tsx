import * as React from "react";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/auth/session";
import { getProfileView } from "@/lib/settings/queries";
import { PageHeader } from "@/components/app/page-header";
import { ProfileSettings } from "@/components/settings/profile-view";

export const metadata: Metadata = { title: "Profile · Client Turn" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const workspace = await requireWorkspace();
  const profile = await getProfileView(
    workspace.userId,
    workspace.businessId,
    workspace.role,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profile"
        description="Your account, your password and how Client Turn contacts you."
      />
      <div className="max-w-3xl">
        <ProfileSettings profile={profile} role={workspace.role} />
      </div>
    </div>
  );
}
