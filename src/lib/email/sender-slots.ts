import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { mailboxDailyCeiling } from "./sender-health";

/**
 * Sender identities on the send path (brief §43).
 *
 * `claimSenderSlot` is the one way a marketing email reserves a place in a
 * sender's day: the SQL function takes the lower of the configured cap (with
 * its warm-up ramp) and the connected mailbox provider's safe daily limit,
 * refuses a sender the complaint monitor PAUSED, and starts the warm-up clock
 * on a sender's first ever send.
 */

// 0127 function and columns post-date the generated database types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** The workspace mailbox's provider ceiling, from its SMTP host. Null when none is connected. */
export async function mailboxCeilingFor(businessId: string): Promise<number | null> {
  const { data, error } = await createAdminClient()
    .from("integrations")
    .select("config")
    .eq("business_id", businessId)
    .eq("provider_type", "imap_smtp")
    .maybeSingle();
  if (error) throw new Error(`Mailbox settings could not be read: ${error.message}`);
  const smtp = ((data?.config ?? {}) as { smtp?: { host?: string } }).smtp;
  return mailboxDailyCeiling(smtp?.host ?? null);
}

/** Reserves one send. False = today's allowance is used (or the sender is paused). */
export async function claimSenderSlot(businessId: string, senderId: string): Promise<boolean> {
  const ceiling = await mailboxCeilingFor(businessId);
  const { data, error } = await db().rpc("claim_sender_send_slot_capped", {
    p_business_id: businessId,
    p_sender_id: senderId,
    p_ceiling: ceiling,
  });
  if (error && isSchemaLag(error)) {
    // Before migration 0127: the uncapped claim, exactly as before.
    const fallback = await createAdminClient().rpc("claim_sender_send_slot", {
      p_business_id: businessId,
      p_sender_id: senderId,
    });
    if (fallback.error) throw new Error(`Sender slot could not be claimed: ${fallback.error.message}`);
    return fallback.data === true;
  }
  if (error) throw new Error(`Sender slot could not be claimed: ${error.message}`);
  return data === true;
}

export type SendingIdentity = {
  id: string;
  displayName: string | null;
  email: string | null;
  replyTo: string | null;
  healthState: "HEALTHY" | "WATCH" | "WARNING" | "PAUSED";
};

type SenderRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  reply_to: string | null;
  health_state: string | null;
  active: boolean;
};

function toIdentity(row: SenderRow): SendingIdentity {
  const state = row.health_state;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    replyTo: row.reply_to,
    healthState:
      state === "WATCH" || state === "WARNING" || state === "PAUSED" ? state : "HEALTHY",
  };
}

/**
 * The identity a warm email goes out under: the one named on the message (the
 * automation step's), else the workspace default. Null when the workspace has
 * none, and the mailbox's own From is used as before.
 */
export async function sendingIdentityFor(
  businessId: string,
  senderIdentityId: string | null,
): Promise<SendingIdentity | null> {
  const find = async (filter: { id: string } | { isDefault: true }): Promise<SenderRow | null> => {
    const read = (columns: string) => {
      let query = db().from("sender_identities").select(columns).eq("business_id", businessId);
      query = "id" in filter ? query.eq("id", filter.id) : query.eq("is_default", true).eq("active", true);
      return query.maybeSingle();
    };
    let { data, error } = await read("id, display_name, email, reply_to, health_state, active");
    // Before migration 0127 there is no health_state: the sender reads HEALTHY.
    if (error && isSchemaLag(error)) ({ data, error } = await read("id, display_name, email, reply_to, active"));
    if (error) throw new Error(`Sender identity could not be read: ${error.message}`);
    return (data as SenderRow | null) ?? null;
  };

  if (senderIdentityId) {
    const row = await find({ id: senderIdentityId });
    if (row?.active) return toIdentity(row);
  }
  const fallback = await find({ isDefault: true });
  return fallback ? toIdentity(fallback) : null;
}
