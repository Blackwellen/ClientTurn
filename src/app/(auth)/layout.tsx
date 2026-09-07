import type { ReactNode } from "react";
import { AuthEnvironment } from "@/components/auth/auth-environment";
import { caveat } from "@/components/auth/fonts";
// The auth doors show the same workspace frames as the public site, and those
// carry their layout in the public stylesheet. Imported explicitly because the
// auth group sits outside the marketing layout that normally loads it.
import "../(marketing)/clientturn.css";

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
