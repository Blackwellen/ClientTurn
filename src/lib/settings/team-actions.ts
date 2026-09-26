"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace, type BusinessRole } from "@/lib/auth/session";
import { runOperation, type ServiceResult } from "@/lib/services";

/**
 * Team settings actions (coverage tracker 8.15).
 *
 * Thin by design: resolve the actor, run the `member.*` service operation.
 * Every guardrail — seat limit, last owner, admins-only-by-owner, reassignment
 * target, typed ownership confirmation — lives behind `runOperation`, the same
 * path MCP and the API take, so the UI cannot do anything they cannot.
 */

export type TeamActionResult = { ok: true; message: string; warning?: string } | { ok: false; error: string };

async function actor(minimum: BusinessRole): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole(minimum);
  } catch {
    return null;
  }
}

function context(workspace: ActiveWorkspace, confirmed = false) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    correlationId: randomUUID(),
    // The dialog the person just confirmed is the confirmation these
    // EXTERNAL / DESTRUCTIVE operations need.
    confirmed,
  };
}

function settle(result: ServiceResult, message: string): TeamActionResult {
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app", "layout");
  revalidatePath("/app/settings");
  return { ok: true, message, warning: result.warnings[0]?.message };
}

const DENIED = { ok: false as const, error: "Only an owner or admin can manage the team." };

export async function inviteMemberAction(input: { email: string; role: string }): Promise<TeamActionResult> {
  const workspace = await actor("admin");
  if (!workspace) return DENIED;
  const result = await runOperation("member.invite", input, context(workspace, true));
  return settle(result, "Invitation sent. They appear as Invited until they accept.");
}

export async function resendInviteAction(input: { membershipId: string }): Promise<TeamActionResult> {
  const workspace = await actor("admin");
  if (!workspace) return DENIED;
  const result = await runOperation("member.resend_invite", input, context(workspace, true));
  return settle(result, "Invitation sent again.");
}

export async function changeMemberRoleAction(input: {
  membershipId: string;
  role: string;
}): Promise<TeamActionResult> {
  const workspace = await actor("admin");
  if (!workspace) return DENIED;
  const result = await runOperation("member.set_role", input, context(workspace));
  return settle(result, "Role updated.");
}

export async function removeMemberAction(input: {
  membershipId: string;
  reassignToUserId: string | null;
}): Promise<TeamActionResult> {
  const workspace = await actor("admin");
  if (!workspace) return DENIED;
  const result = await runOperation<{ revoked: boolean }>(
    "member.remove",
    input,
    context(workspace, true),
  );
  return settle(
    result,
    result.success && result.data.revoked ? "Invitation revoked." : "Member removed.",
  );
}

export async function transferOwnershipAction(input: {
  membershipId: string;
  confirmEmail: string;
}): Promise<TeamActionResult> {
  const workspace = await actor("owner");
  if (!workspace) return { ok: false, error: "Only the workspace owner can transfer ownership." };
  const result = await runOperation("member.transfer_ownership", input, context(workspace, true));
  return settle(result, "Ownership transferred. You are now an admin.");
}
