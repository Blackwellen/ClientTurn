import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerification } from "@/app/(auth)/verify-email/resend-verification";

export const metadata: Metadata = {
  title: "Verify your email | ClientTurn partners",
  description: "Confirm your email address to finish your partner application.",
  robots: { index: false, follow: false },
};

function one(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 254) : "";
}

/**
 * The partner half of email verification.
 *
 * Same card as the customer page, different destination: confirming here opens
 * partner onboarding, never customer workspace setup. The callback derives the
 * door from that destination, so an expired link also returns to the partner
 * sign-in rather than the customer one.
 */
export default async function PartnerVerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const email = one(params.email);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center px-5 py-12 sm:px-8">
      <Logo height={64} className="mb-10" />
      <AuthCard width="sm" className="w-full">
        <div className="mb-5 flex size-12 items-center justify-center rounded-[13px] border border-white/8 bg-white/[0.04] text-[var(--auth-lime)]">
          <MailCheck className="size-5.5" aria-hidden />
        </div>

        <p className="text-[12.5px] font-bold tracking-[0.2em] text-[var(--auth-lime)] uppercase">
          Step 1 of 3
        </p>

        <h1 className="mt-3 text-[26px] font-bold tracking-[-0.02em] text-[var(--auth-text)]">
          Check your email
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--auth-text-muted)]">
          {email ? (
            <>
              We sent a confirmation link to{" "}
              <span className="font-semibold text-[var(--auth-text)]">{email}</span>.
              Open it and we will pick up where you left off.
            </>
          ) : (
            <>
              We sent you a confirmation link. Open it and we will pick up where
              you left off.
            </>
          )}
        </p>

        <ol className="mt-6 space-y-2.5 text-[13.5px] text-[var(--auth-text-muted)]">
          <Next n={2}>Tell us about your audience — about two minutes.</Next>
          <Next n={3}>We review your application, usually within two working days.</Next>
        </ol>

        <div className="mt-7">
          <ResendVerification
            email={email}
            next="/affiliates/onboarding"
          />
        </div>

        <p className="mt-6 border-t border-white/8 pt-5 text-center text-[13.5px] text-[var(--auth-text-muted)]">
          Already confirmed?{" "}
          <Link
            href="/affiliates/login"
            className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </AuthCard>
    </div>
  );
}

function Next({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-white/12 text-[11.5px] font-semibold text-[var(--auth-text-subtle)]">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
