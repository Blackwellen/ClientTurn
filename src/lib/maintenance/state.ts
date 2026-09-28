/**
 * The maintenance state, read cheaply enough to consult on every request.
 *
 * Used by `proxy.ts` (every request), `runOperation` (every write), the send
 * guard (every outbound message), the app layout and the status page. So:
 *
 *   * **Cached per server instance for 20 seconds.** Never a database round
 *     trip per request. A change made in /admin/site reaches every instance
 *     within the TTL; the instance that made it is primed immediately.
 *   * **Read through a public SECURITY DEFINER function** (0161
 *     `platform_maintenance_public`) with the publishable key, over GET. No
 *     service-role key in the proxy, and only public columns come back.
 *   * **Fails OPEN.** A failed read keeps the last good snapshot for up to
 *     five minutes, then assumes no maintenance. A database blip must never
 *     take the site offline on its own; the one thing worse than a
 *     maintenance page nobody asked for is not being able to switch it off.
 *   * **Never trusts the client.** The state comes from the database or the
 *     deployment's environment, not from a cookie, header or query string.
 *
 * Break-glass: `MAINTENANCE_OVERRIDE_LEVEL` (READ_ONLY | APP_OFFLINE |
 * SITE_OFFLINE) forces a level from the environment, for when the database is
 * the thing that is down. `MAINTENANCE_OVERRIDE_MESSAGE` and
 * `MAINTENANCE_OVERRIDE_UNTIL` (ISO) fill in the page.
 *
 * Deliberately not `server-only`: the proxy imports it, and it holds nothing
 * secret (the publishable key is public by definition).
 */

import { resolveMaintenance } from "./schedule";
import {
  MAINTENANCE_LEVELS,
  MAINTENANCE_OFF,
  WRITES_PAUSED_MESSAGE,
  type MaintenanceLevel,
  type MaintenanceStatus,
  type PublicMaintenanceWindow,
} from "./types";
import { backLine } from "./response";

export const MAINTENANCE_CACHE_TTL_MS = 20_000;
const STALE_IF_ERROR_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 1_500;

export type MaintenanceSnapshot = {
  windows: PublicMaintenanceWindow[];
  source: "db" | "env" | "unavailable";
};

type CacheEntry = { snapshot: MaintenanceSnapshot; fetchedAt: number; lastGoodAt: number | null };

let cache: CacheEntry | null = null;
let inFlight: Promise<MaintenanceSnapshot> | null = null;
let warned = false;

type Row = {
  id: string;
  level: string;
  starts_at: string;
  ends_at: string | null;
  expected_back_at: string | null;
  message: string | null;
  keep_quote_pages_online: boolean;
  keep_automation_running: boolean;
  announce_banner: boolean;
};

function isLevel(value: unknown): value is MaintenanceLevel {
  return typeof value === "string" && (MAINTENANCE_LEVELS as readonly string[]).includes(value);
}

export function rowsToWindows(rows: unknown): PublicMaintenanceWindow[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicMaintenanceWindow[] = [];
  for (const raw of rows as Row[]) {
    if (!raw || typeof raw.id !== "string" || !isLevel(raw.level) || typeof raw.starts_at !== "string") {
      continue;
    }
    out.push({
      id: raw.id,
      level: raw.level,
      startsAt: raw.starts_at,
      endsAt: raw.ends_at ?? null,
      expectedBackAt: raw.expected_back_at ?? null,
      message: raw.message ?? null,
      keepQuotePagesOnline: raw.keep_quote_pages_online !== false,
      keepAutomationRunning: raw.keep_automation_running === true,
      announceBanner: raw.announce_banner !== false,
    });
  }
  return out;
}

/** The environment override, if the deployment sets one. */
export function envOverride(env: Record<string, string | undefined> = process.env): PublicMaintenanceWindow | null {
  const level = env.MAINTENANCE_OVERRIDE_LEVEL?.trim().toUpperCase();
  if (!isLevel(level)) return null;
  const until = env.MAINTENANCE_OVERRIDE_UNTIL?.trim();
  const untilValid = until && Number.isFinite(Date.parse(until)) ? new Date(until).toISOString() : null;
  return {
    id: "00000000-0000-0000-0000-000000000000",
    level,
    startsAt: "2000-01-01T00:00:00.000Z",
    endsAt: null,
    expectedBackAt: untilValid,
    message: env.MAINTENANCE_OVERRIDE_MESSAGE?.trim().slice(0, 500) || null,
    keepQuotePagesOnline: true,
    keepAutomationRunning: env.MAINTENANCE_OVERRIDE_KEEP_AUTOMATION === "1",
    announceBanner: false,
  };
}

