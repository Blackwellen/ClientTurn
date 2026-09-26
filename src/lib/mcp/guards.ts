/**
 * Pure permission checks for the MCP surface, split out of the server-only
 * modules so they can be asserted directly.
 */

export type ApproverRole = "owner" | "admin" | "member" | "viewer";

const ROLES: readonly string[] = ["owner", "admin", "member", "viewer"];

/**
 * Whose authority an approved MCP request runs on.
 *
 * Only an *active* member of the workspace may cause an approval to execute.
 * A suspended, removed or merely invited member keeps their `role` column, so
 * reading the role alone would let someone who has been locked out still
 * carry out a high-impact action. A missing membership is a refusal, never a
 * silent fallback to "viewer".
 */
export function approverAuthority(
  membership: { role: string | null; status: string | null } | null,
): { ok: true; role: ApproverRole } | { ok: false; message: string } {
  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      message: "Only an active member of this workspace can approve that request.",
    };
  }
  if (!membership.role || !ROLES.includes(membership.role)) {
    return { ok: false, message: "Your role in this workspace could not be confirmed." };
  }
  return { ok: true, role: membership.role as ApproverRole };
}

/**
 * The refusal `create_lead` returns when any supplied destination is
 * suppressed, or null when none is. A suppressed contact cannot be added as a
 * lead over MCP, mirroring the Add Lead wizard where suppression "cannot be
 * overridden here".
 */
export function suppressionRefusal(
  hits: ({ reason: string } | null | undefined)[],
): string | null {
  return hits.some(Boolean)
    ? "That contact is on this workspace's suppression list, so it cannot be added as a lead."
    : null;
}
