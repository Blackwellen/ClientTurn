import type { ReactNode } from "react";
import { OnboardingEnvironment } from "@/components/onboarding/onboarding-environment";
import { caveat } from "@/components/auth/fonts";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`ct-force-dark ct-auth ${caveat.variable} relative min-h-dvh bg-[var(--auth-bg)] text-[var(--auth-text)]`}
    >
      <OnboardingEnvironment />
      <div className="relative z-10 min-h-dvh">{children}</div>
    </div>
  );
}
