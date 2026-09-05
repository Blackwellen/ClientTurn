import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only legitimate callers: verified webhook handlers, the background worker,
 * and audited platform-admin operations. Never import this from a component
 * that renders for a customer, and never return its raw results to a browser.
 */
export function createAdminClient() {
  return createClient<Database>(
    serverEnv.supabase.url,
    serverEnv.supabase.serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
