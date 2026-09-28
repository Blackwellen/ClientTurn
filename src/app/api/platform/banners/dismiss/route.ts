import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveWorkspace } from "@/lib/auth/session";
import { isDismissKey, recordDismissal } from "@/lib/banners/server";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { serverEnv } from "@/lib/env";

/**
 * POST /api/platform/banners/dismiss — a signed-in person hides one platform
 * banner (or the upcoming-maintenance notice) for themselves.
 *
 * A route handler rather than a Server Action because it must keep working
 * during read-only maintenance: the maintenance notice is itself dismissible,
 * and a Server Action is a POST to the page the proxy pauses. The proxy
 * exempts this path (lib/maintenance/routes.ts, PLATFORM_UI).
 *
 * The user is the verified session's; the body names only the notice. Only a
 * dismissible banner can be dismissed (recordDismissal checks), and the write
 * is the caller's own dismissal row and nothing else.
 */

const body = z.object({ key: z.string().max(120).refine(isDismissKey) });

export async function POST(request: Request) {
  // Same-origin only: a cross-site form cannot dismiss banners for someone.
  // Origin (or Referer) is REQUIRED; a request with neither is refused.
  if (!isSameOriginRequest(request.headers, [new URL(request.url).origin, serverEnv.siteUrl])) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  const workspace = await getActiveWorkspace();
  if (!workspace) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown notice." }, { status: 400 });

  const result = await recordDismissal(workspace.userId, parsed.data.key);
  if (result === "refused") return NextResponse.json({ error: "That notice cannot be dismissed." }, { status: 400 });
  if (result === "unavailable") return NextResponse.json({ error: "Not saved." }, { status: 503 });
  return new NextResponse(null, { status: 204 });
}
