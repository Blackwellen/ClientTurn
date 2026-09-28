/**
 * Which banner each person sees, and in what order the notices stack.
 *
 * Pure (relative imports only), so audience, placement, priority, dismissal
 * and stacking are unit-tested without a database or a browser.
 *
 * Selection:
 *   * a banner is live from `startsAt` (inclusive) to `endsAt` (exclusive),
 *     and not after an operator pressed "End now": expiry is evaluated by time
 *     at read, so no job has to take a banner down;
 *   * the audience decides who may see it, and the placement where. A website
 *     visitor only ever sees ALL or MARKETING_VISITORS banners, and only in the
 *     website top bar; everything else is for signed-in app users;
 *   * at most ONE admin banner per placement: the highest priority, then the
 *     most recently started, so two operators' banners never pile up;
 *   * a banner the person dismissed is skipped, and the next one may show.
 *
 * Stacking (the app top bar):
 *   1. critical platform notices (an admin banner, or maintenance in progress);
 *   2. the existing account notices: trial, dunning, allowance alerts;
 *   3. every other platform notice (warning, info, success).
 * At most two are visible; the rest collapse behind "N more notices". The
 * upsell moments and the trial-upgrade prompt are modals rather than banners,
 * so they never compete for this space.
 */

import { ANNOUNCE_AHEAD_MS, LEVEL_LABEL, type MaintenanceStatus } from "../maintenance/types.ts";
import { expectedBack, formatLondon, isAnnounceable } from "../maintenance/schedule.ts";
import type {
  Banner,
  BannerPlacement,
  BannerTone,
  BannerViewer,
  StackItem,
} from "./types.ts";

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export function isBannerLive(banner: Banner, now: Date): boolean {
  const at = now.getTime();
  const start = ms(banner.startsAt);
  if (start === null || start > at) return false;
  const end = ms(banner.endsAt);
  if (end !== null && end <= at) return false;
  const ended = ms(banner.endedAt);
  if (ended !== null && ended <= at) return false;
  return true;
}

/** Scheduled, live or ended, for the admin list. */
export function bannerPhase(banner: Banner, now: Date): "SCHEDULED" | "LIVE" | "ENDED" {
  if (isBannerLive(banner, now)) return "LIVE";
  const start = ms(banner.startsAt);
  if (start !== null && start > now.getTime() && !banner.endedAt) return "SCHEDULED";
  return "ENDED";
}

export function audienceMatches(banner: Banner, viewer: BannerViewer): boolean {
  if (viewer.kind === "marketing") {
    return banner.audience === "ALL" || banner.audience === "MARKETING_VISITORS";
  }
  switch (banner.audience) {
    case "ALL":
    case "APP_USERS":
      return true;
    case "MARKETING_VISITORS":
      return false;
    case "PLANS":
      return banner.plans.includes(viewer.plan);
    case "WORKSPACES":
      return banner.businessIds.includes(viewer.businessId);
    case "OWNERS_ADMINS":
      return viewer.role === "owner" || viewer.role === "admin";
    default:
      return false;
  }
}

/** A placement is only ever rendered for the viewer kind it belongs to. */
export function placementFits(placement: BannerPlacement, viewer: BannerViewer): boolean {
  return viewer.kind === "marketing" ? placement === "MARKETING_TOP" : placement !== "MARKETING_TOP";
}

/** Highest priority, then latest start, then latest edit, then id (stable). */
export function compareBanners(a: Banner, b: Banner): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const start = (ms(b.startsAt) ?? 0) - (ms(a.startsAt) ?? 0);
  if (start !== 0) return start;
  const updated = (ms(b.updatedAt) ?? 0) - (ms(a.updatedAt) ?? 0);
  if (updated !== 0) return updated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Every banner this viewer could see in this placement now, best first, ignoring dismissals. */
export function eligibleBanners(input: {
  banners: Banner[];
  viewer: BannerViewer;
  placement: BannerPlacement;
  now: Date;
}): Banner[] {
  if (!placementFits(input.placement, input.viewer)) return [];
  return input.banners
    .filter(
      (banner) =>
        banner.placements.includes(input.placement) &&
        isBannerLive(banner, input.now) &&
        audienceMatches(banner, input.viewer),
    )
    .sort(compareBanners);
}

