import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerification } from "./resend-verification";

export const metadata: Metadata = {
  title: "Verify your email | ClientTurn",
  description: "Confirm your email address to finish setting up ClientTurn.",
};

function one(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 254) : "";
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const email = one(params.email);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center px-5 py-12 sm:px-8">
      <Logo height={32} className="mb-10" />
      <AuthCard width="sm" className="w-full">
        <div className="mb-5 flex size-12 items-center justify-center rounded-[13px] border border-white/8 bg-white/[0.04] text-[var(--auth-lime)]">
          <MailCheck className="size-5.5" aria-hidden />
        </div>

        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[var(--auth-text)]">
          Check your email
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--auth-text-muted)]">
          {email ? (
            <>
              We sent a confirmation link to{" "}
              <span className="font-semibold text-[var(--auth-text)]">{email}</span>. Open it
              to activate your workspace.
            </>
          ) : (
            <>We sent you a confirmation link. Open it to activate your workspace.</>
          )}
        </p>

        <div className="mt-7">
          <ResendVerification email={email} />
        </div>

        <p className="mt-6 border-t border-white/8 pt-5 text-center text-[13.5px] text-[var(--auth-text-muted)]">
          Already confirmed?{" "}
          <Link href="/login" className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </AuthCard>
    </div>
  );
}