/** The Next data-cache tag every maintenance write revalidates. */
export const MAINTENANCE_CACHE_TAG = "platform-maintenance";

/**
 * GET on a public RPC. `next` is passed only by statically rendered pages
 * (the status page, the website banner), which cache it by tag for
 * `revalidate` seconds; everywhere else the module cache above is the cache.
 */
export async function publicRpc(
  fn: "platform_maintenance_public" | "platform_marketing_banners",
  next?: { revalidate: number; tags: string[] },
): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL or publishable key is not configured");

  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    ...(next ? { next } : {}),
  });
  if (!response.ok) throw new Error(`${fn} returned ${response.status}`);
  return response.json();
}

async function fetchWindows(): Promise<PublicMaintenanceWindow[]> {
  return rowsToWindows(await publicRpc("platform_maintenance_public"));
}

/**
 * The state for a statically rendered page: cached by tag in the Next data
 * cache for 60 seconds rather than in this module, so the page stays static.
 */
export async function getMaintenanceStatusForStaticPage(now: Date = new Date()): Promise<MaintenanceStatus> {
  const override = envOverride();
  if (override) return resolveMaintenance([override], now);
  try {
    const rows = await publicRpc("platform_maintenance_public", {
      revalidate: 60,
      tags: [MAINTENANCE_CACHE_TAG],
    });
    return resolveMaintenance(rowsToWindows(rows), now);
  } catch {
    return MAINTENANCE_OFF;
  }
}

async function refresh(now: number): Promise<MaintenanceSnapshot> {
  try {
    const windows = await fetchWindows();
    const snapshot: MaintenanceSnapshot = { windows, source: "db" };
    cache = { snapshot, fetchedAt: now, lastGoodAt: now };
    warned = false;
    return snapshot;
  } catch (error) {
    if (!warned) {
      // Once per failure streak: until 0161 is applied this fails on every
      // refresh, and a log line every 20 seconds per instance is noise.
      console.warn("[maintenance] state read failed; failing open", error instanceof Error ? error.message : error);
      warned = true;
    }
    const lastGood = cache?.lastGoodAt ?? null;
    const keep = cache && lastGood !== null && now - lastGood < STALE_IF_ERROR_MS;
    const snapshot: MaintenanceSnapshot = keep ? cache!.snapshot : { windows: [], source: "unavailable" };
    cache = { snapshot, fetchedAt: now, lastGoodAt: lastGood };
    return snapshot;
  }
}

/** The cached snapshot, refreshed at most once per TTL per instance. */
export async function readMaintenanceSnapshot(): Promise<MaintenanceSnapshot> {
  const override = envOverride();
  if (override) return { windows: [override], source: "env" };

  const now = Date.now();
  if (cache && now - cache.fetchedAt < MAINTENANCE_CACHE_TTL_MS) return cache.snapshot;
  if (!inFlight) {
    inFlight = refresh(now).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** The platform's maintenance state now. */
export async function getMaintenanceStatus(now: Date = new Date()): Promise<MaintenanceStatus> {
  try {
    const snapshot = await readMaintenanceSnapshot();
    return resolveMaintenance(snapshot.windows, now);
  } catch {
    return MAINTENANCE_OFF;
  }
}

/**
 * Replaces this instance's cached snapshot. Called by the admin actions right
 * after a write, so the operator's own instance reflects the change at once;
 * tests use it to put the platform into a known state.
 */
export function primeMaintenanceCache(windows: PublicMaintenanceWindow[], now: number = Date.now()): void {
  cache = { snapshot: { windows, source: "db" }, fetchedAt: now, lastGoodAt: now };
}

/** Forgets the cached snapshot, so the next read goes to the database. */
export function invalidateMaintenanceCache(): void {
  cache = null;
}

/**
 * The refusal for a write made by a person or their software while any
 * maintenance level is active, or null when writes are allowed. The service
 * layer's own SYSTEM work (the worker processing webhooks) is not a person's
 * change and is never refused here.
 */
export async function maintenanceWriteBlock(now: Date = new Date()): Promise<string | null> {
  const status = await getMaintenanceStatus(now);
  if (status.level === "OFF") return null;
  const back = backLine(status);
  return back ? `${WRITES_PAUSED_MESSAGE} ${back}` : `${WRITES_PAUSED_MESSAGE} Please try again shortly.`;
}
