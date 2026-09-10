import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { SignupClosed } from "@/components/auth/signup-closed";
import { SELF_SERVE_SIGNUP_OPEN } from "@/lib/auth/signup-mode";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = SELF_SERVE_SIGNUP_OPEN
  ? {
      title: "Create your account | ClientTurn",
      description:
        "Start your ClientTurn trial and follow up with every lead within seconds.",
    }
  : {
      title: "Coming soon | ClientTurn",
      description: "ClientTurn is invite-only while we onboard our first businesses.",
      robots: { index: false, follow: false },
    };

export default function SignupPage() {
  if (!SELF_SERVE_SIGNUP_OPEN) {
    return (
      <AuthShell variant="signup">
        <AuthCard>
          <AuthCardHeader
            eyebrow="Invite only"
            title="Coming soon"
            description="ClientTurn is not open for public sign-up yet. Accounts are created by invitation while we onboard our first businesses."
          />
          <SignupClosed />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="signup">
      <AuthCard width="lg">
        <AuthCardHeader
          eyebrow="Create your account"
          title="Get started with ClientTurn"
          description="Set up your account in minutes and start converting more leads into paying clients."
        />
        <SignupForm />
      </AuthCard>
    </AuthShell>
  );
}
