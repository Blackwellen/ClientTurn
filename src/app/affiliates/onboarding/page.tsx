import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard } from "@/components/auth/auth-card";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAffiliate, getPublicPlan } from "@/lib/affiliates/queries";
import { OnboardingWizard } from "@/components/affiliates/onboarding-wizard";

export const metadata: Metadata = {
  title: "Finish your application | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Partner onboarding.
 *
 * The guard is a three-way split, and each branch is a different situation
 * rather than a different flavour of "denied":
 *
 * - No session — verification has not happened yet, so sign in at the partner
 *   door and come straight back.
 * - A partner account already exists — there is nothing to apply for, so go to
 *   the dashboard, which shows their actual status.
 * - Signed in with no partner account — this page.
 */
export default async function PartnerOnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/affiliates/login?redirect=/affiliates/onboarding");

  const affiliate = await getAffiliate();
  if (affiliate) redirect("/affiliates/app");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const plan = await getPublicPlan();

  const defaultName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    <AuthShell variant="partner-signup">
      <AuthCard>
        <OnboardingWizard
          defaultName={defaultName}
          defaultEmail={profile?.email ?? user.email ?? ""}
          plan={plan}
        />
      </AuthCard>
    </AuthShell>
  );
}
