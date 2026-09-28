import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideMaintenance } from "./routes";
import { maintenanceResponse } from "./response";
import { getMaintenanceStatus } from "./state";

/**
 * The maintenance gate `proxy.ts` runs before the session refresh.
 *
 * Cost when maintenance is OFF (the normal case): one in-memory cache read.
 * The database is consulted at most once per 20 seconds per instance (state.ts)
 * and never on the request path otherwise.
 *
 * The admin bypass: a request that maintenance would take offline is let
 * through when it carries a Supabase session whose user has
 * `profiles.platform_role = 'platform_admin'`. The session is verified by
 * Supabase (`auth.getUser()`, not a decoded cookie), and the role is read from
 * the database with that session and cached for 30 seconds per user. No cookie
 * value, header or query parameter is trusted on its own. The lookup only
 * happens while a page is actually offline, so it costs nothing normally.
 */

type SessionRefresh = (request: NextRequest) => Promise<{
  response: NextResponse;
  supabase: SupabaseClient;
  userId: string | null;
}>;

const ADMIN_TTL_MS = 30_000;
const adminCache = new Map<string, { admin: boolean; at: number }>();

async function isPlatformAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const cached = adminCache.get(userId);
  if (cached && Date.now() - cached.at < ADMIN_TTL_MS) return cached.admin;
  const { data } = await supabase.from("profiles").select("platform_role").eq("id", userId).maybeSingle();
  const admin = data?.platform_role === "platform_admin";
  if (adminCache.size > 500) adminCache.clear();
  adminCache.set(userId, { admin, at: Date.now() });
  return admin;
}

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"));
}

/**
 * Returns the response to send instead of the page, or null to carry on.
 * `refreshSession` is the proxy's normal session refresh; when the bypass is
 * checked its response (with any refreshed cookies) is returned as-is.
 */
export async function maintenanceGate(
  request: NextRequest,
  refreshSession: SessionRefresh,
): Promise<NextResponse | null> {
  const now = new Date();
  const status = await getMaintenanceStatus(now);
  if (status.level === "OFF") return null;

  const { pathname } = request.nextUrl;
  const method = request.method;
  const base = {
    level: status.level,
    pathname,
    method,
    keepQuotePagesOnline: status.active?.keepQuotePagesOnline ?? true,
  };

  let decision = decideMaintenance({ ...base, bypass: false });
  if (decision.action === "allow") return null;

  if (decision.action === "offline" && hasSessionCookie(request)) {
    try {
      const session = await refreshSession(request);
      if (session.userId && (await isPlatformAdmin(session.supabase, session.userId))) {
        decision = decideMaintenance({ ...base, bypass: true });
        if (decision.action === "allow") {
          // A display hint for the static website's "Maintenance bypass" pill
          // (components/site/marketing-bypass-pill.tsx). It grants nothing:
          // this gate re-verifies the session and role on every request.
          session.response.cookies.set("ct-maintenance-bypass", status.level, {
            path: "/",
            maxAge: 120,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
          return session.response;
        }
      }
    } catch {
      // A failed bypass check is a normal visitor.
    }
  }

  if (decision.action === "allow") return null;

  const accept = request.headers.get("accept") ?? "";
  const spec = maintenanceResponse({
    decision,
    status,
    now,
    method,
    isServerAction: request.headers.has("next-action"),
    acceptsHtml: accept.includes("text/html"),
  });
  return new NextResponse(spec.body, { status: spec.status, headers: spec.headers });
}
