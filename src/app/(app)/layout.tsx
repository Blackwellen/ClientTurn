import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { primaryNavFor } from "@/lib/app/nav";
import { getWorkspaceHealth, onboardingIncomplete } from "@/lib/app/health";
import { AppShell } from "@/components/app/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import type { NotificationRow } from "@/components/app/notification-tray";

export const dynamic = "force-dynamic";

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  starter: "Starter plan",
  growth: "Growth plan",
  pro: "Pro plan",
  enterprise: "Enterprise",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await requireWorkspace();

  if (onboardingIncomplete(workspace)) redirect("/onboarding");

  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("lr-sidebar-collapsed")?.value === "1";

  const supabase = await createClient();

  const [profileResult, notificationsResult, entitlements, v4Entitlements, health] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name, email, avatar_url")
        .eq("id", workspace.userId)
        .maybeSingle(),
      supabase
        .from("notifications")
        .select(
          "id, type, severity, title, body, link_url, read_at, created_at",
        )
        .eq("business_id", workspace.businessId)
        .eq("user_id", workspace.userId)
        .order("created_at", { ascending: false })
        .limit(50),
      getEntitlements(workspace.businessId),
      getV4Entitlements(workspace.businessId),
      getWorkspaceHealth(workspace),
    ]);

  const profile = profileResult.data;
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.email ||
    "Your account";

  return (
    <ToastProvider>
      <AppShell
        initialCollapsed={initialCollapsed}
        businessName={workspace.businessName}
        planLabel={PLAN_LABELS[entitlements.plan] ?? entitlements.plan}
        plan={entitlements.plan}
        // Only an owner can open Billing, so only an owner is offered the
        // upgrade prompt in the rail.
        canManageBilling={hasRole(workspace.role, "owner")}
        primaryNav={primaryNavFor({
          sourcing: v4Entitlements.sourcingEnabled,
          // Analytics is a depth tier rather than an on/off capability: every
          // paying plan gets at least the Overview, so the destination is
          // hidden only for a workspace with no analytics tier at all.
          analytics: v4Entitlements.plan !== "trial",
        }).map(item => item.href)}
        integrationStatus={health.integrationStatus}
        notifications={(notificationsResult.data ?? []) as NotificationRow[]}
        user={{
          name: displayName,
          email: profile?.email ?? "",
          avatarUrl: profile?.avatar_url,
        }}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
