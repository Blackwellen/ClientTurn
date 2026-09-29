import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { MfaGateForm } from "@/components/auth/mfa-gate-form";
import { getAccountMfa, getWorkspaceSecurity } from "@/lib/auth/account-security";
import { getActiveWorkspace } from "@/lib/auth/session";
import { sanitizeRedirectPath } from "@/lib/auth/destination";
import { signOut } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Two-factor authentication",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function signOutToLogin() {
  "use server";
  await signOut("/login");
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The customer two-factor door. `requireWorkspace()` sends people here when
 * they have an authenticator but have not used it this session, or when their
 * workspace requires two-factor and they have not set it up. Deliberately
 * outside the app shell: the shell itself is what they cannot reach yet.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = sanitizeRedirectPath(one(params.next)) ?? undefined;

  const mfa = await getAccountMfa();
  if (!mfa) redirect("/login");

  if (mfa.verifiedFactorCount > 0 && mfa.currentAal === "aal2") redirect(next ?? "/app");

  const workspace = await getActiveWorkspace();
  const required = workspace ? (await getWorkspaceSecurity(workspace.businessId)).requireMfa : false;
  const mode = mfa.verifiedFactorCount > 0 ? "verify" : "setup";

  return (
    <AuthShell variant="login">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Two-factor authentication"
          title={mode === "verify" ? "Enter your code" : "Set up two-factor"}
          description={
            mode === "verify"
              ? "Your account is protected by an authenticator app. Enter the code it shows to continue."
              : required
                ? `${workspace?.businessName ?? "Your workspace"} requires two-factor authentication for every member. It takes about a minute.`
                : "Add an authenticator app so a stolen password is not enough to get into your account."
          }
        />

        <MfaGateForm
          surface="app"
          mode={mode}
          next={next}
          factors={mfa.factors.map((factor) => ({ id: factor.id, friendlyName: factor.friendlyName }))}
        />

        <div className="mt-7 flex items-start gap-3 rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
          <ShieldCheck className="mt-px size-4 shrink-0 text-[var(--auth-lime)]" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-[var(--auth-text-muted)]">
            Lost your device? Ask your workspace owner to contact ClientTurn support, who can
            remove the authenticator after confirming who you are. You then set up a new one.
          </p>
        </div>

        <form action={signOutToLogin} className="mt-6 border-t border-white/8 pt-5 text-center">
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
