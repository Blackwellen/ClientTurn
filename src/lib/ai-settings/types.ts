import { z } from "zod";

/**
 * AI Behaviour settings. Deliberately thin — no temperature, tokens, model
 * IDs, system prompts or confidence thresholds are ever exposed here; those
 * stay internal to src/lib/ai/ and src/lib/agent/.
 *
 * Two layers live in this file and they are not the same thing:
 *
 *   * `enabled` / `tone` / `allowAiReply` / `allowAiInterpretation` govern the
 *     *assist* layer — AI rewording a message ClientTurn had already decided
 *     to send, and AI interpreting an answer the deterministic matcher could
 *     not parse.
 *   * `agentMode` and the fields under it govern the *conversation agent* —
 *     an actor that decides what to say. It is off by default in every
 *     workspace, and it is gated by `enabled` as well, so turning AI assist
 *     off turns the agent off with it.
 */

export const AI_TONE_OPTIONS = ["professional", "friendly", "direct"] as const;
export const AI_REPLY_LENGTH_OPTIONS = ["short", "normal"] as const;

export const AGENT_MODE_OPTIONS = [
  {
    value: "OFF" as const,
    label: "Off",
    description: "Replies follow your configured follow-up and qualification steps only.",
  },
  {
    value: "SUGGEST_ONLY" as const,
    label: "Suggest replies",
    description:
      "The assistant drafts a reply and notifies you. Nothing is sent until someone approves it.",
  },
  {
    value: "AUTO_REPLY" as const,
    label: "Reply automatically",
    description:
      "The assistant answers, qualifies and offers booking on its own, and passes anything it should not handle to your team.",
  },
];

export const AGENT_CHANNEL_OPTIONS = [
  { value: "sms" as const, label: "SMS" },
  { value: "whatsapp" as const, label: "WhatsApp" },
  { value: "email" as const, label: "Email" },
];

export type AgentModeValue = (typeof AGENT_MODE_OPTIONS)[number]["value"];
export type AgentChannelValue = (typeof AGENT_CHANNEL_OPTIONS)[number]["value"];

export type AiBehaviourSettings = {
  /** Master on/off switch — business_settings.ai_assist_enabled. */
  enabled: boolean;
  tone: (typeof AI_TONE_OPTIONS)[number];
  replyLength: (typeof AI_REPLY_LENGTH_OPTIONS)[number];
  businessDescription: string;
  handoverInstruction: string;
  allowAiReply: boolean;
  allowAiInterpretation: boolean;
  /** Conversation agent. OFF unless a workspace deliberately turns it on. */
  agentMode: AgentModeValue;
  agentChannels: AgentChannelValue[];
  /** Send a REVIEW qualification result to a person rather than replying. */
  agentHandoverOnReview: boolean;
  /** Let the agent answer general service questions, not only qualify. */
  agentAnswerServiceQuestions: boolean;
};

export const saveAiBehaviourSchema = z.object({
  enabled: z.boolean(),
  tone: z.enum(AI_TONE_OPTIONS),
  replyLength: z.enum(AI_REPLY_LENGTH_OPTIONS),
  businessDescription: z.string().max(600).default(""),
  handoverInstruction: z.string().max(300).default(""),
  allowAiReply: z.boolean(),
  allowAiInterpretation: z.boolean(),
  agentMode: z.enum(["OFF", "SUGGEST_ONLY", "AUTO_REPLY"]).default("OFF"),
  agentChannels: z.array(z.enum(["sms", "whatsapp", "email"])).max(3).default([]),
  agentHandoverOnReview: z.boolean().default(true),
  agentAnswerServiceQuestions: z.boolean().default(true),
});

export const DEFAULT_AI_BEHAVIOUR: AiBehaviourSettings = {
  enabled: false,
  tone: "professional",
  replyLength: "short",
  businessDescription: "",
  handoverInstruction: "",
  allowAiReply: false,
  allowAiInterpretation: true,
  agentMode: "OFF",
  agentChannels: ["sms", "whatsapp"],
  agentHandoverOnReview: true,
  agentAnswerServiceQuestions: true,
};
