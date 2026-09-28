import "server-only";
import { requireWorkspace, type ActiveWorkspace } from "@/lib/auth/session";
import { capabilityAllowed, effectiveCapabilities, type Capability } from "./capabilities";
import { readCapabilityOverrides } from "./capability-overrides";

export { readCapabilityOverrides, readWorkspaceOverrides, CapabilityReadError } from "./capability-overrides";

/**
 * Server-side checks for per-person capabilities (`./capabilities.ts` holds
 * the rules). The overrides are re-read on every check: a permission removed a
 * second ago is honoured now, never cached in a session or a token.
 */

export async function workspaceCan(
  workspace: Pick<ActiveWorkspace, "businessId" | "userId" | "role">,
  capability: Capability,
): Promise<boolean> {
  try {
    const overrides = await readCapabilityOverrides(workspace.businessId, workspace.userId);
    return capabilityAllowed(workspace.role, capability, overrides);
  } catch {
    return false;
  }
}

export async function workspaceCapabilities(
  workspace: Pick<ActiveWorkspace, "businessId" | "userId" | "role">,
): Promise<Record<Capability, boolean>> {
  try {
    const overrides = await readCapabilityOverrides(workspace.businessId, workspace.userId);
    return effectiveCapabilities(workspace.role, overrides);
  } catch {
    return effectiveCapabilities("viewer", null);
  }
}

/**
 * The server-side gate for a Server Action or route handler. Throws
 * `Error("FORBIDDEN")`, the same shape `requireRole` throws, so existing
 * `.catch(() => null)` call sites keep working unchanged.
 */
export async function requireCapability(capability: Capability): Promise<ActiveWorkspace> {
  const workspace = await requireWorkspace();
  if (!(await workspaceCan(workspace, capability))) throw new Error("FORBIDDEN");
  return workspace;
}
