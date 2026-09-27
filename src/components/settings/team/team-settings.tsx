"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Crown,
  Info,
  MailPlus,
  MoreHorizontal,
  Shield,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DropdownItem, DropdownMenu } from "@/components/ui/dropdown";
import { FormField, Input, Select } from "@/components/ui/form";
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
import {
  changeMemberRoleAction,
  removeMemberAction,
  resendInviteAction,
  transferOwnershipAction,
  type TeamActionResult,
} from "@/lib/settings/team-actions";
import {
  ASSIGNABLE_ROLES,
  MEMBER_STATUS_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  memberDisplayName,
  type BusinessRole,
  type TeamMemberRow,
} from "@/lib/settings/types";
import { INVITE_TTL_DAYS, memberActions } from "@/lib/team/rules";
import { InviteMemberDialog } from "./invite-member-dialog";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  invited: "warning",
  expired: "danger",
  suspended: "neutral",
  removed: "neutral",
};

const ROLE_DOT: Record<string, string> = {
  owner: "bg-purple-500",
  admin: "bg-info-500",
  member: "bg-content-subtle",
  viewer: "bg-line-strong",
};

const ROLE_ORDER: BusinessRole[] = ["owner", "admin", "member", "viewer"];

export function TeamSettings({
  members,
  currentUserId,
  actorRole,
  canManage,
  seatLimit,
  seatsUsed,
  expiredInviteIds,
  planName,
  removedRecently,
}: {
  members: TeamMemberRow[];
  currentUserId: string;
  actorRole: BusinessRole;
  canManage: boolean;
  seatLimit: number;
  /** Active, suspended and unexpired invitations (src/lib/team/rules). */
  seatsUsed: number;
  expiredInviteIds: string[];
  planName: string;
  removedRecently: number;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<TeamMemberRow | null>(null);
  const [reassignTo, setReassignTo] = React.useState("");
  const [revoking, setRevoking] = React.useState<TeamMemberRow | null>(null);
  const [transferring, setTransferring] = React.useState<TeamMemberRow | null>(null);
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [updatingRole, setUpdatingRole] = React.useState<string | null>(null);

  const expired = React.useMemo(() => new Set(expiredInviteIds), [expiredInviteIds]);
  const activeCount = members.filter((member) => member.status === "active").length;
  const pendingCount = members.filter(
    (member) => member.status === "invited" && !expired.has(member.membershipId),
  ).length;
  const actor = { userId: currentUserId, role: actorRole };
  // Who can inherit a leaving member's work: active people who can work leads.
  const recipients = members.filter(
    (member) =>
      member.status === "active" &&
      member.role !== "viewer" &&
      member.membershipId !== removing?.membershipId,
  );

  /** Toasts the outcome and refreshes; true on success. */
  function report(result: TeamActionResult, failureTitle: string): boolean {
    if (result.ok) {
      toast({ variant: "success", title: result.message, description: result.warning });
      router.refresh();
      return true;
    }
    toast({ variant: "error", title: failureTitle, description: result.error });
    return false;
  }

  async function onRoleChange(member: TeamMemberRow, nextRole: string) {
    setUpdatingRole(member.membershipId);
    const result = await changeMemberRoleAction({
      membershipId: member.membershipId,
      role: nextRole,
    });
    setUpdatingRole(null);
    report(result, "Role not changed");
  }

  async function onResend(member: TeamMemberRow) {
    report(
      await resendInviteAction({ membershipId: member.membershipId }),
      "Invitation not sent",
    );
  }

  async function onRevoke() {
    if (!revoking) return;
    const result = await removeMemberAction({
      membershipId: revoking.membershipId,
      reassignToUserId: null,
    });
    if (report(result, "Invitation not revoked")) setRevoking(null);
  }

  async function onRemove() {
    if (!removing) return;
    const result = await removeMemberAction({
      membershipId: removing.membershipId,
      reassignToUserId: reassignTo || null,
    });
    if (report(result, "Not removed")) setRemoving(null);
  }

  async function onTransfer() {
    if (!transferring) return;
    const result = await transferOwnershipAction({
      membershipId: transferring.membershipId,
      confirmEmail,
    });
    if (report(result, "Ownership not transferred")) setTransferring(null);
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_320px]">
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
                  <TableHead className="hidden md:table-cell xl:hidden 2xl:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const isExpired = expired.has(member.membershipId);
                  const status = isExpired ? "expired" : member.status;
                  const allowed = memberActions({
                    actor,
                    target: {
                      userId: member.userId,
                      role: member.role,
                      status: member.status,
                      invitedAt: member.invitedAt,
                    },
                  });
                  const hasMenu =
                    allowed.remove || allowed.resend || allowed.revoke || allowed.transfer;

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
                            <p className="truncate text-[12px] text-content-muted md:hidden xl:block 2xl:hidden">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell xl:hidden 2xl:table-cell">
                        <span className="text-content-muted">{member.email}</span>
                      </TableCell>
                      <TableCell>
                        <Select
                          className="h-8 w-[124px] text-[13px]"
                          aria-label={`Role for ${memberDisplayName(member)}`}
                          value={member.role}
                          disabled={!allowed.changeRole || updatingRole === member.membershipId}
                          onChange={(event) => onRoleChange(member, event.target.value)}
                        >
                          {/* The owner role is never assignable, so its option
                              is rendered only for the owner's own row. */}
                          {member.role === "owner" && (
                            <option value="owner">{ROLE_LABELS.owner}</option>
                          )}
                          {ASSIGNABLE_ROLES.map((value) => (
                            <option
                              key={value}
                              value={value}
                              // Only the owner makes someone an admin.
                              disabled={value === "admin" && actorRole !== "owner" && member.role !== "admin"}
                            >
                              {ROLE_LABELS[value]}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge
                          tone={STATUS_TONE[status] ?? "neutral"}
                          dot
                          title={
                            isExpired
                              ? `Invitations lapse after ${INVITE_TTL_DAYS} days. Resend it to give them another ${INVITE_TTL_DAYS}.`
                              : undefined
                          }
                        >
                          {isExpired
                            ? "Invite expired"
                            : (MEMBER_STATUS_LABELS[member.status] ?? member.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="whitespace-nowrap text-content-muted">
                          {member.status === "invited" ? "—" : formatDate(member.joinedAt)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        {hasMenu ? (
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
                            {allowed.resend && (
                              <DropdownItem icon={MailPlus} onSelect={() => onResend(member)}>
                                Resend invitation
                              </DropdownItem>
                            )}
                            {allowed.revoke && (
                              <DropdownItem
                                icon={XCircle}
                                destructive
                                onSelect={() => setRevoking(member)}
                              >
                                Revoke invitation
                              </DropdownItem>
                            )}
                            {allowed.transfer && (
                              <DropdownItem
                                icon={Crown}
                                onSelect={() => {
                                  setConfirmEmail("");
                                  setTransferring(member);
                                }}
                              >
                                Make owner
                              </DropdownItem>
                            )}
                            {allowed.remove && (
                              <DropdownItem
                                icon={Trash2}
                                destructive
                                onSelect={() => {
                                  setReassignTo("");
                                  setRemoving(member);
                                }}
                              >
                                Remove member
                              </DropdownItem>
                            )}
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
                  {seatsUsed}
                  <span className="text-[16px] font-medium text-content-muted">
                    {" "}
                    / {seatLimit}
                  </span>
                </p>
                <p className="text-[13px] text-content-muted">seats used on {planName}</p>
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
                    Open {pendingCount === 1 ? "invitation" : "invitations"}
                  </span>
                </li>
                {expired.size > 0 && (
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden className="size-2 rounded-full bg-danger-500" />
                    <span className="lr-tabular w-5 font-semibold text-content">
                      {expired.size}
                    </span>
                    <span className="text-content-muted">
                      Expired {expired.size === 1 ? "invitation" : "invitations"} (no seat)
                    </span>
                  </li>
                )}
                <li className="flex items-center gap-2.5">
                  <span aria-hidden className="size-2 rounded-full bg-content-subtle" />
                  <span className="lr-tabular w-5 font-semibold text-content">
                    {removedRecently}
                  </span>
                  <span className="text-content-muted">Removed in last 30 days</span>
                </li>
              </ul>
              {canManage && seatsUsed >= seatLimit && (
                <p className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
                  Every seat is in use.{" "}
                  <Link
                    href="/app/settings?section=billing"
                    className="font-medium underline underline-offset-2"
                  >
                    Compare plans
                  </Link>{" "}
                  to add more people.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader icon={Shield} title="Roles" tone="info" />
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {ROLE_ORDER.map((role) => (
                  <li key={role} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${ROLE_DOT[role]}`}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-content">
                        {ROLE_LABELS[role]}
                      </p>
                      <p className="text-[13px] text-content-muted">{ROLE_DESCRIPTIONS[role]}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3.5">
        <Info className="mt-0.5 size-4 shrink-0 text-info-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-content">
            Changes take effect immediately
          </p>
          <p className="text-[13px] text-content-muted">
            Removing someone also cuts off any API keys and connected assistants
            acting as them. Every change is recorded in the audit log.
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
          actorRole={actorRole}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={onRemove}
        variant="danger"
        title="Remove this member?"
        scope={
          removing
            ? `${memberDisplayName(removing)} (${removing.email}) — ${ROLE_LABELS[removing.role]} — loses access to this workspace immediately.`
            : ""
        }
        consequence="Their open leads, conversations and handovers go to the person you choose below. Their message history stays on every record."
        confirmLabel="Remove member"
      >
        <FormField
          label="Give their open work to"
          htmlFor="remove-reassign"
          hint="Leave unassigned to put it back in the shared queue."
        >
          <Select
            id="remove-reassign"
            value={reassignTo}
            onChange={(event) => setReassignTo(event.target.value)}
          >
            <option value="">Nobody — leave unassigned</option>
            {recipients.map((member) => (
              <option key={member.membershipId} value={member.userId ?? ""}>
                {memberDisplayName(member)} ({ROLE_LABELS[member.role]})
              </option>
            ))}
          </Select>
        </FormField>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={onRevoke}
        variant="danger"
        title="Revoke this invitation?"
        scope={revoking ? `The invitation to ${revoking.email} stops working.` : ""}
        consequence="Their seat is freed straight away. You can invite them again later."
        confirmLabel="Revoke invitation"
      />

      <ConfirmDialog
        open={Boolean(transferring)}
        onClose={() => setTransferring(null)}
        onConfirm={onTransfer}
        variant="warning"
        title="Transfer ownership?"
        scope={
          transferring
            ? `${memberDisplayName(transferring)} becomes the owner of this workspace, with control of billing and the team.`
            : ""
        }
        consequence="You become an admin. Only the new owner can give ownership back."
        confirmLabel="Transfer ownership"
      >
        <FormField
          label="Type their email address to confirm"
          htmlFor="transfer-confirm"
          hint={transferring?.email}
        >
          <Input
            id="transfer-confirm"
            type="email"
            autoComplete="off"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
