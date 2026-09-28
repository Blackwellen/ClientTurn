import { workspaceCan } from "@/lib/auth/permissions";
import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session";
import { analyticsAllowed } from "@/lib/billing/allowance-gates";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { needsCheckout } from "@/lib/billing/lifecycle";
import { getBillingNotice } from "@/lib/billing/limits-service";
import { BillingBanner } from "@/components/billing/billing-banner";
import { AppNotices } from "@/components/site/app-notices";
import { MaintenanceBypassPill } from "@/components/site/maintenance-bypass-pill";
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

  // Card-first trial (8.10): nothing in the app is usable until Stripe has
  // confirmed a subscription (verified card, terms accepted). A trial that
  // ended without one lands in the same place.
  const entitlements = await getEntitlements(workspace.businessId);
  if (needsCheckout(entitlements.state)) redirect("/start-trial");

  if (onboardingIncomplete(workspace)) redirect("/onboarding");

  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("lr-sidebar-collapsed")?.value === "1";

  const supabase = await createClient();

  const [profileResult, notificationsResult, v4Entitlements, health, billingNotice] =
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
      getV4Entitlements(workspace.businessId),
      getWorkspaceHealth(workspace),
      getBillingNotice(workspace.businessId, entitlements).catch(() => null),
    ]);

  // Billing capability (0172): the owner, or an admin the owner delegated it to.
  const canManageBilling = await workspaceCan(workspace, "manage_billing");
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
        planLabel={
          entitlements.state === "TRIALING" && entitlements.selectedPlan !== "trial"
            ? `${PLAN_LABELS[entitlements.selectedPlan] ?? entitlements.selectedPlan} · trial`
            : (PLAN_LABELS[entitlements.plan] ?? entitlements.plan)
        }
        // The upgrade ladder starts from the tier chosen at checkout, so a
        // Growth trial is offered Pro, not Starter.
        plan={entitlements.selectedPlan}
        // Only an owner can open Billing, so only an owner is offered the
        // upgrade prompt in the rail.
        canManageBilling={canManageBilling}
        primaryNav={primaryNavFor({
          sourcing: v4Entitlements.sourcingEnabled,
          // Analytics is a depth tier rather than an on/off capability: every
          // paying plan gets at least the Overview, so the destination is
          // hidden only for a workspace with no analytics tier at all.
          analytics: analyticsAllowed(v4Entitlements.plan),
        }).map(item => item.href)}
        integrationStatus={health.integrationStatus}
        notifications={(notificationsResult.data ?? []) as NotificationRow[]}
        user={{
          name: displayName,
          email: profile?.email ?? "",
          avatarUrl: profile?.avatar_url,
        }}
      >
        {/* Platform banners, maintenance and the billing notice, stacked
            (docs/MAINTENANCE.md): critical platform notices first, at most
            two visible, the rest collapsed. */}
        <AppNotices
          userId={workspace.userId}
          reconnect={health.reconnect}
          viewer={{
            kind: "app",
            businessId: workspace.businessId,
            plan: entitlements.plan,
            role: workspace.role,
          }}
          account={
            billingNotice
              ? {
                  tone: billingNotice.tone,
                  node: (
                    <BillingBanner
                      notice={billingNotice}
                      canManageBilling={canManageBilling}
                      className=""
                    />
                  ),
                }
              : null
          }
        />
        <MaintenanceBypassPill />
        {children}
      </AppShell>
    </ToastProvider>
  );
}
