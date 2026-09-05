"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form";
import { PlanLimitState } from "@/components/ui/feedback";
import { UsageMeter } from "@/components/ui/progress";
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
import {
  changeMemberRole,
  inviteMember,
  removeMember,
} from "@/lib/settings/actions";
import {
  ASSIGNABLE_ROLES,
  MEMBER_STATUS_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  memberDisplayName,
  type TeamMemberRow,
} from "@/lib/settings/types";

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  invited: "info",
  suspended: "warning",
  removed: "neutral",
};

export function TeamView({
  members,
  currentUserId,
  canManage,
  seatLimit,
  planName,
}: {
  members: TeamMemberRow[];
  currentUserId: string;
  canManage: boolean;
  seatLimit: number;
  planName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [inviting, setInviting] = React.useState(false);
  const [removing, setRemoving] = React.useState<TeamMemberRow | null>(null);
  const [pending, setPending] = React.useState(false);

  const seatsUsed = members.filter((member) =>
    ["active", "invited"].includes(member.status),
  ).length;
  const atLimit = seatsUsed >= seatLimit;

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    const result = await inviteMember({ email, role });
    setInviting(false);

    if (result.ok) {
      setEmail("");
      toast({
        variant: "success",
        title: "Invitation sent",
        description: "They will appear as Invited until they accept.",
      });
      router.refresh();
    } else {
      setInviteError(result.error);
    }
  }

  async function onRoleChange(member: TeamMemberRow, nextRole: string) {
    const result = await changeMemberRole({
      membershipId: member.membershipId,
      role: nextRole,
    });
    if (result.ok) {
      toast({ variant: "success", title: "Role updated" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Role not changed", description: result.error });
    }
  }

  async function onRemove() {
    if (!removing) return;
    setPending(true);
    const result = await removeMember(removing.membershipId);
    setPending(false);
    setRemoving(null);

    if (result.ok) {
      toast({ variant: "success", title: "Person removed" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Not removed", description: result.error });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <SectionHeader
            icon={Users}
            title="People"
            description={`Everyone with access to this workspace, on your ${planName} plan.`}
          />
        </CardHeader>
        <CardContent className="border-line-subtle border-b pt-0 pb-4">
          <UsageMeter label="Seats used" used={seatsUsed} limit={seatLimit} />
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.userId === currentUserId;
                const isOwner = member.role === "owner";
                const editable = canManage && !isSelf && !isOwner;

                return (
                  <TableRow key={member.membershipId}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={memberDisplayName(member)} size="md" />
                        <div className="min-w-0">
                          <p className="text-content truncate font-medium">
                            {memberDisplayName(member)}
                            {isSelf && (
                              <span className="text-content-subtle ml-1.5 text-[12px]">
                                You
                              </span>
                            )}
                          </p>
                          <p className="text-content-muted truncate text-[12px]">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge tone={STATUS_TONE[member.status] ?? "neutral"} dot>
                        {MEMBER_STATUS_LABELS[member.status] ?? member.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Select
                          className="h-8 w-32 text-[13px]"
                          aria-label={`Role for ${memberDisplayName(member)}`}
                          value={member.role}
                          onChange={(event) =>
                            onRoleChange(member, event.target.value)
                          }
                        >
                          {ASSIGNABLE_ROLES.map((value) => (
                            <option key={value} value={value}>
                              {ROLE_LABELS[value]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-content-secondary">
                          {ROLE_LABELS[member.role]}
                        </span>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {editable ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-danger-600 hover:bg-danger-50"
                          onClick={() => setRemoving(member)}
                        >
                          Remove
                        </Button>
                      ) : (
                        <span className="text-content-subtle text-[12px]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <SectionHeader
              icon={UserPlus}
              title="Invite someone"
              description="They receive an email invitation and appear here straight away."
            />
          </CardHeader>
          <CardContent>
            {atLimit ? (
              <PlanLimitState
                title="Every seat on your plan is in use"
                description={`Your ${planName} plan includes ${seatLimit} ${seatLimit === 1 ? "user" : "users"}. Upgrade, or remove someone, to invite another person.`}
                action={
                  <Link
                    href="/app/settings/billing"
                    className="text-content-accent focus-visible:outline-content-accent rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Compare plans
                  </Link>
                }
              />
            ) : (
              <form onSubmit={onInvite} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Email address"
                    htmlFor="invite-email"
                    required
                    error={inviteError ?? undefined}
                  >
                    <Input
                      id="invite-email"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      required
                      value={email}
                      aria-invalid={Boolean(inviteError) || undefined}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </FormField>

                  <FormField
                    label="Role"
                    htmlFor="invite-role"
                    hint={ROLE_DESCRIPTIONS[role as keyof typeof ROLE_DESCRIPTIONS]}
                  >
                    <Select
                      id="invite-role"
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      {ASSIGNABLE_ROLES.map((value) => (
                        <option key={value} value={value}>
                          {ROLE_LABELS[value]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>

                <Button type="submit" size="sm" loading={inviting}>
                  <UserPlus className="size-3.5" aria-hidden />
                  Send invitation
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <p className="text-content-muted text-[13px]">
              Only an owner or admin can invite people or change roles.
            </p>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={onRemove}
        loading={pending}
        variant="danger"
        title="Remove this person?"
        scope={
          removing
            ? `${memberDisplayName(removing)} loses access to this workspace immediately.`
            : ""
        }
        consequence="Any leads assigned to them become unassigned. Their message history stays on the lead record."
        confirmLabel="Remove"
      />
    </div>
  );
}
