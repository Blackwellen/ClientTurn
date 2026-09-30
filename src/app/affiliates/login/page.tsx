import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { partnerPath } from "@/lib/affiliates/partner-path";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { getUser } from "@/lib/auth/session";
import { getAffiliate } from "@/lib/affiliates/queries";
import { AffiliateLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Partner sign in",
  description:
    "Sign in to the ClientTurn partner portal to track your referral links, commission and payouts.",
};

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AffiliateLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const redirectTo = partnerPath(one(params.redirect));

  // Someone already signed in has no business on a sign-in page. Which way
  // they go depends on whether they are a partner yet — the same split the
  // portal layout makes, for the same reason.
  const user = await getUser();
  if (user) {
    const affiliate = await getAffiliate();
    redirect(affiliate ? redirectTo : "/affiliates");
  }

  const errorCode = one(params.error);
  const problem =
    errorCode === "link_invalid"
      ? "That link is no longer valid. Sign in below, or request a new link."
      : errorCode === "signup_failed"
        ? "We could not finish creating your account. Please try again, or sign up with your email instead."
        : errorCode === "google_unavailable"
          ? "Google sign-in is not available right now. Sign in with your email and password instead."
          : undefined;

  const notice =
    one(params.reset) === "1"
      ? "Your password has been updated. Sign in with your new password."
      : undefined;

  return (
    <AuthShell variant="partner">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Partner portal"
          title="Sign in to your partner account"
          description="Track your referral links, the businesses you have introduced, and the commission and payouts owed to you."
        />
        <AffiliateLoginForm
          redirectTo={redirectTo}
          notice={notice}
          problem={problem}
        />
      </AuthCard>
    </AuthShell>
  );
}
