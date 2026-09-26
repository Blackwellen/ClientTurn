/**
 * Stands in for `@/lib/supabase/server` under node --test (see ../story-hooks.mjs).
 * Next's cookie store does not exist here, so the request client is built from
 * the story owner's real access token instead: every read still goes through
 * Postgres RLS as that user, exactly as a signed-in page would.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function createClient() {
  const token = (globalThis as { __STORY_ACCESS_TOKEN__?: string }).__STORY_ACCESS_TOKEN__;
  if (!token) throw new Error("story: no signed-in user for the request client");
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
