/**
 * The proxy's maintenance decision, as a pure function (docs/MAINTENANCE.md).
 *
 * `proxy.ts` calls `decideMaintenance` for every request and does only what it
 * says. Keeping the decision pure is what lets every level x route class x
 * bypass combination be asserted in a unit test, instead of discovered on the
 * night the site goes offline and a Stripe webhook bounces.
 *
 * The rules, in the order they are applied:
 *
 *   1. OFF allows everything.
 *   2. Exempt routes are never touched at any level: the admin console (so
 *      maintenance can be switched off), /status, provider webhooks (leads,
 *      payments and STOPs are still accepted and queued), the cron worker,
 *      health checks, legal pages and opt-outs, robots/sitemap and static
 *      files, the banner-dismissal endpoint, and the public quote page when
 *      the window keeps it online.
 *   3. From READ_ONLY up, a write is refused with "changes are paused". A
 *      write is any non-GET/HEAD/OPTIONS request (a Server Action is a POST
 *      to the page URL), plus the OAuth connect flow, which writes on GET.
 *      Two routes are left to the next layer: sign-in (starting a session is
 *      not a change to anyone's data) and MCP, whose reads are POSTs too, so
 *      `runOperation` refuses its writes instead.
 *   4. APP_OFFLINE takes the customer app, sign-in, the API and MCP offline.
 *   5. SITE_OFFLINE also takes the marketing site offline.
 *
 * A platform admin's session may preview an offline page (the bypass), but
 * never write through a pause: maintenance usually exists because the data
 * underneath is being changed.
 *
 * Pure: relative imports only.
 */

import { LEVEL_RANK, type EffectiveLevel } from "./types.ts";

export type RouteClass =
  | "ADMIN"
  | "STATUS"
  | "WEBHOOK"
  | "CRON"
  | "HEALTH"
  | "LEGAL"
  | "ASSET"
  | "PLATFORM_UI"
  | "QUOTE"
  | "AUTH"
  | "APP"
  | "APP_API"
  | "MCP"
  | "MARKETING";

/** Never touched by any maintenance level. */
const ALWAYS_EXEMPT = new Set<RouteClass>([
  "ADMIN",
  "STATUS",
  "WEBHOOK",
  "CRON",
  "HEALTH",
  "LEGAL",
  "ASSET",
  "PLATFORM_UI",
]);

/** The pages that make up the legal pack, plus opt-out. Always reachable. */
const LEGAL_PREFIXES = [
  "/privacy",
  "/privacy-request",
  "/terms",
  "/cookies",
  "/sub-processors",
  "/data-deletion",
  "/unsubscribe",
  "/api/unsubscribe",
];

const AUTH_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth",
  "/api/auth",
];

/** The signed-in surfaces that are part of the product rather than the site. */
const APP_PREFIXES = [
  "/app",
  "/onboarding",
  "/start-trial",
  "/signup",
  "/dev",
  "/affiliates/app",
  "/affiliates/login",
  "/affiliates/signup",
  "/affiliates/verify-email",
  "/affiliates/onboarding",
];

const HEALTH_PATHS = ["/api/health", "/healthz", "/api/healthz"];

const ASSET_PATHS = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/icon.png",
  "/apple-icon.png",
]);

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function normalise(pathname: string): string {
  if (!pathname) return "/";
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return trimmed.toLowerCase() || "/";
}

