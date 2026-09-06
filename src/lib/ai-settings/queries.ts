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
    // An unrecognised stored mode reads as OFF. A settings row can only ever
    // fail safe.
    agentMode:
      (["OFF", "SUGGEST_ONLY", "AUTO_REPLY"] as const).find(
        (mode) => mode === aiSettings.data?.agent_mode,
      ) ?? DEFAULT_AI_BEHAVIOUR.agentMode,
    agentChannels: (["sms", "whatsapp", "email"] as const).filter((channel) =>
      (aiSettings.data?.agent_channels ?? DEFAULT_AI_BEHAVIOUR.agentChannels).includes(channel),
    ),
    agentHandoverOnReview:
      aiSettings.data?.agent_handover_on_review ?? DEFAULT_AI_BEHAVIOUR.agentHandoverOnReview,
    agentAnswerServiceQuestions:
      aiSettings.data?.agent_answer_service_questions ??
      DEFAULT_AI_BEHAVIOUR.agentAnswerServiceQuestions,
  };
}

/**
 * Whether the workspace has its own mailbox connected. Email is the one agent
 * channel with no platform fallback sender, so offering it before a mailbox
 * exists would let a workspace enable a channel that can never send.
 */
export async function isEmailChannelConnected(businessId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("integrations")
    .select("status")
    .eq("business_id", businessId)
    .eq("provider_type", "smtp_mailbox")
    .maybeSingle();

  return Boolean(data) && data?.status !== "DISCONNECTED" && data?.status !== "ACTION_REQUIRED";
}
