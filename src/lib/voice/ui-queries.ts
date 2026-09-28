import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { runOperation } from "@/lib/services";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { CallCard } from "./call-view";

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
