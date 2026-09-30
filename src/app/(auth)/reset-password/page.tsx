import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import { isRecoverySession } from "@/lib/auth/recovery-session";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your ClientTurn account.",
};

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  // A signed-in session that did not come from the reset link is not a valid
  // link: the form would only be refused by updatePassword.
  const hasRecoverySession = Boolean(user) && isRecoverySession(session?.access_token);

  return (
    <AuthShell variant="reset">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Reset your password"
          title="Set a new password"
          description="Choose a strong password for your account and get back to your business."
        />
        <ResetPasswordForm hasSession={hasRecoverySession} />
      </AuthCard>
    </AuthShell>
  );
}
