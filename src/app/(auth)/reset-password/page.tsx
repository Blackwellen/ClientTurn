import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password | ClientTurn",
  description: "Choose a new password for your ClientTurn account.",
};

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AuthShell variant="reset">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Reset your password"
          title="Set a new password"
          description="Choose a strong password for your account and get back to your business."
        />
        <ResetPasswordForm hasSession={Boolean(user)} />
      </AuthCard>
    </AuthShell>
  );
}
