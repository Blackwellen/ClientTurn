import * as React from "react";
import { Users } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { countRecentlyRemoved, listTeamMembers } from "@/lib/settings/queries";
import { planLabel } from "@/lib/settings/types";
import { EmptyState } from "@/components/ui/feedback";
import { TeamSettings } from "@/components/settings/team/team-settings";

export async function TeamSection() {
  const workspace = await requireWorkspace();
  const [members, entitlements, removedRecently] = await Promise.all([
    listTeamMembers(workspace.businessId),
    getEntitlements(workspace.businessId),
    countRecentlyRemoved(workspace.businessId),
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
    <TeamSettings
      members={members}
      currentUserId={workspace.userId}
      actorRole={workspace.role}
      canManage={hasRole(workspace.role, "admin")}
      seatLimit={entitlements.userLimit}
      planName={planLabel(entitlements.plan)}
      removedRecently={removedRecently}
    />
  );
}
