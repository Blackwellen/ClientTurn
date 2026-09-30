/**
 * Maintenance schedule: which window is in force, evaluated by time at read.
 *
 * There is no job that "starts" or "ends" maintenance. A window is ACTIVE when
 * `startsAt <= now < endsAt` and nobody has ended or cancelled it, so the
 * automatic start and the automatic end are the same comparison made on the
 * next read. A missed cron tick therefore cannot leave the site offline.
 *
 * Pure: relative imports only, so the boundaries are unit-tested directly.
 */

import {
  LEVEL_RANK,
  MAINTENANCE_OFF,
  isOfflineLevel,
  type MaintenanceStatus,
  type PublicMaintenanceWindow,
  type WindowPhase,
} from "./types.ts";

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/**
 * Where one window is at `now`. The start is inclusive and the end exclusive:
 * at exactly `endsAt` the window is over, so "until 14:00" means the site is
 * back at 14:00, not a minute after.
 */
export function windowPhase(window: PublicMaintenanceWindow, now: Date): WindowPhase {
  if (window.cancelledAt) return "CANCELLED";
  const at = now.getTime();
  const ended = ms(window.endedAt);
  if (ended !== null && ended <= at) return "ENDED";
  const end = ms(window.endsAt);
  if (end !== null && end <= at) return "ENDED";
  const start = ms(window.startsAt);
  if (start === null) return "CANCELLED";
  return start <= at ? "ACTIVE" : "SCHEDULED";
}

/**
 * The platform state at `now`. Overlapping active windows resolve to the most
 * disruptive level, because the operator who scheduled the bigger one meant
 * it; the upcoming window is the soonest to start.
 */
export function resolveMaintenance(
  windows: PublicMaintenanceWindow[],
  now: Date,
): MaintenanceStatus {
  let active: PublicMaintenanceWindow | null = null;
  let upcoming: PublicMaintenanceWindow | null = null;

  for (const window of windows) {
    const phase = windowPhase(window, now);
    if (phase === "ACTIVE") {
      if (!active || LEVEL_RANK[window.level] > LEVEL_RANK[active.level]) active = window;
    } else if (phase === "SCHEDULED") {
      if (!upcoming || (ms(window.startsAt) ?? 0) < (ms(upcoming.startsAt) ?? 0)) upcoming = window;
    }
  }

  if (active) return { phase: "ACTIVE", level: active.level, active, upcoming };
  if (upcoming) return { phase: "SCHEDULED", level: "OFF", active: null, upcoming };
  return MAINTENANCE_OFF;
}

/** When people can expect to be back: the stated time, else the scheduled end. */
export function expectedBack(window: PublicMaintenanceWindow | null): string | null {
  if (!window) return null;
  return window.expectedBackAt ?? window.endsAt ?? null;
}

/**
 * Seconds for `Retry-After`. Never under a minute (a crawler told "retry in 3
 * seconds" hammers the site) and never over a day; with no end in sight, half
 * an hour.
 */
export function retryAfterSeconds(status: MaintenanceStatus, now: Date): number {
  const back = ms(expectedBack(status.active));
  if (back === null) return 1800;
  const seconds = Math.ceil((back - now.getTime()) / 1000);
  return Math.min(86_400, Math.max(60, seconds));
}

/**
 * Until when outbound sends are held. Only the offline levels hold them, and
 * only when the operator did not tick "keep automated follow-up running":
 * read-only maintenance pauses people's changes, not the product's work.
 *
 * With no scheduled end the hold is re-checked every 15 minutes rather than
 * parked indefinitely, so ending maintenance releases the queue promptly.
 */
export function outboundPauseUntil(status: MaintenanceStatus, now: Date): Date | null {
  const window = status.active;
  if (!window || !isOfflineLevel(window.level) || window.keepAutomationRunning) return null;
  const end = ms(window.endsAt);
  const fallback = now.getTime() + 15 * 60 * 1000;
  return new Date(end !== null && end > now.getTime() ? Math.min(end, fallback) : fallback);
}

/** Whether an upcoming window should be announced now (24 hours ahead). */
export function isAnnounceable(
  window: PublicMaintenanceWindow | null,
  now: Date,
  aheadMs: number,
): boolean {
  if (!window || !window.announceBanner) return false;
  const start = ms(window.startsAt);
  if (start === null) return false;
  const lead = start - now.getTime();
  return lead > 0 && lead <= aheadMs;
}

/* ----------------------------------------------------------- Europe/London */

const LONDON = "Europe/London";

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function londonParts(at: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of LONDON_PARTS.formatToParts(new Date(at))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** London's offset from UTC at an instant, in milliseconds (0 or +1h). */
function londonOffsetMs(at: number): number {
  const p = londonParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * A wall-clock time in London (`2026-10-25T01:30`, as a datetime-local input
 * gives it) to a UTC ISO string. The admin form is always London time
 * whatever the operator's laptop is set to, and the database is always UTC.
 *
 * In the autumn hour that happens twice the later (GMT) reading wins; in the
 * spring hour that never happens the time is moved forward an hour.
 */
export function londonLocalToUtc(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (!Number.isFinite(wall)) return null;
  // Two passes: the offset at the guess, then at the corrected instant.
  let instant = wall - londonOffsetMs(wall);
  instant = wall - londonOffsetMs(instant);
  return new Date(instant).toISOString();
}

/** A UTC ISO string as the `YYYY-MM-DDTHH:mm` a datetime-local input shows in London. */
export function utcToLondonLocal(iso: string | null | undefined): string {
  const at = ms(iso);
  if (at === null) return "";
  const p = londonParts(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const LONDON_DISPLAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

const LONDON_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

/** "Sat 25 Oct, 01:30 BST". Every time an operator or customer reads is London time. */
export function formatLondon(iso: string | null | undefined): string {
  const at = ms(iso);
  if (at === null) return "";
  // A window in another year said only "Tue 1 Jan" (admin QA 2026-09-30), and
  // some ICU builds print winter time as "GMT+0".
  const text = tidyZone(LONDON_DISPLAY.format(new Date(at)));
  const year = new Date(at).getUTCFullYear();
  return year === new Date().getUTCFullYear() ? text : text.replace(/,/, ` ${year},`);
}

function tidyZone(text: string): string {
  return text.replace(/GMT\+0\b/, "GMT");
}

/** "14:30 GMT" when the time is today in London, else the full form. */
export function formatLondonShort(iso: string | null | undefined, now: Date): string {
  const at = ms(iso);
  if (at === null) return "";
  const same = utcToLondonLocal(new Date(at).toISOString()).slice(0, 10) ===
    utcToLondonLocal(now.toISOString()).slice(0, 10);
  return same ? tidyZone(LONDON_TIME.format(new Date(at))) : formatLondon(iso);
}

/** "2h 05m" / "4m 09s" / "3d 2h" — the admin countdown. */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "now";
  const total = Math.floor(msLeft / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(seconds)}s`;
}
