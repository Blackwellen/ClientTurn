import * as React from "react";
import { Users } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { listTeamMembers } from "@/lib/settings/queries";
import { planLabel } from "@/lib/settings/types";
import { EmptyState } from "@/components/ui/feedback";
import { TeamView } from "@/components/settings/team-view";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const workspace = await requireWorkspace();
  const [members, entitlements] = await Promise.all([
    listTeamMembers(workspace.businessId),
    getEntitlements(workspace.businessId),
  ]);

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No team members found"
        description="This workspace has no active membership records. Contact support so we can put it right."
      />
    );
  }

  return (
    <TeamView
      members={members}
      currentUserId={workspace.userId}
      canManage={hasRole(workspace.role, "admin")}
      seatLimit={entitlements.userLimit}
      planName={planLabel(entitlements.plan)}
    />
  );
}
