import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { runOperation } from "@/lib/services";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { CallCard } from "./call-view";
import { createAdminClient } from "@/lib/supabase/admin";
import { DRAWER_CALL_UNAVAILABLE, drawerCallState, type DrawerCallState } from "./call-button-state";

/**
 * Reads for the voice UI (Settings -> Voice, the lead page). Both go through
 * the registry operations so the page sees exactly what Copilot and MCP see,
 * with the same redactions (cost for owner/admin only, representative contact
 * details for admins only). `cache` shares one read per request between the
 * lead page's voice card and its conversation timeline.
 */

type Viewer = { businessId: string; userId: string; role: "owner" | "admin" | "member" | "viewer" };

export type Loaded<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

function ctx(viewer: Viewer) {
  return { businessId: viewer.businessId, userId: viewer.userId, role: viewer.role, caller: "UI" as const, correlationId: randomUUID() };
}

export const loadVoiceSettingsView = cache(async (businessId: string, userId: string, role: Viewer["role"]): Promise<Loaded<VoiceSettingsView>> => {
  const result = await runOperation<VoiceSettingsView>("voice.settings_get", {}, ctx({ businessId, userId, role }));
  return result.success ? { ok: true, data: result.data } : { ok: false, code: result.code, message: result.message };
});

export const loadLeadCalls = cache(async (businessId: string, userId: string, role: Viewer["role"], leadId: string): Promise<Loaded<CallCard[]>> => {
  const result = await runOperation<{ calls: CallCard[] }>("voice.calls_list", { leadId, limit: 25 }, ctx({ businessId, userId, role }));
  return result.success ? { ok: true, data: result.data.calls } : { ok: false, code: result.code, message: result.message };
});

/**
 * "Call with AI" in the Leads drawer: the same reads and the same rule
 * (`callDisabledReason`) as the lead page's AI calls panel. Any failed read
 * gives a disabled button with a reason, never an enabled one.
 */
export async function loadDrawerCallState(
  businessId: string,
  userId: string,
  role: Viewer["role"],
  lead: { id: string; phone: string | null; opted_out: boolean },
): Promise<DrawerCallState> {
  try {
    const [view, calls, flags] = await Promise.all([
      loadVoiceSettingsView(businessId, userId, role),
      loadLeadCalls(businessId, userId, role, lead.id),
      createAdminClient()
        .from("leads")
        .select("anonymised_at, archived_at")
        .eq("business_id", businessId)
        .eq("id", lead.id)
        .maybeSingle(),
    ]);
    if (!view.ok || !calls.ok || flags.error) return DRAWER_CALL_UNAVAILABLE;
    const row = flags.data as { anonymised_at: string | null; archived_at: string | null } | null;
    return drawerCallState({
      role,
      lead: { phone: lead.phone, optedOut: lead.opted_out, anonymised: Boolean(row?.anonymised_at), archived: Boolean(row?.archived_at) },
      view: view.data,
      latest: calls.data[0] ?? null,
    });
  } catch {
    return DRAWER_CALL_UNAVAILABLE;
  }
}
