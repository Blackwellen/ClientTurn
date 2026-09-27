import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Start your ClientTurn trial and follow up with every lead within seconds.",
};

/** The plan picked on /pricing, carried through to the trial checkout (8.29). */
function pickedPlan(value: string | string[] | undefined): string | null {
  const plan = Array.isArray(value) ? value[0] : value;
  return plan === "starter" || plan === "growth" || plan === "pro" ? plan : null;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const plan = pickedPlan((await searchParams).plan);
  return (
    <AuthShell variant="signup">
      <AuthCard width="lg">
        <AuthCardHeader
          eyebrow="Create your account"
          title="Get started with ClientTurn"
          description="Set up your account in minutes and start converting more leads into paying clients."
        />
        <SignupForm plan={plan} />
      </AuthCard>
    </AuthShell>
  );
}
