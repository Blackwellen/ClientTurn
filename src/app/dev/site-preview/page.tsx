import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { SiteView } from "@/components/admin/site/site-view";
import { PlatformBanner } from "@/components/site/platform-banner";
import { NoticeStack } from "@/components/site/notice-stack";
import { BypassPill } from "@/components/site/bypass-pill";
import { BillingBanner } from "@/components/billing/billing-banner";
import { PublicHeader } from "@/components/marketing/public/public-header";
import { fixtureTopBar } from "@/lib/admin/fixtures";
import { maintenanceNotice, stackNotices } from "@/lib/banners/select";
import { maintenancePageHtml } from "@/lib/maintenance/response";
import { resolveMaintenance } from "@/lib/maintenance/schedule";
import type { SiteAdminData } from "@/lib/maintenance/admin-types";
import type { Banner, StackItem } from "@/lib/banners/types";
import type { PublicMaintenanceWindow } from "@/lib/maintenance/types";
import "../../(marketing)/clientturn.css";

export const metadata: Metadata = { title: "Site preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for maintenance mode and banners
 * (docs/MAINTENANCE.md). Renders the real components against fixed data, so
 * each surface can be checked without a platform-admin session or migration
 * 0161 applied:
 *
 *   /dev/site-preview?state=admin        the /admin/site page
 *   /dev/site-preview?state=app          the app top-bar notice stack
 *   /dev/site-preview?state=marketing    the website top bar
 *   /dev/site-preview?state=maintenance  the 503 maintenance page
 *
 * It 404s outside development and is never linked from the product. Because it
 * bypasses `requirePlatformAdmin()` it renders fixtures only; its buttons call
 * the real guarded actions, which refuse without an operator session.
 */
const STATES = ["admin", "app", "marketing", "maintenance"] as const;
type PreviewState = (typeof STATES)[number];

const HOUR = 3_600_000;

function fixtures(now: Date) {
  const iso = (offsetHours: number) => new Date(now.getTime() + offsetHours * HOUR).toISOString();
  const upcoming: PublicMaintenanceWindow = {
    id: "5d1f2a53-8c7e-4b1a-9d0e-0a1b2c3d4e5f",
    level: "SITE_OFFLINE",
    startsAt: iso(18),
    endsAt: iso(20),
    expectedBackAt: null,
    message: "We're upgrading our database. Leads, payments and opt-outs keep arriving and nothing is lost.",
    keepQuotePagesOnline: true,
    keepAutomationRunning: false,
    announceBanner: true,
  };
  const banner = (overrides: Partial<Banner>): Banner => ({
    id: "8b4c1d2e-0000-4000-8000-000000000001",
    title: "Reactivation campaigns are here",
    body: "Win back old leads with a guided, compliant campaign in minutes.",
    linkUrl: "/help",
    linkLabel: "See how it works",
    tone: "success",
    audience: "ALL",
    plans: [],
    businessIds: [],
    placements: ["APP_TOP", "MARKETING_TOP"],
    startsAt: iso(-24),
    endsAt: iso(24 * 6),
    endedAt: null,
    dismissible: true,
    priority: 60,
    updatedAt: iso(-24),
    ...overrides,
  });
  return { upcoming, banner, iso };
}

export default async function SitePreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const raw = Array.isArray(params.state) ? params.state[0] : params.state;
  const state: PreviewState = (STATES as readonly string[]).includes(raw ?? "") ? (raw as PreviewState) : "admin";
  const now = new Date();
  const f = fixtures(now);

  if (state === "maintenance") {
    const status = resolveMaintenance([{ ...f.upcoming, startsAt: f.iso(-0.5), endsAt: f.iso(1.5) }], now);
    return (
      <iframe
        title="Maintenance page"
        srcDoc={maintenancePageHtml({ status, kind: "offline" })}
        className="fixed inset-0 h-dvh w-full border-0"
      />
    );
  }

  if (state === "marketing") {
    const status = resolveMaintenance([f.upcoming], now);
    const notice = maintenanceNotice(status, now, { kind: "marketing" });
    return (
      <div className="ct-marketing flex min-h-dvh w-full flex-col">
        {notice ? (
          <PlatformBanner
            dismissKey={notice.id}
            title={notice.title}
            body={notice.body}
            linkUrl={notice.linkUrl}
            linkLabel={notice.linkLabel}
            tone={notice.tone}
            dismissible={notice.dismissible}
            dismissMode="local"
            variant="marketing"
          />
        ) : null}
        <PlatformBanner {...bannerProps(f.banner({}))} dismissMode="local" variant="marketing" />
        <PublicHeader />
        <main className="pub-container flex-1 py-16">
          <h1 className="text-[40px] font-bold leading-tight text-white">Turn every lead into a booked call.</h1>
          <p className="mt-3 max-w-xl text-[17px] text-slate-300">Website top-bar preview: at most one admin banner, plus the Site offline notice 24 hours ahead.</p>
        </main>
        <BypassPill label="Site offline" />
      </div>
    );
  }

  if (state === "app") {
    const status = resolveMaintenance([{ ...f.upcoming, level: "READ_ONLY", startsAt: f.iso(-0.25), endsAt: f.iso(1) }], now);
    const notice = maintenanceNotice(status, now, { kind: "app", businessId: "ws", plan: "growth", role: "owner" });
    type Item = StackItem & { node: React.ReactNode };
    const items: Item[] = [
      {
        key: "feature",
        source: "platform",
        tone: "info",
        priority: 50,
        node: <PlatformBanner key="feature" {...bannerProps(f.banner({ tone: "info" }))} dismissMode="none" />,
      },
      {
        key: "billing",
        source: "account",
        tone: "warning",
        priority: 0,
        node: (
          <BillingBanner
            key="billing"
            className=""
            canManageBilling
            notice={{
              tone: "warning",
              title: "Your trial ends in 3 days",
              body: "Your Growth plan starts on 30 Sep. Nothing to do if you want to continue.",
            } as React.ComponentProps<typeof BillingBanner>["notice"]}
          />
        ),
      },
    ];
    if (notice) {
      items.push({
        key: notice.id,
        source: "maintenance",
        tone: notice.tone,
        priority: 1000,
        node: (
          <PlatformBanner
            key={notice.id}
            dismissKey={notice.id}
            title={notice.title}
            body={notice.body}
            linkUrl={notice.linkUrl}
            linkLabel={notice.linkLabel}
            tone={notice.tone}
            dismissible={notice.dismissible}
            dismissMode="none"
          />
        ),
      });
    }
    const { visible, collapsed } = stackNotices(items);
    return (
      <ToastProvider>
        <div className="min-h-dvh bg-bg">
          <div className="flex h-14 items-center border-b border-line bg-surface px-6 text-[14px] font-semibold text-content">
            ClientTurn · Dashboard
          </div>
          <NoticeStack visible={visible.map((i) => i.node)} collapsed={collapsed.map((i) => i.node)} />
          <div className="mx-4 mt-4 space-y-3 sm:mx-6">
            <h1 className="text-[24px] font-semibold text-content">Good afternoon, Priya</h1>
            <PlatformBanner
              {...bannerProps(f.banner({ id: "8b4c1d2e-0000-4000-8000-000000000002", tone: "info", title: "New: voice follow-up", body: "Call new leads back automatically within a minute.", placements: ["DASHBOARD_CARD"] }))}
              dismissMode="none"
              variant="card"
              className="rounded-xl px-5 py-4 shadow-xs"
            />
            <div className="h-40 rounded-xl border border-line bg-surface" />
          </div>
          <BypassPill label="App offline" />
        </div>
      </ToastProvider>
    );
  }

  const topBar = fixtureTopBar();
  const data: Extract<SiteAdminData, { status: "ok" }> = {
    status: "ok",
    nowIso: now.toISOString(),
    maintenance: resolveMaintenance([f.upcoming], now),
    envOverride: null,
    windows: [
      {
        ...f.upcoming,
        phase: "SCHEDULED",
        reason: "Postgres 17 upgrade",
        notifyOwners: true,
        noticeQueuedAt: f.iso(-1),
        endedAt: null,
        cancelledAt: null,
        createdAt: f.iso(-1),
        createdByEmail: "ops@clientturn.com",
      },
      {
        ...f.upcoming,
        id: "5d1f2a53-8c7e-4b1a-9d0e-0a1b2c3d4e60",
        level: "READ_ONLY",
        startsAt: f.iso(-24 * 9),
        endsAt: f.iso(-24 * 9 + 1),
        message: null,
        phase: "ENDED",
        reason: "Index rebuild",
        notifyOwners: false,
        noticeQueuedAt: null,
        endedAt: f.iso(-24 * 9 + 0.6),
        cancelledAt: null,
        createdAt: f.iso(-24 * 10),
        createdByEmail: "ops@clientturn.com",
      },
    ],
    banners: [
      { ...f.banner({}), phase: "LIVE", createdAt: f.iso(-24) },
      {
        ...f.banner({
          id: "8b4c1d2e-0000-4000-8000-000000000003",
          title: "Price change for new Pro workspaces on 1 Nov",
          tone: "warning",
          audience: "PLANS",
          plans: ["pro"],
          placements: ["APP_TOP", "DASHBOARD_CARD"],
          startsAt: f.iso(48),
          priority: 80,
          dismissible: false,
        }),
        phase: "SCHEDULED",
        createdAt: f.iso(-2),
      },
    ],
    history: [
      { id: "h1", at: f.iso(-1), action: "admin.maintenance_scheduled", actorEmail: "ops@clientturn.com", summary: "Maintenance scheduled: Site offline · starts in 18 hours" },
      { id: "h2", at: f.iso(-1), action: "admin.maintenance_notice_queued", actorEmail: "ops@clientturn.com", summary: "Owner emails queued: Site offline · 412 workspaces" },
      { id: "h3", at: f.iso(-24), action: "admin.banner_created", actorEmail: "ops@clientturn.com", summary: 'Banner created: "Reactivation campaigns are here" · success, ALL' },
    ],
  };

  return (
    <ToastProvider>
      <AdminShell operator={topBar.operator} recentCustomers={topBar.recentCustomers} alertCount={topBar.alertCount}>
        <div className="space-y-5">
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
              Site &amp; announcements
            </h1>
            <p className="mt-1 text-[14px] text-content-muted">
              Maintenance mode, taking the app or the site offline, and banners for customers and visitors.
            </p>
          </div>
          <SiteView data={data} />
        </div>
      </AdminShell>
    </ToastProvider>
  );
}

function bannerProps(banner: Banner) {
  return {
    dismissKey: banner.id,
    title: banner.title,
    body: banner.body,
    linkUrl: banner.linkUrl,
    linkLabel: banner.linkLabel,
    tone: banner.tone,
    dismissible: banner.dismissible,
  };
}
