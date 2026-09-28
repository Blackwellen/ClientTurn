import * as React from "react";
import type { Metadata } from "next";
import { DatabaseZap } from "lucide-react";
import { getSiteAdminData } from "@/lib/maintenance/admin";
import { SiteView } from "@/components/admin/site/site-view";
import { EmptyState } from "@/components/ui/feedback";
import { LEVEL_LABEL } from "@/lib/maintenance/types";
// The website banner preview renders inside `.ct-marketing`, whose palette
// lives with the marketing group. Every rule in it is scoped to that class.
import "../../../(marketing)/clientturn.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site & announcements",
  robots: { index: false, follow: false },
};

/**
 * /admin/site — maintenance mode, site offline and platform banners
 * (docs/MAINTENANCE.md). The (ops) layout has already resolved a platform
 * operator; `getSiteAdminData` re-asserts it before any service-role read,
 * and every change goes through step-up and the audit log.
 */
export default async function AdminSitePage() {
  const data = await getSiteAdminData();

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
          Site &amp; announcements
        </h1>
        <p className="mt-1 text-[14px] text-content-muted">
          Maintenance mode, taking the app or the site offline, and banners for customers and visitors.
        </p>
      </div>

      {data.status === "ok" ? (
        <SiteView data={data} />
      ) : (
        <section className="rounded-xl border border-line bg-surface shadow-xs">
          <EmptyState
            icon={DatabaseZap}
            title="Maintenance controls are not available yet"
            description={data.message}
          />
          {data.envOverride ? (
            <p className="border-t border-line px-5 py-3 text-center text-[13px] font-medium text-danger-700">
              MAINTENANCE_OVERRIDE_LEVEL is set on this deployment: {LEVEL_LABEL[data.envOverride]} is in force.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
