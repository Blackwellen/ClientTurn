import type { ReactNode } from "react";
import { AuthDarkShell } from "@/components/auth/auth-dark-shell";

export default function PartnerAuthLayout({ children }: { children: ReactNode }) {
  return <AuthDarkShell>{children}</AuthDarkShell>;
}
