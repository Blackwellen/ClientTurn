import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMaintenanceStatus, getMaintenanceStatusForStaticPage, publicRpc } from "@/lib/maintenance/state";
import { rowsToBanners } from "./rows";
import {
  maintenanceNotice,
  selectBanner,
  eligibleBanners,
  type MaintenanceNotice,
} from "./select";
import type { Banner, BannerPlacement, BannerViewer } from "./types";

/**
 * Banner reads for the app and the website (docs/MAINTENANCE.md).
 *
 * App: the live banner list is read with the service role and cached per
 * instance for 30 seconds, then filtered by audience in code (select.ts). A
 * customer's browser never queries `platform_banners`: there is no select
 * policy on it at all, so a workspace-targeted banner cannot leak to another
 * workspace through a broad policy. Dismissals are read only when the winning
 * banner is dismissible, and only for this user and these candidates.
 *
 * Website: `platform_marketing_banners()` over GET with the publishable key,
 * cached by tag in the Next data cache so the marketing pages stay static
 * (every banner write revalidates the tag).
 */

export const BANNER_CACHE_TAG = "platform-banners";
const APP_CACHE_TTL_MS = 30_000;

let appCache: { banners: Banner[]; fetchedAt: number } | null = null;

function untyped(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

async function liveBannersForApp(): Promise<Banner[]> {
  const now = Date.now();
  if (appCache && now - appCache.fetchedAt < APP_CACHE_TTL_MS) return appCache.banners;
  try {
    const nowIso = new Date(now).toISOString();
    const { data, error } = await untyped()
      .from("platform_banners")
      .select(
        "id, title, body, link_url, link_label, tone, audience, plans, business_ids, placements, starts_at, ends_at, ended_at, dismissible, priority, updated_at",
      )
      .is("ended_at", null)
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("priority", { ascending: false })
      .limit(100);
    if (error) throw error;
    const banners = rowsToBanners(data);
    appCache = { banners, fetchedAt: now };
    return banners;
  } catch {
    // Until 0161 is applied, and on any read failure: no banners, cached for
    // the TTL so the layout does not retry on every page view.
    appCache = { banners: appCache?.banners ?? [], fetchedAt: now };
    return appCache.banners;
  }
}

export function invalidateAppBannerCache(): void {
  appCache = null;
}

async function dismissedKeys(userId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  try {
    const { data } = await untyped()
      .from("platform_banner_dismissals")
      .select("banner_key")
      .eq("user_id", userId)
      .in("banner_key", keys);
    return new Set((data ?? []).map((row: { banner_key: string }) => row.banner_key));
  } catch {
    return new Set();
  }
}

export type AppNotices = {
  banner: Banner | null;
  maintenance: MaintenanceNotice | null;
};

/** The admin banner for one app placement, plus the maintenance notice. */
export async function getAppNotices(input: {
  userId: string;
  viewer: Extract<BannerViewer, { kind: "app" }>;
  placement: Exclude<BannerPlacement, "MARKETING_TOP">;
  /** The dashboard card carries admin banners only; maintenance lives in the top bar. */
  includeMaintenance: boolean;
  now?: Date;
}): Promise<AppNotices> {
  const now = input.now ?? new Date();
  const [banners, status] = await Promise.all([
    liveBannersForApp(),
    input.includeMaintenance ? getMaintenanceStatus(now) : Promise.resolve(null),
  ]);

  const candidates = eligibleBanners({ banners, viewer: input.viewer, placement: input.placement, now });
  const notice = status ? maintenanceNotice(status, now, input.viewer) : null;

  const keys = [
    ...candidates.filter((b) => b.dismissible).map((b) => b.id),
    ...(notice?.dismissible ? [notice.id] : []),
  ];
  const dismissed = await dismissedKeys(input.userId, keys);

  return {
    banner: selectBanner({ banners: candidates, viewer: input.viewer, placement: input.placement, now, dismissedIds: dismissed }),
    maintenance: notice && !(notice.dismissible && dismissed.has(notice.id)) ? notice : null,
  };
}

/** The website top bar: one admin banner and, for SITE_OFFLINE windows, the notice. */
export async function getMarketingNotices(now: Date = new Date()): Promise<{
  banner: Banner | null;
  maintenance: MaintenanceNotice | null;
}> {
  const viewer: BannerViewer = { kind: "marketing" };
  const [banners, status] = await Promise.all([
    publicRpc("platform_marketing_banners", { revalidate: 60, tags: [BANNER_CACHE_TAG] })
      .then(rowsToBanners)
      .catch(() => [] as Banner[]),
    getMaintenanceStatusForStaticPage(now),
  ]);
  return {
    banner: selectBanner({ banners, viewer, placement: "MARKETING_TOP", now }),
    maintenance: maintenanceNotice(status, now, viewer),
  };
}

const KEY_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|maintenance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:upcoming)$/;

export function isDismissKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/**
 * Records one person's dismissal. Only a dismissible, live banner (or the
 * upcoming-maintenance notice) can be dismissed: a request naming a
 * non-dismissible banner is refused, so a critical notice cannot be hidden by
 * a hand-made request.
 */
export async function recordDismissal(userId: string, key: string): Promise<"ok" | "refused" | "unavailable"> {
  if (!isDismissKey(key)) return "refused";
  const db = untyped();
  if (!key.startsWith("maintenance:")) {
    const { data, error } = await db
      .from("platform_banners")
      .select("id, dismissible")
      .eq("id", key)
      .maybeSingle();
    if (error) return "unavailable";
    if (!data || data.dismissible !== true) return "refused";
  }
  const { error } = await db
    .from("platform_banner_dismissals")
    .upsert({ banner_key: key, user_id: userId }, { onConflict: "banner_key,user_id", ignoreDuplicates: true });
  return error ? "unavailable" : "ok";
}
