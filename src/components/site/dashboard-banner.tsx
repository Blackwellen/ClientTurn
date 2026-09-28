import { requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getAppNotices } from "@/lib/banners/server";
import { PlatformBanner } from "./platform-banner";

/**
 * The dashboard card placement: at most one admin banner targeted at
 * DASHBOARD_CARD. Maintenance is announced in the top bar, never here, so the
 * same notice is not shown twice on one screen. Renders nothing on any
 * failure: it must never be why the dashboard does not load.
 */
export async function DashboardBanner() {
  const workspace = await requireWorkspace();
  const banner = await getEntitlements(workspace.businessId)
    .then((entitlements) =>
      getAppNotices({
        userId: workspace.userId,
        viewer: {
          kind: "app",
          businessId: workspace.businessId,
          plan: entitlements.plan,
          role: workspace.role,
        },
        placement: "DASHBOARD_CARD",
        includeMaintenance: false,
      }),
    )
    .then((notices) => notices.banner)
    .catch(() => null);

  if (!banner) return null;
  return (
    <PlatformBanner
      dismissKey={banner.id}
      title={banner.title}
      body={banner.body}
      linkUrl={banner.linkUrl}
      linkLabel={banner.linkLabel}
      tone={banner.tone}
      dismissible={banner.dismissible}
      dismissMode="server"
      variant="card"
      className="rounded-xl px-5 py-4 shadow-xs"
    />
  );
}
