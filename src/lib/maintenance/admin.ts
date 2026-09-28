import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminRead } from "@/lib/admin/shared";
import { rowsToBanners } from "@/lib/banners/rows";
import { bannerPhase } from "@/lib/banners/select";
import { resolveMaintenance, windowPhase } from "./schedule";
import { envOverride } from "./state";
import { SITE_HISTORY_ACTION_LABEL, type AdminMaintenanceWindow, type SiteAdminData, type SiteHistoryRow } from "./admin-types";
import { LEVEL_LABEL, MAINTENANCE_LEVELS, type MaintenanceLevel } from "./types";

/**
 * /admin/site reads. `adminRead()` re-asserts platform-admin status against
 * the database before the service-role client is handed out. The tables are
 * 0161 and post-date the generated types, so they are read through one
 * untyped cast; a failed read returns `unavailable` with the reason, never an
 * empty list that would read as "no maintenance scheduled".
 */

type WindowRow = {
  id: string;
  level: string;
  starts_at: string;
  ends_at: string | null;
  expected_back_at: string | null;
  message: string | null;
  reason: string | null;
  keep_quote_pages_online: boolean;
  keep_automation_running: boolean;
  announce_banner: boolean;
  notify_owners: boolean;
  notice_queued_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by_email: string | null;
};

export const WINDOW_COLUMNS =
  "id, level, starts_at, ends_at, expected_back_at, message, reason, keep_quote_pages_online, keep_automation_running, announce_banner, notify_owners, notice_queued_at, ended_at, cancelled_at, created_at, created_by_email";

export function toAdminWindow(row: WindowRow, now: Date): AdminMaintenanceWindow | null {
  if (!(MAINTENANCE_LEVELS as readonly string[]).includes(row.level)) return null;
  const window = {
    id: row.id,
    level: row.level as MaintenanceLevel,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    expectedBackAt: row.expected_back_at,
    message: row.message,
    keepQuotePagesOnline: row.keep_quote_pages_online,
    keepAutomationRunning: row.keep_automation_running,
    announceBanner: row.announce_banner,
    endedAt: row.ended_at,
    cancelledAt: row.cancelled_at,
  };
  return {
    ...window,
    phase: windowPhase(window, now),
    reason: row.reason,
    notifyOwners: row.notify_owners,
    noticeQueuedAt: row.notice_queued_at,
    createdAt: row.created_at,
    createdByEmail: row.created_by_email,
  };
}

function summarise(action: string, metadata: Record<string, unknown>): string {
  const outcome = metadata.outcome === "denied" ? " (refused)" : metadata.outcome === "failed" ? " (failed)" : "";
  const level = typeof metadata.level === "string" && metadata.level in LEVEL_LABEL
    ? LEVEL_LABEL[metadata.level as MaintenanceLevel]
    : null;
  const title = typeof metadata.title === "string" ? `"${metadata.title.slice(0, 60)}"` : null;
  const detail = [level, title, typeof metadata.detail === "string" ? metadata.detail : null]
    .filter(Boolean)
    .join(" · ");
  return `${SITE_HISTORY_ACTION_LABEL[action] ?? action}${outcome}${detail ? `: ${detail}` : ""}`;
}

export async function getSiteAdminData(): Promise<SiteAdminData> {
  const admin = await adminRead();
  const db = admin as unknown as SupabaseClient;
  const now = new Date();
  const override = envOverride();

  try {
    const [windowsResult, bannersResult, historyResult] = await Promise.all([
      db.from("platform_maintenance_windows").select(WINDOW_COLUMNS).order("starts_at", { ascending: false }).limit(50),
      db
        .from("platform_banners")
        .select(
          "id, title, body, link_url, link_label, tone, audience, plans, business_ids, placements, starts_at, ends_at, ended_at, dismissible, priority, updated_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("audit_log")
        .select("id, created_at, action, actor_user_id, metadata")
        .or("action.like.admin.maintenance_*,action.like.admin.banner_*")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    if (windowsResult.error) throw new Error(windowsResult.error.message);
    if (bannersResult.error) throw new Error(bannersResult.error.message);

    const windows = ((windowsResult.data ?? []) as WindowRow[])
      .map((row) => toAdminWindow(row, now))
      .filter((w): w is AdminMaintenanceWindow => w !== null);

    const createdAt = new Map(
      ((bannersResult.data ?? []) as { id: string; created_at: string }[]).map((r) => [r.id, r.created_at]),
    );
    const banners = rowsToBanners(bannersResult.data).map((banner) => ({
      ...banner,
      phase: bannerPhase(banner, now),
      createdAt: createdAt.get(banner.id) ?? banner.updatedAt,
    }));

    const historyRows = historyResult.data ?? [];
    const actorIds = [...new Set(historyRows.map((r) => r.actor_user_id).filter((v): v is string => !!v))];
    const emails = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: people } = await admin.from("profiles").select("id, email").in("id", actorIds);
      for (const person of people ?? []) if (person.email) emails.set(person.id, person.email);
    }
    const history: SiteHistoryRow[] = historyRows.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        at: row.created_at,
        action: row.action,
        actorEmail: (row.actor_user_id && emails.get(row.actor_user_id)) || null,
        summary: summarise(row.action, metadata),
      };
    });

    return {
      status: "ok",
      nowIso: now.toISOString(),
      maintenance: resolveMaintenance(override ? [override] : windows, now),
      windows,
      banners,
      history,
      envOverride: override?.level ?? null,
    };
  } catch (error) {
    console.error("[admin/site] read failed", error);
    return {
      status: "unavailable",
      nowIso: now.toISOString(),
      message:
        "Maintenance and banners could not be loaded. The tables behind them (migration 0161) may not be applied on this database yet.",
      envOverride: override?.level ?? null,
    };
  }
}
