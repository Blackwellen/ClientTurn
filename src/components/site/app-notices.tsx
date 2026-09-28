import * as React from "react";
import { getAppNotices } from "@/lib/banners/server";
import { stackNotices } from "@/lib/banners/select";
import type { BannerTone, BannerViewer, StackItem } from "@/lib/banners/types";
import { PlatformBanner } from "./platform-banner";
import { NoticeStack } from "./notice-stack";

/**
 * The app top bar's notices: the one admin banner for APP_TOP, the automatic
 * maintenance notice, and the existing account notice (trial, dunning,
 * allowance), stacked by `stackNotices` (lib/banners/select.ts): critical
 * platform notices, then the account notice, then everything else, at most
 * two visible.
 *
 * Never throws: a failed banner read renders the account notice alone, so
 * this can never be the reason the app shell fails to load.
 */
export async function AppNotices({
  userId,
  viewer,
  account,
  reconnect = [],
}: {
  userId: string;
  viewer: Extract<BannerViewer, { kind: "app" }>;
  /** The billing banner, already rendered, with its tone for ordering. */
  account: { node: React.ReactNode; tone: "info" | "warning" | "danger" } | null;
  /** Connections that need reconnecting (lib/app/health.ts `reconnect`). */
  reconnect?: { providerType: string; label: string; message: string | null }[];
}) {
  const notices = await getAppNotices({ userId, viewer, placement: "APP_TOP", includeMaintenance: true }).catch(
    () => ({ banner: null, maintenance: null }),
  );

  type Item = StackItem & { node: React.ReactNode };
  const items: Item[] = [];

  if (notices.maintenance) {
    const m = notices.maintenance;
    items.push({
      key: m.id,
      source: "maintenance",
      tone: m.tone,
      priority: 1000,
      node: (
        <PlatformBanner
          key={m.id}
          dismissKey={m.id}
          title={m.title}
          body={m.body}
          linkUrl={m.linkUrl}
          linkLabel={m.linkLabel}
          tone={m.tone}
          dismissible={m.dismissible}
          dismissMode="server"
        />
      ),
    });
  }

  if (notices.banner) {
    const b = notices.banner;
    items.push({
      key: b.id,
      source: "platform",
      tone: b.tone,
      priority: b.priority,
      node: (
        <PlatformBanner
          key={b.id}
          dismissKey={b.id}
          title={b.title}
          body={b.body}
          linkUrl={b.linkUrl}
          linkLabel={b.linkLabel}
          tone={b.tone}
          dismissible={b.dismissible}
          dismissMode="server"
        />
      ),
    });
  }

  if (account) {
    const tone: BannerTone = account.tone === "danger" ? "critical" : account.tone;
    items.push({ key: "account", source: "account", tone, priority: 0, node: <React.Fragment key="account">{account.node}</React.Fragment> });
  }

  if (reconnect.length > 0) {
    const names = reconnect.map((r) => r.label);
    const title =
      names.length === 1
        ? `Reconnect ${names[0]}`
        : `Reconnect ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    items.push({
      key: "reconnect",
      source: "account",
      tone: "warning",
      priority: 0,
      node: (
        <PlatformBanner
          key="reconnect"
          dismissKey="reconnect"
          title={title}
          body={
            names.length === 1 && reconnect[0].message
              ? reconnect[0].message
              : "These connections stopped working and nothing syncs through them until they are reconnected."
          }
          linkUrl="/app/settings?section=connections"
          linkLabel="Open connections"
          tone="warning"
          dismissible={false}
          dismissMode="none"
        />
      ),
    });
  }

  const { visible, collapsed } = stackNotices(items);
  return <NoticeStack visible={visible.map((i) => i.node)} collapsed={collapsed.map((i) => i.node)} />;
}
