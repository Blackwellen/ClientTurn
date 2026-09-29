import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Checks a password without touching the caller's own session.
 *
 * `signInWithPassword` on the cookie-bound client would replace the current
 * session with a fresh AAL1 one, silently undoing the two-factor the caller
 * already passed. So the check runs on a throwaway client that stores
 * nothing, and the session it creates is revoked straight away.
 */
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}
