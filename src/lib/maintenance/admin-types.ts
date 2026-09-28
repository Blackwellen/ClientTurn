/**
 * The /admin/site data shapes. Pure, so the client components can import them
 * without reaching the service-role reads in `admin.ts`.
 */

import type { Banner } from "../banners/types.ts";
import type {
  MaintenanceLevel,
  MaintenanceStatus,
  PublicMaintenanceWindow,
  WindowPhase,
} from "./types.ts";

export type AdminMaintenanceWindow = PublicMaintenanceWindow & {
  phase: WindowPhase;
  reason: string | null;
  notifyOwners: boolean;
  noticeQueuedAt: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdByEmail: string | null;
};

export type AdminBanner = Banner & {
  phase: "SCHEDULED" | "LIVE" | "ENDED";
  createdAt: string;
};

export type SiteHistoryRow = {
  id: string;
  at: string;
  action: string;
  actorEmail: string | null;
  summary: string;
};

export type SiteAdminData =
  | {
      status: "ok";
      nowIso: string;
      maintenance: MaintenanceStatus;
      windows: AdminMaintenanceWindow[];
      banners: AdminBanner[];
      history: SiteHistoryRow[];
      /** True when MAINTENANCE_OVERRIDE_LEVEL is set on this deployment. */
      envOverride: MaintenanceLevel | null;
    }
  | { status: "unavailable"; nowIso: string; message: string; envOverride: MaintenanceLevel | null };

/** Input shapes the admin forms send. Times are London wall-clock strings. */
export type MaintenanceFormInput = {
  level: MaintenanceLevel;
  startMode: "now" | "scheduled";
  startsAtLocal?: string;
  endsAtLocal?: string;
  expectedBackLocal?: string;
  message?: string;
  reason?: string;
  keepQuotePagesOnline: boolean;
  keepAutomationRunning: boolean;
  announceBanner: boolean;
  notifyOwners: boolean;
  confirmText?: string;
};

export type BannerFormInput = {
  id?: string;
  title: string;
  body?: string;
  linkUrl?: string;
  linkLabel?: string;
  tone: string;
  audience: string;
  plans: string[];
  businessIds: string[];
  placements: string[];
  startsAtLocal?: string;
  endsAtLocal?: string;
  dismissible: boolean;
  priority: number;
};

export const SITE_HISTORY_ACTION_LABEL: Record<string, string> = {
  "admin.maintenance_scheduled": "Maintenance scheduled",
  "admin.maintenance_updated": "Maintenance updated",
  "admin.maintenance_ended": "Maintenance ended",
  "admin.maintenance_cancelled": "Maintenance cancelled",
  "admin.maintenance_notice_queued": "Owner emails queued",
  "admin.banner_created": "Banner created",
  "admin.banner_updated": "Banner updated",
  "admin.banner_ended": "Banner ended",
  "admin.banner_deleted": "Banner deleted",
};