/** The one banner for this placement: the best eligible one not dismissed. */
export function selectBanner(input: {
  banners: Banner[];
  viewer: BannerViewer;
  placement: BannerPlacement;
  now: Date;
  dismissedIds?: ReadonlySet<string>;
}): Banner | null {
  const dismissed = input.dismissedIds ?? new Set<string>();
  for (const banner of eligibleBanners(input)) {
    // A non-dismissible banner cannot be hidden by a stale dismissal row.
    if (banner.dismissible && dismissed.has(banner.id)) continue;
    return banner;
  }
  return null;
}

/* ------------------------------------------------------ maintenance notice */

export type MaintenanceNotice = {
  /** Stable per window and phase, so dismissing "upcoming" does not hide "in progress". */
  id: string;
  title: string;
  body: string;
  tone: BannerTone;
  linkUrl: string;
  linkLabel: string;
  dismissible: boolean;
};

/**
 * The automatic notice for a maintenance window: "upcoming" from 24 hours
 * before (when the window asks for it), "in progress" while it runs.
 *
 * App viewers see it for every level. Website visitors see it only for a
 * SITE_OFFLINE window, the one level that affects them.
 */
export function maintenanceNotice(
  status: MaintenanceStatus,
  now: Date,
  viewer: BannerViewer,
): MaintenanceNotice | null {
  if (status.phase === "ACTIVE" && status.active) {
    const window = status.active;
    if (viewer.kind === "marketing") return null; // the site itself is the notice
    const back = expectedBack(window);
    return {
      id: `maintenance:${window.id}:active`,
      title:
        window.level === "READ_ONLY"
          ? "Maintenance in progress: changes are paused"
          : "Maintenance in progress",
      body: `${
        window.level === "READ_ONLY"
          ? "You can view everything, but nothing can be saved or sent by hand right now."
          : "Some of ClientTurn is unavailable right now."
      }${back ? ` We expect to finish by ${formatLondon(back)}.` : ""}`,
      tone: "critical",
      linkUrl: "/status",
      linkLabel: "View status",
      dismissible: false,
    };
  }

  const upcoming = status.upcoming;
  if (!upcoming || !isAnnounceable(upcoming, now, ANNOUNCE_AHEAD_MS)) return null;
  if (viewer.kind === "marketing" && upcoming.level !== "SITE_OFFLINE") return null;

  const end = upcoming.endsAt ? ` until ${formatLondon(upcoming.endsAt)}` : "";
  return {
    id: `maintenance:${upcoming.id}:upcoming`,
    title: `Planned maintenance: ${formatLondon(upcoming.startsAt)}`,
    body: `ClientTurn will be ${LEVEL_LABEL[upcoming.level].toLowerCase()} from ${formatLondon(
      upcoming.startsAt,
    )}${end}.${upcoming.message?.trim() ? ` ${upcoming.message.trim()}` : ""}`,
    tone: "warning",
    linkUrl: "/status",
    linkLabel: "Details",
    dismissible: true,
  };
}

/* ------------------------------------------------------------------ stack */

export const MAX_VISIBLE_NOTICES = 2;

function stackRank(item: StackItem): number {
  if (item.source !== "account" && item.tone === "critical") return 0;
  if (item.source === "account") return 1;
  return 2;
}

/**
 * The stacking rule. Stable within a rank: higher priority first, then the
 * order given.
 */
export function stackNotices<T extends StackItem>(
  items: T[],
  maxVisible: number = MAX_VISIBLE_NOTICES,
): { visible: T[]; collapsed: T[] } {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        stackRank(a.item) - stackRank(b.item) ||
        b.item.priority - a.item.priority ||
        a.index - b.index,
    )
    .map(({ item }) => item);
  return { visible: ordered.slice(0, maxVisible), collapsed: ordered.slice(maxVisible) };
}

/* ---------------------------------------------------------------- content */

/**
 * The one link a banner may carry: a same-site path (`/pricing`) or an
 * absolute https URL. No `javascript:`, no `data:`, no protocol-relative
 * `//evil.example`, no credentials in the URL.
 */
export function safeBannerLink(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.length > 500) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#]*$/.test(value) ? value : null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The key a website visitor's dismissal is stored under (localStorage). */
export function bannerDismissStorageKey(id: string): string {
  return `ct-banner-dismissed:${id}`;
}
