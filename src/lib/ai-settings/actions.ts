"use server";

import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { saveAiBehaviourSchema, type AiBehaviourSettings } from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

async function admin(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

export async function saveAiBehaviour(
  input: Partial<AiBehaviourSettings>,
): Promise<ActionResult> {
  const parsed = saveAiBehaviourSchema.safeParse(input);
  if (!parsed.success) return fail("Check the AI behaviour fields and try again.");

  const workspace = await admin();
  if (!workspace) return fail("You do not have permission to change AI settings.");

  if (parsed.data.enabled) {
    try {
      await assertEntitlement(workspace.businessId, "ai_assist");
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("Could not verify your plan's AI entitlement.");
    }
  }

  const supabase = createAdminClient();

  const { error: settingsError } = await supabase.from("business_settings").upsert(
    { business_id: workspace.businessId, ai_assist_enabled: parsed.data.enabled },
    { onConflict: "business_id" },
  );
  if (settingsError) return fail("Could not save the AI on/off switch.");

  const { error: aiSettingsError } = await supabase.from("business_ai_settings").upsert(
    {
      business_id: workspace.businessId,
      tone: parsed.data.tone,
      reply_length: parsed.data.replyLength,
      business_description: parsed.data.businessDescription || null,
      handover_instruction: parsed.data.handoverInstruction || null,
      allow_ai_reply: parsed.data.allowAiReply,
      allow_ai_interpretation: parsed.data.allowAiInterpretation,
      // Turning AI assist off turns the agent off with it, in the same write.
      // Leaving a stale AUTO_REPLY behind would be a live actor with its
      // master switch off.
      agent_mode: parsed.data.enabled ? parsed.data.agentMode : "OFF",
      agent_channels: parsed.data.agentChannels,
      agent_handover_on_review: parsed.data.agentHandoverOnReview,
      agent_answer_service_questions: parsed.data.agentAnswerServiceQuestions,
    },
    { onConflict: "business_id" },
  );
  if (aiSettingsError) return fail("Could not save AI behaviour.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "ai_settings.updated",
    entityType: "business_ai_settings",
    entityId: workspace.businessId,
    metadata: {
      enabled: parsed.data.enabled,
      tone: parsed.data.tone,
      agentMode: parsed.data.enabled ? parsed.data.agentMode : "OFF",
      agentChannels: parsed.data.agentChannels,
    },
  });

  revalidatePath("/app/follow-up");
  revalidatePath("/app/settings");
  return { ok: true };
}
