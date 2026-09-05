import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { AuthBrandPanel, type AuthVariant } from "./auth-brand-panel";

const SWITCH: Record<AuthVariant, { prompt: string; label: string; href: string }> = {
  signup: { prompt: "Already have an account?", label: "Sign in", href: "/login" },
  login: { prompt: "Need an account?", label: "Sign up", href: "/signup" },
  forgot: { prompt: "Already have an account?", label: "Sign in", href: "/login" },
  reset: { prompt: "Already have an account?", label: "Sign in", href: "/login" },
};

export function AuthShell({
  variant,
  children,
}: {
  variant: AuthVariant;
  children: ReactNode;
}) {
  const sw = SWITCH[variant];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1720px] flex-col px-5 pt-6 pb-8 sm:px-8 sm:pt-8 sm:pb-10 lg:px-16 lg:pt-10 lg:pb-12 xl:px-20">
      <header className="flex items-center justify-between gap-4">
        <Logo height={40} />
        <div className="hidden items-center gap-3 sm:flex">
          <span className="text-[13.5px] text-[var(--auth-text-muted)]">{sw.prompt}</span>
          <Link
            href={sw.href}
            className="rounded-[10px] border border-white/15 px-4 py-2 text-[13.5px] font-medium text-[var(--auth-text)] transition-colors hover:border-[var(--auth-lime)]/50 hover:text-[var(--auth-lime)]"
          >
            {sw.label}
          </Link>
        </div>
      </header>

      <div className="mt-8 grid flex-1 items-center gap-x-12 gap-y-10 lg:mt-4 lg:grid-cols-[1.15fr_minmax(500px,0.85fr)] lg:gap-x-16 xl:gap-x-20">
        {/* No z-index here on purpose: a stacking context would trap the
            handwritten annotation behind the card it overlaps. */}
        <div className="relative min-w-0">
          <AuthBrandPanel variant={variant} />
        </div>
        <div className="relative z-10 flex justify-center lg:justify-end">{children}</div>
      </div>
    </div>
  );
}
