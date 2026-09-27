import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicContainer } from "@/components/marketing/public/ui";
import { ConfirmRequestButton } from "@/components/marketing/public/privacy-request/confirm-request-button";

export const metadata: Metadata = {
  title: "Confirm your privacy request",
  description: "Confirm a privacy request from the link we emailed you.",
  // Every URL here carries a one-time token.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Where the verification email lands. It does nothing on GET: mail scanners
 * open links, and a request must not be confirmed by a scanner. The person
 * presses the button; the server action checks the token.
 */
export default async function VerifyPrivacyRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const plausible = typeof token === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(token);

  return (
    <main className="py-16 sm:py-20">
      <PublicContainer narrow>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
          Confirm your privacy request
        </h1>
        {plausible ? (
          <>
            <p className="mt-4 text-[15px] leading-relaxed opacity-80">
              Press the button to confirm that you made this request. We will
              then act on it and reply by email.
            </p>
            <div className="mt-8">
              <ConfirmRequestButton token={token!} />
            </div>
          </>
        ) : (
          <p className="mt-4 text-[15px] leading-relaxed opacity-80">
            This link is incomplete. Open the link in your email again, or make a
            new request at <Link className="underline" href="/privacy-request">/privacy-request</Link>.
          </p>
        )}
      </PublicContainer>
    </main>
  );
}
