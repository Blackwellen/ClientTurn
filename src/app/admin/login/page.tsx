import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPlatformOperator } from "@/lib/admin/guard";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard, AuthCardHeader } from "@/components/auth/auth-card";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The operator door.
 *
 * Same shell and card as the customer and partner doors so the product reads
 * as one thing, with the marketing stripped out: no trust logos, no growth
 * claims, no sign-up switch. Someone arriving here already works here.
 */
export default async function AdminLoginPage() {
  // An operator who is already signed in has no reason to see this.
  if (await getPlatformOperator()) redirect("/admin");

  return (
    <AuthShell variant="admin">
      <AuthCard>
        <AuthCardHeader
          eyebrow="Platform operations"
          title="Operator sign in"
          description="Internal access for ClientTurn staff. Your platform role is checked against the database on every request."
        />

        <AdminLoginForm />

        <div className="mt-7 flex items-start gap-3 rounded-[12px] border border-white/8 bg-white/[0.03] px-4 py-3.5">
          <ShieldCheck
            className="mt-px size-4 shrink-0 text-[var(--auth-lime)]"
            aria-hidden
          />
          <p className="text-[12.5px] leading-relaxed text-[var(--auth-text-muted)]">
            Every sign-in is recorded, and each change asks you to confirm your
            password again before it is applied.
          </p>
        </div>

        <p className="mt-6 border-t border-white/8 pt-5 text-center text-[13px] text-[var(--auth-text-muted)]">
          Not staff?{" "}
          <Link
            href="/login"
            className="font-medium underline underline-offset-4 hover:text-[var(--auth-text)]"
          >
            Customer sign in
          </Link>{" "}
          ·{" "}
          <Link
            href="/affiliates/login"
            className="font-medium underline underline-offset-4 hover:text-[var(--auth-text)]"
          >
            Partner sign in
          </Link>
        </p>
      </AuthCard>
    </AuthShell>
  );
}
