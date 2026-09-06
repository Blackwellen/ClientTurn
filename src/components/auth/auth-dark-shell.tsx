import type { ReactNode } from "react";
import { AuthEnvironment } from "./auth-environment";
import { caveat } from "./fonts";

/**
 * The dark auth environment.
 *
 * Every sign-in door — customer, partner, operator — and the onboarding that
 * follows one share this wrapper, so a person moving from signup to
 * verification to onboarding never crosses a visual seam.
 *
 * It exists as a component rather than a layout because the partner surfaces
 * are interleaved with the light portal under `/affiliates`: `/affiliates/app`
 * must not be pulled into `ct-force-dark`, so each dark route opts in for
 * itself instead of inheriting.
 */
export function AuthDarkShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={`ct-force-dark ct-auth ${caveat.variable} relative min-h-dvh overflow-hidden bg-[var(--auth-bg)] text-[var(--auth-text)]`}
    >
      <AuthEnvironment />
      <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
    </div>
  );
}
