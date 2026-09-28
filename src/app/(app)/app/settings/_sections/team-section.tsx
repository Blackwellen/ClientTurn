import * as React from "react";
import { Users } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { countRecentlyRemoved, listTeamMembers } from "@/lib/settings/queries";
import { planLabel } from "@/lib/settings/types";
import { inviteExpired, seatsInUse } from "@/lib/team/rules";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { TeamSettings } from "@/components/settings/team/team-settings";
import { MemberPermissions } from "@/components/settings/team/member-permissions";
import { readWorkspaceOverrides } from "@/lib/auth/permissions";
import { memberDisplayName } from "@/lib/settings/types";

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

  // Expiry is decided once, on the server, so the table and the seat count
  // agree and the client never renders a different verdict from its own clock.
  const now = new Date();
  const facts = members.map((member) => ({
    userId: member.userId,
    role: member.role,
    status: member.status,
    invitedAt: member.invitedAt,
  }));
  const expiredInviteIds = members
    .filter((member) => member.status === "invited" && inviteExpired(member.invitedAt, now))
    .map((member) => member.membershipId);

  // Per-person permissions (0172). A failed read shows its own error rather
  // than taking the team list down with it.
  const overrides = await readWorkspaceOverrides(workspace.businessId).then(
    (value) => ({ ...value, error: false }),
    () => ({ available: false, byMembership: new Map(), error: true }),
  );
  const permissionRows = members.map((member) => ({
    membershipId: member.membershipId,
    userId: member.userId,
    name: memberDisplayName(member),
    role: member.role,
    status: member.status,
    overrides: overrides.byMembership.get(member.membershipId) ?? {},
  }));

  return (
    <div className="space-y-4">
    <TeamSettings
      members={members}
      currentUserId={workspace.userId}
      actorRole={workspace.role}
      canManage={hasRole(workspace.role, "admin")}
      seatLimit={entitlements.userLimit}
      seatsUsed={seatsInUse(facts, now)}
      expiredInviteIds={expiredInviteIds}
      planName={planLabel(entitlements.plan)}
      removedRecently={removedRecently}
    />
    {overrides.error ? (
      <ErrorState
        title="Permissions could not be loaded"
        description="The team list above is correct. Refresh to try loading per-person permissions again."
      />
    ) : (
      <MemberPermissions
        rows={permissionRows}
        actorRole={workspace.role}
        currentUserId={workspace.userId}
        canManage={hasRole(workspace.role, "admin")}
        available={overrides.available}
      />
    )}
    </div>
  );
}
