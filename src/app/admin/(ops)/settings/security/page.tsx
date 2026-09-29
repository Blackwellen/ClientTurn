import * as React from "react";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { getAccountMfa } from "@/lib/auth/account-security";
import { listMySessions } from "@/lib/auth/security-queries";
import { describeUserAgent } from "@/lib/auth/security-policy";
import { AccountSecurityPanel } from "@/components/security/account-security-panel";

export const metadata: Metadata = {
  title: "Your sign-in security",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The operator's own sign-in security: authenticators (a backup is strongly
 * recommended; the last one cannot be removed) and sessions. Removing a
 * factor also needs a current step-up (password + code).
 */
export default async function AdminSecurityPage() {
  await requirePlatformAdmin();
  const [mfa, sessions] = await Promise.all([getAccountMfa(), listMySessions()]);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
          Your sign-in security
        </h1>
        <p className="mt-1 text-[14px] text-content-muted">
          Two-factor authentication is mandatory for platform administrators. Keep at least two
          authenticators so a lost phone does not lock you out.
        </p>
      </div>
      <AccountSecurityPanel
        surface="admin"
        factors={mfa?.factors ?? []}
        sessions={
          sessions.available
            ? sessions.sessions.map((session) => ({
                id: session.id,
                device: describeUserAgent(session.userAgent),
                ip: session.ip,
                createdAt: session.createdAt,
                lastActiveAt: session.lastActiveAt,
                isCurrent: session.isCurrent,
                twoFactor: session.aal === "aal2",
              }))
            : null
        }
        sessionsNote={
          sessions.available
            ? undefined
            : "The session list appears once migration 0180 is applied. The sign-out buttons still work."
        }
        mfaRequiredNote={
          (mfa?.factors.length ?? 0) < 2
            ? "You have one authenticator. Add a backup: the last one can never be removed."
            : undefined
        }
      />
    </div>
  );
}
