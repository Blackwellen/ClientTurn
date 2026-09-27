import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseStoredChannelPreference, type ContactChannel } from "./channel-preference";

/**
 * Reads and writes `leads.preferred_contact_channel` and
 * `leads.preferred_contact_channel_asked_at` (0147).
 *
 * Deliberately tolerant: read on its own, never inside LEAD_COLUMNS, so a
 * schema lag (0147 not yet applied) degrades to "no preference, never asked"
 * instead of breaking the lead load every job depends on. Writes are
 * best-effort for the same reason and log rather than throw.
 */

export type ChannelPreferenceState = { preference: ContactChannel | null; askedAt: string | null };

const NONE: ChannelPreferenceState = { preference: null, askedAt: null };

// The columns post-date the generated types.
type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function readChannelPreference(businessId: string, leadId: string): Promise<ChannelPreferenceState> {
  try {
    const db = createAdminClient() as unknown as Untyped;
    const { data, error } = await db
      .from("leads")
      .select("preferred_contact_channel, preferred_contact_channel_asked_at")
      .eq("business_id", businessId)
      .eq("id", leadId)
      .maybeSingle();
    if (error || !data) return NONE;
    return {
      preference: parseStoredChannelPreference(data.preferred_contact_channel),
      askedAt: typeof data.preferred_contact_channel_asked_at === "string" ? data.preferred_contact_channel_asked_at : null,
    };
  } catch {
    return NONE;
  }
}

async function update(businessId: string, leadId: string, patch: Record<string, unknown>, what: string): Promise<void> {
  try {
    const db = createAdminClient() as unknown as Untyped;
    const { error } = await db.from("leads").update(patch).eq("business_id", businessId).eq("id", leadId);
    if (error) console.error(`[channel-preference] ${what} failed`, { businessId, leadId, message: error.message });
  } catch (error) {
    console.error(`[channel-preference] ${what} threw`, { businessId, leadId, error });
  }
}

/** The question was asked: it is never asked again. */
export function markChannelPreferenceAsked(businessId: string, leadId: string, at = new Date()): Promise<void> {
  return update(businessId, leadId, { preferred_contact_channel_asked_at: at.toISOString() }, "mark asked");
}

/** The lead said where to reach them (or asked for a call). */
export function recordChannelPreference(businessId: string, leadId: string, preference: ContactChannel, at = new Date()): Promise<void> {
  return update(
    businessId,
    leadId,
    { preferred_contact_channel: preference, preferred_contact_channel_asked_at: at.toISOString() },
    "record",
  );
}
