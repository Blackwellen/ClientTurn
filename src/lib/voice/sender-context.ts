import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceNumber } from "./numbers/sender";
import type { ProvisioningState } from "./numbers/provisioning";

/**
 * The two facts the SMS path needs to decide its sender (messaging/sms-sender.ts):
 * the workspace's live dedicated number and its Twilio subaccount. Two small
 * reads, never provider I/O. Any failure (a missing table, a read error)
 * returns nulls, which means the platform sender, exactly as before voice.
 */
export async function readSmsSenderContext(businessId: string): Promise<{ number: WorkspaceNumber | null; subaccountSid: string | null }> {
  try {
    const client = createAdminClient() as unknown as SupabaseClient;
    const [number, account] = await Promise.all([
      client
        .from("business_numbers")
        .select("business_id, provisioning_state, e164, messaging_service_sid, quarantine_until")
        .eq("business_id", businessId)
        .in("provisioning_state", ["ACTIVE", "RELEASE_SCHEDULED"])
        .limit(1)
        .maybeSingle(),
      client.from("telephony_accounts").select("subaccount_sid").eq("business_id", businessId).eq("provider", "twilio").maybeSingle(),
    ]);
    if (number.error || account.error) return { number: null, subaccountSid: null };
    const row = number.data as { business_id: string; provisioning_state: string; e164: string | null; messaging_service_sid: string | null; quarantine_until: string | null } | null;
    return {
      number: row
        ? { businessId: row.business_id, state: row.provisioning_state as ProvisioningState, e164: row.e164, messagingServiceSid: row.messaging_service_sid, quarantineUntil: row.quarantine_until }
        : null,
      subaccountSid: (account.data as { subaccount_sid: string } | null)?.subaccount_sid ?? null,
    };
  } catch {
    return { number: null, subaccountSid: null };
  }
}
