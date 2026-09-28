"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  CAPABILITIES,
  canOverride,
  capabilityAllowed,
  permissionChangeProblem,
  roleDefault,
  valueToChoice,
  type Capability,
  type CapabilityOverrides,
  type OverrideChoice,
} from "@/lib/auth/capabilities";
import { setMemberPermissionAction } from "@/lib/settings/team-actions";
import { ROLE_LABELS, type BusinessRole } from "@/lib/settings/types";

export type PermissionRow = {
  membershipId: string;
  userId: string | null;
  name: string;
  role: BusinessRole;
  status: string;
  overrides: CapabilityOverrides;
};

const ROLES: BusinessRole[] = ["owner", "admin", "member", "viewer"];

/**
 * Settings -> Team -> Permissions. The per-person capability overrides
 * (0172). The server re-checks every change (`member.set_permissions`); this
 * only hides the controls it would refuse.
 */
export function MemberPermissions({
  rows,
  actorRole,
  currentUserId,
  canManage,
  available,
}: {
  rows: PermissionRow[];
  actorRole: BusinessRole;
  currentUserId: string;
  canManage: boolean;
  /** False until migration 0172 is applied: the matrix shows, editing does not. */
  available: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  async function change(row: PermissionRow, capability: Capability, choice: OverrideChoice) {
    const key = `${row.membershipId}:${capability}`;
    setPending(key);
    const result = await setMemberPermissionAction({
      membershipId: row.membershipId,
      capability,
      choice,
    });
    setPending(null);
    if (result.ok) {
      toast({ variant: "success", title: result.message, description: result.warning });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Permissions not changed", description: result.error });
    }
  }

  const people = rows.filter((row) => row.status !== "removed");

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <KeyRound className="h-4 w-4 text-content-muted" aria-hidden />
            Permissions
          </h3>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Each role comes with the defaults below. For larger teams you can allow or
            withhold outbound sending, integrations and billing per person. Viewers are
            read-only (analyst seats) and the owner always has everything.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Role defaults matrix */}
        <div className="-mx-1 overflow-x-auto rounded-lg border border-line">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Role default</TableHead>
                {CAPABILITIES.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLES.map((role) => (
                <TableRow key={role}>
                  <TableCell className="font-medium">{ROLE_LABELS[role]}</TableCell>
                  {CAPABILITIES.map((c) => (
                    <TableCell key={c.key}>
                      <Badge tone={roleDefault(role, c.key) ? "success" : "neutral"} dense>
                        {roleDefault(role, c.key) ? "Yes" : "No"}
                        {canOverride(role, c.key) ? " · adjustable" : ""}
                      </Badge>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {!available ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-[12.5px] text-content-muted">
            Per-person permissions are not switched on for this workspace yet. Everyone has
            their role&rsquo;s defaults above.
          </p>
        ) : people.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-content-muted">
            Nobody to show yet. Invite someone to set their permissions.
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto rounded-lg border border-line">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Person</TableHead>
                  {CAPABILITIES.map((c) => (
                    <TableHead key={c.key} title={c.description}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((row) => (
                  <TableRow key={row.membershipId}>
                    <TableCell className="min-w-[180px]">
                      <span className="block font-medium text-content">{row.name}</span>
                      <span className="text-[12px] text-content-muted">{ROLE_LABELS[row.role]}</span>
                    </TableCell>
                    {CAPABILITIES.map((c) => {
                      const effective = capabilityAllowed(row.role, c.key, row.overrides);
                      const problem = canManage
                        ? permissionChangeProblem({
                            actor: { userId: currentUserId, role: actorRole },
                            target: { userId: row.userId, role: row.role, status: row.status },
                            capability: c.key,
                          })
                        : "Only an owner or admin can change permissions.";
                      const key = `${row.membershipId}:${c.key}`;
                      if (problem) {
                        return (
                          <TableCell key={c.key} title={problem}>
                            <Badge tone={effective ? "success" : "neutral"} dense>
                              {effective ? "Allowed" : "Not allowed"}
                            </Badge>
                          </TableCell>
                        );
                      }
                      const defaultLabel = roleDefault(row.role, c.key) ? "yes" : "no";
                      return (
                        <TableCell key={c.key} className="min-w-[170px]">
                          <Select
                            className="h-8 w-[160px] text-[13px]"
                            aria-label={`${c.label} for ${row.name}`}
                            value={valueToChoice(row.overrides[c.key])}
                            disabled={pending === key}
                            onChange={(event) =>
                              change(row, c.key, event.target.value as OverrideChoice)
                            }
                          >
                            <option value="default">Role default ({defaultLabel})</option>
                            <option value="allow">Allowed</option>
                            <option value="deny">Not allowed</option>
                          </Select>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[12px] text-content-subtle">
          Changes apply immediately and are checked on the server for every action, from
          the app, the API and MCP. Each change is written to the audit log. Changing
          someone&rsquo;s role resets their permissions to the new role&rsquo;s defaults.
        </p>
      </CardContent>
    </Card>
  );
}
