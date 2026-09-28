import { safeRelativePath } from "@/lib/security/safe-redirect";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared by `actions.ts` (`signIn`) and `google-login.ts` (the Google
 * callback) -- password sign-in and Google sign-in are two doors onto the same
 * account, and must resolve a requested `redirect` and a default destination
 * identically. Split out of `actions.ts` rather than exported from it because
 * that file has a `"use server"` directive: every top-level export of a
 * `"use server"` module becomes a Server Action reference, and Next.js
 * requires every one of those to be an async function. `sanitizeRedirectPath`
 * below is synchronous, so it cannot live there.
 */

/** Only same-origin relative paths survive, so `?redirect=` cannot be a phishing hop. */
export function sanitizeRedirectPath(value: unknown): string | null {
  const path = safeRelativePath(value);
  if (!path) return null;
  if (path.startsWith("/login") || path.startsWith("/signup")) return null;
  return path;
}

export async function destinationForUser(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_members")
    .select("businesses(status)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const status = data?.businesses?.status;
  return status === "active" ? "/app" : "/onboarding";
}
