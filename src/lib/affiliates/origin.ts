import "server-only";
import { headers } from "next/headers";

/**
 * The public origin referral links should point at.
 *
 * Prefers the configured site URL so a link copied from a preview deploy still
 * points at production — a partner who shares a `*.vercel.app` referral URL
 * with their audience has effectively lost those clicks, and that is not a
 * mistake we should make easy to make.
 *
 * Falls back to the request host only when nothing is configured, which is the
 * local-development case.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
