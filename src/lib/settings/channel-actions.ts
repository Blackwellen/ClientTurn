"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { runOperation, type ServiceResult } from "@/lib/services";

/**
 * Settings actions for the channel and booking controls (brief §29, §45, §57).
 *
 * Thin by design: resolve the actor, run the service operation. Permission,
 * validation, audit and the write itself live behind `runOperation` -- the
 * same path MCP and the API take -- so the UI cannot do anything they cannot.
 */

export type ChannelActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string };

async function admin(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

function context(workspace: ActiveWorkspace) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    correlationId: randomUUID(),
  };
}

function failure(result: ServiceResult): { ok: false; error: string } {
  return { ok: false, error: result.success ? "That did not work." : result.message };
}

const DENIED = { ok: false as const, error: "Only owners and admins can change this." };

export async function setCrmPullAction(input: {
  integrationId: string;
  enabled: boolean;
}): Promise<ChannelActionResult> {
  const workspace = await admin();
  if (!workspace) return DENIED;
  const result = await runOperation("crm_pull.set", input, context(workspace));
  if (!result.success) return failure(result);
  revalidatePath("/app/settings");
  return {
    ok: true,
    message: input.enabled
      ? "New contacts from this CRM will be imported from now on."
      : "Importing from this CRM is switched off.",
  };
}

export async function syncWhatsAppTemplatesAction(): Promise<ChannelActionResult> {
  const workspace = await admin();
  if (!workspace) return DENIED;
  const result = await runOperation<{ transport: string; result: unknown }>(
    "whatsapp_template.sync",
    {},
    context(workspace),
  );
  if (!result.success) return failure(result);
  revalidatePath("/app/settings");
  const outcome = result.data.result;
  if (outcome === "NOT_CONFIGURED") {
    return { ok: false, error: "WhatsApp through Twilio is not configured on this platform yet." };
  }
  if (outcome === "NOT_CONNECTED") {
    return { ok: false, error: "Connect your WhatsApp Business number before syncing its templates." };
  }
  const synced = (outcome as { synced?: number } | null)?.synced ?? 0;
  return { ok: true, message: `${synced} template${synced === 1 ? "" : "s"} synced.` };
}

export async function mapWhatsAppStepAction(input: {
  automationId: string;
  stepPosition: number;
  templateId: string | null;
  variableMap?: Record<string, string>;
}): Promise<ChannelActionResult> {
  const workspace = await admin();
  if (!workspace) return DENIED;
  const result = await runOperation("whatsapp_template.map_step", input, context(workspace));
  if (!result.success) return failure(result);
  revalidatePath("/app/settings");
  return {
    ok: true,
    message: input.templateId ? "Template saved on the step." : "Template removed from the step.",
  };
}

export async function saveMeetingTypeAction(input: unknown): Promise<ChannelActionResult> {
  const workspace = await admin();
  if (!workspace) return DENIED;
  const result = await runOperation("meeting_type.save", input, context(workspace));
  if (!result.success) return failure(result);
  revalidatePath("/app/settings");
  return { ok: true, message: "Meeting type saved." };
}

export async function archiveMeetingTypeAction(input: { id: string }): Promise<ChannelActionResult> {
  const workspace = await admin();
  if (!workspace) return DENIED;
  const result = await runOperation("meeting_type.archive", input, context(workspace));
  if (!result.success) return failure(result);
  revalidatePath("/app/settings");
  return { ok: true, message: "Meeting type archived. Existing bookings keep it." };
}
