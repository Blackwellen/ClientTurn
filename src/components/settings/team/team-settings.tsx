"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, MoreHorizontal, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DropdownItem, DropdownMenu } from "@/components/ui/dropdown";
import { Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/dates";
import { changeMemberRole, removeMember } from "@/lib/settings/actions";
import {
  ASSIGNABLE_ROLES,
  MEMBER_STATUS_LABELS,
  ROLE_LABELS,
  canEditMember,
  memberDisplayName,
  type BusinessRole,
  type TeamMemberRow,
} from "@/lib/settings/types";
import { InviteMemberDialog } from "./invite-member-dialog";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  invited: "warning",
  suspended: "neutral",
  removed: "neutral",
};

const ROLE_DOT: Record<string, string> = {
  owner: "bg-purple-500",
  admin: "bg-info-500",
  member: "bg-content-subtle",
};

const ROLE_HELP: { role: BusinessRole; text: string }[] = [
  {
    role: "owner",
    text: "Full access to all settings and billing. Can manage team members.",
  },
  {
    role: "admin",
    text: "Can manage most settings and team members, except billing.",
  },
  {
    role: "member",
    text: "Can use Client Turn to manage leads and campaigns.",
  },
];

export function TeamSettings({
  members,
  currentUserId,
  actorRole,
  canManage,
  seatLimit,
  planName,
  removedRecently,
}: {
  members: TeamMemberRow[];
  currentUserId: string;
  actorRole: BusinessRole;
  canManage: boolean;
  seatLimit: number;
  planName: string;
  removedRecently: number;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<TeamMemberRow | null>(null);
  const [pending, setPending] = React.useState(false);
  const [updatingRole, setUpdatingRole] = React.useState<string | null>(null);

  const activeCount = members.filter((member) => member.status === "active").length;
  const pendingCount = members.filter((member) => member.status === "invited").length;
  const seatsUsed = activeCount + pendingCount;
  const ownerCount = members.filter((member) => member.role === "owner").length;

  async function onRoleChange(member: TeamMemberRow, nextRole: string) {
    setUpdatingRole(member.membershipId);
    const result = await changeMemberRole({
      membershipId: member.membershipId,
      role: nextRole,
    });
    setUpdatingRole(null);

    if (result.ok) {
      toast({ variant: "success", title: "Role updated" });
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Role not changed",
        description: result.error,
      });
    }
  }

  async function onRemove() {
    if (!removing) return;
    setPending(true);
    const result = await removeMember(removing.membershipId);
    setPending(false);
    setRemoving(null);

    if (result.ok) {
      toast({ variant: "success", title: "Member removed" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Not removed", description: result.error });
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <SectionHeader
              title="Team members"
              description="Manage who can access this workspace and what they can do."
              action={
                canManage ? (
                  <Button size="sm" onClick={() => setInviteOpen(true)}>
                    <UserPlus className="size-3.5" aria-hidden />
                    Invite member
                  </Button>
                ) : undefined
              }
            />
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const editable =
                    canManage &&
                    canEditMember({
                      actorRole,
                      memberRole: member.role,
                      isSelf,
                      ownerCount,
                    });

                  return (
                    <TableRow key={member.membershipId} className="h-14">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={memberDisplayName(member)} size="md" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-medium text-content">
                              {memberDisplayName(member)}
                              {isSelf && (
                                <Badge tone="neutral" className="shrink-0">
                                  You
                                </Badge>
                              )}
                            </p>
                            <p className="truncate text-[12px] text-content-muted md:hidden">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-content-muted">{member.email}</span>
                      </TableCell>
                      <TableCell>
                        <Select
                          className="h-8 w-[124px] text-[13px]"
                          aria-label={`Role for ${memberDisplayName(member)}`}
                          value={member.role}
                          disabled={!editable || updatingRole === member.membershipId}
                          onChange={(event) =>
                            onRoleChange(member, event.target.value)
                          }
                        >
                          {/* An owner's own role is not assignable, so its
                              option is rendered only for that row. */}
                          {member.role === "owner" && (
                            <option value="owner">{ROLE_LABELS.owner}</option>
                          )}
                          {ASSIGNABLE_ROLES.map((value) => (
                            <option key={value} value={value}>
                              {ROLE_LABELS[value]}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[member.status] ?? "neutral"} dot>
                          {MEMBER_STATUS_LABELS[member.status] ?? member.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-content-muted">
                          {formatDate(member.joinedAt)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        {editable ? (
                          <DropdownMenu
                            align="end"
                            trigger={
                              <IconButton
                                size="xs"
                                label={`Actions for ${memberDisplayName(member)}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </IconButton>
                            }
                          >
                            <DropdownItem
                              icon={Trash2}
                              destructive
                              onSelect={() => setRemoving(member)}
                            >
                              Remove member
                            </DropdownItem>
                          </DropdownMenu>
                        ) : (
                          <span className="text-[12px] text-content-subtle">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <aside className="space-y-4" aria-label="Team overview">
          <Card>
            <CardHeader>
              <SectionHeader icon={Users} title="Team overview" tone="info" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="lr-tabular text-[30px] font-semibold leading-none text-content">
                  {members.length}
                </p>
                <p className="text-[13px] text-content-muted">team members</p>
              </div>
              <ul className="space-y-2 border-t border-line pt-3 text-[13px]">
                <li className="flex items-center gap-2.5">
                  <span aria-hidden className="size-2 rounded-full bg-success-500" />
                  <span className="lr-tabular w-5 font-semibold text-content">
                    {activeCount}
                  </span>
                  <span className="text-content-muted">Active members</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span aria-hidden className="size-2 rounded-full bg-warning-500" />
                  <span className="lr-tabular w-5 font-semibold text-content">
                    {pendingCount}
                  </span>
                  <span className="text-content-muted">
                    Pending {pendingCount === 1 ? "invitation" : "invitations"}
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span aria-hidden className="size-2 rounded-full bg-content-subtle" />
                  <span className="lr-tabular w-5 font-semibold text-content">
                    {removedRecently}
                  </span>
                  <span className="text-content-muted">Removed in last 30 days</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span aria-hidden className="size-2 rounded-full bg-accent-500" />
                  <span className="lr-tabular w-5 font-semibold text-content">
                    {Math.max(seatLimit - seatsUsed, 0)}
                  </span>
                  <span className="text-content-muted">
                    Seats left on {planName}
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader icon={Shield} title="Roles" tone="info" />
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {ROLE_HELP.map((entry) => (
                  <li key={entry.role} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${ROLE_DOT[entry.role]}`}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-content">
                        {ROLE_LABELS[entry.role]}
                      </p>
                      <p className="text-[13px] text-content-muted">{entry.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {canManage && (
            <Card>
              <CardHeader>
                <SectionHeader icon={Trash2} title="Need to remove someone?" tone="danger" />
              </CardHeader>
              <CardContent>
                <p className="text-[13px] text-content-muted">
                  You can remove a team member at any time. They lose access to
                  this workspace immediately, and any leads assigned to them
                  become unassigned. Their message history stays on the lead
                  record. The last owner can never be removed.
                </p>
                <Link
                  href="/app/help"
                  className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-line-strong bg-surface text-[13px] font-medium text-content shadow-xs transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                >
                  Learn more
                </Link>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3.5">
        <Info className="mt-0.5 size-4 shrink-0 text-info-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-content">
            Changes are saved automatically
          </p>
          <p className="text-[13px] text-content-muted">
            Team member changes take effect immediately.
          </p>
        </div>
      </div>

      {/* Mounted only while open so its fields start empty every time,
          rather than being reset from an effect. */}
      {inviteOpen && (
        <InviteMemberDialog
          open
          onClose={() => setInviteOpen(false)}
          atSeatLimit={seatsUsed >= seatLimit}
          seatLimit={seatLimit}
          planName={planName}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={onRemove}
        loading={pending}
        variant="danger"
        title="Remove this member?"
        scope={
          removing
            ? `${memberDisplayName(removing)} (${removing.email}) — ${ROLE_LABELS[removing.role]} — loses access to this workspace immediately.`
            : ""
        }
        consequence="Any leads assigned to them become unassigned. Their message history stays on the lead record."
        confirmLabel="Remove member"
      />
    </div>
  );
}
