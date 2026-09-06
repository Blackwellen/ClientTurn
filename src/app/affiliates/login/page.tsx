import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { getUser } from "@/lib/auth/session";
import { getAffiliate } from "@/lib/affiliates/queries";
import { AffiliateLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Partner sign in | ClientTurn",
  description:
    "Sign in to the ClientTurn partner portal to track your referral links, commission and payouts.",
};

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The partner login only ever lands inside the partner portal. A generic
 * same-origin check would make this page a redirector into the customer app,
 * which is not what a partner is signing in for.
 */
function partnerPath(value: string | undefined): string {
  const fallback = "/affiliates/app";
  if (!value) return fallback;
  if (value.startsWith("//")) return fallback;
  // Only the partner surfaces, and never this page itself — that would be a
  // sign-in loop.
  if (value.startsWith("/affiliates/login")) return fallback;
  if (value !== "/affiliates" && !value.startsWith("/affiliates/")) return fallback;
  return value;
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

  const problem =
    one(params.error) === "link_invalid"
      ? "That link is no longer valid. Sign in below, or request a new link."
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
