import type { ReactNode } from "react";
import { AuthEnvironment } from "@/components/auth/auth-environment";
import { caveat } from "@/components/auth/fonts";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`ct-force-dark ct-auth ${caveat.variable} relative min-h-dvh overflow-hidden bg-[var(--auth-bg)] text-[var(--auth-text)]`}
    >
      <AuthEnvironment />
      <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
    </div>
  );
}
