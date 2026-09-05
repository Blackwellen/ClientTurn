import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_AI_BEHAVIOUR, type AiBehaviourSettings } from "./types";

export async function getAiBehaviour(businessId: string): Promise<AiBehaviourSettings> {
  const supabase = createAdminClient();
  const [settings, aiSettings] = await Promise.all([
    supabase
      .from("business_settings")
      .select("ai_assist_enabled")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("business_ai_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  return {
    enabled: settings.data?.ai_assist_enabled ?? DEFAULT_AI_BEHAVIOUR.enabled,
    tone: (aiSettings.data?.tone as AiBehaviourSettings["tone"]) ?? DEFAULT_AI_BEHAVIOUR.tone,
    replyLength:
      (aiSettings.data?.reply_length as AiBehaviourSettings["replyLength"]) ??
      DEFAULT_AI_BEHAVIOUR.replyLength,
    businessDescription:
      aiSettings.data?.business_description ?? DEFAULT_AI_BEHAVIOUR.businessDescription,
    handoverInstruction:
      aiSettings.data?.handover_instruction ?? DEFAULT_AI_BEHAVIOUR.handoverInstruction,
    allowAiReply: aiSettings.data?.allow_ai_reply ?? DEFAULT_AI_BEHAVIOUR.allowAiReply,
    allowAiInterpretation:
      aiSettings.data?.allow_ai_interpretation ?? DEFAULT_AI_BEHAVIOUR.allowAiInterpretation,
  };
}
