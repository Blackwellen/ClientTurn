import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create your account | ClientTurn",
  description:
    "Start your ClientTurn trial and follow up with every lead within seconds.",
};

export default function SignupPage() {
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
