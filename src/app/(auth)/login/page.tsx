import { safeRelativePath } from "@/lib/security/safe-redirect";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your ClientTurn workspace.",
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safePath(value: string | undefined): string | undefined {
  const path = safeRelativePath(value);
  if (!path) return undefined;
  if (path.startsWith("/login") || path.startsWith("/signup")) return undefined;
  return path;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const redirectTo = safePath(one(params.redirect));

  const notice =
    one(params.reset) === "1"
      ? "Your password has been updated. Sign in with your new password."
      : one(params.verified) === "1"
        ? "Your email is confirmed. Sign in to continue."
        : undefined;

  const errorCode = one(params.error);
  const problem =
    errorCode === "link_invalid"
      ? "That link is no longer valid. Sign in below, or request a new link."
      : errorCode === "signup_failed"
        ? "We could not finish creating your account. Please try again, or sign up with your email instead."
        : errorCode === "google_unavailable"
          ? "Google sign-in is not available right now. Sign in with your email and password instead."
          : undefined;

  return (
    <AuthShell variant="login">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Sign in to your account"
          title="Welcome back"
          description="Sign in to your ClientTurn account and continue where you left off."
        />
        <LoginForm
          redirectTo={redirectTo}
          notice={notice}
          problem={problem}
        />
      </AuthCard>
    </AuthShell>
  );
}
