import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Host-based routing for the status subdomain.
 *
 * `status.clientturn.com` serves the `/status` route that already exists on
 * the main domain rather than being a separate deployment. A status page is
 * there to be reachable when things are wrong, and a second app to keep
 * running is a second thing that can break during the incident it is supposed
 * to be reporting on.
 *
 * The rewrite is invisible: the visitor keeps the status hostname in the
 * address bar and the existing route renders the page.
 */
const STATUS_HOSTS = new Set([
  "status.clientturn.com",
  "status.localhost:3000",
  "status.localhost:3001",
]);

function isStatusHost(request: NextRequest): boolean {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  return STATUS_HOSTS.has(host);
}

/**
 * Canonical-domain redirect: `www.clientturn.com` -> `clientturn.com`.
 *
 * Both hostnames are aliased to the same Vercel deployment, so a visitor could
 * reach either one and get an identical page -- which is exactly the problem.
 * The Supabase session cookie the app sets is host-only (`proxy-session.ts`
 * sets no explicit `domain`), so a session established on one hostname is
 * invisible on the other. Every OAuth connect flow (Calendly, Slack, HubSpot,
 * Zoho...) builds its redirect_uri from `NEXT_PUBLIC_SITE_URL`, which is the
 * apex domain -- so a workspace member who happened to be signed in on `www`
 * would click Connect, complete the provider's consent screen, get redirected
 * back to the apex domain with no session cookie for it, and land on `/login`
 * looking logged out. Discovered 2026-09-13 exercising the Calendly connect
 * flow live; the fix belongs here because the failure is general, not
 * Calendly-specific.
 *
 * A redirect before Supabase's cookie logic runs, rather than a cookie
 * `domain` of `.clientturn.com`, because sharing the cookie would still leave
 * two live copies of the app answering as the same signed-in session --
 * harmless today, but a needless second surface. One canonical host is
 * simpler to reason about.
 */
function isWwwHost(request: NextRequest): boolean {
  return (request.headers.get("host")?.toLowerCase() ?? "") === "www.clientturn.com";
}

export async function proxy(request: NextRequest) {
  if (isWwwHost(request)) {
    const url = request.nextUrl.clone();
    url.host = "clientturn.com";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (isStatusHost(request)) {
    const { pathname } = request.nextUrl;

    // Assets and API routes resolve normally, or the rewritten page loads
    // without its own CSS and JS.
    const passThrough =
      pathname.startsWith("/_next") ||
      pathname.startsWith("/api") ||
      pathname.startsWith("/status") ||
      /\.[a-z0-9]+$/i.test(pathname);

    if (!passThrough) {
      // The whole host is the status page. Serving the marketing site at
      // status.clientturn.com/pricing would be a second front door nobody
      // asked for.
      const url = request.nextUrl.clone();
      url.pathname = "/status";
      return NextResponse.rewrite(url);
    }

    // The status page reads no session, so it skips the Supabase refresh
    // entirely — one less dependency on the page people load during an
    // outage.
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
