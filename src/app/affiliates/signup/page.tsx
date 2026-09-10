import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { getUser } from "@/lib/auth/session";
import { getAffiliate } from "@/lib/affiliates/queries";
import { SignupClosed } from "@/components/auth/signup-closed";
import { SELF_SERVE_SIGNUP_OPEN } from "@/lib/auth/signup-mode";
import { PartnerSignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Join the partner programme | ClientTurn",
  description:
    "Create a ClientTurn partner account and earn recurring commission on the businesses you introduce.",
};

export const dynamic = "force-dynamic";

export default async function PartnerSignUpPage() {
  // Someone signed in does not need to create an account. Where they go
  // depends on how far through they already are — the same three-way split
  // the onboarding guard makes, for the same reason.
  const user = await getUser();
  if (user) {
    const affiliate = await getAffiliate();
    redirect(affiliate ? "/affiliates/app" : "/affiliates/onboarding");
  }

  if (!SELF_SERVE_SIGNUP_OPEN) {
    return (
      <AuthShell variant="partner-signup">
        <AuthCard>
          <AuthCardHeader
            eyebrow="Invite only"
            title="Coming soon"
            description="The ClientTurn partner programme is not open for applications yet. We are onboarding our first businesses by hand first."
          />
          <SignupClosed
            signInHref="/affiliates/login"
            signInLabel="Sign in to your partner account"
          />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="partner-signup">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Create your partner account"
          title="Join the partner programme"
          description="Set up your account in minutes, then tell us about your audience. A person reviews every application."
        />
        <PartnerSignUpForm />
      </AuthCard>
    </AuthShell>
  );
}
