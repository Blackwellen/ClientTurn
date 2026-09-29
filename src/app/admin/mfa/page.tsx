import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { MfaGateForm } from "@/components/auth/mfa-gate-form";
import { ADMIN_LOGIN_PATH, getPlatformOperatorSession } from "@/lib/admin/guard";
import { getAccountMfa } from "@/lib/auth/account-security";
import { evaluateAdminAccess } from "@/lib/auth/security-policy";
import { adminSignOut } from "@/lib/admin/actions";

export const metadata: Metadata = {
  title: "Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function signOutOperator() {
  "use server";
  await adminSignOut();
  redirect(ADMIN_LOGIN_PATH);
}

/**
 * Mandatory two-factor for platform administrators (IR-06). Reached after the
 * password step of /admin/login, and whenever /admin is opened by a session
 * that has not passed two-factor. An operator without an authenticator must
 * set one up here before any admin page opens.
 */
export default async function AdminMfaPage() {
  const session = await getPlatformOperatorSession();
  // Not an operator: same answer as a signed-out visitor, as /admin/login gives.
  if (!session) redirect(ADMIN_LOGIN_PATH);

  const decision = evaluateAdminAccess(session.mfa);
  if (decision === "ok") redirect("/admin");

  const mfa = await getAccountMfa();
  const factors = (mfa?.factors ?? []).map((factor) => ({
    id: factor.id,
    friendlyName: factor.friendlyName,
  }));
  const mode = decision === "mfa_setup" ? "setup" : "verify";

  return (
    <AuthShell variant="admin">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Platform operations"
          title={mode === "setup" ? "Set up two-factor" : "Enter your code"}
          description={
            mode === "setup"
              ? "Two-factor authentication is mandatory for platform administrators. Add an authenticator app to continue."
              : "Enter the current code from your authenticator app. It also confirms you for admin changes for the next 30 minutes."
          }
        />

        <MfaGateForm surface="admin" mode={mode} factors={factors} />

        <div className="mt-7 flex items-start gap-3 rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
          <ShieldCheck className="mt-px size-4 shrink-0 text-[var(--auth-lime)]" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-[var(--auth-text-muted)]">
            Keep a second authenticator enrolled (Admin, Settings, Your sign-in security). If
            every device is lost, recovery is done by the owner in the Supabase dashboard, as
            described in docs/security/MFA_AND_SESSIONS.md.
          </p>
        </div>

        <form action={signOutOperator} className="mt-6 border-t border-white/8 pt-5 text-center">
          <button
            type="submit"
            className="text-[13px] font-medium text-[var(--auth-text-muted)] underline underline-offset-4 hover:text-[var(--auth-text)]"
          >
            Sign out
          </button>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
