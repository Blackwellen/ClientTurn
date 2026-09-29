import type { ReactNode } from "react";
import { AuthDarkShell } from "@/components/auth/auth-dark-shell";

/** Same dark environment as the operator sign-in, which this step follows. */
export default function AdminMfaLayout({ children }: { children: ReactNode }) {
  return <AuthDarkShell>{children}</AuthDarkShell>;
}
