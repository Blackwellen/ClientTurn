import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { DISABLED_AUTHORITY, parseAuthority, type CommercialAuthority } from "./authority";

/** The workspace's commercial authority for the settings screen. Disabled if absent. */
export async function loadCommercialAuthoritySettings(businessId: string): Promise<CommercialAuthority> {
  const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
    .from("commercial_authority")
    .select("enabled, approved_checkout_links, max_discount_percent, requires_human_above_value_minor")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) {
    logWriteError({ error }, "settings: read commercial authority", { businessId });
    return DISABLED_AUTHORITY;
  }
  return parseAuthority(data);
}
