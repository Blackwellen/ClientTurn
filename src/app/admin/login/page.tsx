import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPlatformOperator } from "@/lib/admin/guard";
import { Logo } from "@/components/ui/logo";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  // An operator who is already signed in has no reason to see this.
  if (await getPlatformOperator()) redirect("/admin");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0B1020] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Logo href={null} height={32} />
          <p className="text-[11px] tracking-wide text-white/50 uppercase">
            Platform operations
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h1 className="text-[16px] font-semibold text-white">
            Operator sign in
          </h1>
          <p className="mt-1 text-[13px] text-white/60">
            This area is for Client Turn staff. Customer accounts sign in at the
            main login.
          </p>

          <AdminLoginForm />
        </div>

        <p className="mt-4 text-[12px] text-white/40">
          Access is checked against the platform role held in the database. All
          sign-ins are recorded.
        </p>
      </div>
    </div>
  );
}
