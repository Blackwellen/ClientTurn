import { z } from "zod";

/**
 * AI Behaviour settings (§6, §32). Deliberately thin — no temperature,
 * tokens, model IDs, system prompts or confidence thresholds are ever
 * exposed here; those stay internal to src/lib/ai/.
 */

export const AI_TONE_OPTIONS = ["professional", "friendly", "direct"] as const;
export const AI_REPLY_LENGTH_OPTIONS = ["short", "normal"] as const;

export type AiBehaviourSettings = {
  /** Master on/off switch — business_settings.ai_assist_enabled. */
  enabled: boolean;
  tone: (typeof AI_TONE_OPTIONS)[number];
  replyLength: (typeof AI_REPLY_LENGTH_OPTIONS)[number];
  businessDescription: string;
  handoverInstruction: string;
  allowAiReply: boolean;
  allowAiInterpretation: boolean;
};

export const saveAiBehaviourSchema = z.object({
  enabled: z.boolean(),
  tone: z.enum(AI_TONE_OPTIONS),
  replyLength: z.enum(AI_REPLY_LENGTH_OPTIONS),
  businessDescription: z.string().max(600).default(""),
  handoverInstruction: z.string().max(300).default(""),
  allowAiReply: z.boolean(),
  allowAiInterpretation: z.boolean(),
});

export const DEFAULT_AI_BEHAVIOUR: AiBehaviourSettings = {
  enabled: false,
  tone: "professional",
  replyLength: "short",
  businessDescription: "",
  handoverInstruction: "",
  allowAiReply: false,
  allowAiInterpretation: true,
};
