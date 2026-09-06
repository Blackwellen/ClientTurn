import * as React from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminTopBarData } from "@/lib/admin/overview";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Platform operations · Client Turn",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const operator = await requirePlatformAdmin();
  const topBar = await getAdminTopBarData();

  const cookieStore = await cookies();
  const initialCollapsed =
    cookieStore.get("ct-admin-sidebar-collapsed")?.value === "1";

  return (
    <ToastProvider>
      <AdminShell
        initialCollapsed={initialCollapsed}
        operator={{ name: operator.name, email: operator.email, role: "platform_admin" }}
        recentCustomers={topBar.recentCustomers}
        alertCount={topBar.alertCount}
      >
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
