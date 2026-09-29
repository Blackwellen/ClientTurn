import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSchemaLag } from "@/lib/supabase/schema-lag";

export type AuthSessionRow = {
  id: string;
  createdAt: string;
  lastActiveAt: string | null;
  userAgent: string | null;
  ip: string | null;
  aal: string | null;
  isCurrent: boolean;
};

export type SessionList =
  | { available: true; sessions: AuthSessionRow[] }
  | { available: false; reason: "pending_migration" | "error" };

type RpcRow = {
  id: string;
  created_at: string;
  updated_at: string | null;
  refreshed_at: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
  is_current: boolean | null;
};

/**
 * The caller's own sign-in sessions. Supabase does not list sessions through
 * its client API, so migration 0180 adds `my_auth_sessions()`: a SECURITY
 * DEFINER read of `auth.sessions` restricted to `auth.uid()`. Until 0180 is
 * applied the list is reported as unavailable (the sign-out controls still
 * work, they use the Auth API).
 */
export async function listMySessions(): Promise<SessionList> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await supabase.rpc("my_auth_sessions");
  if (error) {
    if (isSchemaLag(error)) return { available: false, reason: "pending_migration" };
    console.error("[sessions] list failed", { code: error.code });
    return { available: false, reason: "error" };
  }
  return {
    available: true,
    sessions: ((data ?? []) as RpcRow[]).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastActiveAt: row.refreshed_at ?? row.updated_at ?? null,
      userAgent: row.user_agent,
      ip: row.ip,
      aal: row.aal,
      isCurrent: Boolean(row.is_current),
    })),
  };
}
