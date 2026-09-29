import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { withActivity } from "@/lib/auth/activity-proxy";

/**
 * Refreshes the Supabase session and reports whose it is. `userId` comes from
 * `auth.getUser()`, which Supabase verifies, never from a decoded cookie.
 * The maintenance gate uses it for the admin bypass (lib/maintenance/proxy-gate.ts).
 */
export async function refreshSessionWithUser(request: NextRequest): Promise<{
  response: NextResponse;
  supabase: SupabaseClient;
  userId: string | null;
}> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, supabase: supabase as unknown as SupabaseClient, userId: user?.id ?? null };
}

/**
 * The session refresh every non-maintenance request goes through. Also feeds
 * the workspace idle timeout (lib/auth/activity-proxy.ts): the page is handed
 * the previous activity time and the cookie is moved on to now.
 */
export async function updateSession(request: NextRequest) {
  const { response, userId } = await refreshSessionWithUser(request);
  return withActivity(request, response, userId);
}