export function classifyRoute(rawPathname: string): RouteClass {
  const pathname = normalise(rawPathname);

  if (under(pathname, "/admin")) return "ADMIN";
  if (under(pathname, "/status")) return "STATUS";
  if (under(pathname, "/api/webhooks")) return "WEBHOOK";
  // Voice P3: Retell's custom functions for a call in progress (signed like a
  // webhook). A live call must keep working through a maintenance window.
  if (under(pathname, "/api/voice/tools")) return "WEBHOOK";
  if (under(pathname, "/api/cron")) return "CRON";
  if (HEALTH_PATHS.some((path) => under(pathname, path))) return "HEALTH";
  if (under(pathname, "/api/platform/banners")) return "PLATFORM_UI";
  if (
    ASSET_PATHS.has(pathname) ||
    under(pathname, "/_next") ||
    pathname.startsWith("/opengraph-image") ||
    pathname.startsWith("/twitter-image") ||
    /\.[a-z0-9]{2,5}$/.test(pathname)
  ) {
    return "ASSET";
  }
  if (LEGAL_PREFIXES.some((prefix) => under(pathname, prefix))) return "LEGAL";
  if (under(pathname, "/q")) return "QUOTE";
  if (AUTH_PREFIXES.some((prefix) => under(pathname, prefix))) return "AUTH";
  if (APP_PREFIXES.some((prefix) => under(pathname, prefix))) return "APP";
  if (under(pathname, "/api/mcp")) return "MCP";
  if (under(pathname, "/api/marketing")) return "MARKETING";
  if (under(pathname, "/api")) return "APP_API";
  return "MARKETING";
}

/** The level at which each class goes offline. Classes absent never do. */
const OFFLINE_FROM: Partial<Record<RouteClass, EffectiveLevel>> = {
  APP: "APP_OFFLINE",
  AUTH: "APP_OFFLINE",
  APP_API: "APP_OFFLINE",
  MCP: "APP_OFFLINE",
  QUOTE: "APP_OFFLINE",
  MARKETING: "SITE_OFFLINE",
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type MaintenanceInput = {
  level: EffectiveLevel;
  pathname: string;
  method: string;
  /** From the active window: /q/* stays up through an offline level. */
  keepQuotePagesOnline: boolean;
  /**
   * The request carries a valid platform-admin session, verified against
   * `profiles.platform_role` by the caller. Never derived from a cookie value.
   */
  bypass: boolean;
};

export type MaintenanceDecision =
  | { action: "allow"; routeClass: RouteClass; reason: "off" | "exempt" | "level" | "bypass" }
  /** Show the maintenance page (or a 503 JSON body to an API client). */
  | { action: "offline"; routeClass: RouteClass }
  /** Refuse this change with "changes are paused"; the page itself is fine. */
  | { action: "writes_paused"; routeClass: RouteClass };

function isWriteRequest(routeClass: RouteClass, pathname: string, method: string): boolean {
  if (!SAFE_METHODS.has(method.toUpperCase())) return true;
  // The OAuth connect and callback both store credentials on a GET.
  return routeClass === "APP_API" && under(normalise(pathname), "/api/integrations");
}

export function decideMaintenance(input: MaintenanceInput): MaintenanceDecision {
  const routeClass = classifyRoute(input.pathname);

  if (input.level === "OFF") return { action: "allow", routeClass, reason: "off" };
  if (ALWAYS_EXEMPT.has(routeClass)) return { action: "allow", routeClass, reason: "exempt" };
  if (routeClass === "QUOTE" && input.keepQuotePagesOnline) {
    return { action: "allow", routeClass, reason: "exempt" };
  }

  const offlineFrom = OFFLINE_FROM[routeClass];
  const offline =
    offlineFrom !== undefined && LEVEL_RANK[input.level] >= LEVEL_RANK[offlineFrom];

  if (offline) {
    return input.bypass
      ? isWriteRequest(routeClass, input.pathname, input.method) && routeClass !== "AUTH"
        ? { action: "writes_paused", routeClass }
        : { action: "allow", routeClass, reason: "bypass" }
      : { action: "offline", routeClass };
  }

  // Sign-in writes a session, not anyone's data; MCP's reads are POSTs, so its
  // writes are refused inside runOperation, where the operation is known.
  if (routeClass === "AUTH" || routeClass === "MCP") {
    return { action: "allow", routeClass, reason: "level" };
  }

  if (isWriteRequest(routeClass, input.pathname, input.method)) {
    return { action: "writes_paused", routeClass };
  }

  return { action: "allow", routeClass, reason: "level" };
}
