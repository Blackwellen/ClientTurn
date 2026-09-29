import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/auth/session";
import { activitySigningKey } from "@/lib/auth/activity-proxy";
import { ACTIVITY_COOKIE, verifyIdleExpiry } from "@/lib/auth/security-policy";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Where `requireWorkspace()` sends a member whose workspace idle timeout has
 * passed (Settings -> Security). A Server Component cannot clear cookies, so
 * the sign-out happens here.
 *
 * Only signs out on a fresh token that requireWorkspace minted for this same
 * user, so a link to this URL cannot be used to sign someone else out.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(`${origin}/login?reason=idle`);

  const key = activitySigningKey();
  const valid = Boolean(key && verifyIdleExpiry(searchParams.get("t"), user.id, Date.now(), key));
  if (!valid) return NextResponse.redirect(`${origin}/app`);

  const workspace = await getActiveWorkspace();
  await recordAudit({
    businessId: workspace?.businessId ?? null,
    actorUserId: user.id,
    action: "security.session_idle_timeout",
    entityType: "user",
    entityId: user.id,
  });

  // This device only: the member's other devices keep their own sessions.
  await supabase.auth.signOut({ scope: "local" });

  const response = NextResponse.redirect(`${origin}/login?reason=idle`);
  response.cookies.set(ACTIVITY_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
