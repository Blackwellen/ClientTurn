import Link from "next/link";
import { ArrowRight, Lock, Mail } from "lucide-react";

/**
 * What stands in place of a registration form while ClientTurn is invite-only.
 *
 * It is a real page rather than a 404 because every marketing CTA on the site
 * points here. Someone who clicked "Start free" deserves to be told where the
 * product is up to and given the two things they can still do — sign in if
 * they already have an account, or ask for an invitation.
 */
export function SignupClosed({
  signInHref = "/login",
  signInLabel = "Sign in to your account",
}: {
  signInHref?: string;
  signInLabel?: string;
}) {
  return (
    <div className="space-y-6">
      <div
        className="flex items-start gap-3.5 rounded-[12px] border p-4"
        style={{
          background: "rgba(168,255,31,0.06)",
          borderColor: "rgba(168,255,31,0.22)",
        }}
      >
        <Lock
          aria-hidden
          className="mt-0.5 size-[18px] shrink-0 text-[var(--auth-lime)]"
        />
        <p className="text-[14.5px] leading-relaxed text-[var(--auth-text-muted)]">
          We are onboarding a small number of businesses by hand so that every
          workspace is set up properly before the first lead arrives. Public
          sign-up opens once that queue clears.
        </p>
      </div>

      <Link
        href={signInHref}
        className="group relative flex h-[56px] w-full items-center justify-center gap-2 overflow-hidden rounded-[11px] text-[16px] font-bold text-[var(--auth-on-lime)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_14px_38px_rgba(168,255,31,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)] active:translate-y-0"
        style={{
          background:
            "linear-gradient(135deg, var(--auth-lime-hover), var(--auth-lime))",
        }}
      >
        {signInLabel}
        <ArrowRight aria-hidden className="size-[18px]" />
      </Link>

      <Link
        href="/contact-sales"
        className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[11px] border border-white/15 text-[15px] font-semibold text-[var(--auth-text)] transition-colors hover:border-[var(--auth-lime)]/50 hover:text-[var(--auth-lime)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
      >
        <Mail aria-hidden className="size-[17px]" />
        Request an invitation
      </Link>
    </div>
  );
}

/** The one-line notice that sits under a sign-in form while the door is shut. */
export function InviteOnlyNote() {
  return (
    <p className="text-center text-[13.5px] text-[var(--auth-text-muted)]">
      Access is currently invite-only.{" "}
      <Link
        href="/contact-sales"
        className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
      >
        Request an invitation
      </Link>
    </p>
  );
}
