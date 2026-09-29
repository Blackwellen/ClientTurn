import * as React from "react";
import { requireWorkspace } from "@/lib/auth/session";
import { getAccountMfa, loadWorkspaceSecurity } from "@/lib/auth/account-security";
import { listMySessions } from "@/lib/auth/security-queries";
import { auditRetentionCapMonths, describeUserAgent } from "@/lib/auth/security-policy";
import { getEntitlements } from "@/lib/billing/entitlements";
import { AccountSecurityPanel } from "@/components/security/account-security-panel";
import { WorkspaceSecurityForm } from "@/components/security/workspace-security-form";

/**
 * Settings -> Security. Two halves: the signed-in person's own sign-in
 * security (every member manages their own), and the workspace policy that
 * only the owner may change. Profile -> Security opens this section.
 */
export async function SecuritySection() {
  const workspace = await requireWorkspace();
  const [mfa, security, sessions, entitlements] = await Promise.all([
    getAccountMfa(),
    loadWorkspaceSecurity(workspace.businessId),
    listMySessions(),
    getEntitlements(workspace.businessId),
  ]);

  const factors = mfa?.factors ?? [];
  const sessionRows = sessions.available
    ? sessions.sessions.map((session) => ({
        id: session.id,
        device: describeUserAgent(session.userAgent),
        ip: session.ip,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        isCurrent: session.isCurrent,
        twoFactor: session.aal === "aal2",
      }))
    : null;

  return (
    <div className="space-y-5">
      <AccountSecurityPanel
        surface="app"
        factors={factors}
        sessions={sessionRows}
        sessionsNote={
          sessions.available
            ? undefined
            : "The session list is not available yet. The sign-out buttons below still work."
        }
        mfaRequiredNote={
          security.policy.requireMfa
            ? "Your workspace requires two-factor, so your last authenticator cannot be removed."
            : undefined
        }
      />
      <WorkspaceSecurityForm
        canEdit={workspace.role === "owner"}
        initial={security.policy}
        retentionCapMonths={auditRetentionCapMonths(entitlements.plan)}
        ownerHasFactor={factors.length > 0}
        settingsAvailable={security.available}
      />
    </div>
  );
}
