"use server";

/**
 * Voice (P2) server actions for Settings -> Voice and the lead page. Each one
 * runs a registry operation (`voice.*`, operations/voice.ts), so the role,
 * entitlement, confirmation and audit rules are the runtime's, not this
 * file's. The role is checked here only so the message is clear.
 *
 * Confirmation: `voice.request_call` is EXTERNAL and `voice.number_release`
 * is DESTRUCTIVE. `confirmed: true` is set here only because these actions
 * are called from a confirmation dialog in the UI and nowhere else.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole, requireWorkspace, type ActiveWorkspace, type BusinessRole } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import type { SettingsActionResult } from "@/lib/settings/ai-selling-actions";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";

function context(workspace: ActiveWorkspace, confirmed = false) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    correlationId: randomUUID(),
    ...(confirmed ? { confirmed: true } : {}),
  };
}

async function actor(minimum: BusinessRole): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole(minimum);
  } catch {
    return null;
  }
}

const ADMIN_ONLY = "Only an owner or admin can change voice settings.";

/** Saves one panel's slice of the voice settings (voice.settings_update). */
export async function saveVoiceSettingsAction(update: unknown): Promise<SettingsActionResult> {
  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: ADMIN_ONLY };
  const result = await runOperation("voice.settings_update", update, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/settings");
  return { ok: true, message: "Voice settings saved." };
}

type Prefill = VoiceSettingsView["regulatory"]["prefill"];

export type CompaniesHouseLookup = ({ ok: true } & Prefill) | { ok: false; error: string };

/**
 * Re-reads the settings with a Companies House lookup to prefill the business
 * details. NOT_FOUND is returned as ok so the form can say "enter it yourself".
 */
export async function lookupCompaniesHouseAction(): Promise<CompaniesHouseLookup> {
  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: ADMIN_ONLY };
  const result = await runOperation<VoiceSettingsView>("voice.settings_get", { lookupCompaniesHouse: true }, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  return { ok: true, ...result.data.regulatory.prefill };
}

/** Starts setting up the dedicated number (voice.number_request). */
export async function requestVoiceNumberAction(): Promise<SettingsActionResult> {
  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only an owner or admin can request a number." };
  const result = await runOperation("voice.number_request", {}, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/settings");
  return { ok: true, message: "Number requested. We will show each step here as it happens." };
}

/** Releases the number. Owner only; called from the typed confirmation dialog. */
export async function releaseVoiceNumberAction(confirmE164: unknown): Promise<SettingsActionResult> {
  const parsed = z.string().trim().min(8).max(20).safeParse(confirmE164);
  if (!parsed.success) return { ok: false, error: "Type the number exactly as shown to confirm the release." };
  const workspace = await actor("owner");
  if (!workspace) return { ok: false, error: "Only the workspace owner can release the number." };
  const result = await runOperation("voice.number_release", { confirmE164: parsed.data }, context(workspace, true));
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/settings");
  return { ok: true, message: "Release scheduled. Queued calls have been cancelled." };
}

const requestCallInput = z.object({
  leadId: z.uuid(),
  recordCallRequest: z.object({ note: z.string().trim().min(3).max(500) }).optional(),
});

export type RequestCallResult =
  | { ok: true; message: string }
  | { ok: false; error: string; code: string; productState: string | null };

/** Places an AI call to a lead (voice.request_call). Called from the confirmation dialog only. */
export async function requestVoiceCallAction(input: unknown): Promise<RequestCallResult> {
  const parsed = requestCallInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Add a short note (at least 3 characters) about how the lead asked to be called.", code: "INVALID_INPUT", productState: null };
  }
  const workspace = await requireWorkspace();
  const result = await runOperation(
    "voice.request_call",
    { leadId: parsed.data.leadId, route: "QUALIFICATION", recordCallRequest: parsed.data.recordCallRequest },
    context(workspace, true),
  );
  if (!result.success) {
    return { ok: false, error: result.message, code: result.code, productState: result.warnings[0]?.code ?? null };
  }
  revalidatePath(`/app/leads/${parsed.data.leadId}`);
  const deferred = result.warnings.find((w) => w.code === "deferred");
  return { ok: true, message: deferred ? deferred.message : "The call is queued and will start shortly." };
}

/** Cancels a call that has not started yet (voice.cancel_call). */
export async function cancelVoiceCallAction(input: unknown): Promise<SettingsActionResult> {
  const parsed = z.object({ callId: z.uuid(), leadId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That call could not be found." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "Viewers can't cancel calls." };
  const result = await runOperation("voice.cancel_call", { callId: parsed.data.callId }, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath(`/app/leads/${parsed.data.leadId}`);
  return { ok: true, message: "Call cancelled. Its minutes are back in your balance." };
}
