import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password | ClientTurn",
  description: "Request a password reset link for your ClientTurn account.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell variant="forgot">
      <AuthCard width="sm">
        <AuthCardHeader
          eyebrow="Reset your password"
          title="Forgot your password?"
          description="Enter your work email and we'll send you a secure password reset link."
        />
        <ForgotPasswordForm />
      </AuthCard>
    </AuthShell>
  );
}
