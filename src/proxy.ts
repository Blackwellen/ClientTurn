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

export async function proxy(request: NextRequest) {
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
