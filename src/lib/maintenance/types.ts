/**
 * Platform maintenance: the vocabulary (docs/MAINTENANCE.md).
 *
 * Pure: no `server-only`, no Supabase, relative imports only. The proxy, the
 * admin screen, the status page, the send guard and the unit tests all read
 * these same names, so a level can never mean one thing in the proxy and
 * another on the page that switches it on.
 */

/**
 * The levels, least to most disruptive. Each level includes everything the
 * one before it does: APP_OFFLINE also pauses writes, SITE_OFFLINE also takes
 * the app offline.
 *
 *   READ_ONLY     the app loads; every change (Server Action, API write, MCP
 *                 write) is refused with a friendly "changes are paused".
 *   APP_OFFLINE   the customer app (/app, sign-in, the API) shows the
 *                 maintenance page. The marketing site stays up.
 *   SITE_OFFLINE  the marketing site shows the maintenance page too.
 */
export const MAINTENANCE_LEVELS = ["READ_ONLY", "APP_OFFLINE", "SITE_OFFLINE"] as const;
export type MaintenanceLevel = (typeof MAINTENANCE_LEVELS)[number];
export type EffectiveLevel = "OFF" | MaintenanceLevel;

export const LEVEL_RANK: Record<EffectiveLevel, number> = {
  OFF: 0,
  READ_ONLY: 1,
  APP_OFFLINE: 2,
  SITE_OFFLINE: 3,
};

export const LEVEL_LABEL: Record<EffectiveLevel, string> = {
  OFF: "Off",
  READ_ONLY: "Read only",
  APP_OFFLINE: "App offline",
  SITE_OFFLINE: "Site offline",
};

export const LEVEL_DESCRIPTION: Record<MaintenanceLevel, string> = {
  READ_ONLY:
    "The app loads normally, but every change is paused: saving, sending by hand, API and MCP writes.",
  APP_OFFLINE:
    "Customers see the maintenance page instead of the app. The marketing site stays up.",
  SITE_OFFLINE:
    "Everything public shows the maintenance page, including the marketing site.",
};

/**
 * The levels that take a page away from people. Switching one on needs a
 * typed confirmation of the level's name and a fresh step-up.
 */
export function isOfflineLevel(level: EffectiveLevel): level is "APP_OFFLINE" | "SITE_OFFLINE" {
  return level === "APP_OFFLINE" || level === "SITE_OFFLINE";
}

/**
 * The public shape of a window: what the proxy, the status page and the
 * maintenance page may know. Nothing here is internal (no reason, no author).
 */
export type PublicMaintenanceWindow = {
  id: string;
  level: MaintenanceLevel;
  /** ISO, UTC. */
  startsAt: string;
  /** ISO, UTC. Null: runs until an operator ends it. */
  endsAt: string | null;
  /** Shown on the maintenance page. Falls back to `endsAt`. */
  expectedBackAt: string | null;
  message: string | null;
  /** The public quote page (/q/*) stays reachable during an offline level. */
  keepQuotePagesOnline: boolean;
  /** Outbound follow-up keeps sending during an offline level. */
  keepAutomationRunning: boolean;
  /** Show an "upcoming maintenance" notice from 24 hours before. */
  announceBanner: boolean;
  /** Set when an operator ended it early; the window is then over. */
  endedAt?: string | null;
  cancelledAt?: string | null;
};

/** Where a window is relative to now. */
export type WindowPhase = "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";

/** The platform's maintenance state at one instant. */
export type MaintenanceStatus = {
  phase: "OFF" | "SCHEDULED" | "ACTIVE";
  level: EffectiveLevel;
  /** The window in force now (the most disruptive, if several overlap). */
  active: PublicMaintenanceWindow | null;
  /** The next window to start, if any. */
  upcoming: PublicMaintenanceWindow | null;
};

export const MAINTENANCE_OFF: MaintenanceStatus = {
  phase: "OFF",
  level: "OFF",
  active: null,
  upcoming: null,
};

/** What the operator may type into the message box. */
export const MESSAGE_MAX = 500;

/** How far ahead an upcoming window is announced. */
export const ANNOUNCE_AHEAD_MS = 24 * 60 * 60 * 1000;

/** The one sentence every refused change carries. */
export const WRITES_PAUSED_MESSAGE = "ClientTurn is in maintenance, so changes are paused.";
