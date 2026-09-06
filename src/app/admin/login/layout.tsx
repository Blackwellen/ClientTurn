import type { ReactNode } from "react";
import { AuthDarkShell } from "@/components/auth/auth-dark-shell";

/**
 * The operator door is the one dark auth surface under `/admin`; the ops shell
 * behind it is a light app surface, so this route opts into the environment
 * for itself rather than the admin root layout applying it to everything.
 */
export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return <AuthDarkShell>{children}</AuthDarkShell>;
}
