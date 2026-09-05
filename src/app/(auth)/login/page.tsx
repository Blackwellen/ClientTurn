import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in | ClientTurn",
  description: "Sign in to your ClientTurn workspace.",
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (value.startsWith("/login") || value.startsWith("/signup")) return undefined;
  return value;
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

  const problem =
    one(params.error) === "link_invalid"
      ? "That link is no longer valid. Sign in below, or request a new link."
      : undefined;

  return (
    <AuthShell variant="login">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Sign in to your account"
          title="Welcome back"
          description="Sign in to your ClientTurn account and continue where you left off."
        />
        <LoginForm redirectTo={redirectTo} notice={notice} problem={problem} />
      </AuthCard>
    </AuthShell>
  );
}
